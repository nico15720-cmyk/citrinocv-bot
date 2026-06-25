@echo off
echo ================================================
echo  CITRINO BOT — Deploy mejoras auditoria exhaustiva
echo  - Fix TURNO URGENTE: handler SI/NO en admin
echo  - Fix si/no handler: incluye estado agendado
echo  - Fix Instagram: sanitizar mas formatos WA
echo  - Fix registrar_venta: comisiones correctas
echo  - Fix cross-canal: scheduler usa Canal no Origen
echo  - Fix IG 1000-char limit en enviarEnPartes
echo  - Fix ustedeo: "Te cuento" -> "Le cuento"
echo  - Informe AUDITORIA_EXHAUSTIVA_2026.md
echo ================================================
echo.

cd /d "C:\Users\Lenovo\Claude\citrino-bot"

echo  Verificando cambios...
git status --short

echo.
echo  Commiteando cambios del bot...
git add bot/scheduler.js bot/conversation.js bot/admin.js bot/sender.js AUDITORIA_2026.md AUDITORIA_EXHAUSTIVA_2026.md
git commit -m "fix: auditoria exhaustiva — cross-canal, IG limit, ustedeo, turno urgente, comisiones"
if %errorlevel% neq 0 (
    echo ERROR en el commit. Abortando.
    pause
    exit /b 1
)

echo.
echo  Pusheando a Railway...
git push origin main
if %errorlevel% neq 0 (
    echo ERROR en el push.
    pause
    exit /b 1
)

echo.
echo ================================================
echo  Deploy OK — Railway redeploy en ~2min
echo  Bot: https://citrinobienestar.uy
echo  CRM: https://citrinobienestar.uy/app/crm/
echo ================================================
pause
