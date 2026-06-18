// ============================================================
// CITRINO — Plataforma de enseñanza
// Sesión de voz/texto con Claude Haiku. Al final indexa
// todo en CONOCIMIENTO.md para que el admin bot lo use.
// ============================================================

const Anthropic = require("@anthropic-ai/sdk");
const fs        = require("fs");
const path      = require("path");

const anthropic       = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const CONOCIMIENTO_MD = path.join(__dirname, "../CONOCIMIENTO.md");

// ── Estado de sesión (una a la vez, en memoria) ───────────────
let session = {
  active:      false,
  messages:    [],          // { role, content }
  fileContext: "",          // texto acumulado de archivos subidos
  startedAt:   null,
};

// ── Leer base de conocimiento ─────────────────────────────────
function getConocimiento() {
  try {
    if (fs.existsSync(CONOCIMIENTO_MD)) return fs.readFileSync(CONOCIMIENTO_MD, "utf8");
  } catch {}
  return "";
}

// ── System prompt del modo enseñanza ─────────────────────────
const TEACH_SYSTEM = `Sos el asistente de aprendizaje de Citrino (centro de estética en Uruguay). Nico, el dueño, te está enseñando cosas sobre el negocio.

Tu rol:
- Escuchás lo que dice Nico y confirmás que entendiste en UNA oración
- Hacés UNA pregunta de seguimiento por turno si es necesario (no más)
- Sos conciso: máx 3 líneas por respuesta
- Usás "vos" y tono cálido pero directo
- Si Nico sube un archivo, extraés lo relevante para el negocio

Podés aprender sobre:
• Reglas de negocio y preferencias de clientas específicas
• Cómo manejar situaciones especiales o excepciones
• Precios, productos, terapeutas y horarios
• Cualquier cosa que Nico quiera que sepas

Al final de la clase organizás todo lo aprendido en puntos concretos y claros.`;

// ── Iniciar o continuar sesión ────────────────────────────────
function ensureSession() {
  if (!session.active) {
    session = {
      active:      true,
      messages:    [],
      fileContext: "",
      startedAt:   new Date().toISOString(),
    };
  }
}

// ── Chat (texto o transcripción de audio) ────────────────────
async function chat(userMessage) {
  ensureSession();

  // Añadir contexto de archivos al PRIMER mensaje
  let content = userMessage;
  if (session.fileContext && session.messages.length === 0) {
    content = `[Archivos subidos:]\n${session.fileContext}\n\n${userMessage}`;
  }

  // Guardar turno del usuario
  session.messages.push({ role: "user", content: userMessage });

  // Construir mensajes para Claude (últimos 14 para ahorrar tokens)
  const msgsToSend = session.messages.map((m, i) => ({
    role:    m.role,
    content: (i === 0 && session.fileContext) ? `[Archivos subidos:]\n${session.fileContext}\n\n${m.content}` : m.content,
  }));
  const trimmed = msgsToSend.length > 14 ? msgsToSend.slice(-14) : msgsToSend;

  const response = await anthropic.messages.create({
    model:      "claude-haiku-4-5-20251001",
    max_tokens: 250,
    system:     TEACH_SYSTEM,
    messages:   trimmed,
  });

  const reply = response.content[0].text;
  session.messages.push({ role: "assistant", content: reply });
  return reply;
}

// ── Agregar archivo al contexto ───────────────────────────────
async function addFile(filename, textContent) {
  ensureSession();
  const truncated = textContent.substring(0, 3000); // max 3000 chars por archivo
  session.fileContext += `\n=== ${filename} ===\n${truncated}\n`;
  return `Entendido, leí "${filename}". ¿Qué querés que aprenda de este archivo?`;
}

// ── Finalizar sesión y guardar conocimiento ───────────────────
async function endSession() {
  if (!session.active || session.messages.length < 2) {
    session.active = false;
    return { ok: false, aprendizajes: "La sesión no tenía contenido suficiente." };
  }

  // Construir transcripción completa
  let transcript = "TRANSCRIPCIÓN DE LA CLASE:\n\n";
  if (session.fileContext) transcript += `ARCHIVOS SUBIDOS:\n${session.fileContext}\n\n`;
  transcript += session.messages
    .map(m => `${m.role === "user" ? "Nico" : "Bot"}: ${m.content}`)
    .join("\n\n");

  // Extraer conocimiento estructurado con Claude
  const response = await anthropic.messages.create({
    model:      "claude-haiku-4-5-20251001",
    max_tokens: 900,
    system: `Sos un asistente que extrae conocimiento de negocio de conversaciones de entrenamiento.
Leés la transcripción de una sesión donde el dueño de Citrino enseñó cosas al bot.
Extraé SOLO información factual, concreta y útil (no conversación genérica).
Organizala en secciones Markdown claras. Secciones sugeridas (solo las que apliquen):
📋 Reglas del negocio, 👤 Clientas específicas, 💆 Terapeutas, 💰 Productos/Precios, ⚡ Situaciones especiales, 🔧 Mejoras al sistema.
Sé conciso. Solo incluí lo que el dueño dijo explícitamente.`,
    messages: [{ role: "user", content: transcript }],
  });

  const aprendizajes = response.content[0].text;
  const fecha = new Date().toLocaleDateString("es-UY", {
    day: "numeric", month: "long", year: "numeric", timeZone: "America/Montevideo",
  });

  // Escribir a CONOCIMIENTO.md
  const existing  = getConocimiento();
  const header    = existing || "# 🌿 Conocimiento de Citrino\n*Base de conocimiento acumulada por el dueño.*\n\n---\n";
  const newBlock  = `\n\n## 📅 Clase del ${fecha}\n\n${aprendizajes}\n\n---`;
  fs.writeFileSync(CONOCIMIENTO_MD, (existing ? existing : header) + newBlock, "utf8");

  // Reset
  session = { active: false, messages: [], fileContext: "", startedAt: null };
  return { ok: true, aprendizajes };
}

// ── Info de sesión actual ─────────────────────────────────────
function getSessionInfo() {
  return {
    active:    session.active,
    turns:     Math.floor(session.messages.length / 2),
    startedAt: session.startedAt,
    hasFiles:  session.fileContext.length > 0,
  };
}

module.exports = { chat, addFile, endSession, getSessionInfo, getConocimiento };
