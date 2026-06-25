@echo off
cd /d C:\Users\Lenovo\Claude\citrino-bot
git add index.js bot/conversation.js bot/calendar.js
git --no-pager diff --cached --stat
git commit -m "fix: echo IG/FB, nombre CRM en agendar/cancelar, recomendacion obligatoria"
git push origin main --force
echo.
echo === Deploy listo! Ahora renueva el token de Instagram en Railway ===
pause
