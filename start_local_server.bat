@echo off
chcp 65001 >nul
title SKIBIDI Gym Tracker - Local Server
echo ========================================================
echo   SKIBIDI Gym Tracker PWA — Локальный сервер запущен!
echo ========================================================
echo.
echo 1. На компьютере открой в браузере:
echo    http://localhost:8080
echo.
echo 2. Чтобы открыть с телефона Vivo X300 по домашнему Wi-Fi,
echo    введи один из локальных IP-адресов ниже + :8080
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4"') do (
    echo    http://%%a:8080
)
echo.
echo ========================================================
F:\Programs\Python3.9\python.exe -m http.server 8080
pause

