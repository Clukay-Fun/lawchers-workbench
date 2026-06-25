@echo off
REM 启动 LAWCHERS.bat — Windows best-effort (未实测)
REM Windows support is best-effort and has not been verified on a Windows machine.
echo ==========================================
echo   LAWCHERS 启动中... (Windows best-effort)
echo ==========================================
echo.
echo 注意: Windows 支持未经实测。
echo.
powershell -ExecutionPolicy Bypass -File "%~dp0scripts\start-app.ps1"
pause
