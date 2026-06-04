@echo off
echo ================================================
echo   Citrino Bot - Instalacion de dependencias
echo ================================================

:: Verificar Node.js
node --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js no esta instalado.
    echo Descargalo desde https://nodejs.org  ^(versión LTS^)
    pause
    exit /b 1
)

for /f "tokens=1,* delims=v" %%a in ('node --version') do set NODE_VER=%%b
echo Node.js encontrado: v%NODE_VER%

:: Verificar version minima (18)
for /f "tokens=1 delims=." %%a in ("%NODE_VER%") do set NODE_MAJOR=%%a
if %NODE_MAJOR% LSS 18 (
    echo ERROR: Necesitas Node.js 18 o mayor. Tenes la version %NODE_VER%
    echo Descargalo desde https://nodejs.org
    pause
    exit /b 1
)

echo.
echo Instalando dependencias...
npm install

if errorlevel 1 (
    echo ERROR al instalar dependencias.
    pause
    exit /b 1
)

:: Crear .env si no existe
if not exist .env (
    copy .env.example .env
    echo.
    echo Archivo .env creado desde .env.example
    echo IMPORTANTE: Abri el archivo .env y completa tus credenciales
) else (
    echo Archivo .env ya existe - no se sobreescribio
)

echo.
echo ================================================
echo   Listo! Pasos siguientes:
echo   1. Completa el archivo .env con tus credenciales
echo   2. Ejecuta: node index.js
echo ================================================
pause
