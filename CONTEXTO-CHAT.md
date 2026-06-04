# CONTEXTO PARA CONTINUAR EN OTRO CHAT

## Proyecto: Citrino Bot

**Repo:** https://github.com/nico15720-cmyk/citrinocv-bot  
**Carpeta local:** `C:\Users\Lenovo\Claude\citrino-bot`  
**Último commit:** `067c535` — consciousness.js integrado

---

## ¿Qué es este bot?

Bot de WhatsApp para **Citrino**, spa de masajes en Montevideo (Sarandí 554 apto. 1, frente a Plaza Matriz).  
La IA se llama **Marta** y atiende clientes, agenda turnos en Google Calendar y guarda todo en Google Sheets.  
El dueño es **Nico** (WhatsApp: +598 91 998 151).

---

## Stack

- **Node.js + Express** — servidor principal (`index.js`)
- **Claude Haiku** (`claude-haiku-4-5-20251001`) — cerebro de Marta
- **Meta API** — WhatsApp Business (principal), Facebook, Instagram
- **Google Calendar** — disponibilidad y agendamiento
- **Google Sheets** — CRM completo
- **Railway** — hosting (aún pendiente de deploy)
- **node-cron** — scheduler automático

---

## Módulos

| Archivo | Función |
|---|---|
| `bot/conversation.js` | Motor de conversación de Marta + acciones (agendar, cancelar, etc.) |
| `bot/admin.js` | Panel de Nico por WhatsApp — stats, notas, cuponeras |
| `bot/crm.js` | CRM en Google Sheets — 15 columnas, scoring, perfiles |
| `bot/calendar.js` | Disponibilidad y turnos en Google Calendar |
| `bot/scheduler.js` | Recordatorios 24hs, remarketing, seguimiento, resumen diario 20hs |
| `bot/consciousness.js` | Análisis del negocio cada 6hs — alertas VIP, insights semanales lunes |
| `bot/sender.js` | Envío multi-canal con delay humano |
| `public/dashboard.html` | Dashboard de métricas |
| `public/admin.html` | Panel admin web |

---

## Estado actual del .env

```
VERIFY_TOKEN=citrino2024                          ✅
ANTHROPIC_API_KEY=sk-ant-api03-...                ✅
META_ACCESS_TOKEN=EAAKbLcVH...                    ✅
WHATSAPP_PHONE_NUMBER_ID=493523657174625          ✅
FACEBOOK_PAGE_ID=pendiente                        ⚠️ (no es urgente)
META_PAGE_ACCESS_TOKEN=pendiente                  ⚠️ (no es urgente)
INSTAGRAM_PAGE_ID=pendiente                       ⚠️ (no es urgente)
GOOGLE_CALENDAR_ID=nicolas.nirodriguez@gmail.com  ✅
GOOGLE_SHEETS_ID=15xmr3uAVIY3j...                 ✅
GOOGLE_SERVICE_ACCOUNT_JSON={...}                 ✅
OWNER_WHATSAPP=59891998151                        ✅
PORT=3000                                         ✅
```

---

## Lo que falta para encender

1. **Google** — compartir Calendar y Sheet con `bot-whatsapp@citrino-app-495316.iam.gserviceaccount.com`
2. **Railway** — crear proyecto, conectar repo, cargar variables (ver `PARA-ENCENDER.md`)
3. **Meta webhook** — configurar URL de Railway en Meta for Developers
4. **Templates Meta** — aprobar plantillas para remarketing (opcional al inicio)

---

## Detalles del CRM (Google Sheets)

Sheet ID: `1y2RBm6VQyD-7ULCepkWfJRFIjfLdYS66Q_uCW-3MWko`  
Tab: `CRM`  
Headers creados automáticamente al primer arranque.

Columnas: ID | Nombre | Teléfono | Canal | Servicio | Estado | Cuponera | Ses.Rest. | FechaAlta | FechaTurno | EventID | Notas | UltimoContacto | Remarketing | Perfil

Estados posibles: `lead` → `agendado` → `vino` / `no_vino` / `cancelado`

---

## Comandos útiles en WhatsApp (para Nico)

- `/nicolas` — Nico toma el control del chat, Marta se detiene
- `/marta` — Marta retoma el control
- Cualquier pregunta al número propio → módulo admin (stats, acciones)

---

## Horarios configurados en calendar.js

Lunes a viernes: 8:00 — 18:00 (último slot 16:30, termina 18:00)  
Sábados: 8:00 — 12:00  
Duración slot: 90 min (sesión + limpieza)  
Para incluir slot de 18:00 (termina 19:30): cambiar `fin: 18` a `fin: 19.5`

---

## Servicios y precios (en SYSTEM_PROMPT de conversation.js)

- Método Citrino: $1.500 / Pack 4: $5.100 / Pack 6: $7.400 / Pack 8: $9.600
- Drenaje Linfático: $1.500
- Descontracturante: $1.200
- Relax: $1.300
- Modelador: $1.500
- Piedras Calientes: $1.500
- Reflexología: $1.300
- Reiki: $1.200
- Limpieza de cutis: $1.500
- Manicuría/Depilación/Podología: $1.300
- Taller maquillaje: $1.500
- Quinceañeras/Novias: $2.700
- Masajes corporativos empresa: desde $2.000 UYU/hora

---

## Lo que estaba en progreso al cortar el chat anterior

Se estaba a punto de encender el bot. Falta solo el deploy en Railway y configurar el webhook de Meta.
Ver archivo `PARA-ENCENDER.md` para los pasos exactos.
