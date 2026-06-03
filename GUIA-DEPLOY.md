# Guía de Deploy — Citrino Bot v2

## Tiempo estimado: 45-60 minutos

---

## PASO 1: Preparar el código en GitHub

1. Andá a **github.com** y creá una cuenta gratis si no tenés
2. Creá un repositorio nuevo llamado `citrino-bot` (privado)
3. Subí todos los archivos de esta carpeta al repositorio
   - ⚠️ NO subas el archivo `.env` (tiene tus contraseñas)
   - Sí subí `.env.example`, todos los `.js`, `package.json`

---

## PASO 2: Configurar Google Cloud (Calendar + Sheets)

Esta es la parte más importante. Google Calendar y Google Sheets son **gratis**.

### 2.1 Crear un proyecto en Google Cloud

1. Andá a **console.cloud.google.com**
2. Creá una cuenta o iniciá sesión con tu Gmail
3. Hacé click en **"Seleccionar proyecto"** (arriba) → **"Nuevo proyecto"**
4. Nombre: `citrino-bot` → click en **Crear**

### 2.2 Activar las APIs necesarias

1. En el menú izquierdo: **APIs y servicios** → **Biblioteca**
2. Buscá y activá:
   - **Google Calendar API** → click en **Activar**
   - **Google Sheets API** → click en **Activar**

### 2.3 Crear Service Account (cuenta de servicio)

1. **APIs y servicios** → **Credenciales** → **Crear credenciales** → **Cuenta de servicio**
2. Nombre: `citrino-bot-sa` → click en **Crear y continuar**
3. En el paso de roles: **Propietario** → click en **Continuar** → **Listo**
4. En la lista de cuentas de servicio, hacé click en la que acabás de crear
5. Andá a la pestaña **Claves** → **Agregar clave** → **Crear clave nueva** → **JSON**
6. Se va a descargar un archivo `.json`. ¡Guardalo bien!
7. Abrí ese archivo y copiá TODO el contenido (incluyendo las llaves `{}`)
   - Ese contenido va a la variable `GOOGLE_SERVICE_ACCOUNT_JSON` en Railway

### 2.4 Dar acceso al Calendar

1. Abrí **Google Calendar** en el navegador
2. A la izquierda, buscá el calendario que quieras usar (puede ser el principal)
3. Click en los tres puntitos → **Configuración y uso compartido**
4. Bajá hasta **Compartir con personas específicas** → **Agregar personas**
5. Pegá el email de la cuenta de servicio (termina en `@...iam.gserviceaccount.com`)
6. Permiso: **Hacer cambios en eventos** → **Enviar**
7. Copiá el **ID del calendario** (lo encontrás más abajo en esa misma página)
   - Ejemplo: `natalia@gmail.com` o algo como `c_abc123...@group.calendar.google.com`
   - Ese ID va a la variable `GOOGLE_CALENDAR_ID`

### 2.5 Crear el Google Sheet del CRM

1. Andá a **docs.google.com/spreadsheets** → **Nuevo documento**
2. Renombralo como `Citrino CRM`
3. Renombrá la primera hoja como `CRM` (click derecho en la tab "Hoja 1")
4. Compartí el sheet con la cuenta de servicio:
   - Click en **Compartir** (arriba a la derecha)
   - Pegá el email de la cuenta de servicio
   - Permiso: **Editor** → **Enviar**
5. Copiá el ID del Sheet desde la URL:
   - URL: `docs.google.com/spreadsheets/d/**ESTE_ES_EL_ID**/edit`
   - Ese ID va a la variable `GOOGLE_SHEETS_ID`
6. **No agregues headers manualmente** — el bot los crea solo al arrancar

---

## PASO 3: Deploy en Railway

1. Andá a **railway.app** y creá una cuenta (con tu GitHub)
2. Click en **"New Project"** → **"Deploy from GitHub repo"**
3. Seleccioná `citrino-bot`
4. Railway va a detectar que es Node.js y lo despliega automáticamente
5. Una vez desplegado, andá a **Settings > Domains** y generá un dominio
   - Va a quedar algo como: `citrino-bot.railway.app`

### 3.1 Variables de entorno en Railway

En Railway, andá a **Variables** y cargá estas variables:

```
VERIFY_TOKEN=citrino2024
ANTHROPIC_API_KEY=sk-ant-...
META_ACCESS_TOKEN=EAAxxxxx...
WHATSAPP_PHONE_NUMBER_ID=1234567890
FACEBOOK_PAGE_ID=1234567890
META_PAGE_ACCESS_TOKEN=EAAxxxxx...
INSTAGRAM_PAGE_ID=1234567890
GOOGLE_CALENDAR_ID=vos@gmail.com
GOOGLE_SHEETS_ID=1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
PORT=3000
```

⚠️ Para `GOOGLE_SERVICE_ACCOUNT_JSON`: copiá todo el contenido del JSON en una sola línea (Railway lo maneja bien así).

---

## PASO 4: Configurar Meta for Developers

### 4.1 Crear la App de Meta
1. Andá a **developers.facebook.com**
2. **"My Apps"** → **"Create App"** → Tipo **"Business"**
3. Nombre: `Citrino Bot`

### 4.2 Configurar WhatsApp
1. **"Add Product"** → agrega **WhatsApp**
2. **WhatsApp > API Setup**
3. Copiá el **Phone Number ID** → variable `WHATSAPP_PHONE_NUMBER_ID`
4. Generá un **Access Token permanente** (via Business Manager) → variable `META_ACCESS_TOKEN`
5. **Webhook > Configure**:
   - Callback URL: `https://tu-dominio.railway.app/webhook`
   - Verify Token: `citrino2024`
   - Click **"Verify and Save"**
6. Habilitá el campo: `messages`

### 4.3 Configurar Facebook Messenger
1. Agregá el producto **Messenger**
2. Conectá tu Página de Facebook
3. Copiá el **Page ID** → variable `FACEBOOK_PAGE_ID`
4. Generá un **Page Access Token** → variable `META_PAGE_ACCESS_TOKEN`
5. Webhook: misma URL, mismo token. Habilitá: `messages`, `messaging_postbacks`

### 4.4 Configurar Instagram
1. Conectá tu cuenta de Instagram Business (vinculada a la Página de Facebook)
2. Copiá el **Instagram Page ID** → variable `INSTAGRAM_PAGE_ID`
3. Webhook: misma URL. Habilitá: `messages`

---

## PASO 5: Obtener API Key de Anthropic (Claude)

1. Andá a **console.anthropic.com**
2. **"API Keys"** → **"Create Key"**
3. Copiá la key → variable `ANTHROPIC_API_KEY`
4. Cargá créditos ($5 USD alcanza para miles de conversaciones con Haiku)

---

## PASO 6: Personalizar el bot

Abrí `bot/conversation.js` y en la sección `SYSTEM_PROMPT` actualizá:
- Servicios y precios reales de Citrino
- Dirección real
- Número de WhatsApp real
- Handle de Instagram real

Abrí `bot/calendar.js` y en la sección `HORARIOS` ajustá los días y franjas horarias de la terapeuta.

Abrí `bot/crm.js` y en la función `getStats()` actualizá el precio promedio de sesión (actualmente `1500` UYU).

---

## PASO 7: Aprobar templates de Meta para recordatorios y remarketing

El bot necesita **templates aprobados por Meta** para enviar mensajes de recordatorio y remarketing
(los mensajes de primera iniciativa requieren templates aprobados).

Para ver los templates que necesitás aprobar, abrí en el navegador:
`https://tu-dominio.railway.app/api/templates`

Luego:
1. Andá a **Meta Business Suite** → **WhatsApp Manager** → **Plantillas de mensaje**
2. Click en **Crear plantilla**
3. Creá cada una de las plantillas que te muestra la URL de arriba
4. Enviá a revisión (Meta tarda 24-48hs)

---

## PASO 8: Dashboard

El dashboard está disponible en:
`https://tu-dominio.railway.app/dashboard`

Muestra en tiempo real:
- Total de contactos y leads
- Clientes agendados, que vinieron, que no vinieron
- Tasa de conversión
- Ingresos estimados
- Distribución por canal (WhatsApp / Facebook / Instagram)

---

## PASO 9: Probar todo

1. Mandá "hola" a tu WhatsApp Business desde otro número
2. Revisá los logs en Railway (tab **"Deployments"** → **"View Logs"**)
3. Verificá que aparezca el registro en el Google Sheet
4. Pedile al bot que te muestre disponibilidad

---

## Costos estimados

| Servicio | Costo |
|---|---|
| Railway | Gratis (hasta 500 hs/mes) o $5/mes ilimitado |
| Meta Webhooks | Gratis |
| Google Calendar API | Gratis |
| Google Sheets API | Gratis |
| Claude Haiku | ~$0.01 por 200 mensajes |
| **Total/mes ~200 leads** | **~$2-8 USD** |

---

## Preguntas frecuentes

**¿El bot funciona si no tengo internet?**
No, necesita conexión para hablar con Claude, Google y Meta.

**¿Qué pasa si se reinicia el servidor?**
Las conversaciones en memoria se borran (no es crítico, el cliente puede volver a escribir).
El CRM en Google Sheets persiste todo.

**¿Puedo cambiar los horarios de la terapeuta?**
Sí, editá el objeto `HORARIOS` en `bot/calendar.js`.

**¿Cómo marco que un cliente vino?**
Por ahora es manual en el Sheet (cambiá el estado de "agendado" a "vino" o "no_vino").
En una próxima versión se puede automatizar.

---

## Soporte

Si algo no funciona, mandá el error que aparece en los logs de Railway y lo resolvemos.
