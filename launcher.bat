@echo off
chcp 65001 >nul
title VN Studio Launcher

set "ROOT_DIR=%~dp0"
set "AI_DIR=%ROOT_DIR%ai-server"
set "APP_DIR=%ROOT_DIR%app"
set "PYTHON_PATH=%AI_DIR%\python312\python.exe"
set "DEV_LAUNCHED=0"

echo [%date% %time%] Старт launcher.bat > "%ROOT_DIR%launcher.log"
set "PATH=C:\Program Files\nodejs;%APPDATA%\npm;%PATH%"

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

set "VN_MODEL_PATH=C:\models\Qwen-Image-2.1-Turbo"
set "VN_EMBED_PATH=C:\models\e5-small"
if not defined VN_SERVER_HOST set "VN_SERVER_HOST=127.0.0.1"
if not defined VN_SERVER_PORT set "VN_SERVER_PORT=8765"

echo Проверка уже запущенного AI-сервера... >> "%ROOT_DIR%launcher.log"
call :check_health
if not errorlevel 1 goto server_ready

echo Запуск AI-сервера... >> "%ROOT_DIR%launcher.log"
echo VN_MODEL_PATH=%VN_MODEL_PATH% >> "%ROOT_DIR%launcher.log"
echo VN_EMBED_PATH=%VN_EMBED_PATH% >> "%ROOT_DIR%launcher.log"

pushd "%AI_DIR%"
start "VN Studio AI Server" /min cmd /c ""%PYTHON_PATH%" -m uvicorn server:app --host %VN_SERVER_HOST% --port %VN_SERVER_PORT% >> "%ROOT_DIR%ai-server.log" 2>&1"
popd

:: Режим разработки запускается параллельно с холодным стартом AI-сервера.
if /I not "%VN_SERVER_ONLY%"=="1" call :launch_dev

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
if "%DEV_LAUNCHED%"=="0" call :launch_dev

echo Приложение запущено в режиме разработки. AI-сервер работает отдельно. >> "%ROOT_DIR%launcher.log"
del "%ROOT_DIR%health.tmp" 2>nul
exit /b 0

:launch_dev
echo Запуск приложения: npm run tauri dev >> "%ROOT_DIR%launcher.log"
pushd "%APP_DIR%"
start "VN Studio (dev)" /min cmd /c "npm run tauri dev >> ""%ROOT_DIR%launcher.log"" 2>&1"
popd
set "DEV_LAUNCHED=1"
exit /b 0

:check_health
set "HTTP_CODE="
curl.exe -s -o NUL -w "%%{http_code}" --connect-timeout 1 --max-time 2 "http://127.0.0.1:%VN_SERVER_PORT%/health" > "%ROOT_DIR%health.tmp" 2>nul
if exist "%ROOT_DIR%health.tmp" set /p HTTP_CODE=<"%ROOT_DIR%health.tmp"
if "%HTTP_CODE%"=="200" exit /b 0
exit /b 1
