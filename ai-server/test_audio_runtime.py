import json
import tempfile
import unittest
import zipfile
from pathlib import Path

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
