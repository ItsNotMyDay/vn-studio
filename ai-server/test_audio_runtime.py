import json
import tempfile
import unittest
import zipfile
import sys
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

                command, cwd, env, job_id, stage, progress = run_command.call_args.args[:6]
                self.assertEqual(
                    command,
                    [
                        "uv",
                        "sync",
                        "--project",
                        str(runtime.repo_dir),
                        "--python",
                        "3.11",
                        "--no-dev",
                        "--locked",
                    ],
                )
                self.assertEqual(cwd, runtime.repo_dir)
                self.assertEqual(env["UV_PROJECT_ENVIRONMENT"], str(runtime.repo_dir / ".venv"))
                self.assertEqual(job_id, "job123")
                self.assertEqual(stage, "Проверка зависимостей")
                self.assertEqual(progress, 0.12)
                probe.assert_called_once_with(
                    [str(python_path), "-c", "import loguru"],
                    capture_output=True,
                    text=True,
                    timeout=30,
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
