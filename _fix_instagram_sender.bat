@echo off
cd /d C:\Users\Lenovo\Claude\citrino-bot
git add bot/sender.js
git commit -m "fix: usar FACEBOOK_PAGE_ID en vez de 'me' para enviar mensajes de IG"
git push origin main
echo.
echo === Deploy enviado! ===
pause
