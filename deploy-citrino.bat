@echo off
echo ================================================
echo  CITRINO — Deploy completo (bot + CRM)
echo ================================================
echo.

echo [1/5] Build del CRM (citrino-agent)...
cd /d "C:\Users\Lenovo\Desktop\citrino-agent"
call npm run build
if %errorlevel% neq 0 (
  echo ERROR en el build. Abortando.
  pause
  exit /b 1
)
echo Build OK.
echo.

echo [2/5] Copiando dist al bot (citrino-bot)...
xcopy /s /y "dist\*" "C:\Users\Lenovo\Claude\citrino-bot\public\app\crm\"
echo Copia OK.
echo.

echo [3/5] Git push del bot (incluye CRM + cambios bot)...
cd /d "C:\Users\Lenovo\Claude\citrino-bot"
git add -A
git commit -m "fix: safe() para #ERROR! en ClienteDetalle; feat: temperatura leads, agenda timeline, buscar_cliente tel, crons activados, remarketing 7d"
git push origin main
echo Push bot OK.
echo.

echo ================================================
echo  Deploy completado! Railway redeploy en ~2min.
echo ================================================
pause
