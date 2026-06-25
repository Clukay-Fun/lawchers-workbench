@echo off
REM 安装 LAWCHERS.bat — Windows 一键安装（双击运行）
echo ==========================================
echo   LAWCHERS 安装程序
echo ==========================================
echo.
powershell -ExecutionPolicy Bypass -File "%~dp0scripts\setup-app.ps1"
pause
