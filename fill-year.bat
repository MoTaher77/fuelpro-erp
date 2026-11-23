@echo off
chcp 65001 >nul
title FuelPro - fill one year
cd /d "%~dp0"
set "PATH=C:\Program Files\nodejs;%PATH%"
set "DB_PATH=%~dp0data\demo.db"
node --disable-warning=ExperimentalWarning --experimental-sqlite scripts\fill-year.js --email hmoody11.com@gmail.com --currency YER
echo.
echo Done. Refresh the FuelPro page in the browser (F5).
pause
