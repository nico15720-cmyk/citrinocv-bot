@echo off
cd /d "C:\Users\Lenovo\Claude\citrino-bot"
git add bot/sender.js
git commit -m "fix: enviarInstagram usa Messenger Platform (graph.facebook.com) en vez de graph.instagram.com"
git push origin main
echo.
echo Push OK
pause
