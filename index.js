// ============================================================
// CITRINO BOT v2 — Servidor principal
// WhatsApp + Facebook + Instagram + Google Calendar + CRM
// ============================================================

require("dotenv").config();
const express = require("express");
const path = require("path");
const { handleIncomingMessage } = require("./bot/conversation");
const { handleAdminMessage } = require("./bot/admin");
const { startScheduler } = require("./bot/scheduler");

const OWNER_WHATSAPP = process.env.OWNER_WHATSAPP;
const modoAdmin = new Set(); // números que activaron /admin temporalmente
const modoMarta = new Set(); // números que activaron /marta (override admin)

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Health check para Railway
app.get("/health", (req, res) => res.status(200).send("OK"));

// ============================================================
// WEBHOOK VERIFICATION
// ============================================================
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
    console.log("✅ Webhook verificado");
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// ============================================================
// WEBHOOK PRINCIPAL — recibe mensajes
// ============================================================
app.post("/webhook", async (req, res) => {
  res.sendStatus(200); // Responder rápido a Meta

  const body = req.body;
  if (!body.object || !body.entry?.[0]) return;

  const entry = body.entry[0];

  // WhatsApp
  if (body.object === "whatsapp_business_account") {
    const msg = entry.changes?.[0]?.value?.messages?.[0];
    if (!msg) return;

    // Tipos soportados
    const tiposSoportados = ["text", "image", "document", "audio", "video", "sticker"];
    if (!tiposSoportados.includes(msg.type)) return;

    // Extraer texto (solo para mensajes de texto)
    const texto = msg.type === "text" ? msg.text.body.trim() : "";

    // Comandos de modo (solo desde texto)
    if (msg.type === "text") {
      if (texto.toLowerCase() === "/admin") {
        modoAdmin.add(msg.from);
        modoMarta.delete(msg.from);
        const { enviarMensaje } = require("./bot/sender");
        await enviarMensaje(msg.from, "🔑 Modo admin activado.", "whatsapp");
        return;
      }
      if (texto.toLowerCase() === "/marta") {
        modoMarta.add(msg.from);
        modoAdmin.delete(msg.from);
        const { enviarMensaje } = require("./bot/sender");
        await enviarMensaje(msg.from, "🌿 Modo Marta activado — respondiendo como clienta.", "whatsapp");
        return;
      }
    }

    // Procesar media si la hay (imagen, documento, audio)
    let media = null;
    if (msg.type !== "text") {
      try {
        const { procesarMensajeMedia } = require("./bot/media");
        media = await procesarMensajeMedia(msg);
        console.log(`📎 [WA] Media recibido: tipo=${media?.type}, mimeType=${media?.mimeType || "-"}`);
      } catch (err) {
        console.error("❌ Error procesando media:", err.message);
      }
    }

    // Si es el dueño O está en modo admin → modo admin (salvo que activó /marta)
    const esAdmin = !modoMarta.has(msg.from) &&
      ((OWNER_WHATSAPP && msg.from === OWNER_WHATSAPP) || modoAdmin.has(msg.from));
    if (esAdmin) {
      // Admin solo procesa texto por ahora
      if (msg.type !== "text") return;
      await handleAdminMessage({
        text: texto,
        platform: "whatsapp",
      });
      return;
    }

    await handleIncomingMessage({
      userId: msg.from,
      text: texto,
      platform: "whatsapp",
      messageId: msg.id,
      media,
    });
  }

  // Facebook Messenger
  if (body.object === "page") {
    const msg = entry.messaging?.[0];
    if (!msg?.message?.text) return;
    await handleIncomingMessage({
      userId: msg.sender.id,
      text: msg.message.text,
      platform: "facebook",
    });
  }

  // Instagram
  if (body.object === "instagram") {
    const msg = entry.messaging?.[0];
    if (!msg?.message?.text) return;
    await handleIncomingMessage({
      userId: msg.sender.id,
      text: msg.message.text,
      platform: "instagram",
    });
  }
});

// ============================================================
// ESTADO GLOBAL DEL BOT
// ============================================================
let botActivo = true;
let botModo = "auto"; // "auto" | "pausa" | "off"

// Exportar para que conversation.js pueda consultarlo
global.getBotActivo = () => botActivo;
global.getBotModo = () => botModo;

// ============================================================
// API DE CONTROL — Centro de control
// ============================================================

// Estado actual del bot
app.get("/api/control/estado", (req, res) => {
  res.json({ activo: botActivo, modo: botModo });
});

// Cambiar modo del bot
app.post("/api/control/modo", (req, res) => {
  const { modo } = req.body;
  if (!["auto", "pausa", "off"].includes(modo)) {
    return res.status(400).json({ error: "Modo inválido. Usar: auto, pausa, off" });
  }
  botModo = modo;
  botActivo = modo === "auto";
  console.log(`🎛️ Bot modo cambiado a: ${modo}`);
  res.json({ ok: true, modo, activo: botActivo });
});

// Actualizar score manual de un cliente
app.post("/api/clientes/:userId/score", async (req, res) => {
  try {
    const { actualizarNotas } = require("./bot/crm");
    const { score } = req.body; // 1-5
    await actualizarNotas(req.params.userId, `Score manual: ${score}/5`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Enviar mensaje desde el panel
app.post("/api/clientes/:userId/whatsapp", async (req, res) => {
  try {
    const { enviarMensaje } = require("./bot/sender");
    await enviarMensaje(req.params.userId, req.body.texto, "whatsapp");
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Envío masivo a un segmento
app.post("/api/campana", async (req, res) => {
  try {
    const { leerTodosLosClientes } = require("./bot/crm");
    const { enviarMensaje } = require("./bot/sender");
    const { segmento, texto } = req.body;
    const clientes = await leerTodosLosClientes();

    const filtrados = clientes.filter(c => {
      if (segmento === "leads") return c.Estado === "lead";
      if (segmento === "vip") return c.Score >= 4;
      if (segmento === "cuponera") return c.Cuponera === "si";
      if (segmento === "inactivos") {
        const dias = c.UltimoContacto
          ? Math.floor((Date.now() - new Date(c.UltimoContacto)) / 86400000)
          : 999;
        return dias > 30;
      }
      return true;
    });

    // Enviar con delay para no saturar
    let enviados = 0;
    for (const c of filtrados) {
      if (!c.ID) continue;
      await enviarMensaje(c.ID, texto, c.Canal || "whatsapp").catch(() => {});
      enviados++;
      await new Promise(r => setTimeout(r, 1500));
    }
    res.json({ ok: true, enviados });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// DASHBOARD — métricas y templates
// ============================================================
app.get("/api/templates", (req, res) => {
  const { getTemplatesMeta } = require("./bot/scheduler");
  res.json(getTemplatesMeta());
});

app.get("/api/stats", async (req, res) => {
  try {
    const { getStats } = require("./bot/crm");
    const stats = await getStats();
    res.json(stats);
  } catch (e) {
    res.json({ error: e.message });
  }
});

app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});

// ============================================================
// ADMIN API — gestión de clientes sin tocar el Sheet
// ============================================================
app.get("/api/clientes", async (req, res) => {
  try {
    const { leerTodosLosClientes } = require("./bot/crm");
    const clientes = await leerTodosLosClientes();
    res.json(clientes);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Marcar que un cliente vino
app.post("/api/clientes/:userId/asistencia", async (req, res) => {
  try {
    const { registrarAsistencia } = require("./bot/crm");
    const vino = req.body.vino !== false; // true por defecto
    await registrarAsistencia(req.params.userId, vino);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Registrar cuponera
app.post("/api/clientes/:userId/cuponera", async (req, res) => {
  try {
    const { registrarCuponera } = require("./bot/crm");
    const sesiones = parseInt(req.body.sesiones) || 5;
    await registrarCuponera(req.params.userId, sesiones);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Agregar nota a un cliente
app.post("/api/clientes/:userId/nota", async (req, res) => {
  try {
    const { actualizarNotas } = require("./bot/crm");
    await actualizarNotas(req.params.userId, req.body.nota);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Enviar mensaje manual desde el admin
app.post("/api/clientes/:userId/mensaje", async (req, res) => {
  try {
    const { enviarMensaje } = require("./bot/sender");
    const { buscarCliente } = require("./bot/crm");
    const cliente = await buscarCliente(req.params.userId);
    const canal = cliente?.datos?.[3] || "whatsapp";
    await enviarMensaje(req.params.userId, req.body.texto, canal);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/agenda", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "agenda.html"));
});

// ============================================================
// API DE AGENDA — para el dashboard de calendario
// ============================================================

// Obtener eventos del Google Calendar con info del CRM cruzada
app.get("/api/agenda/eventos", async (req, res) => {
  try {
    const { getEventosAgenda } = require("./bot/calendar");
    const { leerTodosLosClientes } = require("./bot/crm");

    const desde = req.query.desde ? new Date(req.query.desde) : new Date();
    const hasta = req.query.hasta
      ? new Date(req.query.hasta)
      : new Date(Date.now() + 21 * 86400000); // 3 semanas

    const [eventos, clientes] = await Promise.all([
      getEventosAgenda(desde, hasta),
      leerTodosLosClientes(),
    ]);

    // Cruzar eventos con datos del CRM por número de teléfono
    const eventosConCRM = eventos.map((ev) => {
      const tel = ev.clienteTelefono?.replace(/\D/g, ""); // solo números
      const clienteCRM = tel
        ? clientes.find((c) => {
            const cTel = (c.ID || c.Teléfono || "").replace(/\D/g, "");
            return cTel && cTel.includes(tel.slice(-9)); // últimos 9 dígitos
          })
        : null;

      return {
        ...ev,
        crm: clienteCRM
          ? {
              nombre: clienteCRM.Nombre,
              estado: clienteCRM.Estado,
              canal: clienteCRM.Canal,
              cuponera: clienteCRM.Cuponera,
              sesRest: clienteCRM["Ses.Rest."],
              notas: clienteCRM.Notas,
              fechaAlta: clienteCRM.FechaAlta,
            }
          : null,
      };
    });

    res.json(eventosConCRM);
  } catch (e) {
    console.error("❌ /api/agenda/eventos:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Obtener configuración de terapeutas y sus horarios
app.get("/api/agenda/terapeutas", (req, res) => {
  const { TERAPEUTAS } = require("./bot/calendar");
  // No enviar el calendarId completo al frontend
  const safe = TERAPEUTAS.map(({ id, nombre, color, colorBadge, horarios }) => ({
    id,
    nombre,
    color,
    colorBadge,
    horarios,
  }));
  res.json(safe);
});

// Obtener slots disponibles (para mostrar en la agenda)
app.get("/api/agenda/disponibilidad", async (req, res) => {
  try {
    const { getDisponibilidad } = require("./bot/calendar");
    const slots = await getDisponibilidad();
    res.json(slots);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Crear turno desde el dashboard de agenda
app.post("/api/agenda/turno", async (req, res) => {
  try {
    const { crearTurno, resolverSlot, getDisponibilidad } = require("./bot/calendar");
    const { registrarTurno, registrarCliente } = require("./bot/crm");
    const { nombre, telefono, servicio, slotLabel, inicioISO, finISO } = req.body;

    if (!nombre || !servicio) {
      return res.status(400).json({ error: "nombre y servicio son requeridos" });
    }

    let slot;
    if (inicioISO && finISO) {
      // Slot manual con ISO directo
      slot = {
        inicioISO,
        finISO,
        label: slotLabel || inicioISO,
        horaInicio: inicioISO.slice(11, 16),
        horaFin: finISO.slice(11, 16),
      };
    } else if (slotLabel) {
      const partes = slotLabel.split(" ");
      const dia = partes.slice(0, -1).join(" ");
      const hora = partes[partes.length - 1];
      slot = await resolverSlot(dia, hora);
    }

    if (!slot) return res.status(400).json({ error: "Slot no encontrado o inválido" });

    const userId = telefono || `manual_${Date.now()}`;
    const evento = await crearTurno({ nombre, telefono: userId, servicio, slot });

    // Registrar en CRM
    await registrarCliente({ userId, nombre, servicio, canal: "dashboard" });
    await registrarTurno(userId, { fechaTurno: slot.inicioISO, eventId: evento.id, servicio });

    res.json({ ok: true, eventoId: evento.id, link: evento.htmlLink });
  } catch (e) {
    console.error("❌ /api/agenda/turno POST:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Cancelar turno desde el dashboard
app.delete("/api/agenda/turno/:eventId", async (req, res) => {
  try {
    const { cancelarTurno } = require("./bot/calendar");
    await cancelarTurno(req.params.eventId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// CLIENTE TIPO — análisis agregado de perfiles aprendidos
// ============================================================
// Changelog de cambios aplicados por WhatsApp
app.get("/api/changelog", async (req, res) => {
  try {
    const { leerChangelog } = require("./bot/self-fix");
    const log = await leerChangelog();
    res.json(log);
  } catch (e) {
    res.json([]);
  }
});

app.get("/api/cliente-tipo", async (req, res) => {
  try {
    const Anthropic = require("@anthropic-ai/sdk");
    const { obtenerTodosLosPerfiles } = require("./bot/crm");
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const perfiles = await obtenerTodosLosPerfiles();
    if (perfiles.length === 0) {
      return res.json({ mensaje: "Todavía no hay suficientes perfiles para analizar.", perfiles: [] });
    }

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 800,
      system: `Sos una analista de marketing para Citrino, un spa de masajes en Montevideo, Uruguay.
Analizá los perfiles de clientes y generá un resumen útil y accionable para el negocio.`,
      messages: [{
        role: "user",
        content: `Acá están los perfiles de ${perfiles.length} clientes:\n\n${JSON.stringify(perfiles, null, 2)}\n\nGenerá:
1. Perfil del "cliente tipo" de Citrino (quién es, qué busca, cuándo viene)
2. Horarios más demandados
3. Servicios más populares
4. Cómo comunicarse mejor con estos clientes
5. Oportunidades de venta (qué más podrían querer)

Usá un tono práctico y directo, como si le hablaras al dueño del negocio.`,
      }],
    });

    res.json({
      perfiles_analizados: perfiles.length,
      analisis: response.content[0].text,
      perfiles_raw: perfiles,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// INICIAR
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`🚀 Citrino Bot v2 corriendo en puerto ${PORT}`);

  // Inicializar CRM (crea headers si el sheet está vacío)
  try {
    const { inicializarSheet } = require("./bot/crm");
    await inicializarSheet();
  } catch (err) {
    console.warn("⚠️ No se pudo inicializar el Sheet (¿está configurado Google Sheets?):", err.message);
  }

  startScheduler(); // recordatorios + remarketing
});
