@echo off
chcp 65001 >nul
title VN Studio Launcher

set ROOT_DIR=C:\Users\Кирилл\Projects\vn-studio
set AI_DIR=%ROOT_DIR%\ai-server
set APP_DIR=%ROOT_DIR%\app
set PYTHON_PATH=%AI_DIR%\python312\python.exe

:: Логирование
echo [%date% %time%] Старт launcher.bat > "%ROOT_DIR%\launcher.log"

:: Пути к Node.js
set PATH=C:\Program Files\nodejs;C:\Users\Кирилл\AppData\Roaming\npm;%PATH%
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

:: Очистка старых процессов
echo Остановка старых процессов... >> "%ROOT_DIR%\launcher.log"
taskkill /f /im python.exe 2>nul

:: Переменные для AI-сервера
set VN_MODEL_PATH=C:\models\Qwen-Image-2.1-Turbo
set VN_LLM_PATH=C:\models\qwen3-14b
set VN_EMBED_PATH=C:\models\e5-small

:: Запуск AI-сервера ИЗ ПАПКИ ai-server (важно!)
echo Запуск AI-сервера... >> "%ROOT_DIR%\launcher.log"
echo VN_MODEL_PATH=%VN_MODEL_PATH% >> "%ROOT_DIR%\launcher.log"
echo VN_LLM_PATH=%VN_LLM_PATH% >> "%ROOT_DIR%\launcher.log"
echo VN_EMBED_PATH=%VN_EMBED_PATH% >> "%ROOT_DIR%\launcher.log"

pushd "%AI_DIR%"
start "" /b cmd /c "set VN_MODEL_PATH=%VN_MODEL_PATH%&& set VN_LLM_PATH=%VN_LLM_PATH%&& set VN_EMBED_PATH=%VN_EMBED_PATH%&& "%PYTHON_PATH%" -m uvicorn server:app --host 127.0.0.1 --port 8765"
popd

:: Ожидание готовности сервера (30 секунд с проверкой через curl)
echo Ожидание готовности сервера... >> "%ROOT_DIR%\launcher.log"
set /a attempts=0
:wait_loop
timeout /t 2 /nobreak >nul
set /a attempts+=1
curl.exe -s -o NUL -w "%%{http_code}" http://127.0.0.1:8765/health > "%ROOT_DIR%\health.tmp" 2>nul
set /p HTTP_CODE=<"%ROOT_DIR%\health.tmp"
if "%HTTP_CODE%"=="200" goto server_ready
if %attempts% lss 15 goto wait_loop

echo ОШИБКА: AI-сервер не запустился за 30 секунд >> "%ROOT_DIR%\launcher.log"
powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('AI-сервер не запустился за 30 секунд. Проверьте launcher.log', 'VN Studio', 'OK', 'Warning')"
exit /b 1

:server_ready
echo AI-сервер готов >> "%ROOT_DIR%\launcher.log"

:: Запуск Tauri приложения
echo Запуск Tauri (npm run tauri dev)... >> "%ROOT_DIR%\launcher.log"
cd /d "%APP_DIR%"
call npm run tauri dev >> "%ROOT_DIR%\launcher.log" 2>&1

:: Завершение
echo Приложение закрыто. Остановка Python... >> "%ROOT_DIR%\launcher.log"
taskkill /f /im python.exe 2>nul
echo Готово. >> "%ROOT_DIR%\launcher.log"
del "%ROOT_DIR%\health.tmp" 2>nul
