@echo off
chcp 65001 >nul
title Выгрузка SKIBIDI Gym Tracker на GitHub Pages
cd /d "g:\FitnessAPP"
F:\Programs\Git\cmd\git.exe add -A
F:\Programs\Git\cmd\git.exe commit -m "Update flat PWA files for GitHub Pages"
F:\Programs\Git\cmd\git.exe push -f origin main
echo.
echo ========================================================
echo   Готово! Через 1 минуту обнови страницу:
echo   https://miseriezz.github.io/skibidi-gym/
echo ========================================================
pause

