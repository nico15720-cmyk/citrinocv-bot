# PARA ENCENDER EL BOT — Checklist definitivo

## ✅ Ya hecho
- [x] Código completo y subido a GitHub
- [x] Marta configurada con todos los servicios y precios de Citrino
- [x] CRM en Google Sheets (15 columnas, scoring, perfiles de clientes)
- [x] Google Calendar con horarios reales (L-V 8-18, Sáb 8-12)
- [x] Dirección real en todos los mensajes
- [x] Scheduler: recordatorios 24hs, remarketing, seguimiento post-sesión, resumen diario
- [x] Conciencia: análisis cada 6hs, alertas VIP, insight semanal los lunes
- [x] Panel admin para Nico por WhatsApp
- [x] Dashboard web en /dashboard
- [x] Variables WhatsApp y Google ya cargadas en .env

---

## ❶ GOOGLE — Compartir acceso (5 minutos)

La service account es: **bot-whatsapp@citrino-app-495316.iam.gserviceaccount.com**

### Google Calendar
1. Abrí calendar.google.com
2. Click en los 3 puntitos del calendario → "Configuración y uso compartido"
3. "Compartir con personas específicas" → Agregar: `bot-whatsapp@citrino-app-495316.iam.gserviceaccount.com`
4. Permiso: **"Hacer cambios en eventos"** → Enviar

### Google Sheets
1. Abrí el sheet: https://docs.google.com/spreadsheets/d/1y2RBm6VQyD-7ULCepkWfJRFIjfLdYS66Q_uCW-3MWko
2. Click en "Compartir" (arriba a la derecha)
3. Pegá: `bot-whatsapp@citrino-app-495316.iam.gserviceaccount.com`
4. Permiso: **Editor** → Enviar

---

## ❷ RAILWAY — Deploy (10 minutos)

### 2.1 Crear proyecto
1. Andá a **railway.app** → "New Project" → "Deploy from GitHub repo"
2. Seleccioná `nico15720-cmyk/citrinocv-bot`
3. Railway detecta Node.js y despliega solo

### 2.2 Cargar variables de entorno
En Railway → tu proyecto → **Variables** → "Raw Editor" → pegá esto:

```
VERIFY_TOKEN=citrino2024
ANTHROPIC_API_KEY=(copiá del archivo .env local — línea 9)
META_ACCESS_TOKEN=(copiá del archivo .env local — línea 12)
WHATSAPP_PHONE_NUMBER_ID=493523657174625
FACEBOOK_PAGE_ID=pendiente
META_PAGE_ACCESS_TOKEN=pendiente
INSTAGRAM_PAGE_ID=pendiente
GOOGLE_CALENDAR_ID=nicolas.nirodriguez@gmail.com
GOOGLE_SHEETS_ID=15xmr3uAVIY3jGxNo_M5Y8Y3rJTX933qKM12I6TnajLI
OWNER_WHATSAPP=59891998151
PORT=3000
```

⚠️ **GOOGLE_SERVICE_ACCOUNT_JSON** hay que pegarlo aparte (es muy largo):
- En Railway, añadí una variable llamada `GOOGLE_SERVICE_ACCOUNT_JSON`
- El valor está en tu archivo `.env` local (línea 27, todo el JSON)

### 2.3 Obtener el dominio
- Railway → Settings → Domains → "Generate Domain"
- Va a quedar algo como: `citrino-bot-production.up.railway.app`
- **Anotá esa URL** — la necesitás para el paso siguiente

---

## ❸ META WEBHOOK — Conectar WhatsApp (5 minutos)

1. Andá a **developers.facebook.com** → Tu app → WhatsApp → Configuration
2. En "Webhook" → Edit:
   - **Callback URL:** `https://TU-URL.railway.app/webhook`
   - **Verify Token:** `citrino2024`
3. Click "Verify and Save"
4. En "Webhook Fields" activá: ✅ `messages`

---

## ❹ PROBAR

Mandá "hola" al WhatsApp Business desde otro celular.  
Marta debería responder en 3-8 segundos.

Revisá los logs en Railway → Deployments → View Logs

---

## ❺ DESPUÉS DE QUE FUNCIONE (opcional)

### Templates Meta (para recordatorios automáticos)
Sin templates aprobados, los recordatorios de 24hs NO llegan si el cliente no escribió en las últimas 24hs.
Para aprobarlos: Meta Business Suite → WhatsApp Manager → Plantillas
Ver los textos en: `https://tu-url.railway.app/api/templates`
Meta tarda 24-48hs en aprobar.

### Facebook e Instagram
Cuando quieras activarlos, cargá en Railway:
- `FACEBOOK_PAGE_ID` = ID de tu página de Facebook
- `META_PAGE_ACCESS_TOKEN` = token de acceso de la página
- `INSTAGRAM_PAGE_ID` = ID de tu cuenta Instagram Business

---

## Costos estimados

| Servicio | Costo |
|---|---|
| Railway Hobby | $5/mes (ilimitado) |
| Claude Haiku | ~$0.50 por 1000 conversaciones |
| Google APIs | Gratis |
| Meta Webhooks | Gratis |
| **Total aprox.** | **~$5-8 USD/mes** |
