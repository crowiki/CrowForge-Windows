@echo off
chcp 65001 >nul
cd /d "%~dp0"
title CrowForge - Instalador Gráfico
color 0A

echo ============================================
echo   CrowForge - Instalador Inteligente
echo ============================================
echo.

:: Verificar Node.js
where node >nul 2>&1
if errorlevel 1 (
    color 0C
    echo ERRO: Node.js nao encontrado!
    echo Instale Node.js 22.12 ou superior em https://nodejs.org/
    pause
    exit /b 1
)

:: Verificar se dependencias do instalador estao instaladas
if not exist "installer\node_modules" (
    echo Instalando dependencias do instalador...
    cd installer
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        echo Falha ao instalar dependencias do instalador.
        pause
        exit /b 1
    )
    cd ..
    echo Dependencias instaladas!
    echo.
)

echo Iniciando instalador grafico (sem janela de terminal)...
echo.

:: Usar launcher VBS silencioso para evitar janela CMD visivel
cscript //nologo "%~dp0INSTALAR_CROWBOT.vbs"

:: Aguardar um momento para garantir que o Electron iniciou
timeout /t 2 /nobreak >nul
exit