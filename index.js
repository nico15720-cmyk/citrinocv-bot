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

// ============================================================
// MESSAGE BATCHING — acumula mensajes durante 8 segundos
// para que Marta responda después de que la persona termina
// ============================================================
const MESSAGE_BATCH_DELAY_MS = 8000;
const messageBatch = new Map(); // userId → { messages, media, platform, messageId, timer }

function encolarMensaje(userId, texto, platform, messageId, media) {
  if (!messageBatch.has(userId)) {
    messageBatch.set(userId, { messages: [], media: null, platform, messageId });
  }
  const batch = messageBatch.get(userId);
  if (texto) batch.messages.push(texto);
  if (media)  batch.media = media; // guardamos el último media recibido
  batch.platform  = platform;
  batch.messageId = messageId || batch.messageId;

  // Resetear el timer cada vez que llega un mensaje nuevo
  if (batch.timer) clearTimeout(batch.timer);
  batch.timer = setTimeout(() => procesarBatch(userId), MESSAGE_BATCH_DELAY_MS);
}

async function procesarBatch(userId) {
  const batch = messageBatch.get(userId);
  if (!batch) return;
  messageBatch.delete(userId);

  const textoFinal = batch.messages.join("\n").trim();
  await handleIncomingMessage({
    userId,
    text: textoFinal,
    platform: batch.platform,
    messageId: batch.messageId,
    media: batch.media,
  });
}

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
      // Comando especial: /alerta — Nico activa alerta urgente sobre algo
      if (texto.toLowerCase().startsWith("/alerta ") && OWNER_WHATSAPP && msg.from === OWNER_WHATSAPP) {
        const { enviarAlertaUrgente } = require("./bot/scheduler");
        const motivo = texto.substring(8).trim();
        await enviarAlertaUrgente(`⚠️ *Alerta manual de Nico:*\n${motivo}`);
        const { enviarMensaje } = require("./bot/sender");
        await enviarMensaje(msg.from, "✅ Alerta enviada", "whatsapp");
        return;
      }
      // Comando /nollego — cliente no llegó aún
      if (texto.toLowerCase().startsWith("/nollego") && OWNER_WHATSAPP && msg.from === OWNER_WHATSAPP) {
        const nombreCliente = texto.substring(8).trim();
        const { enviarMensaje: enviar } = require("./bot/sender");
        const msgEspera = nombreCliente
          ? `¡Hola ${nombreCliente}! 🌿 Te estamos esperando, ¿estás en camino? Cualquier cosa avisanos 😊`
          : `¡Hola! 🌿 Te estamos esperando para tu turno. ¿Estás en camino? Avisanos si necesitás algo 😊`;
        await enviar(msg.from, `¿A qué número le mando el "no llegó aún"? Respondeme con el número y el mensaje o usá /nollego NOMBRE NUMERO`, "whatsapp");
        return;
      }
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
      if (msg.type === "audio") {
        // Audio del dueño — pedirle que use texto hasta tener Whisper
        const { enviarMensaje } = require("./bot/sender");
        await enviarMensaje(msg.from,
          "🎤 Recibí tu audio pero por ahora no puedo transcribirlo automáticamente.\n\nEscribime lo que necesitás registrar, por ejemplo:\n_\"Vino María, pagó $1500 con débito. No vino Juan.\"_",
          "whatsapp"
        );
        return;
      }
      if (msg.type === "image" || msg.type === "document") {
        // Imagen del dueño — procesarla con Claude Vision
        await handleAdminMessage({
          text: `[El dueño envió una imagen: ${media?.mimeType || "imagen"}. ${media?.caption || ""}]`,
          platform: "whatsapp",
          media,
        });
        return;
      }
      if (msg.type !== "text") return;
      await handleAdminMessage({
        text: texto,
        platform: "whatsapp",
      });
      return;
    }

    // Encolar — espera 8s para juntar mensajes múltiples
    encolarMensaje(msg.from, texto, "whatsapp", msg.id, media);
  }

  // Facebook Messenger
  if (body.object === "page") {
    const msg = entry.messaging?.[0];
    if (!msg?.message?.text) return;
    encolarMensaje(msg.sender.id, msg.message.text, "facebook", null, null);
  }

  // Instagram
  if (body.object === "instagram") {
    const msg = entry.messaging?.[0];
    if (!msg?.message?.text) return;
    encolarMensaje(msg.sender.id, msg.message.text, "instagram", null, null);
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

app.get("/cliente", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "cliente.html"));
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

// ── PERFIL COMPLETO DE CLIENTE ──────────────────────────────
// Agrega: CRM + turnos Google Calendar + pagos Finanzas + chats + perfil IA
app.get("/api/clientes/:userId/perfil-completo", async (req, res) => {
  try {
    const userId = req.params.userId;
    const { buscarCliente, obtenerPerfil, obtenerChats } = require("./bot/crm");
    const { getEventosAgenda } = require("./bot/calendar");
    const { leerTransacciones } = require("./bot/finanzas");

    const [clienteCRM, perfil, chats, todasTransacciones, eventos] = await Promise.all([
      buscarCliente(userId),
      obtenerPerfil(userId),
      obtenerChats(userId),
      leerTransacciones(),
      getEventosAgenda(
        new Date(Date.now() - 365 * 86400000), // último año
        new Date(Date.now() + 90 * 86400000)   // + 90 días hacia adelante
      ),
    ]);

    // Pagos de este cliente en Finanzas
    const pagos = todasTransacciones.filter(t =>
      t.clienteId && (
        t.clienteId === userId ||
        t.clienteId.replace(/\D/g, "").includes(userId.replace(/\D/g, "").slice(-8))
      )
    );

    // Turnos de este cliente en Google Calendar
    const tel = userId.replace(/\D/g, "");
    const turnos = eventos.filter(ev =>
      ev.clienteTelefono && ev.clienteTelefono.replace(/\D/g, "").includes(tel.slice(-8))
    );

    // Stats calculados
    const datos = clienteCRM?.datos || [];
    const sesionesRegistradas = pagos.filter(p => p.tipo === "ingreso" && p.categoria === "Servicio").length;
    const totalPagado = pagos.filter(p => p.tipo === "ingreso").reduce((s, p) => s + Math.abs(p.monto), 0);
    const ultimoTurno = turnos.sort((a, b) => new Date(b.inicio) - new Date(a.inicio))[0];
    const diasDesdeUltima = ultimoTurno
      ? Math.floor((Date.now() - new Date(ultimoTurno.inicio)) / 86400000)
      : null;

    res.json({
      info: {
        id: datos[0] || userId,
        nombre: datos[1] || "",
        telefono: datos[2] || userId,
        canal: datos[3] || "",
        servicio: datos[4] || "",
        estado: datos[5] || "lead",
        cuponera: datos[6] || "no",
        sesRest: parseInt(datos[7]) || 0,
        fechaAlta: datos[8] || "",
        fechaTurno: datos[9] || "",
        notas: datos[11] || "",
        ultimoContacto: datos[12] || "",
      },
      perfil,
      stats: {
        sesionesRegistradas,
        totalPagado,
        diasDesdeUltima,
        proximoTurno: turnos.find(ev => new Date(ev.inicio) > new Date()) || null,
      },
      turnos: turnos.sort((a, b) => new Date(b.inicio) - new Date(a.inicio)),
      pagos: pagos.sort((a, b) => new Date(b.fecha) - new Date(a.fecha)),
      chats: chats.slice(-50), // últimos 50 mensajes
    });
  } catch (e) {
    console.error("❌ perfil-completo:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── ALTA MANUAL DE CLIENTE + TURNO OPCIONAL ──────────────────
app.post("/api/clientes/nuevo", async (req, res) => {
  try {
    const { registrarCliente, registrarTurno } = require("./bot/crm");
    const { crearTurno, resolverSlot } = require("./bot/calendar");
    const { nombre, telefono, servicio, canal, notas, slotLabel, inicioISO, finISO } = req.body;

    if (!nombre || !telefono) return res.status(400).json({ error: "nombre y teléfono requeridos" });

    const userId = telefono.replace(/\s/g, "");
    await registrarCliente({ userId, nombre, canal: canal || "dashboard", servicio });

    let eventoId = null;
    if (slotLabel || (inicioISO && finISO)) {
      let slot;
      if (inicioISO && finISO) {
        slot = { inicioISO, finISO, label: slotLabel || inicioISO };
      } else {
        const partes = slotLabel.split(" ");
        slot = await resolverSlot(partes.slice(0, -1).join(" "), partes[partes.length - 1]);
      }
      if (slot) {
        const evento = await crearTurno({ nombre, telefono: userId, servicio: servicio || "Consulta", slot });
        await registrarTurno(userId, { fechaTurno: slot.inicioISO, eventId: evento.id, servicio });
        eventoId = evento.id;
      }
    }

    if (notas) {
      const { actualizarNotas } = require("./bot/crm");
      await actualizarNotas(userId, notas);
    }

    res.json({ ok: true, userId, eventoId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Obtener historial de chats de un cliente
app.get("/api/clientes/:userId/chats", async (req, res) => {
  try {
    const { obtenerChats } = require("./bot/crm");
    const chats = await obtenerChats(req.params.userId);
    res.json(chats);
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

// Obtener configuración de terapeutas (desde Sheets)
app.get("/api/agenda/terapeutas", async (req, res) => {
  try {
    const { leerTerapeutas } = require("./bot/terapeutas");
    const terapeutas = await leerTerapeutas();
    res.json(terapeutas.map(({ id, nombre, color, horarios }) => ({ id, nombre, color, horarios })));
  } catch (e) {
    // Fallback a config hardcoded
    const { TERAPEUTAS } = require("./bot/calendar");
    res.json(TERAPEUTAS.map(({ id, nombre, color, horarios }) => ({ id, nombre, color, horarios })));
  }
});

// CRUD de terapeutas
app.get("/api/terapeutas", async (req, res) => {
  try {
    const { leerTerapeutas } = require("./bot/terapeutas");
    res.json(await leerTerapeutas());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/terapeutas", async (req, res) => {
  try {
    const { guardarTerapeuta } = require("./bot/terapeutas");
    const id = await guardarTerapeuta(req.body);
    res.json({ ok: true, id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/terapeutas/:id", async (req, res) => {
  try {
    const { guardarTerapeuta } = require("./bot/terapeutas");
    await guardarTerapeuta({ ...req.body, id: req.params.id });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/terapeutas/:id", async (req, res) => {
  try {
    const { eliminarTerapeuta } = require("./bot/terapeutas");
    await eliminarTerapeuta(req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
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
// API FINANZAS
// ============================================================
app.get("/finanzas", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "finanzas.html"));
});

app.get("/api/finanzas/resumen", async (req, res) => {
  try {
    const { getResumenMes } = require("./bot/finanzas");
    const resumen = await getResumenMes(req.query.mes || null);
    res.json(resumen);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/finanzas/transacciones", async (req, res) => {
  try {
    const { leerTransacciones } = require("./bot/finanzas");
    let transacciones = await leerTransacciones();
    // Filtrar por mes si se pide
    if (req.query.mes) transacciones = transacciones.filter(t => t.fecha?.startsWith(req.query.mes));
    if (req.query.tipo) transacciones = transacciones.filter(t => t.tipo === req.query.tipo);
    res.json(transacciones.reverse()); // más recientes primero
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/finanzas/ingreso", async (req, res) => {
  try {
    const { registrarIngreso } = require("./bot/finanzas");
    const { clienteId, servicio, monto, descripcion, notas } = req.body;
    if (!monto) return res.status(400).json({ error: "monto requerido" });
    await registrarIngreso({ clienteId, servicio, monto: Number(monto), descripcion, notas });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/finanzas/cuponera", async (req, res) => {
  try {
    const { registrarIngresoCuponera } = require("./bot/finanzas");
    const { clienteId, sesiones, monto, descripcion } = req.body;
    await registrarIngresoCuponera({ clienteId, sesiones: Number(sesiones) || 4, monto: Number(monto), descripcion });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/finanzas/gasto", async (req, res) => {
  try {
    const { registrarGasto } = require("./bot/finanzas");
    const { categoria, descripcion, monto, notas } = req.body;
    if (!monto || !descripcion) return res.status(400).json({ error: "monto y descripción requeridos" });
    await registrarGasto({ categoria, descripcion, monto: Number(monto), notas });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Scan ticket con Claude Vision — sube imagen, devuelve monto+descripción
app.post("/api/finanzas/scan-ticket", async (req, res) => {
  try {
    const Anthropic = require("@anthropic-ai/sdk");
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const { imageBase64, mimeType } = req.body;
    if (!imageBase64) return res.status(400).json({ error: "imageBase64 requerido" });

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      messages: [{
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mimeType || "image/jpeg", data: imageBase64 }
          },
          {
            type: "text",
            text: `Analizá este ticket o comprobante de gasto. Extraé los datos principales.
Respondé SOLO con JSON válido, sin texto adicional:
{"monto": 1500, "descripcion": "descripción breve del gasto", "categoria": "Insumos|Alquiler|Servicios|Marketing|Personal|Equipamiento|Mantenimiento|Otros"}
Si no podés leer el monto, ponés 0. Si no identificás la categoría, ponés "Otros".`,
          }
        ]
      }]
    });

    const txt = response.content[0].text.trim().replace(/```json\n?|\n?```/g, "");
    const data = JSON.parse(txt);
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message, monto: 0, descripcion: "", categoria: "Otros" }); }
});

// ── STATS AVANZADOS ──────────────────────────────────────────
app.get("/api/stats/float", async (req, res) => {
  try {
    const { getFloat } = require("./bot/stats");
    res.json(await getFloat());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/stats/ranking", async (req, res) => {
  try {
    const { getRankingClientes } = require("./bot/stats");
    res.json(await getRankingClientes(parseInt(req.query.limit) || 30));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/stats/completos", async (req, res) => {
  try {
    const { getStatsCompletos } = require("./bot/stats");
    res.json(await getStatsCompletos(req.query.mes || null));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/clientes/:userId/ltv", async (req, res) => {
  try {
    const { getLTVCliente } = require("./bot/stats");
    const ltv = await getLTVCliente(req.params.userId);
    res.json({ ltv });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ============================================================
// INICIAR
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`🚀 Citrino Bot v2 corriendo en puerto ${PORT}`);

  // Inicializar CRM y Finanzas
  try {
    const { inicializarSheet } = require("./bot/crm");
    await inicializarSheet();
  } catch (err) {
    console.warn("⚠️ No se pudo inicializar el Sheet CRM:", err.message);
  }
  try {
    const { inicializarHojaFinanzas } = require("./bot/finanzas");
    await inicializarHojaFinanzas();
  } catch (err) {
    console.warn("⚠️ No se pudo inicializar la hoja Finanzas:", err.message);
  }
  try {
    const { inicializarHojaTerapeutas } = require("./bot/terapeutas");
    await inicializarHojaTerapeutas();
  } catch (err) {
    console.warn("⚠️ No se pudo inicializar la hoja Terapeutas:", err.message);
  }

  startScheduler(); // recordatorios + remarketing
});
