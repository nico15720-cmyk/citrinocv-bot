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
    if (!msg || msg.type !== "text") return;

    // Si es el dueño → modo admin
    if (OWNER_WHATSAPP && msg.from === OWNER_WHATSAPP) {
      await handleAdminMessage({
        text: msg.text.body,
        platform: "whatsapp",
      });
      return;
    }

    await handleIncomingMessage({
      userId: msg.from,
      text: msg.text.body,
      platform: "whatsapp",
      messageId: msg.id,
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

// ============================================================
// CLIENTE TIPO — análisis agregado de perfiles aprendidos
// ============================================================
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
