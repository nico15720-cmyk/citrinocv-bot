@echo off
title Citrino BOT — Deploy directo
echo.
echo ============================================
echo   CITRINO BOT — Deploy a Railway
echo ============================================
echo.

cd /d "C:\Users\Lenovo\Claude\citrino-bot"
git add -A
git commit -m "feat: soporte Groq en simulador — llama 3.3 70B, 8B, mixtral (gratis)"
git push origin HEAD

if %errorlevel% neq 0 (
  echo ERROR en git push
  pause & exit /b 1
)

echo.
echo ============================================
echo  LISTO! Railway auto-deploya en ~2 min
echo  Panel de test: https://citrinobienestar.uy/app/test
echo ============================================
echo.
pause
