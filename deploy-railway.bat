@echo off
echo.
echo ============================================
echo    CITRINO BOT - DEPLOY AUTOMATICO
echo ============================================
echo.

REM 1. Login en Railway (abre el browser)
echo [1/4] Iniciando sesion en Railway...
railway login

echo.
echo [2/4] Conectando al proyecto de Railway...
echo    (Si es la primera vez, va a crear un nuevo proyecto)
railway link --environment production

echo.
echo [3/4] Subiendo variables de entorno desde .env...
railway variables set --from-file .env

echo.
echo [4/4] Haciendo deploy...
railway up --detach

echo.
echo ============================================
echo    DEPLOY COMPLETADO!
echo ============================================
echo.
echo Para ver el dominio de tu app:
railway domain

echo.
echo Para ver los logs en tiempo real:
echo    railway logs
echo.
pause
