# Citrino Bot — Pasos Manuales
**Tiempo estimado: 45 minutos**

---

## ANTES DE EMPEZAR

Ejecutá `setup.bat` — instala las dependencias npm automáticamente y verifica que Node.js esté instalado.

---

## PASO 1 — Personalizar el bot (5 min)

Abrí `bot/conversation.js` y en el SYSTEM_PROMPT completá:
- `[COMPLETAR — ej: Av. 18 de Julio 1234, Montevideo]` → tu dirección real
- `[COMPLETAR]` → tu número de WhatsApp

Abrí `bot/calendar.js` y en la sección `HORARIOS` ajustá los días y horarios reales de la terapeuta.

---

## PASO 2 — Google Cloud (15 min)

### 2a. Crear proyecto y activar APIs
1. Andá a → **https://console.cloud.google.com**
2. Arriba: **Seleccionar proyecto → Nuevo proyecto** → nombre: `citrino-bot` → Crear
3. Menú izquierdo: **APIs y servicios → Biblioteca**
4. Buscá y activá: **Google Calendar API** y **Google Sheets API**

### 2b. Crear Service Account (la "cuenta" que usa el bot)
1. **APIs y servicios → Credenciales → Crear credenciales → Cuenta de servicio**
2. Nombre: `citrino-bot-sa` → Crear y continuar → rol: **Propietario** → Listo
3. Click en la cuenta creada → pestaña **Claves → Agregar clave → Crear clave nueva → JSON**
4. Se descarga un archivo `.json` → **guardalo, lo vas a necesitar**

### 2c. Compartir tu Google Calendar con el bot
1. Abrí **Google Calendar** → click en los 3 puntitos del calendario → **Configuración y uso compartido**
2. **Compartir con personas específicas → Agregar personas**
3. Pegá el email de la Service Account (dice `client_email` en el JSON descargado)
4. Permiso: **Hacer cambios en eventos** → Enviar
5. En esa misma página, copiá el **ID del calendario** (más abajo) → lo vas a necesitar

### 2d. Crear Google Sheet del CRM
1. Andá a → **https://docs.google.com/spreadsheets/u/0/create**
2. Renombralo `Citrino CRM`
3. Click derecho en la tab "Hoja 1" → Renombrar → `CRM`
4. **Compartir** (arriba a la derecha) → pegá el email de la Service Account → Editor → Enviar
5. Copiá el ID desde la URL: `docs.google.com/spreadsheets/d/**ESTE_TEXTO**/edit`

---

## PASO 3 — Anthropic API (2 min)

1. Andá a → **https://console.anthropic.com**
2. **API Keys → Create Key** → copiá la key
3. Cargá $5 USD (alcanzan para miles de conversaciones)

---

## PASO 4 — Subir a GitHub y deployar en Railway (10 min)

1. Creá cuenta en **https://github.com** (si no tenés)
2. Nuevo repositorio privado llamado `citrino-bot`
3. Subí todos los archivos de esta carpeta (**NO subas el archivo `.env`**)
4. Andá a → **https://railway.app** → creá cuenta con GitHub
5. **New Project → Deploy from GitHub repo** → seleccioná `citrino-bot`
6. Una vez desplegado: **Settings → Domains → Generate domain** → copiá la URL

---

## PASO 5 — Variables en Railway (5 min)

En Railway → **Variables** → cargá estas (con los datos que fuiste juntando):

| Variable | De dónde sacarla |
|---|---|
| `VERIFY_TOKEN` | `citrino2024` (ya está bien así) |
| `ANTHROPIC_API_KEY` | Paso 3 |
| `GOOGLE_CALENDAR_ID` | Paso 2c |
| `GOOGLE_SHEETS_ID` | Paso 2d |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Todo el contenido del archivo JSON del Paso 2b (en una sola línea) |
| `META_ACCESS_TOKEN` | Paso 6 |
| `WHATSAPP_PHONE_NUMBER_ID` | Paso 6 |
| `FACEBOOK_PAGE_ID` | Paso 6 |
| `META_PAGE_ACCESS_TOKEN` | Paso 6 |
| `INSTAGRAM_PAGE_ID` | Paso 6 |

---

## PASO 6 — Meta for Developers (10 min)

1. Andá a → **https://developers.facebook.com/apps**
2. **Create App → Business** → nombre: `Citrino Bot`
3. **Add Product → WhatsApp**
   - Copiá el **Phone Number ID** → variable `WHATSAPP_PHONE_NUMBER_ID`
   - Generá un **Access Token** → variable `META_ACCESS_TOKEN`
   - **Webhook → Configure**:
     - Callback URL: `https://TU-DOMINIO.railway.app/webhook`
     - Verify Token: `citrino2024`
     - Click **Verify and Save** → habilitá el campo `messages`
4. **Add Product → Messenger**
   - Conectá tu Página de Facebook
   - Copiá **Page ID** → `FACEBOOK_PAGE_ID` y generá **Page Access Token** → `META_PAGE_ACCESS_TOKEN`
   - Webhook: misma URL y token → habilitá `messages` y `messaging_postbacks`
5. Instagram Business (vinculada a la página de FB)
   - Copiá el **Instagram Page ID** → `INSTAGRAM_PAGE_ID`
   - Webhook: misma URL → habilitá `messages`

---

## PASO 7 — Aprobar templates de WhatsApp para recordatorios

1. Una vez el bot esté corriendo, abrí: `https://TU-DOMINIO.railway.app/api/templates`
2. Eso te muestra los 4 templates que necesitás crear
3. **Meta Business Suite → WhatsApp Manager → Plantillas → Crear plantilla**
4. Creá cada una y enviá a revisión (Meta tarda 24-48hs)

---

## PASO 8 — Probar

1. Mandá "hola" a tu WhatsApp Business desde otro número
2. Revisá logs: Railway → tu proyecto → **Deployments → View Logs**
3. Verificá que apareció el contacto en el Google Sheet

**Dashboard disponible en:** `https://TU-DOMINIO.railway.app/dashboard`
