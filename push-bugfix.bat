@echo off
cd /d "C:\Users\Lenovo\Claude\citrino-bot"
git add bot/conversation.js
git commit -m "fix: mensaje is not defined en smart retrieval — usar text"
git push origin main
echo Push OK.
pause
