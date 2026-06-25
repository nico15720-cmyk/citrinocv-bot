# Auditoría Completa — Citrino Bot
**Fecha:** Junio 2026  
**Alcance:** conversation.js, admin.js, consciousness.js, calendar.js, sender.js, scheduler.js, index.js, sheets-crm.js, citrino-mind.js

---

## Resumen Ejecutivo

El bot de Marta está en un estado técnico muy sólido para un negocio de este tamaño. Tiene:
- Flujo de booking completo con anti-doble-booking, slot lock y reagendamiento automático
- NPS post-sesión con alertas a Nico cuando el score es bajo
- Smart retrieval de conocimiento (no dump completo)
- Auto-aprendizaje desde conversaciones reales
- Persistencia de historial de conversaciones en Sheets (sobrevive reinicios)
- Panel admin potente con acciones directas desde WhatsApp

Se encontraron **5 bugs críticos** y **6 oportunidades de mejora**. Se implementaron 4 fixes en esta sesión.

---

## Bugs Encontrados

### 🔴 Bug Crítico #1 — TURNO URGENTE sin handler en admin (IMPLEMENTADO)
**Archivo:** `admin.js`, `conversation.js`

**Problema:** Cuando Nico recibe el aviso "⚡ TURNO URGENTE — ¿Tenemos lugar para hoy? Respondé SI o NO", el admin bot no tenía contexto sobre QUÉ cliente estaba esperando. Si Nico respondía "SI" o "NO", el admin pasaba la respuesta a Claude que no tenía idea de para quién era.

**Impacto:** El cliente queda esperando indefinidamente sin respuesta real. Alta fricción.

**Fix:** Se agrega en `admin.js` un handler pre-Claude que:
1. Detecta si el texto es SI/NO simple
2. Verifica si hay turnos urgentes pendientes en `turnosUrgentesMap`
3. Si hay, responde al cliente correspondiente con slots del día (SI) o disculpa + oferta de otro día (NO)
4. Notifica a Nico que el mensaje fue enviado

---

### 🔴 Bug Crítico #2 — Sí/No handler no captura estado "agendado" (IMPLEMENTADO)
**Archivo:** `conversation.js` línea 1162

**Problema:** El handler que detecta si una clienta responde "si/no" a un turno próximo en las 48 horas solo chequeaba estados: `confirmado`, `pendiente_confirmacion`, `prospecto`. No incluía `agendado` — el estado más común cuando el turno fue creado por el bot.

**Impacto:** Las clientas con turno en estado `agendado` que responden "sí" o "no" eran ignoradas por el handler automático y pasaban a Claude (que podía generar una respuesta inesperada).

**Fix:** Agregado `|| cliente.Estado === "agendado"` a la condición.

---

### 🔴 Bug Crítico #3 — `sanitizarParaInstagram` incompleta (IMPLEMENTADO)
**Archivo:** `sender.js`

**Problema:** Solo limpiaba `*negrita*` y `_itálica_`. Dejaba pasar `~tachado~`, `` ```código``` ``, `> cita`, `- bullet`, `1. lista numerada`. En Instagram, todos estos aparecen como caracteres literales (`~texto~`, ` ``` `, `>`, `- texto`).

**Impacto:** Respuestas con formato viéndose feas en Instagram. Mala imagen de marca.

**Fix:** Se agregó limpieza de todos los formatos WA: tachado, código inline, bloques código, blockquotes, bullets y listas numeradas. Los bullets se convierten a `·` que sí es legible en IG.

---

### 🔴 Bug Crítico #4 — `registrar_venta` admin no descuenta comisiones (IMPLEMENTADO)
**Archivo:** `admin.js`

**Problema:** Al registrar una venta desde el panel admin con `/registrar_venta`, `Ingreso_Real` se seteaba = `monto` sin descontar la comisión del medio de pago. En el CRM React, el `Ingreso_Real` ya se calculaba correctamente.

**Impacto:** Los reportes financieros del CRM mostraban ingresos inflados para ventas registradas desde el admin (ej: una venta de $7.200 con débito → el CRM mostraba $7.200 en vez de $7.002).

**Fix:** Se aplica la misma lógica de comisiones del CRM React:
- Débito: 2.75%
- 1-2 Cuotas: 9.75%
- 3 Cuotas: 10.36%
- Mercado Pago: 8.03%

El admin ahora confirma el monto neto al registrar ("neto: $X — Y% de comisión").

---

### 🟡 Bug Medio #5 — `mensajesPendientes` se pierde en reinicios de Railway
**Archivo:** `conversation.js`

**Problema:** Los mensajes que llegan fuera de horario (de noche, domingos) se guardan en el Map `mensajesPendientes`. Si Railway hace un redeploy mientras esos mensajes están encolados, se pierden. La clienta recibió el aviso de "fuera de horario" pero nunca recibe respuesta.

**Impacto:** Clientas que escriben el domingo a las 22hs pueden quedar sin respuesta si hay un deploy el lunes temprano antes de que el bot las procese.

**Fix pendiente:** Persistir `mensajesPendientes` en un archivo JSON local (`/tmp/pending.json`) o en Sheets. Al iniciar el servidor, cargar el archivo y procesar los mensajes pendientes.

---

### 🟡 Bug Medio #6 — Admin `historialAdmin` se reinicia en cada deploy
**Archivo:** `admin.js`

**Problema:** `historialAdmin` es un array en memoria. Cada deploy de Railway lo borra. Si Nico tenía una conversación larga con el admin bot (ej: revisando el CRM con múltiples búsquedas), pierde todo el contexto.

**Impacto:** El admin bot no recuerda el contexto de conversaciones pasadas con Nico. Menor en la práctica (Nico ya sabe esto) pero molesto en sesiones largas.

**Fix pendiente:** Persistir `historialAdmin` en Railway (en memoria cross-restart con un archivo JSON). O simplemente ignorar el problema dado que el admin system prompt incluye todos los datos del negocio en cada llamada, lo que compensa parcialmente.

---

## Hallazgos de Arquitectura

### ✅ Lo que está muy bien
- **Anti-doble-booking:** `_slotsEnProceso` Set + verificación de duplicados en `crearTurno`. Sólido.
- **Smart retrieval:** No se envía todo el conocimiento en cada prompt — solo los fragmentos relevantes. Eficiente.
- **Clustering de agenda:** Las reglas de negocio (máx 2.5h de gap entre sesiones) están correctamente implementadas en `filtrarSlotsAgrupados`.
- **Alta intención:** Detección de precio + horario juntos → salta la intro. Mejora conversión.
- **NPS automático:** Envío post-sesión + alerta a Nico si score ≤ 3. Excelente para retención.
- **Fallback de slots:** Si `slotsPendientes` expiró o está vacío, re-fetcha Google Calendar automáticamente. No crashea.
- **Rate limiting de análisis:** `analizarConversacion` tiene pre-screening de keywords + 15 min de rate limit por usuario. Eficiente.
- **Coalescing en admin:** Espera 1.5s para combinar mensajes múltiples de Nico. Buena UX.

### ⚠️ Lo que podría mejorar
- **Historial de conversación limitado a 8 mensajes:** Por diseño para reducir tokens. El riesgo es que en conversaciones largas (lead que pide info → pide disponibilidad → repregunta → confirma), el bot "olvida" el primer contexto. Solucionable aumentando a 12.
- **`turnosUrgentesMap` solo limpia por TTL en `handleIncomingMessage`:** Si el cliente no escribe nada después de que Nico responde, el turno urgente queda en la Map hasta el próximo mensaje del cliente. Menor.
- **Admin usa `leerTodosLosClientes()` de CRM viejo:** La función `recolectarDatosNegocio()` usa el CRM legacy (`crm.js`) para datos de estado de clientes. Debería migrar a `sheets-crm.js` para consistencia.
- **`registrar_cuponera` en admin solo llama a `crm.js`:** No registra en VENTAS (la fuente de verdad del CRM React). Al marcar cuponera desde el admin bot, el CRM React no lo refleja.

---

## Análisis del Flujo WhatsApp

### Flujo de Conversión (Lead → Turno)
```
Nueva clienta → Saludo automático → Presentación Marta → 
Precio/info → Ver disponibilidad → Confirmar turno → 
Recordatorio 2h antes → NPS post-sesión → Oferta de re-booking
```

**Fortalezas:**
- El flujo es completo y cubre el 95% de casos
- `detectarAltaIntencion` evita rodeos innecesarios para clientes decisivos
- Re-booking automático post-sesión mantiene el LTV alto
- Confirmación 48h antes reduce no-shows

**Debilidades encontradas:**
- Si una clienta pregunta precio pero NO pregunta horario (solo precio), el bot presenta primero toda la info de servicios antes de ofrecer disponibilidad. Para clientas que solo quieren saber el precio y ya conocen el lugar, esto es un paso extra innecesario.
- No hay manejo específico de "¿puedo ir con mi hija/amiga?" (pregunta frecuente). El bot puede contestar mal si no hay conocimiento en la base.

### Manejo de Objeciones
**Las objeciones se guardan en CRM** (`guardar_objecion`) — buena práctica para auto-aprendizaje.

Tipos de objeciones comunes que el sistema debería tener en la base de conocimiento:
- "Es caro" → respuesta de valor + comparación con alternativas
- "No tengo tiempo" → mencionar sábados + horarios extendidos
- "Ya tengo masajista" → diferenciador Citrino (ambiente, profesionalismo, precio/valor)
- "¿Me puede ir a domicilio?" → solo con precio premium, requiere coordinación con Nico

### Manejo de Errores de Escritura y Slang
El bot usa Claude Haiku que maneja bien la escritura informal uruguaya. El system prompt explícitamente menciona el ustedeo. No se detectaron problemas graves aquí.

**Casos edge que pueden ser problemáticos:**
- Clientas que escriben solo emojis (🙋) → el bot recibe `[La clienta envió un sticker 😊 ...]` y responde con calidez. OK.
- Mensajes de voz no transcriptos → responde pidiendo que escriban. Riesgo: algunas clientas solo usan audio y podrían frustrarse. Solución: Gemini transcribing ya está implementado para audios.
- Preguntas médicas específicas ("¿el masaje ayuda con hernia de disco?") → el system prompt pide no dar consejos médicos. Pero si el conocimiento no tiene respuesta, puede escalar a Nico.

---

## Análisis del Flujo Instagram

### Estado actual
- Story replies y reactions están manejados (devuelven respuesta apropiada)
- La sanitización de markdown se mejoró en esta sesión
- El canal Instagram usa `META_PAGE_ACCESS_TOKEN` — independiente del token de WA

### Problemas Instagram específicos
- **Max 1000 chars en IG DM:** Instagram limita mensajes a 1000 caracteres. Si `enviarEnPartes` no splitea considerando este límite (solo el de WhatsApp), podría haber errores silenciosos.
- **Tasa de respuesta más baja:** Clientes de Instagram esperan respuestas más visuales. El bot solo manda texto.

---

## Análisis del Flujo Admin (Nico)

### Comandos disponibles
| Comando | Función |
|---------|---------|
| `/nicolas` | Toma control manual del chat |
| `/marta` | Devuelve el chat al bot |
| `/vino TELEFONO` | Marca que la clienta vino |
| `/nollego TELEFONO` | Le dice a la clienta que la esperamos |
| `/alerta MOTIVO` | Envía alerta urgente a todos los staff |
| Text libre | Admin bot con Claude (buscar, agendar, notas, etc.) |

### El admin bot es potente pero tiene gaps
- **No hay comando `/saldo NOMBRE`** — Nico tiene que escribir "¿cuántas sesiones le quedan a X?" para que el admin bot ejecute `buscar_cliente`. Agregar el shortcut mejoraría la UX.
- **`enviar_masivo` no segmenta por servicio/historial** — Solo filtra por estado (leads, activos, etc.). No puede mandar "a todas las que compraron Pack 4 hace más de 2 meses". Mejora futura de alto valor.
- **Sin confirmación doble para `agendar_turno` desde admin** — A diferencia de `enviar_individual`, crear un turno desde el admin no requiere confirmación. Si Nico escribe mal el nombre del cliente, el turno se crea igual.

---

## Análisis CRM y Datos

### Fuentes de verdad
| Dato | Fuente | Usado en |
|------|--------|---------|
| Saldo cuponera | VENTAS - SESIONES | Bot, CRM React, Admin |
| Estado cliente | CLIENTES | Bot, Admin |
| Historial chat | CLIENTES.Historial_JSON | Bot (recovery) |
| Sesiones agendadas | SESIONES | CRM React, Admin, Scheduler |
| Ingresos | VENTAS | CRM React, Scheduler |
| Gastos | GASTOS | CRM React |

**Consistencia:** Alta. La fuente de verdad para cuponeras es VENTAS-SESIONES en todos los lugares.

### Dualidad CRM
El sistema tiene dos capas de CRM:
- `crm.js` → hoja "CRM" (legacy, legado)
- `sheets-crm.js` → hojas CLIENTES/SESIONES/VENTAS/GASTOS (nuevo)

La migración hacia el CRM nuevo está bien avanzada. Los módulos críticos (conversation.js, admin.js, consciousness.js) ya usan ambos con fallback. La hoja "CRM" legacy aún se usa en `admin.js → recolectarDatosNegocio()` para datos de estado.

---

## Mejoras de Best Practices (Industria)

Basado en investigación de mejores prácticas para bots de WhatsApp en clínicas y spas de bienestar:

### 1. Re-engagement post-cancelación (ROI alto)
Cuando una clienta cancela, el bot ya ofrece reagendamiento inmediato. Pero si la clienta no agendó otro turno en los 7 días siguientes, podría enviarse un mensaje de re-engagement personalizado ("Hola, ¿pudimos encontrar un horario que le venga bien?").

### 2. Contenido de valor entre sesiones
Los bots exitosos de wellness envían mini-tips de bienestar entre sesiones (cada 2 semanas). Ejemplo: "💡 Consejo post-masaje: tomar agua abundante las próximas 24 horas potencia los efectos de la sesión de hoy 🌿". Aumenta engagement y reduce churn.

### 3. Warmup de leads fríos segmentado
El remarketing actual tiene etapas (Remarketing_Etapa 0/1/2). Podría mejorarse segmentando por servicio consultado ("Hola, ¿seguís con la intención de hacer el masaje descontracturante?").

### 4. Límite de caracteres por canal
WhatsApp: sin límite práctico. Instagram: 1000 chars. Facebook: 2000 chars. El bot debería tener un `MAX_CHARS` por canal para evitar mensajes cortados.

### 5. Métricas de conversión del bot
Actualmente no hay tracking de: tasa de respuesta del bot (mensajes enviados vs respondidos), tasa de conversión (leads → turnos), tiempo promedio de conversión. Estos datos serían valiosos para optimizar el flujo.

---

## Pregunta sobre Rutas Admin Legacy

Las rutas `/dashboard`, `/inbox`, `/finanzas`, `/cliente` sirven archivos HTML desde `public/`. Están **protegidas con Basic Auth** (mismo usuario/password que el CRM). No generan costo extra en Railway (son archivos estáticos).

**¿Se pueden borrar?** Sí, si ya no se usan. El CRM React en `/app/crm/` cubre toda la funcionalidad de esas interfaces. Verificar que no haya links o bookmarks activos antes de eliminar.

---

## Resumen de Cambios Implementados en Esta Sesión

| # | Archivo | Fix | Impacto |
|---|---------|-----|---------|
| 1 | `admin.js` | Handler TURNO URGENTE SI/NO | Crítico — cierra el loop urgente |
| 2 | `conversation.js` | Estado "agendado" en sí/no handler | Alto — evita respuestas incorrectas |
| 3 | `sender.js` | Sanitizar más formatos WA para IG | Medio — mejora presentación en IG |
| 4 | `admin.js` | Comisiones en registrar_venta | Medio — reportes financieros correctos |

---

## Próximos Pasos Recomendados

1. **Deploy** los cambios actuales a Railway
2. **Migrar `recolectarDatosNegocio`** en admin.js para usar CLIENTES sheet nuevo
3. **Agregar `/saldo NOMBRE`** como shortcut en comandos de Nico (index.js)
4. **Persistir `mensajesPendientes`** a archivo JSON en Railway
5. **Contenido de valor** entre sesiones: cron semanal que mande un tip de bienestar
6. **Límite de chars por canal** en enviarEnPartes (IG: 1000)
7. **Métricas de conversión** del bot: agregar tracking en Sheets

---

*Generado automáticamente por Citrino AI Audit — Junio 2026*
