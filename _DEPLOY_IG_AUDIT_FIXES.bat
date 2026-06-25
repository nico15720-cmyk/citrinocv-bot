@echo off
echo ================================================
echo  CITRINO — Deploy: Instagram Audit Fixes
echo ================================================
echo.
echo  Cambios incluidos:
echo  - sender.js: sanitizarParaInstagram (elimina asteriscos/guiones bajos)
echo  - index.js: Story Replies + Reactions + Media en webhook IG
echo  - scheduler.js: c.Canal (fix c.Origen incorrecto x5) + rebooking dead code
echo  - conversation.js: ustedeo sin contradiccion + reglas Instagram
echo.

cd /d "C:\Users\Lenovo\Claude\citrino-bot"

git add bot/sender.js bot/scheduler.js bot/conversation.js index.js
git commit -m "fix(instagram): audit fixes — sanitizar markdown IG, story replies, reactions, c.Canal correcto en scheduler, dead code rebooking, SYSTEM_PROMPT ustedeo + reglas IG"
git push origin main

echo.
echo ================================================
echo  Push OK — Railway redeploy en ~2min
echo ================================================
pause
