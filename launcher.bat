@echo off
chcp 65001 >nul
title VN Studio Launcher

set "ROOT_DIR=%~dp0"
set "AI_DIR=%ROOT_DIR%ai-server"
set "APP_DIR=%ROOT_DIR%app"
set "PYTHON_PATH=%AI_DIR%\python312\python.exe"
set "APP_EXE=%APP_DIR%\src-tauri\target\release\vn-studio.exe"

:: Логирование
echo [%date% %time%] Старт launcher.bat > "%ROOT_DIR%launcher.log"

:: Пути к Node.js (нужны только для резервного режима разработки)
set "PATH=C:\Program Files\nodejs;%APPDATA%\npm;%PATH%"

:: Проверки
if not exist "%PYTHON_PATH%" (
    echo ОШИБКА: Python не найден: %PYTHON_PATH% >> "%ROOT_DIR%launcher.log"
    powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('Python не найден. Проверьте установку.', 'VN Studio', 'OK', 'Error')"
    exit /b 1
)

if not exist "%APP_DIR%\package.json" (
    echo ОШИБКА: package.json не найден >> "%ROOT_DIR%launcher.log"
    powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('Папка приложения не найдена.', 'VN Studio', 'OK', 'Error')"
    exit /b 1
)

:: Переменные для AI-сервера
set "VN_MODEL_PATH=C:\models\Qwen-Image-2.1-Turbo"
set "VN_LLM_PATH=C:\models\qwen3-14b"
set "VN_EMBED_PATH=C:\models\e5-small"
if not defined VN_SERVER_HOST set "VN_SERVER_HOST=127.0.0.1"
if not defined VN_SERVER_PORT set "VN_SERVER_PORT=8765"

:: Сначала проверяем существующий сервер: не создаём второй процесс и не ждём лишний раз.
echo Проверка уже запущенного AI-сервера... >> "%ROOT_DIR%launcher.log"
call :check_health
if not errorlevel 1 goto server_ready

:: Запуск AI-сервера в отдельном свернутом окне.
echo Запуск AI-сервера... >> "%ROOT_DIR%launcher.log"
echo VN_MODEL_PATH=%VN_MODEL_PATH% >> "%ROOT_DIR%launcher.log"
echo VN_LLM_PATH=%VN_LLM_PATH% >> "%ROOT_DIR%launcher.log"
echo VN_EMBED_PATH=%VN_EMBED_PATH% >> "%ROOT_DIR%launcher.log"

pushd "%AI_DIR%"
start "VN Studio AI Server" /min cmd /c ""%PYTHON_PATH%" -m uvicorn server:app --host %VN_SERVER_HOST% --port %VN_SERVER_PORT% >> "%ROOT_DIR%ai-server.log" 2>&1"
popd

:: Проверяем готовность сразу, затем раз в секунду (всего до 60 секунд).
echo Ожидание готовности сервера... >> "%ROOT_DIR%launcher.log"
set /a attempts=0
:wait_loop
call :check_health
if not errorlevel 1 goto server_ready
set /a attempts+=1
if %attempts% geq 60 goto server_timeout
ping -n 2 127.0.0.1 >nul
goto wait_loop

:server_timeout
echo ОШИБКА: AI-сервер не запустился за 60 секунд >> "%ROOT_DIR%launcher.log"
powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('AI-сервер не запустился за 60 секунд. Проверьте ai-server.log и launcher.log', 'VN Studio', 'OK', 'Warning')"
exit /b 1

:server_ready
echo AI-сервер готов или уже работал >> "%ROOT_DIR%launcher.log"

if /I "%VN_SERVER_ONLY%"=="1" (
    echo AI-сервер готов. Логи: ai-server.log
    echo Для остановки сервера закройте окно "VN Studio AI Server".
    exit /b 0
)

:: Если приложение уже собрано, запускаем готовый exe без Vite и компиляции Rust.
if exist "%APP_EXE%" (
    echo Запуск готового приложения: %APP_EXE% >> "%ROOT_DIR%launcher.log"
    start "" "%APP_EXE%"
    goto app_started
)

:: Резервный режим для разработчика, если release exe еще не собран.
echo Release exe не найден. Запуск Tauri в режиме разработки... >> "%ROOT_DIR%launcher.log"
cd /d "%APP_DIR%"
call npm run tauri dev >> "%ROOT_DIR%launcher.log" 2>&1

:app_started
echo Приложение запущено/закрыто. AI-сервер продолжает работать отдельно. >> "%ROOT_DIR%launcher.log"
echo Для остановки сервера закройте окно "VN Studio AI Server". >> "%ROOT_DIR%launcher.log"
del "%ROOT_DIR%health.tmp" 2>nul
exit /b 0

:check_health
set "HTTP_CODE="
curl.exe -s -o NUL -w "%%{http_code}" --connect-timeout 1 --max-time 2 "http://127.0.0.1:%VN_SERVER_PORT%/health" > "%ROOT_DIR%health.tmp" 2>nul
if exist "%ROOT_DIR%health.tmp" set /p HTTP_CODE=<"%ROOT_DIR%health.tmp"
if "%HTTP_CODE%"=="200" exit /b 0
exit /b 1
