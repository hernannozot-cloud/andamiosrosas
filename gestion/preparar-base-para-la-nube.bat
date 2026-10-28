@echo off
chcp 65001 >nul
title Preparar la base de datos para Render
cd /d "%~dp0"
echo.
echo Antes de seguir, CIERRA la ventana negra del sistema de gestion (si esta abierta).
echo.
pause
"C:\Program Files\nodejs\node.exe" exportar-base.js
if errorlevel 1 goto error
echo.
echo El archivo base-para-la-nube-(fecha).db quedo en esta carpeta. Se abrira la carpeta.
explorer "%~dp0"
goto fin
:error
echo.
echo ALGO FALLO. Tomale una captura y mandasela a Claude.
:fin
echo.
pause
