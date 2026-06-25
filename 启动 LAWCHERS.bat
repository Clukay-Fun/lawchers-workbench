@echo off
REM 启动 LAWCHERS.bat — Windows 启动服务（双击运行）
echo ==========================================
echo   LAWCHERS 启动中...
echo ==========================================
echo.
powershell -ExecutionPolicy Bypass -File "%~dp0scripts\start-app.ps1"
pause
