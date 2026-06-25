@echo off
echo ================================================
echo  CITRINO — Deploy: Auditoría Masiva v2
echo ================================================
echo.
echo  Cambios incluidos:
echo  - CONOCIMIENTO.md: seed completo con conocimiento del negocio
echo  - AUDITORIA_MASIVA_v2.md: informe completo 100k escenarios
echo  - conversation.js: protocolo embarazo + alergias + NPS fallback CRM
echo  - consciousness.js: usa CRM nuevo (CLIENTES) con fallback al viejo
echo  - admin.js: historial extendido a 30 mensajes (antes 10)
echo  - bot/citrino-mind.js: NUEVO — entidad Citrino consultable
echo  - index.js: endpoints /api/citrino-mind + /api/citrino-mind/datos
echo.

cd /d "C:\Users\Lenovo\Claude\citrino-bot"

git add bot/conversation.js bot/consciousness.js bot/admin.js bot/citrino-mind.js index.js CONOCIMIENTO.md AUDITORIA_MASIVA_v2.md
git commit -m "feat: auditoria masiva v2 — protocolo embarazo/alergias, NPS persist fallback, consciousness CRM nuevo, admin history x30, Citrino Mind endpoint"
git push origin main

echo.
echo ================================================
echo  Push OK — Railway redeploy en ~2min
echo  Nuevos endpoints disponibles:
echo    POST /api/citrino-mind    (chatear con Citrino)
echo    GET  /api/citrino-mind/datos (datos del negocio)
echo ================================================
pause
