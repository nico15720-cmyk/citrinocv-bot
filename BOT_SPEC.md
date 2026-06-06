# CITRINO BOT — Especificación Técnica Completa
*Actualizar este archivo cada vez que se agregue o modifique una funcionalidad.*

---

## 1. DESCRIPCIÓN GENERAL
Bot de WhatsApp/Instagram/Facebook para Citrino, centro de bienestar en Montevideo, Uruguay.
El bot se llama **Marta** — asistente de bienestar, no un bot.
Dueño: Nico (nicolas.nirodriguez@gmail.com)

### Stack
- **Runtime**: Node.js ≥18, Express
- **IA**: Anthropic Claude (claude-haiku-4-5-20251001) vía `@anthropic-ai/sdk`
- **Canales**: WhatsApp Business API, Facebook Messenger, Instagram DM (Meta Graph API v19)
- **Calendario**: Google Calendar (Service Account) vía `@googleapis/calendar`
- **Base de datos**: Google Sheets vía `@googleapis/sheets`
- **Deploy**: Railway (dominio: `citrinocv-bot-production.up.railway.app`)

---

## 2. ARCHIVOS Y ESTRUCTURA

```
citrino-bot/
├── index.js                  # Servidor Express + webhook + APIs
├── bot/
│   ├── conversation.js       # Motor de conversación (Claude), message batching/splitting
│   ├── calendar.js           # Google Calendar: slots, crear/cancelar eventos
│   ├── crm.js                # Google Sheets CRM: clientes, estados, cuponeras, chats
│   ├── finanzas.js           # Google Sheets Finanzas: ingresos, gastos
│   ├── terapeutas.js         # Google Sheets Terapeutas: config por terapeuta
│   ├── media.js              # Descarga y procesa imágenes/audio de WhatsApp
│   ├── sender.js             # Envío de mensajes multi-canal (WA, FB, IG)
│   ├── scheduler.js          # Cron jobs: recordatorios, remarketing, resumen diario
│   ├── admin.js              # Módulo admin (Nico habla con el bot sobre el negocio)
│   ├── consciousness.js      # Análisis de conversaciones, detección de señales
│   ├── self-fix.js           # Contexto dinámico, auto-corrección
│   ├── reportes.js           # Reportes de leads, VIP, inactivos, cuponeras
│   └── utils.js              # Helpers: retry, verificación de salud
├── public/
│   ├── admin.html            # CRM web: lista clientes, filtros, acciones
│   ├── agenda.html           # Agenda semanal tipo Google Calendar
│   ├── finanzas.html         # Finanzas: ingresos, gastos, tendencias
│   ├── cliente.html          # Perfil individual de cliente (LTV, historial, chat)
│   └── dashboard.html        # Dashboard móvil (stats, modo bot, campañas)
└── BOT_SPEC.md               # ESTE ARCHIVO
```

---

## 3. VARIABLES DE ENTORNO (.env)

```
ANTHROPIC_API_KEY=            # Clave Claude
META_ACCESS_TOKEN=            # WhatsApp Business token
META_PAGE_ACCESS_TOKEN=       # Facebook/Instagram token
META_PAGE_TOKEN_EXPIRES=      # Fecha vencimiento token (YYYY-MM-DD)
WHATSAPP_PHONE_NUMBER_ID=     # ID del número WA
VERIFY_TOKEN=                 # Token verificación webhook
OWNER_WHATSAPP=               # Número de Nico (+598...) para notificaciones
GOOGLE_SERVICE_ACCOUNT_JSON=  # JSON de service account (una sola línea)
GOOGLE_CALENDAR_ID=           # ID del Google Calendar principal
GOOGLE_SHEETS_ID=             # ID del Google Sheet
GOOGLE_SHEETS_ID_CITRINO=     # (alias) ID del Sheet
PORT=3000
TERAPEUTA_NOMBRE=Citrino      # Nombre de la terapeuta principal
```

---

## 4. GOOGLE SHEETS — HOJAS

### Hoja "CRM" (columnas A-P)
| Col | Campo           | Descripción |
|-----|-----------------|-------------|
| A   | ID              | Número de teléfono o user ID |
| B   | Nombre          | |
| C   | Teléfono        | |
| D   | Canal           | whatsapp / facebook / instagram / dashboard |
| E   | Servicio        | Último servicio consultado |
| F   | Estado          | lead / agendado / vino / no_vino / cancelado |
| G   | Cuponera        | si / no |
| H   | Ses. Rest.      | Sesiones restantes de cuponera |
| I   | Fecha Alta      | ISO timestamp |
| J   | Fecha Turno     | ISO timestamp próximo turno |
| K   | Event ID        | Google Calendar event ID |
| L   | Notas           | Texto libre |
| M   | Último Contacto | ISO timestamp |
| N   | Remarketing     | Fecha último remarketing |
| O   | Perfil          | JSON aprendido por IA |
| P   | Chats           | JSON últimos 30 mensajes |

### Hoja "Finanzas" (columnas A-H)
Fecha | Tipo (ingreso/gasto) | Categoría | Descripción | Monto | ClienteID | Servicio | Notas

### Hoja "Terapeutas" (columnas A-F)
ID | Nombre | Color | Horarios (JSON) | CalendarID | Activa (si/no)

---

## 5. FLUJO DE CONVERSACIÓN

### Batching de mensajes
- Se esperan **8 segundos** desde el último mensaje antes de procesar
- Si llegan múltiples mensajes en ese lapso, se concatenan y procesan juntos
- Implementado en `index.js` con `messageBatch` (Map userId → timer)

### Respuestas largas
- Si la respuesta tiene múltiples párrafos y >250 chars, se divide en partes
- Cada parte se envía con ~1 segundo de pausa entre ellas (splitting natural)

### Horario del bot
- **7:30 a 21:30** (hora Uruguay / America/Montevideo)
- Fuera de horario: respuesta automática de que responde a la mañana

### Seguridad
- Solo el número `OWNER_WHATSAPP` puede acceder al modo admin
- El modo admin solo se activa con el comando `/admin`
- El SYSTEM_PROMPT incluye instrucciones anti-prompt-injection
- Marta NUNCA revela información financiera, del sistema ni de otras clientas

---

## 6. ACCIONES QUE MARTA PUEDE EJECUTAR

```json
{"tipo": "ver_disponibilidad"}
{"tipo": "agendar", "slot_label": "lunes 10:00", "nombre": "...", "servicio": "..."}
{"tipo": "cancelar"}
{"tipo": "guardar_nombre", "nombre": "..."}
{"tipo": "guardar_servicio", "servicio": "..."}
{"tipo": "escalar", "motivo": "..."}
{"tipo": "agregar_nota", "texto": "..."}
```

---

## 7. SERVICIOS Y PRECIOS

| Servicio                  | Precio |
|---------------------------|--------|
| Método Citrino            | $1.500 |
| Drenaje Linfático         | $1.500 |
| Masaje Descontracturante  | $1.200 |
| Masaje Relax              | $1.300 |
| Masaje Modelador          | $1.500 |
| Masaje Piedras Calientes  | $1.500 |
| Reflexología              | $1.300 |
| Reiki                     | $1.200 |
| Limpieza de Cutis         | $1.500 |
| Manicuría                 | $1.300 |
| Podología                 | $1.300 |
| Depilación                | $1.300 |

**Cuponeras:**
- Pack 4 sesiones: $5.100
- Pack 6 sesiones: $7.400
- Pack 8 sesiones: $9.600

---

## 8. SCHEDULERS (CRON JOBS)

| Frecuencia          | Tarea |
|---------------------|-------|
| Cada hora           | Recordatorios 24hs antes de turno |
| Lun/Mié/Vie 10:00   | Remarketing a leads sin respuesta (+48hs) |
| Diario 11:00        | Seguimiento post-sesión (7 días después) |
| **Diario 20:00**    | **Resumen corto para Nico** (turno mañana + stats del día) |
| Cada 6hs            | Análisis de conciencia / proactividad |
| Cada 4hs            | Health check del sistema |
| Diario 9:00         | Alerta vencimiento token Meta |
| Diario 3:00am       | Auto-review nocturno |

---

## 9. APIs REST

### Clientes
- `GET /api/clientes` — lista todos
- `GET /api/clientes/:id/perfil-completo` — perfil + turnos + pagos + chats
- `GET /api/clientes/:id/chats` — historial de chat
- `POST /api/clientes/nuevo` — alta manual con turno opcional
- `POST /api/clientes/:id/asistencia` — marcar vino/no vino (auto-registra ingreso)
- `POST /api/clientes/:id/cuponera` — registrar pack
- `POST /api/clientes/:id/nota` — agregar nota
- `POST /api/clientes/:id/mensaje` — enviar WA manual

### Agenda
- `GET /api/agenda/eventos` — eventos del calendar con CRM cruzado
- `GET /api/agenda/disponibilidad` — slots libres
- `GET /api/agenda/terapeutas` — config terapeutas
- `POST /api/agenda/turno` — crear turno
- `DELETE /api/agenda/turno/:id` — cancelar turno

### Finanzas
- `GET /api/finanzas/resumen?mes=YYYY-MM` — resumen mensual
- `GET /api/finanzas/transacciones` — lista
- `POST /api/finanzas/ingreso` — registrar ingreso manual
- `POST /api/finanzas/cuponera` — registrar ingreso cuponera
- `POST /api/finanzas/gasto` — registrar gasto

### Terapeutas
- `GET /api/terapeutas`
- `POST /api/terapeutas`
- `PUT /api/terapeutas/:id`
- `DELETE /api/terapeutas/:id`

### Control
- `GET /api/control/estado`
- `POST /api/control/modo` — auto / pausa / off
- `GET /api/stats`
- `GET /api/changelog`
- `GET /api/cliente-tipo`

---

## 10. PÁGINAS WEB

| URL           | Descripción |
|---------------|-------------|
| `/admin`      | CRM — lista de clientes, filtros, acciones rápidas |
| `/agenda`     | Agenda semanal con Google Calendar + gestión de terapeutas |
| `/finanzas`   | Ingresos, gastos, tendencia 6 meses |
| `/cliente?id=` | Perfil individual: LTV, historial, chat, perfil IA |
| `/dashboard`  | Dashboard móvil con stats y control del bot |

---

## 11. MEDIA SOPORTADA

- **Imágenes** (WhatsApp): se descargan vía Meta API, se pasan a Claude Vision
  - Uso principal: comprobantes de pago, fotos de zonas corporales
- **Documentos/PDF**: mismo flujo que imágenes
- **Audio**: se detecta y Marta pide que escriban (sin transcripción automática aún)

---

## 12. MÓDULO STATS (bot/stats.js)

- `getLTVCliente(userId)` — suma ingresos de Finanzas para ese cliente
- `getRankingClientes(limit)` — clientes ordenados por LTV con breakdown sesiones
- `getFloat()` — sesiones vendidas pero no dadas, capital flotante
- `getStatsCompletos(mes)` — ingresos brutos, comisiones, netos, gastos, margen, sesiones, ticket promedio

**Comisiones por medio de pago:**
| Medio | Tasa |
|-------|------|
| Efectivo / Transferencia | 0% |
| Débito | 2.75% |
| Crédito 1 cuota | 3% |
| Crédito 3 cuotas | ~10% |
| MercadoPago | 8% |

## 13. COMANDOS DE NICO (desde WhatsApp al OWNER_WHATSAPP)

- `/admin` — activa modo admin (Marta responde con datos del negocio)
- `/marta` — vuelve al modo clienta
- `/nicolas` — Nico toma el control de esa conversación
- `/alerta MOTIVO` — manda 4 mensajes de alerta + descripción
- `/nollego [nombre]` — envía recordatorio a cliente que no llegó

## 14. MULTI-TERAPEUTA

Citrino tiene 3-4 gabinetes de masajes + sala grande (psicólogo/médico).
Múltiples terapeutas pueden atender simultáneamente.

- `getDisponibilidadTodos()` — verifica por separado el calendar de CADA terapeuta
- `getSlotsParaTerapeuta(config)` — slots libres de un terapeuta específico
- `crearTurno({ ..., terapeutaId })` — crea el evento en el calendar del terapeuta correcto
- Agenda web muestra selector de terapeuta al crear un turno
- Marta muestra disponibilidad agrupada por terapeuta cuando hay múltiples

**Para agregar terapeutas**: ir a `/agenda` → botón "Terapeutas" → agregar con nombre, color, horarios y Google Calendar ID propio.

## 15. AUDIO CON GEMINI

Para transcripción de audios de WhatsApp:
1. Obtener GEMINI_API_KEY en https://aistudio.google.com (gratis)
2. Agregar a las variables de entorno en Railway: `GEMINI_API_KEY=...`
3. El bot transcribirá automáticamente las notas de voz

Sin la clave, el bot pedirá que escriban el mensaje.

## 16. PENDIENTES / ROADMAP

- [ ] Importar clientes desde CSV (app anterior: hay 180 clientes con sesiones)
- [ ] Inbox de chats en el dashboard (ver conversaciones en curso)
- [ ] Periodo de prueba: Nico recibe copia de cada conversación
- [ ] Reconfirmación a las 12hs si no confirman a las 24hs
- [ ] Botón "No llegó aún" directo desde agenda para enviar mensaje al cliente

---

## 13. INFORMACIÓN DE CITRINO

- **Dirección**: Sarandí 554 apto. 1, frente a Plaza Matriz, Ciudad Vieja, Montevideo
- **Horarios**: Lun-Vie 8:00-19:00, Sábados por la mañana. Última clienta: 19:30.
- **Entre turnos**: mínimo 2:30hs
- **Instagram**: @citrino.cv | **Facebook**: Citrinocv | **Web**: citrinobienestar.uy
- **WhatsApp**: +598 91 998 151
- **Pagos**: débito y crédito hasta 3 cuotas sin recargo

---

*Última actualización: 2026-06-05*
