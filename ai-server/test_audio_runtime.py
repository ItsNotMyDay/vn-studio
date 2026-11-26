import json
import tempfile
import unittest
import zipfile
import sys
import urllib.parse
from pathlib import Path
from subprocess import CompletedProcess
from unittest.mock import patch

from audio_runtime import (
    AudioRuntime,
    parse_generated_audio_path,
    safe_extract_zip,
    unwrap_api_data,
)


class AudioRuntimeTests(unittest.TestCase):
    def test_unwraps_native_api_response(self):
        self.assertEqual(unwrap_api_data({"data": {"task_id": "abc"}, "code": 200}), {"task_id": "abc"})
        self.assertEqual(unwrap_api_data({"task_id": "abc"}), {"task_id": "abc"})

    def test_parses_generated_audio_file_from_json_string(self):
        raw = json.dumps([{"file": "C:/audio/result.wav"}])
        self.assertEqual(parse_generated_audio_path(raw), "C:/audio/result.wav")

    def test_parses_generated_audio_file_from_object(self):
        self.assertEqual(parse_generated_audio_path({"path": "/tmp/result.wav"}), "/tmp/result.wav")

    def test_parses_generated_audio_download_url(self):
        audio_path = r"C:\Users\Test User\audio-runtime\tmp\api_audio\result.wav"
        audio_url = "/v1/audio?path=" + urllib.parse.quote(audio_path, safe="")
        result = json.dumps([{"file": audio_url}])
        self.assertEqual(parse_generated_audio_path(result), audio_path)

    def test_parses_absolute_generated_audio_download_url(self):
        audio_path = "/opt/acestep/tmp/api_audio/result.wav"
        audio_url = "http://127.0.0.1:8766/v1/audio?path=" + urllib.parse.quote(audio_path, safe="")
        self.assertEqual(parse_generated_audio_path({"file": audio_url}), audio_path)

    def test_rejects_missing_generated_audio_path(self):
        with self.assertRaises(RuntimeError):
            parse_generated_audio_path('{"status": "done"}')

    def test_safe_extract_accepts_normal_archive(self):
        with tempfile.TemporaryDirectory() as temp:
            destination = Path(temp) / "extract"
            destination.mkdir()
            archive_path = Path(temp) / "source.zip"
            with zipfile.ZipFile(archive_path, "w") as archive:
                archive.writestr("ACE-Step-1.5/pyproject.toml", "[project]")
            with zipfile.ZipFile(archive_path) as archive:
                root = safe_extract_zip(archive, destination)
            self.assertEqual(root.name, "ACE-Step-1.5")
            self.assertTrue((root / "pyproject.toml").is_file())

    def test_safe_extract_rejects_path_traversal(self):
        with tempfile.TemporaryDirectory() as temp:
            destination = Path(temp) / "extract"
            destination.mkdir()
            archive_path = Path(temp) / "malicious.zip"
            with zipfile.ZipFile(archive_path, "w") as archive:
                archive.writestr("../outside.txt", "must not escape")
            with zipfile.ZipFile(archive_path) as archive:
                with self.assertRaises(RuntimeError):
                    safe_extract_zip(archive, destination)
            self.assertFalse((Path(temp) / "outside.txt").exists())

    @patch("audio_runtime.shutil.which", return_value=None)
    @patch("audio_runtime.Path.is_file", return_value=False)
    @patch("audio_runtime.subprocess.run")
    def test_uv_command_uses_active_python_module_when_available(self, run, _is_file, _which):
        run.return_value = CompletedProcess(
            args=[sys.executable, "-m", "uv", "--version"],
            returncode=0,
            stdout="uv 0.9.0",
            stderr="",
        )
        with tempfile.TemporaryDirectory() as temp:
            runtime = AudioRuntime(base_dir=temp, port=18766)
            try:
                self.assertEqual(runtime._uv_command(), [sys.executable, "-m", "uv"])
                run.assert_called_once()
            finally:
                runtime.shutdown()

    @patch("audio_runtime.shutil.which", return_value=None)
    @patch("audio_runtime.Path.is_file", return_value=False)
    @patch("audio_runtime.subprocess.run")
    def test_uv_command_bootstraps_missing_uv_with_active_python(self, run, _is_file, _which):
        run.side_effect = [
            CompletedProcess(args=[], returncode=1, stdout="", stderr="No module named uv"),
            CompletedProcess(args=[], returncode=0, stdout="pip 25.0", stderr=""),
            CompletedProcess(args=[], returncode=0, stdout="Successfully installed uv", stderr=""),
            CompletedProcess(args=[], returncode=0, stdout="uv 0.9.0", stderr=""),
        ]
        with tempfile.TemporaryDirectory() as temp:
            runtime = AudioRuntime(base_dir=temp, port=18766)
            try:
                self.assertEqual(runtime._uv_command(), [sys.executable, "-m", "uv"])
                self.assertEqual(run.call_count, 4)
                install_args = run.call_args_list[2].args[0]
                self.assertEqual(
                    install_args,
                    [sys.executable, "-m", "pip", "install", "--disable-pip-version-check", "uv>=0.7.0"],
                )
            finally:
                runtime.shutdown()

    @patch.object(AudioRuntime, "_run_command")
    def test_sync_environment_repairs_locked_dependencies(self, run_command):
        with tempfile.TemporaryDirectory() as temp:
            runtime = AudioRuntime(base_dir=temp, port=18766)
            try:
                runtime.repo_dir.mkdir(parents=True)
                if __import__("os").name == "nt":
                    python_path = runtime.repo_dir / ".venv" / "Scripts" / "python.exe"
                else:
                    python_path = runtime.repo_dir / ".venv" / "bin" / "python"
                python_path.parent.mkdir(parents=True)
                python_path.touch()

                with patch(
                    "audio_runtime.subprocess.run",
                    return_value=CompletedProcess(
                        args=[], returncode=0, stdout="", stderr=""
                    ),
                ) as probe:
                    runtime._sync_environment(
                        "job123",
                        ["uv"],
                        "Проверка зависимостей",
                        0.12,
                    )

                sync_command, sync_cwd, sync_env, job_id, stage, progress = run_command.call_args_list[0].args[:6]
                self.assertEqual(
                    sync_command,
                    [
                        "uv",
                        "sync",
                        "--project",
                        str(runtime.repo_dir),
                        "--python",
                        "3.11",
                        "--no-dev",
                        "--locked",
                        "--no-install-package",
                        "torch",
                        "--no-install-package",
                        "torchvision",
                        "--no-install-package",
                        "torchaudio",
                    ],
                )
                self.assertEqual(sync_cwd, runtime.repo_dir)
                self.assertEqual(sync_env["UV_PROJECT_ENVIRONMENT"], str(runtime.repo_dir / ".venv"))
                self.assertEqual(job_id, "job123")
                self.assertEqual(stage, "Проверка зависимостей")
                self.assertEqual(progress, 0.12)

                torch_command, torch_cwd, _, _, torch_stage, _ = run_command.call_args_list[1].args[:6]
                self.assertIn("--torch-backend=auto", torch_command)
                self.assertIn("torch==2.7.1", torch_command)
                self.assertIn("torchaudio==2.7.1", torch_command)
                self.assertEqual(torch_cwd, runtime.base_dir)
                self.assertEqual(torch_stage, "Установка PyTorch для оборудования этого ПК")

                probe.assert_any_call(
                    [str(python_path), "-c", "import loguru"],
                    capture_output=True,
                    text=True,
                    timeout=30,
                    check=False,
                )
                probe.assert_any_call(
                    [
                        str(python_path),
                        "-c",
                        "import torch, torchvision, torchaudio; "
                        "print('torch=' + str(torch.__version__)); "
                        "print('cuda=' + str(torch.cuda.is_available())); "
                        "print('xpu=' + str(hasattr(torch, 'xpu') and torch.xpu.is_available()))",
                    ],
                    capture_output=True,
                    text=True,
                    timeout=60,
                    check=False,
                )
            finally:
                runtime.shutdown()

    @patch.object(AudioRuntime, "_run_command")
    def test_sync_environment_reports_missing_loguru_after_sync(self, run_command):
        with tempfile.TemporaryDirectory() as temp:
            runtime = AudioRuntime(base_dir=temp, port=18766)
            try:
                runtime.repo_dir.mkdir(parents=True)
                if __import__("os").name == "nt":
                    python_path = runtime.repo_dir / ".venv" / "Scripts" / "python.exe"
                else:
                    python_path = runtime.repo_dir / ".venv" / "bin" / "python"
                python_path.parent.mkdir(parents=True)
                python_path.touch()

                with patch(
                    "audio_runtime.subprocess.run",
                    return_value=CompletedProcess(
                        args=[], returncode=1, stdout="", stderr="No module named loguru"
                    ),
                ):
                    with self.assertRaisesRegex(RuntimeError, "loguru всё ещё недоступен"):
                        runtime._sync_environment(
                            "job123", ["uv"], "Проверка зависимостей", 0.12
                        )
            finally:
                runtime.shutdown()

    def test_api_server_command_uses_venv_python_module(self):
        with tempfile.TemporaryDirectory() as temp:
            runtime = AudioRuntime(base_dir=temp, port=18766)
            try:
                if __import__("os").name == "nt":
                    python_path = runtime.repo_dir / ".venv" / "Scripts" / "python.exe"
                else:
                    python_path = runtime.repo_dir / ".venv" / "bin" / "python"
                python_path.parent.mkdir(parents=True)
                python_path.touch()

                self.assertEqual(
                    runtime._api_server_command(),
                    [
                        str(python_path),
                        "-m",
                        "acestep.api_server",
                        "--host",
                        "127.0.0.1",
                        "--port",
                        "18766",
                    ],
                )
            finally:
                runtime.shutdown()

    def test_api_server_command_reports_missing_environment_python(self):
        with tempfile.TemporaryDirectory() as temp:
            runtime = AudioRuntime(base_dir=temp, port=18766)
            try:
                with self.assertRaisesRegex(RuntimeError, "Не найден Python"):
                    runtime._api_server_command()
            finally:
                runtime.shutdown()

    def test_http_access_logs_are_filtered_but_model_warnings_are_kept(self):
        with tempfile.TemporaryDirectory() as temp:
            runtime = AudioRuntime(base_dir=temp, port=18766)
            try:
                runtime._append_log('INFO:     127.0.0.1:56036 - "GET /health HTTP/1.1" 200 OK')
                runtime._append_log("14:31:49 | WARNING | [tiled_decode] Reduced overlap")
                with runtime._lock:
                    self.assertEqual(runtime._log_tail, [
                        "14:31:49 | WARNING | [tiled_decode] Reduced overlap"
                    ])
            finally:
                runtime.shutdown()

    @patch.object(AudioRuntime, "_detect_gpu_memory_gb", return_value=6.0)
    def test_low_vram_enables_dit_cpu_offload(self, _detect):
        with tempfile.TemporaryDirectory() as temp:
            runtime = AudioRuntime(base_dir=temp, port=18766)
            try:
                env = {}
                runtime._apply_low_vram_offload_defaults(env)
                self.assertEqual(env["ACESTEP_OFFLOAD_DIT_TO_CPU"], "true")
            finally:
                runtime.shutdown()

    @patch.object(AudioRuntime, "_detect_gpu_memory_gb", return_value=12.0)
    def test_12gb_gpu_uses_low_vram_offload_profile(self, _detect):
        with tempfile.TemporaryDirectory() as temp:
            runtime = AudioRuntime(base_dir=temp, port=18766)
            try:
                env = {}
                runtime._apply_low_vram_offload_defaults(env)
                self.assertEqual(env["ACESTEP_OFFLOAD_DIT_TO_CPU"], "true")
            finally:
                runtime.shutdown()

    @patch.object(AudioRuntime, "_detect_gpu_memory_gb", return_value=16.0)
    def test_high_vram_does_not_force_dit_cpu_offload(self, _detect):
        with tempfile.TemporaryDirectory() as temp:
            runtime = AudioRuntime(base_dir=temp, port=18766)
            try:
                env = {}
                runtime._apply_low_vram_offload_defaults(env)
                self.assertNotIn("ACESTEP_OFFLOAD_DIT_TO_CPU", env)
            finally:
                runtime.shutdown()

    @patch.object(AudioRuntime, "_detect_gpu_memory_gb", return_value=6.0)
    def test_explicit_dit_cpu_offload_setting_is_preserved(self, _detect):
        with tempfile.TemporaryDirectory() as temp:
            runtime = AudioRuntime(base_dir=temp, port=18766)
            try:
                env = {"ACESTEP_OFFLOAD_DIT_TO_CPU": "false"}
                runtime._apply_low_vram_offload_defaults(env)
                self.assertEqual(env["ACESTEP_OFFLOAD_DIT_TO_CPU"], "false")
            finally:
                runtime.shutdown()

    def test_generation_progress_identifies_vae_decode(self):
        progress, stage = AudioRuntime._generation_progress(
            "14:31:49 | WARNING | [tiled_decode] Reduced overlap from 64 to 32 for chunk_size=128"
        )
        self.assertEqual(progress, 0.82)
        self.assertIn("VAE", stage)
        self.assertIn("128", stage)

    def test_generation_progress_identifies_cpu_vae_decode(self):
        progress, stage = AudioRuntime._generation_progress(
            "[_decode_on_cpu] Moving VAE to CPU for decode"
        )
        self.assertEqual(progress, 0.84)
        self.assertIn("CPU", stage)

    def test_installed_detection_requires_project_and_venv_python(self):
        with tempfile.TemporaryDirectory() as temp:
            runtime = AudioRuntime(base_dir=temp, port=18766)
            try:
                self.assertFalse(runtime._installed())
                runtime.repo_dir.mkdir(parents=True)
                (runtime.repo_dir / "pyproject.toml").write_text("[project]", encoding="utf-8")
                if __import__("os").name == "nt":
                    python_path = runtime.repo_dir / ".venv" / "Scripts" / "python.exe"
                else:
                    python_path = runtime.repo_dir / ".venv" / "bin" / "python"
                python_path.parent.mkdir(parents=True)
                python_path.write_text("", encoding="utf-8")
                self.assertTrue(runtime._installed())
            finally:
                runtime.shutdown()


if __name__ == "__main__":
    unittest.main()
