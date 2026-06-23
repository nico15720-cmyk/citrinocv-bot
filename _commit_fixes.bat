@echo off
cd /d C:\Users\Lenovo\Claude\citrino-bot
git add bot/conversation.js
git --no-pager diff --cached --stat
git commit -m "fix: mensaje unico por respuesta, no mostrar horarios sin pedir, LISTA_RESERVAR saltea presentacion"
git push origin main --force
echo.
echo === Listo ===
pause
