@echo off
REM 安装 LAWCHERS.bat — Windows best-effort (未实测)
REM Windows support is best-effort and has not been verified on a Windows machine.
echo ==========================================
echo   LAWCHERS 安装程序 (Windows best-effort)
echo ==========================================
echo.
echo 注意: Windows 支持未经实测，不纳入已支持平台。
echo 如遇问题请使用 macOS 或 Linux。
echo.
powershell -ExecutionPolicy Bypass -File "%~dp0scripts\setup-app.ps1"
pause
