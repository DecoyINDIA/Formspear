@echo off
cd /d "%~dp0\.."
if "%PORT%"=="" set PORT=4173
node src\server.js > data\server.log 2> data\server.err.log
