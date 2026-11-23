@echo off
chcp 65001 >nul
title VN Studio Launcher

set "ROOT_DIR=%~dp0"
set "AI_DIR=%ROOT_DIR%ai-server"
set "APP_DIR=%ROOT_DIR%app"
set "PYTHON_PATH=%AI_DIR%\python312\python.exe"

:: Логирование
echo [%date% %time%] Старт launcher.bat > "%ROOT_DIR%\launcher.log"

:: Пути к Node.js
set "PATH=C:\Program Files\nodejs;%APPDATA%\npm;%PATH%"
echo PATH установлен >> "%ROOT_DIR%\launcher.log"

:: Проверки
if not exist "%PYTHON_PATH%" (
    echo ОШИБКА: Python не найден: %PYTHON_PATH% >> "%ROOT_DIR%\launcher.log"
    powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('Python не найден. Проверьте установку.', 'VN Studio', 'OK', 'Error')"
    exit /b 1
)

if not exist "%APP_DIR%\package.json" (
    echo ОШИБКА: package.json не найден >> "%ROOT_DIR%\launcher.log"
    powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('Папка приложения не найдена.', 'VN Studio', 'OK', 'Error')"
    exit /b 1
)

:: Не завершаем все процессы Python: AI-сервер может использоваться другими ПК.
:: Если порт уже занят, проверьте существующий сервер перед запуском.

:: Переменные для AI-сервера
set VN_MODEL_PATH=C:\models\Qwen-Image-2.1-Turbo
set VN_LLM_PATH=C:\models\qwen3-14b
set VN_EMBED_PATH=C:\models\e5-small
if not defined VN_SERVER_HOST set "VN_SERVER_HOST=127.0.0.1"
if not defined VN_SERVER_PORT set "VN_SERVER_PORT=8765"

:: При сетевом доступе включаем общий bearer-токен.
:: Не открывайте этот порт в интернет и используйте только доверенную локальную сеть.
if /I not "%VN_SERVER_HOST%"=="127.0.0.1" if /I not "%VN_SERVER_HOST%"=="localhost" if not defined VN_SERVER_TOKEN (
    echo Для сетевого доступа задайте общий токен, который нужно будет ввести в VN Studio на клиентских ПК.
    set /p "VN_SERVER_TOKEN=Токен доступа к AI-серверу: "
    if not defined VN_SERVER_TOKEN (
        echo ОШИБКА: при сетевом доступе обязателен VN_SERVER_TOKEN.
        pause
        exit /b 1
    )
)

:: Запуск AI-сервера ИЗ ПАПКИ ai-server (важно!)
echo Запуск AI-сервера... >> "%ROOT_DIR%\launcher.log"
echo VN_MODEL_PATH=%VN_MODEL_PATH% >> "%ROOT_DIR%\launcher.log"
echo VN_LLM_PATH=%VN_LLM_PATH% >> "%ROOT_DIR%\launcher.log"
echo VN_EMBED_PATH=%VN_EMBED_PATH% >> "%ROOT_DIR%\launcher.log"

pushd "%AI_DIR%"
start "VN Studio AI Server" /min cmd /c ""%PYTHON_PATH%" -m uvicorn server:app --host %VN_SERVER_HOST% --port %VN_SERVER_PORT%"
popd

:: Ожидание готовности сервера (30 секунд с проверкой через curl)
echo Ожидание готовности сервера... >> "%ROOT_DIR%\launcher.log"
set /a attempts=0
:wait_loop
timeout /t 2 /nobreak >nul
set /a attempts+=1
curl.exe -s -o NUL -w "%%{http_code}" http://127.0.0.1:%VN_SERVER_PORT%/health > "%ROOT_DIR%\health.tmp" 2>nul
set /p HTTP_CODE=<"%ROOT_DIR%\health.tmp"
if "%HTTP_CODE%"=="200" goto server_ready
if %attempts% lss 15 goto wait_loop

echo ОШИБКА: AI-сервер не запустился за 30 секунд >> "%ROOT_DIR%\launcher.log"
powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('AI-сервер не запустился за 30 секунд. Проверьте launcher.log', 'VN Studio', 'OK', 'Warning')"
exit /b 1

:server_ready
echo AI-сервер готов >> "%ROOT_DIR%\launcher.log"

if /I "%VN_SERVER_ONLY%"=="1" (
    echo AI-сервер запущен в отдельном свернутом окне "VN Studio AI Server".
    echo Для остановки сервера закройте это окно.
    exit /b 0
)

:: Запуск Tauri приложения
echo Запуск Tauri (npm run tauri dev)... >> "%ROOT_DIR%\launcher.log"
cd /d "%APP_DIR%"
call npm run tauri dev >> "%ROOT_DIR%\launcher.log" 2>&1

:: Завершение
echo Приложение закрыто. AI-сервер продолжает работать в отдельном окне. >> "%ROOT_DIR%\launcher.log"
echo Для остановки сервера закройте окно "VN Studio AI Server". >> "%ROOT_DIR%\launcher.log"
echo Готово. >> "%ROOT_DIR%\launcher.log"
del "%ROOT_DIR%\health.tmp" 2>nul
