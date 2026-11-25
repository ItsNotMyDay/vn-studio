"""Isolated ACE-Step 1.5 runtime for local music generation.

The audio engine is installed in its own uv environment so its pinned PyTorch and
Transformers dependencies cannot replace the VN Studio AI server packages.
"""
from __future__ import annotations

import json
import os
import shutil
import signal
import subprocess
import sys
import threading
import time
import uuid
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any



ACE_STEP_REPOSITORY = "https://github.com/ACE-Step/ACE-Step-1.5"
ACE_STEP_REVISION = "ca1e85fe9430179831e6bc6be790c332190a3866"
ACE_STEP_ARCHIVE = (
    f"https://codeload.github.com/ACE-Step/ACE-Step-1.5/zip/{ACE_STEP_REVISION}"
)
DEFAULT_AUDIO_PORT = int(os.environ.get("VN_AUDIO_PORT", "8766"))




def unwrap_api_data(payload: Any) -> Any:
    """Unwrap ACE-Step's {data, code, ...} response envelope."""
    if isinstance(payload, dict) and "data" in payload:
        return payload.get("data")
    return payload


def parse_generated_audio_path(task_result: Any) -> str:
    """Extract the generated file path from ACE-Step's legacy result payload."""
    if isinstance(task_result, str):
        try:
            task_result = json.loads(task_result)
        except json.JSONDecodeError as exc:
            raise RuntimeError("ACE-Step вернул некорректный JSON результата") from exc
    if isinstance(task_result, dict):
        records = [task_result]
    elif isinstance(task_result, list):
        records = task_result
    else:
        records = []
    for record in records:
        if not isinstance(record, dict):
            continue
        path = record.get("file") or record.get("path") or record.get("audio_path")
        if isinstance(path, str) and path.strip():
            return path.strip()
    raise RuntimeError("ACE-Step завершил задачу, но не вернул путь к аудиофайлу")


def safe_extract_zip(archive: zipfile.ZipFile, destination: Path) -> Path:
    """Extract an archive while rejecting absolute paths and traversal entries."""
    root = destination.resolve()
    for member in archive.infolist():
        member_path = (root / member.filename).resolve()
        if member_path != root and root not in member_path.parents:
            raise RuntimeError("Архив ACE-Step содержит недопустимый путь")
    archive.extractall(root)
    roots = [item for item in root.iterdir() if item.is_dir()]
    if len(roots) != 1:
        raise RuntimeError("Не удалось определить корневую папку архива ACE-Step")
    return roots[0]


class AudioRuntime:
    def __init__(self, base_dir: str | Path | None = None, port: int = DEFAULT_AUDIO_PORT):
        default_dir = Path(__file__).resolve().parent / "audio-runtime"
        self.base_dir = Path(base_dir or default_dir).resolve()
        self.repo_dir = self.base_dir / "ACE-Step-1.5"
        self.generated_dir = self.base_dir / "generated"
        self.archive_path = self.base_dir / "ace-step-source.zip"
        self.port = int(port)
        self.base_url = f"http://127.0.0.1:{self.port}"

        self._lock = threading.RLock()
        self._generation_lock = threading.Lock()
        self._executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="vn-audio")
        self._jobs: dict[str, dict[str, Any]] = {}
        self._process: subprocess.Popen | None = None
        self._log_tail: list[str] = []
        self._last_error: str | None = None
        self._active_process: subprocess.Popen | None = None
        self._shutdown = False

    def _append_log(self, line: str) -> None:
        clean = str(line).rstrip()
        if not clean:
            return
        with self._lock:
            self._log_tail.append(clean[-500:])
            self._log_tail = self._log_tail[-80:]

    def _update_job(self, job_id: str, **patch: Any) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is not None:
                job.update(patch)
                job["updated_at"] = time.time()

    def _submit(self, kind: str, stage: str, fn) -> str:
        job_id = uuid.uuid4().hex[:12]
        with self._lock:
            active = [
                item for item in self._jobs.values()
                if item.get("kind") == kind and item.get("state") in ("queued", "running")
            ]
            if active:
                raise RuntimeError("Операция такого типа уже выполняется")
            self._jobs[job_id] = {
                "kind": kind,
                "state": "queued",
                "progress": 0.0,
                "stage": stage,
                "message": None,
                "result": None,
                "file_path": None,
                "created_at": time.time(),
                "updated_at": time.time(),
            }
        self._executor.submit(self._run_job, job_id, fn)
        return job_id

    def _run_job(self, job_id: str, fn) -> None:
        self._update_job(job_id, state="running", progress=0.01)
        try:
            result = fn(job_id)
            self._update_job(
                job_id,
                state="done",
                progress=1.0,
                stage="Готово",
                result=result,
            )
        except Exception as exc:
            message = f"{type(exc).__name__}: {exc}"
            with self._lock:
                self._last_error = message
            self._append_log(message)
            self._update_job(job_id, state="error", message=message, stage="Ошибка")

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return None
            return {
                key: value for key, value in job.items()
                if key not in ("file_path", "created_at", "updated_at")
            }

    def get_job_file(self, job_id: str) -> Path | None:
        with self._lock:
            job = self._jobs.get(job_id)
            raw_path = job.get("file_path") if job else None
        if not raw_path:
            return None
        path = Path(raw_path).resolve()
        try:
            path.relative_to(self.generated_dir.resolve())
        except ValueError:
            return None
        return path if path.is_file() else None

    def _installed(self) -> bool:
        if not (self.repo_dir / "pyproject.toml").is_file():
            return False
        if os.name == "nt":
            return (self.repo_dir / ".venv" / "Scripts" / "python.exe").is_file()
        return (self.repo_dir / ".venv" / "bin" / "python").is_file()

    def _uv_command(self) -> str:
        found = shutil.which("uv")
        if found:
            return found
        scripts = Path(sys.executable).resolve().parent
        candidates = (
            scripts / "uv.exe",
            scripts / "Scripts" / "uv.exe",
            scripts / "uv",
        )
        for candidate in candidates:
            if candidate.is_file():
                return str(candidate)
        raise RuntimeError(
            "Не найден uv. Установи зависимости ai-server из актуального requirements.txt "
            "(в нём должен быть uv)."
        )

    def _run_command(
        self,
        command: list[str],
        cwd: Path,
        env: dict[str, str],
        job_id: str,
        stage: str,
        progress: float,
        timeout: float = 4 * 60 * 60,
    ) -> None:
        self._update_job(job_id, stage=stage, progress=progress)
        self._append_log("$ " + " ".join(command))
        proc = subprocess.Popen(
            command,
            cwd=str(cwd),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
            start_new_session=os.name != "nt",
        )
        with self._lock:
            self._active_process = proc
        started = time.monotonic()
        try:
            assert proc.stdout is not None
            for line in proc.stdout:
                self._append_log(line)
                clean = line.strip()
                if clean:
                    self._update_job(job_id, stage=f"{stage}: {clean[-110:]}")
                if time.monotonic() - started > timeout:
                    self._terminate_process(proc)
                    raise TimeoutError(f"Превышено время операции: {stage}")
            return_code = proc.wait(timeout=10)
            if return_code != 0:
                with self._lock:
                    tail = "\n".join(self._log_tail[-12:])
                raise RuntimeError(
                    f"Команда завершилась с кодом {return_code}.\n{tail}"
                )
        finally:
            with self._lock:
                if self._active_process is proc:
                    self._active_process = None

    def _download_source(self, job_id: str) -> None:
        self.base_dir.mkdir(parents=True, exist_ok=True)
        self._update_job(
            job_id,
            stage="Скачивание исходников ACE-Step 1.5",
            progress=0.03,
        )
        request = urllib.request.Request(
            ACE_STEP_ARCHIVE,
            headers={"User-Agent": "VN-Studio-AudioRuntime/1.0"},
        )
        temp_archive = self.archive_path.with_suffix(".zip.part")
        with urllib.request.urlopen(request, timeout=60) as response:
            total = int(response.headers.get("Content-Length") or 0)
            written = 0
            with temp_archive.open("wb") as output:
                while True:
                    block = response.read(1024 * 1024)
                    if not block:
                        break
                    output.write(block)
                    written += len(block)
                    if total:
                        progress = 0.03 + min(0.22, 0.22 * written / total)
                        self._update_job(
                            job_id,
                            progress=progress,
                            stage=f"Скачивание исходников: {written / 1024 / 1024:.0f} МБ",
                        )
        temp_archive.replace(self.archive_path)
        self._update_job(job_id, stage="Распаковка ACE-Step", progress=0.27)

        extraction_dir = self.base_dir / f"extract-{uuid.uuid4().hex[:8]}"
        extraction_dir.mkdir(parents=True, exist_ok=True)
        try:
            with zipfile.ZipFile(self.archive_path) as archive:
                extracted_root = safe_extract_zip(archive, extraction_dir)
            new_repo = self.base_dir / f"repo-{uuid.uuid4().hex[:8]}"
            shutil.move(str(extracted_root), str(new_repo))
            if self.repo_dir.exists():
                shutil.rmtree(self.repo_dir)
            new_repo.replace(self.repo_dir)
        finally:
            shutil.rmtree(extraction_dir, ignore_errors=True)
        self._update_job(job_id, progress=0.32, stage="Исходники ACE-Step готовы")

    def install(self) -> str:
        return self._submit("install", "Подготовка установки ACE-Step", self._install)

    def _install(self, job_id: str) -> dict[str, Any]:
        if self._installed():
            self._update_job(job_id, progress=0.98, stage="Движок уже установлен")
            return {"installed": True, "already_installed": True}
        if self.process_running():
            raise RuntimeError("Сначала останови работающий аудиодвижок")
        self._download_source(job_id)
        uv = self._uv_command()
        env = os.environ.copy()
        env["UV_PROJECT_ENVIRONMENT"] = str(self.repo_dir / ".venv")
        env["UV_PYTHON_DOWNLOADS"] = "automatic"
        self._run_command(
            [uv, "sync", "--python", "3.11", "--no-dev"],
            self.repo_dir,
            env,
            job_id,
            "Создание изолированной среды Python 3.11 и установка зависимостей",
            0.34,
            timeout=4 * 60 * 60,
        )
        if not self._installed():
            raise RuntimeError("uv завершил установку, но виртуальная среда ACE-Step не найдена")
        return {"installed": True, "revision": ACE_STEP_REVISION}

    def process_running(self) -> bool:
        with self._lock:
            process = self._process
        return bool(process is not None and process.poll() is None)

    def _read_process_output(self, process: subprocess.Popen) -> None:
        stream = process.stdout
        if stream is None:
            return
        try:
            for line in stream:
                self._append_log(line)
        except Exception as exc:
            self._append_log(f"Не удалось прочитать лог ACE-Step: {exc}")

    def _read_json(self, path: str, timeout: float = 5) -> Any:
        req = urllib.request.Request(self.base_url + path, headers={"User-Agent": "VN-Studio"})
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))

    def _post_json(self, path: str, payload: dict[str, Any], timeout: float = 30) -> Any:
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            self.base_url + path,
            data=data,
            headers={"Content-Type": "application/json", "User-Agent": "VN-Studio"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))

    def _start_service(self, job_id: str) -> dict[str, Any]:
        if not self._installed():
            raise RuntimeError("Сначала установи аудиодвижок")
        if self.process_running():
            try:
                payload = unwrap_api_data(self._read_json("/health"))
                if isinstance(payload, dict) and payload.get("models_initialized"):
                    self._update_job(job_id, progress=0.98, stage="Аудиомодель уже загружена")
                    return {"model_loaded": True, "already_running": True}
            except Exception:
                pass
            self.stop_service()

        uv = self._uv_command()
        env = os.environ.copy()
        env["ACESTEP_API_HOST"] = "127.0.0.1"
        env["ACESTEP_API_PORT"] = str(self.port)
        env["ACESTEP_NO_INIT"] = "false"
        env["ACESTEP_INIT_LLM"] = "false"
        env["ACESTEP_CONFIG_PATH"] = "acestep-v15-turbo"
        env["ACESTEP_LLM_BACKEND"] = "pt"
        env.pop("ACESTEP_API_KEY", None)
        command = [
            uv, "run", "--project", str(self.repo_dir), "--no-sync",
            "acestep-api", "--host", "127.0.0.1", "--port", str(self.port),
        ]
        self._append_log("Запуск ACE-Step 1.5 API")
        process = subprocess.Popen(
            command,
            cwd=str(self.repo_dir),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
            start_new_session=os.name != "nt",
        )
        with self._lock:
            self._process = process
            self._last_error = None
        threading.Thread(
            target=self._read_process_output,
            args=(process,),
            daemon=True,
            name="vn-audio-log",
        ).start()

        deadline = time.monotonic() + 2 * 60 * 60
        last_stage = 0.35
        while time.monotonic() < deadline:
            if process.poll() is not None:
                with self._lock:
                    tail = "\n".join(self._log_tail[-20:])
                raise RuntimeError(f"ACE-Step завершился с кодом {process.returncode}.\n{tail}")
            try:
                data = unwrap_api_data(self._read_json("/health"))
                if isinstance(data, dict) and data.get("models_initialized"):
                    self._update_job(
                        job_id,
                        progress=0.98,
                        stage="ACE-Step 1.5: модель загружена в память",
                    )
                    return {
                        "model_loaded": True,
                        "model": data.get("loaded_model") or "acestep-v15-turbo",
                        "port": self.port,
                    }
                if isinstance(data, dict):
                    stage = "Запуск API ACE-Step; подготовка модели"
                    if data.get("llm_initialized"):
                        stage += "; дополнительная LM загружена"
                    self._update_job(job_id, progress=last_stage, stage=stage)
            except (OSError, urllib.error.URLError, TimeoutError, ValueError, json.JSONDecodeError):
                pass
            time.sleep(2)
            last_stage = min(0.9, last_stage + 0.002)
        self.stop_service()
        raise TimeoutError("ACE-Step не завершил загрузку модели за 2 часа")

    def start(self) -> str:
        return self._submit("start", "Запуск ACE-Step 1.5", self._start_service)

    def _terminate_process(self, process: subprocess.Popen) -> None:
        if process.poll() is not None:
            return
        try:
            if os.name == "nt":
                subprocess.run(
                    ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    timeout=20,
                    check=False,
                )
            else:
                os.killpg(os.getpgid(process.pid), signal.SIGTERM)
                try:
                    process.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    os.killpg(os.getpgid(process.pid), signal.SIGKILL)
        except Exception:
            try:
                process.terminate()
            except Exception:
                pass
        try:
            process.wait(timeout=5)
        except Exception:
            pass

    def stop_service(self) -> None:
        with self._lock:
            process = self._process
            self._process = None
        if process is not None:
            self._terminate_process(process)
        self._append_log("ACE-Step остановлен")

    def stop(self) -> dict[str, Any]:
        self.stop_service()
        return {"ok": True, "running": False}

    def health(self) -> dict[str, Any]:
        installed = self._installed()
        running = self.process_running()
        data = None
        service_error = None
        if running:
            try:
                data = unwrap_api_data(self._read_json("/health"))
            except Exception as exc:
                service_error = str(exc)
        model_loaded = bool(
            isinstance(data, dict) and data.get("models_initialized")
        )
        with self._lock:
            latest_log = list(self._log_tail[-8:])
            last_error = self._last_error
            process = self._process
        return {
            "installed": installed,
            "running": running,
            "model_loaded": model_loaded,
            "model": (data or {}).get("loaded_model") if isinstance(data, dict) else None,
            "port": self.port,
            "stage": (
                "Модель загружена"
                if model_loaded
                else "Запуск ACE-Step"
                if running
                else "Движок установлен"
                if installed
                else "Движок не установлен"
            ),
            "error": service_error or last_error,
            "log_tail": latest_log,
            "pid": process.pid if process is not None and running else None,
        }

    def generate(self, request: Any) -> str:
        status = self.health()
        if not status["model_loaded"]:
            raise RuntimeError("Сначала запусти ACE-Step и дождись загрузки аудиомодели")
        return self._submit("generate", "Ожидание генерации", lambda job_id: self._generate(job_id, request))

    def _generate(self, job_id: str, request: AudioGenerateRequest) -> dict[str, Any]:
        if not self._generation_lock.acquire(blocking=False):
            raise RuntimeError("ACE-Step уже выполняет другую генерацию. Дождись её завершения.")
        try:
            if not self.health()["model_loaded"]:
                raise RuntimeError("Аудиомодель больше не загружена")
            lyrics = request.lyrics.strip()
            if request.instrumental:
                lyrics = "[Instrumental]"
            payload: dict[str, Any] = {
                "prompt": request.prompt.strip(),
                "lyrics": lyrics,
                "thinking": False,
                "use_format": False,
                "audio_duration": float(request.duration),
                "inference_steps": 8,
                "use_random_seed": True,
                "task_type": "text2music",
                "audio_format": "wav",
                "batch_size": 1,
                "use_cot_caption": False,
                "use_cot_language": False,
            }
            if request.bpm is not None:
                payload["bpm"] = request.bpm

            self._update_job(job_id, progress=0.02, stage="Отправка запроса ACE-Step")
            task_response = unwrap_api_data(self._post_json("/release_task", payload))
            if not isinstance(task_response, dict) or not task_response.get("task_id"):
                raise RuntimeError("ACE-Step не вернул task_id")
            task_id = str(task_response["task_id"])
            self._update_job(job_id, progress=0.08, stage="Генерация аудио")

            deadline = time.monotonic() + 90 * 60
            while time.monotonic() < deadline:
                if not self.health()["running"]:
                    raise RuntimeError("Процесс ACE-Step остановился во время генерации")
                result = self._post_json("/query_result", {"task_id_list": [task_id]}, timeout=30)
                data = unwrap_api_data(result)
                item = data[0] if isinstance(data, list) and data else None
                if not isinstance(item, dict):
                    raise RuntimeError("ACE-Step вернул пустой статус задачи")
                try:
                    state = int(item.get("status", 0))
                except (TypeError, ValueError):
                    state = 0
                message = str(item.get("progress_text") or "ACE-Step генерирует аудио")
                if state == 1:
                    audio_path = parse_generated_audio_path(item.get("result"))
                    break
                if state == 2:
                    detail = item.get("result") or item.get("error") or message
                    raise RuntimeError(f"ACE-Step не смог сгенерировать аудио: {detail}")
                self._update_job(job_id, progress=0.12, stage=message[:160])
                time.sleep(2)
            else:
                raise TimeoutError("Время ожидания генерации аудио истекло")

            query = urllib.parse.urlencode({"path": audio_path})
            audio_url = f"{self.base_url}/v1/audio?{query}"
            req = urllib.request.Request(audio_url, headers={"User-Agent": "VN-Studio"})
            self._update_job(job_id, progress=0.92, stage="Получение готового аудиофайла")
            with urllib.request.urlopen(req, timeout=120) as response:
                audio_bytes = response.read()
            if not audio_bytes:
                raise RuntimeError("ACE-Step вернул пустой аудиофайл")

            self.generated_dir.mkdir(parents=True, exist_ok=True)
            output_path = (self.generated_dir / f"{job_id}.wav").resolve()
            output_path.write_bytes(audio_bytes)
            self._update_job(
                job_id,
                progress=0.98,
                stage="Аудио готово",
                file_path=str(output_path),
            )
            return {
                "filename": output_path.name,
                "duration": float(request.duration),
                "mode": request.mode,
                "mime": "audio/wav",
            }
        finally:
            self._generation_lock.release()

    def shutdown(self) -> None:
        with self._lock:
            self._shutdown = True
        self.stop_service()
        self._executor.shutdown(wait=False, cancel_futures=True)


AUDIO_RUNTIME = AudioRuntime()
