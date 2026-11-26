use serde_json::{json, Value};
use std::{
    fs::{self, File, OpenOptions},
    io::{BufRead, BufReader, Read, Write},
    net::{Ipv4Addr, SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager};

const AI_SERVER_REVISION: &str = "33faa2c4066f514ed250d12b931eb0e32733f391";
const UV_VERSION: &str = "0.13.10";
const UV_WINDOWS_X64_URL: &str = "https://releases.astral.sh/github/uv/releases/download/0.13.10/uv-x86_64-pc-windows-msvc.zip";
const UV_WINDOWS_X64_SHA256: &str =
    "297b3881fe1adfb922becc2c1613202abb41dc83ea5ff43d472aa087ca1f8683";

#[tauri::command]
async fn ensure_ai_server(app: AppHandle, endpoint: String) -> Result<Value, String> {
    let endpoint = if endpoint.trim().is_empty() {
        "http://127.0.0.1:8765".to_string()
    } else {
        endpoint.trim().trim_end_matches('/').to_string()
    };

    let Some(port) = local_http_port(&endpoint)? else {
        return Ok(json!({
            "ready": true,
            "external": true,
            "message": "Используется внешний AI-сервер"
        }));
    };

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(3))
        .timeout(Duration::from_secs(5))
        .user_agent("VN-Studio-AI-Server-Installer/1.0")
        .build()
        .map_err(|error| format!("Не удалось подготовить HTTP-клиент: {error}"))?;

    if server_health_ok(&client, &endpoint).await {
        return Ok(json!({
            "ready": true,
            "already_running": true,
            "external": false
        }));
    }

    #[cfg(not(all(target_os = "windows", target_arch = "x86_64")))]
    {
        let _ = (app, client, port);
        return Err(
            "Автоматическая установка локального AI-сервера пока поддерживается только в Windows x64. \
             Для этой системы укажи адрес уже запущенного AI-сервера.".to_string()
        );
    }

    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        let root = app
            .path()
            .app_local_data_dir()
            .map_err(|error| format!("Не удалось определить папку данных VN Studio: {error}"))?
            .join("ai-server-runtime");
        fs::create_dir_all(&root)
            .map_err(|error| format!("Не удалось создать папку AI-сервера: {error}"))?;

        let uv_exe = root.join("uv").join("uv.exe");
        if !uv_exe.is_file() {
            emit_setup_progress(&app, 0.03, "Скачивание установщика Python", "Загружаем uv — менеджер Python и зависимостей");
            let uv_archive = root.join("uv-windows-x64.zip");
            download_to_file(&app, &client, UV_WINDOWS_X64_URL, &uv_archive, 0.04, "Скачивание uv").await?;

            emit_setup_progress(&app, 0.10, "Проверка установщика", "Проверяем контрольную сумму uv");
            let actual_hash = powershell_output(&format!(
                "(Get-FileHash -LiteralPath {} -Algorithm SHA256).Hash",
                ps_quote(&uv_archive)
            ))?;
            if !actual_hash.trim().eq_ignore_ascii_case(UV_WINDOWS_X64_SHA256) {
                let _ = fs::remove_file(&uv_archive);
                return Err(format!(
                    "Контрольная сумма установщика uv не совпала. Ожидалась {}, получена {}",
                    UV_WINDOWS_X64_SHA256,
                    actual_hash.trim()
                ));
            }

            let uv_dir = root.join("uv");
            let extract_dir = root.join("uv-extract");
            let script = format!(
                "$ErrorActionPreference = 'Stop'; \
                 $dest = {}; \
                 if (Test-Path -LiteralPath $dest) {{ Remove-Item -LiteralPath $dest -Recurse -Force }}; \
                 New-Item -ItemType Directory -Force -Path $dest | Out-Null; \
                 Expand-Archive -LiteralPath {} -DestinationPath $dest -Force; \
                 $exe = Get-ChildItem -LiteralPath $dest -Filter 'uv.exe' -File -Recurse | Select-Object -First 1; \
                 if ($null -eq $exe) {{ throw 'uv.exe not found in archive' }}; \
                 New-Item -ItemType Directory -Force -Path {} | Out-Null; \
                 Copy-Item -LiteralPath $exe.FullName -Destination {} -Force;",
                ps_quote(&extract_dir),
                ps_quote(&uv_archive),
                ps_quote(&uv_dir),
                ps_quote(&uv_exe)
            );
            powershell_output(&script)?;
            let _ = fs::remove_dir_all(&extract_dir);
            let _ = fs::remove_file(&uv_archive);
            if !uv_exe.is_file() {
                return Err("Не удалось распаковать установщик uv.".to_string());
            }
        }

        let source_dir = root.join(format!("server-src-{}", &AI_SERVER_REVISION[..12]));
        if !source_dir.join("server.py").is_file() || !source_dir.join("requirements.txt").is_file() {
            emit_setup_progress(&app, 0.14, "Скачивание AI-сервера", "Загружаем зафиксированную версию server.py и модулей VN Studio");
            let source_url = format!(
                "https://codeload.github.com/ItsNotMyDay/vn-studio/zip/{}",
                AI_SERVER_REVISION
            );
            let source_archive = root.join("vn-studio-server-source.zip");
            download_to_file(&app, &client, &source_url, &source_archive, 0.15, "Скачивание исходников").await?;

            let app_for_extract = app.clone();
            let root_for_extract = root.clone();
            let source_for_extract = source_dir.clone();
            tauri::async_runtime::spawn_blocking(move || {
                extract_ai_server_source(
                    &app_for_extract,
                    &root_for_extract.join("vn-studio-server-source.zip"),
                    &root_for_extract.join("source-extract"),
                    &source_for_extract,
                )
            })
            .await
            .map_err(|error| format!("Поток распаковки AI-сервера завершился с ошибкой: {error}"))??;
            let _ = fs::remove_file(&source_archive);
        }

        let app_for_setup = app.clone();
        let root_for_setup = root.clone();
        let source_for_setup = source_dir.clone();
        let result = tauri::async_runtime::spawn_blocking(move || {
            install_and_start_ai_server(
                app_for_setup,
                root_for_setup,
                source_for_setup,
                port,
            )
        })
        .await
        .map_err(|error| format!("Поток установки AI-сервера завершился с ошибкой: {error}"))??;

        Ok(json!({
            "ready": true,
            "already_running": false,
            "external": false,
            "server_url": endpoint,
            "install_root": root.to_string_lossy(),
            "revision": AI_SERVER_REVISION,
            "uv_version": UV_VERSION,
            "result": result
        }))
    }
}

fn local_http_port(endpoint: &str) -> Result<Option<u16>, String> {
    let url = reqwest::Url::parse(endpoint)
        .map_err(|error| format!("Некорректный адрес AI-сервера: {error}"))?;
    if url.scheme() != "http" {
        return Ok(None);
    }
    let host = url.host_str().unwrap_or_default();
    if host != "127.0.0.1" && host != "localhost" && host != "::1" {
        return Ok(None);
    }
    let port = url.port_or_known_default().unwrap_or(8765);
    if port < 1024 {
        return Err("Для локального AI-сервера выбери порт 1024 или выше.".to_string());
    }
    Ok(Some(port))
}

async fn server_health_ok(client: &reqwest::Client, endpoint: &str) -> bool {
    let Ok(response) = client
        .get(format!("{}/health", endpoint.trim_end_matches('/')))
        .send()
        .await
    else {
        return false;
    };
    if !response.status().is_success() {
        return false;
    }
    let Ok(payload) = response.json::<Value>().await else {
        return false;
    };
    payload.get("service").and_then(Value::as_str) == Some("vn-studio-ai")
}

async fn download_to_file(
    app: &AppHandle,
    client: &reqwest::Client,
    url: &str,
    destination: &Path,
    progress: f64,
    stage: &str,
) -> Result<(), String> {
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Не удалось создать папку загрузки: {error}"))?;
    }
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("Ошибка загрузки {stage}: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "Не удалось скачать {stage}: HTTP {}",
            response.status()
        ));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("Не удалось получить данные {stage}: {error}"))?;
    let temporary = destination.with_extension("download");
    fs::write(&temporary, &bytes)
        .map_err(|error| format!("Не удалось сохранить {stage}: {error}"))?;
    if destination.exists() {
        fs::remove_file(destination)
            .map_err(|error| format!("Не удалось заменить предыдущий файл {stage}: {error}"))?;
    }
    fs::rename(&temporary, destination)
        .map_err(|error| format!("Не удалось завершить сохранение {stage}: {error}"))?;
    emit_setup_progress(
        app,
        progress + 0.04,
        stage,
        &format!("Загружено {:.1} МБ", bytes.len() as f64 / 1024.0 / 1024.0),
    );
    Ok(())
}

fn emit_setup_progress(app: &AppHandle, progress: f64, stage: &str, detail: &str) {
    let _ = app.emit(
        "ai-server-setup-progress",
        json!({
            "progress": progress.clamp(0.0, 0.99),
            "stage": stage,
            "detail": detail
        }),
    );
}

fn ps_quote(path: &Path) -> String {
    format!("'{}'", path.to_string_lossy().replace('\'', "''"))
}

fn powershell_output(script: &str) -> Result<String, String> {
    let output = Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ])
        .output()
        .map_err(|error| format!("Не удалось запустить PowerShell: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "Операция PowerShell завершилась с ошибкой: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[cfg(all(target_os = "windows", target_arch = "x86_64"))]
fn extract_ai_server_source(
    app: &AppHandle,
    archive: &Path,
    staging: &Path,
    destination: &Path,
) -> Result<(), String> {
    emit_setup_progress(app, 0.20, "Распаковка AI-сервера", "Извлекаем только папку ai-server");
    if !archive.is_file() {
        return Err("Архив исходников AI-сервера не найден.".to_string());
    }
    if staging.exists() {
        fs::remove_dir_all(staging)
            .map_err(|error| format!("Не удалось очистить временную папку: {error}"))?;
    }
    let script = format!(
        "$ErrorActionPreference = 'Stop'; \
         $stage = {}; \
         New-Item -ItemType Directory -Force -Path $stage | Out-Null; \
         Expand-Archive -LiteralPath {} -DestinationPath $stage -Force; \
         $repo = Get-ChildItem -LiteralPath $stage -Directory | Where-Object {{ Test-Path (Join-Path $_.FullName 'ai-server\\server.py') }} | Select-Object -First 1; \
         if ($null -eq $repo) {{ throw 'ai-server/server.py not found in pinned source archive' }}; \
         $source = Join-Path $repo.FullName 'ai-server'; \
         $destination = {}; \
         if (Test-Path -LiteralPath $destination) {{ Remove-Item -LiteralPath $destination -Recurse -Force }}; \
         New-Item -ItemType Directory -Force -Path $destination | Out-Null; \
         Copy-Item -Path (Join-Path $source '*') -Destination $destination -Recurse -Force;",
        ps_quote(staging),
        ps_quote(archive),
        ps_quote(destination)
    );
    powershell_output(&script)?;
    let _ = fs::remove_dir_all(staging);
    if !destination.join("server.py").is_file() || !destination.join("requirements.txt").is_file() {
        return Err("Архив распакован, но в нём отсутствуют файлы AI-сервера.".to_string());
    }
    Ok(())
}

fn pump_command_output<R: Read + Send + 'static>(
    reader: R,
    app: AppHandle,
    stage: String,
    progress: f64,
    log: Arc<Mutex<File>>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        for line in BufReader::new(reader).lines().flatten() {
            if let Ok(mut file) = log.lock() {
                let _ = writeln!(file, "{}", line);
            }
            emit_setup_progress(&app, progress, &stage, &line);
        }
    })
}

fn run_setup_command(
    app: &AppHandle,
    program: &Path,
    args: &[String],
    current_dir: &Path,
    environment: &[(String, String)],
    stage: &str,
    progress: f64,
    log_path: &Path,
) -> Result<(), String> {
    emit_setup_progress(app, progress, stage, "Подготавливаем окружение Python");
    let log_file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)
        .map_err(|error| format!("Не удалось открыть журнал установки: {error}"))?;
    let shared_log = Arc::new(Mutex::new(log_file));
    let mut command = Command::new(program);
    command
        .args(args)
        .current_dir(current_dir)
        .envs(environment.iter().map(|(key, value)| (key, value)))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command
        .spawn()
        .map_err(|error| format!("Не удалось запустить {}: {error}", program.display()))?;
    let stdout_thread = child.stdout.take().map(|stdout| {
        pump_command_output(
            stdout,
            app.clone(),
            stage.to_string(),
            progress,
            Arc::clone(&shared_log),
        )
    });
    let stderr_thread = child.stderr.take().map(|stderr| {
        pump_command_output(
            stderr,
            app.clone(),
            stage.to_string(),
            progress,
            Arc::clone(&shared_log),
        )
    });

    let status = child
        .wait()
        .map_err(|error| format!("Не удалось дождаться завершения {stage}: {error}"))?;
    if let Some(thread) = stdout_thread {
        let _ = thread.join();
    }
    if let Some(thread) = stderr_thread {
        let _ = thread.join();
    }
    if !status.success() {
        return Err(format!(
            "{stage}: код завершения {}.\n{}",
            status.code().unwrap_or(-1),
            read_log_tail(log_path)
        ));
    }
    Ok(())
}

fn python_runtime_version(python: &Path) -> Option<String> {
    let output = Command::new(python)
        .args(["-c", "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn python_cuda_available(python: &Path) -> bool {
    Command::new(python)
        .args(["-c", "import torch,sys; sys.exit(0 if torch.cuda.is_available() else 1)"])
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn read_log_tail(path: &Path) -> String {
    fs::read_to_string(path)
        .map(|contents| {
            let lines: Vec<&str> = contents.lines().collect();
            lines
                .iter()
                .rev()
                .take(18)
                .rev()
                .copied()
                .collect::<Vec<&str>>()
                .join("\n")
        })
        .unwrap_or_default()
}

#[cfg(all(target_os = "windows", target_arch = "x86_64"))]
fn install_and_start_ai_server(
    app: AppHandle,
    root: PathBuf,
    source_dir: PathBuf,
    port: u16,
) -> Result<Value, String> {
    let uv_exe = root.join("uv").join("uv.exe");
    let python_dir = root.join("python");
    let cache_dir = root.join("uv-cache");
    let venv_dir = root.join("venv");
    let python_exe = venv_dir.join("Scripts").join("python.exe");
    let models_dir = root.join("models");
    let data_dir = root.join("data");
    let audio_dir = root.join("audio-runtime");
    let hf_dir = root.join("hf-cache");
    let torch_dir = root.join("torch-cache");
    let log_path = root.join("setup.log");
    let marker_path = root.join("installed-revision.txt");

    for path in [&python_dir, &cache_dir, &models_dir, &data_dir, &audio_dir, &hf_dir, &torch_dir] {
        fs::create_dir_all(path)
            .map_err(|error| format!("Не удалось создать {}: {error}", path.display()))?;
    }
    if !uv_exe.is_file() {
        return Err("Установщик uv не найден после распаковки.".to_string());
    }
    if !source_dir.join("server.py").is_file() {
        return Err("Исходники AI-сервера не найдены.".to_string());
    }

    let environment = vec![
        ("UV_PYTHON_INSTALL_DIR".to_string(), python_dir.to_string_lossy().to_string()),
        ("UV_CACHE_DIR".to_string(), cache_dir.to_string_lossy().to_string()),
        ("UV_HTTP_TIMEOUT".to_string(), "120".to_string()),
        ("UV_HTTP_RETRIES".to_string(), "5".to_string()),
        ("UV_PYTHON_PREFERENCE".to_string(), "only-managed".to_string()),
        (
            "PATH".to_string(),
            format!(
                "{};{}",
                root.join("uv").to_string_lossy(),
                std::env::var("PATH").unwrap_or_default()
            ),
        ),
        ("PYTHONUTF8".to_string(), "1".to_string()),
    ];

    let installed_revision = fs::read_to_string(&marker_path).unwrap_or_default();
    let install_marker = format!("{}|python=3.11|torch=2.7.1|backend=auto", AI_SERVER_REVISION);
    let dependencies_ready = installed_revision.trim() == install_marker.as_str()
        && python_runtime_version(&python_exe).as_deref() == Some("3.11");

    // Keep one managed interpreter for the app, but isolate server and ACE-Step
    // packages in their own virtual environments.
    let python_install_args = vec![
        "python".to_string(),
        "install".to_string(),
        "3.11".to_string(),
    ];
    run_setup_command(
        &app,
        &uv_exe,
        &python_install_args,
        &root,
        &environment,
        "Подготовка общего Python 3.11",
        0.24,
        &log_path,
    )?;

    if python_runtime_version(&python_exe).as_deref() != Some("3.11") && venv_dir.exists() {
        fs::remove_dir_all(&venv_dir)
            .map_err(|error| format!("Не удалось заменить старое окружение Python: {error}"))?;
    }
    if !python_exe.is_file() {
        let venv_args = vec![
            "venv".to_string(),
            "--python".to_string(),
            "3.11".to_string(),
            "--seed".to_string(),
            venv_dir.to_string_lossy().to_string(),
        ];
        run_setup_command(
            &app,
            &uv_exe,
            &venv_args,
            &root,
            &environment,
            "Создание изолированного окружения AI-сервера",
            0.38,
            &log_path,
        )?;
    }
    if python_runtime_version(&python_exe).as_deref() != Some("3.11") {
        return Err("Не удалось подготовить общее окружение Python 3.11 для VN Studio.".to_string());
    }

    if !dependencies_ready {
        let requirements = source_dir.join("requirements.txt");
        let install_args = vec![
            "pip".to_string(),
            "install".to_string(),
            "--python".to_string(),
            python_exe.to_string_lossy().to_string(),
            "-r".to_string(),
            requirements.to_string_lossy().to_string(),
        ];
        run_setup_command(
            &app,
            &uv_exe,
            &install_args,
            &source_dir,
            &environment,
            "Установка базовых зависимостей AI-сервера",
            0.52,
            &log_path,
        )?;
    }

    // uv queries the actual GPU/driver and selects a compatible CUDA, ROCm,
    // Intel XPU, or CPU wheel set. Pin the framework versions used by the app.
    let torch_args = vec![
        "pip".to_string(),
        "install".to_string(),
        "--python".to_string(),
        python_exe.to_string_lossy().to_string(),
        "--torch-backend=auto".to_string(),
        "torch==2.7.1".to_string(),
        "torchvision==0.22.1".to_string(),
    ];
    run_setup_command(
        &app,
        &uv_exe,
        &torch_args,
        &root,
        &environment,
        "Подбор и установка PyTorch под оборудование ПК",
        0.62,
        &log_path,
    )?;

    if python_cuda_available(&python_exe) {
        let quantization_args = vec![
            "pip".to_string(),
            "install".to_string(),
            "--python".to_string(),
            python_exe.to_string_lossy().to_string(),
            "bitsandbytes>=0.46".to_string(),
        ];
        run_setup_command(
            &app,
            &uv_exe,
            &quantization_args,
            &root,
            &environment,
            "Установка CUDA-библиотек для INT4-квантования",
            0.72,
            &log_path,
        )?;
    }

    let torch_probe = Command::new(&python_exe)
        .args([
            "-c",
            concat!(
                "import torch, torchvision; ",
                "print('torch=' + str(torch.__version__)); ",
                "print('cuda=' + str(torch.cuda.is_available())); ",
                "print('cuda_runtime=' + str(torch.version.cuda)); ",
                "print('xpu=' + str(hasattr(torch, 'xpu') and torch.xpu.is_available()))",
            ),
        ])
        .output()
        .map_err(|error| format!("Не удалось проверить PyTorch: {error}"))?;
    if !torch_probe.status.success() {
        return Err(format!(
            "PyTorch не прошёл проверку после установки.\n{}",
            String::from_utf8_lossy(&torch_probe.stderr)
        ));
    }
    if let Ok(mut log) = OpenOptions::new().create(true).append(true).open(&log_path) {
        let _ = log.write_all(&torch_probe.stdout);
    }

    emit_setup_progress(
        &app,
        0.89,
        "Запуск AI-сервера",
        "Запускаем локальный API на 127.0.0.1",
    );
    let server_log_path = root.join("ai-server.log");
    let server_log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&server_log_path)
        .map_err(|error| format!("Не удалось открыть журнал AI-сервера: {error}"))?;
    let stderr_log = server_log
        .try_clone()
        .map_err(|error| format!("Не удалось подготовить журнал AI-сервера: {error}"))?;

    let port_arg = port.to_string();
    let mut command = Command::new(&python_exe);
    command
        .args([
            "-m",
            "uvicorn",
            "server:app",
            "--host",
            "127.0.0.1",
            "--port",
            port_arg.as_str(),
        ])
        .current_dir(&source_dir)
        .envs(environment.iter().map(|(key, value)| (key, value)))
        .env("VN_SERVER_DATA_DIR", &data_dir)
        .env("VN_MODELS_DIR", &models_dir)
        .env("VN_EMBED_PATH", models_dir.join("e5-small"))
        .env("VN_AUDIO_RUNTIME_DIR", &audio_dir)
        .env("VN_QUANTIZED_MODELS_DIR", root.join("quantized-models"))
        .env("VN_SERVER_REVISION", AI_SERVER_REVISION)
        .env("VN_SERVER_HOST", "127.0.0.1")
        .env("VN_SERVER_PORT", port.to_string())
        .env("HF_HOME", &hf_dir)
        .env("HUGGINGFACE_HUB_CACHE", hf_dir.join("hub"))
        .env("TORCH_HOME", &torch_dir)
        .env("PYTHONUTF8", "1")
        .env("PYTHONUNBUFFERED", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::from(server_log))
        .stderr(Stdio::from(stderr_log));

    command
        .spawn()
        .map_err(|error| format!("Не удалось запустить server.py: {error}"))?;

    for attempt in 0..120 {
        if local_server_health(port) {
            fs::write(&marker_path, &install_marker)
                .map_err(|error| format!("Не удалось сохранить состояние установки: {error}"))?;
            emit_setup_progress(&app, 0.99, "AI-сервер готов", "Локальный API отвечает на /health");
            return Ok(json!({
                "server_url": format!("http://127.0.0.1:{port}"),
                "python": python_exe.to_string_lossy(),
                "models_dir": models_dir.to_string_lossy(),
                "data_dir": data_dir.to_string_lossy()
            }));
        }
        if attempt % 5 == 0 {
            emit_setup_progress(
                &app,
                0.90 + (attempt as f64 / 120.0) * 0.08,
                "Ожидание запуска AI-сервера",
                &format!("Проверка готовности {}/120", attempt + 1),
            );
        }
        thread::sleep(Duration::from_secs(1));
    }

    Err(format!(
        "AI-сервер не ответил за 120 секунд. Проверь журнал:\n{}\n{}",
        server_log_path.display(),
        read_log_tail(&server_log_path)
    ))
}

fn local_server_health(port: u16) -> bool {
    let address = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_millis(800)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
    if stream
        .write_all(b"GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .is_err()
    {
        return false;
    }
    let mut response = Vec::new();
    if stream.read_to_end(&mut response).is_err() {
        return false;
    }
    let response_text = String::from_utf8_lossy(&response);
    let Some((headers, body)) = response_text.split_once("\r\n\r\n") else {
        return false;
    };
    let status_ok = headers.starts_with("HTTP/1.1 200")
        || headers.starts_with("HTTP/1.0 200");
    if !status_ok {
        return false;
    }
    serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|payload| payload.get("service").and_then(Value::as_str).map(str::to_string))
        .as_deref()
        == Some("vn-studio-ai")
}

#[tauri::command]
fn exit_app(app: AppHandle) {
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![ensure_ai_server, exit_app])
        .setup(|app| {
            let main_window = app
                .get_webview_window("main")
                .expect("main window is missing");
            let app_handle = app.handle().clone();

            main_window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = app_handle.emit("app-close-requested", ());
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
