@echo off
echo ================================================
echo  CITRINO — Deploy completo (bot + CRM)
echo ================================================
echo.

echo [1/6] Build del CRM (citrino-agent)...
cd /d "C:\Users\Lenovo\Desktop\citrino-agent"
call npm run build
if %errorlevel% neq 0 (
  echo ERROR en el build. Abortando.
  pause
  exit /b 1
)
echo Build OK.
echo.

echo [2/6] Copiando dist al bot (citrino-bot)...
xcopy /s /y "dist\*" "C:\Users\Lenovo\Claude\citrino-bot\public\app\crm\"
echo Copia OK.
echo.

cd /d "C:\Users\Lenovo\Claude\citrino-bot"

echo [3/6] Migrando columnas en Google Sheets (CLIENTES)...
node bot/migrate-sheets.js
if %errorlevel% neq 0 (
  echo ADVERTENCIA: No se pudo migrar Sheets. Continuar de todas formas.
)
echo.

echo [4/6] Actualizando perfil de WhatsApp Business...
node bot/update-profile.js
if %errorlevel% neq 0 (
  echo ADVERTENCIA: No se pudo actualizar el perfil WA. Continuar de todas formas.
)
echo.

echo [5/6] Git push del bot (incluye CRM + todos los cambios)...
git add -A
git commit -m "feat: calendar clustering + ghost bookings; remarketing 3 etapas; autoReview6am; fix cuponera; migrate-sheets; update-profile"
git push origin main
echo Push OK.
echo.

echo ================================================
echo  [6/6] Deploy completado!
echo  Railway redeploy en ~2min.
echo  Foto de perfil: cambiarla manualmente en
echo  Meta Business Suite si es necesario.
echo ================================================
pause
