@echo off
title Citrino BOT — Deploy directo
echo.
echo ============================================
echo   CITRINO BOT — Deploy a Railway
echo ============================================
echo.

cd /d "C:\Users\Lenovo\Claude\citrino-bot"
git add -A
git commit -m "feat: test panel — simulador dry-run con pipeline visual"
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
