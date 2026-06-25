@echo off
cd /d C:\Users\Lenovo\Claude\citrino-bot
echo.
echo ========================================
echo  Obteniendo Page Token con pages_messaging
echo ========================================
echo.
echo El navegador va a abrir el login de Facebook.
echo Aprobá los permisos y el token se captura automaticamente.
echo.
node _oauth_server.js
echo.
pause
