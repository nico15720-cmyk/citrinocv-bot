// ============================================================
// CITRINO — Plataforma de enseñanza (El Cerebro)
// Sesión de chat/voz con Claude Haiku.
// Al finalizar, guarda aprendizajes en Google Sheets (CONOCIMIENTO)
// y en CONOCIMIENTO.md como cache local para el admin bot.
// ============================================================

const Anthropic       = require("@anthropic-ai/sdk");
const fs              = require("fs");
const path            = require("path");
const { sheets: googleSheets } = require("@googleapis/sheets");
const { GoogleAuth }  = require("google-auth-library");

const anthropic       = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const CONOCIMIENTO_MD = path.join(__dirname, "../CONOCIMIENTO.md");

// Sheet del conocimiento (sheet separada, compartida con la service account)
const TEACH_SHEET_ID     = process.env.TEACH_SHEET_ID || "1gKkQAWVVrH85OXxoZLPO-86GxLj7c9GU267ZRGo4AYM";
const CONOCIMIENTO_SHEET = "CONOCIMIENTO";
const CONOCIMIENTO_COLS  = ["Fecha", "Categoria", "Contenido", "Fuente"];

// ── Estado de sesión (una a la vez, en memoria) ───────────────
let session = { active: false, messages: [], fileContext: "", startedAt: null };

// ── Google Sheets auth ────────────────────────────────────────
function getAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  return new GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
}
async function getSheetsApi() {
  return googleSheets({ version: "v4", auth: getAuth() });
}

// ── Asegurar que la hoja CONOCIMIENTO exista con header ───────
async function ensureConocimientoHeader() {
  const api = await getSheetsApi();
  try {
    const resp = await api.spreadsheets.values.get({
      spreadsheetId: TEACH_SHEET_ID,
      range: `${CONOCIMIENTO_SHEET}!A1:D1`,
    });
    if (!resp.data.values?.length) throw new Error("no header");
  } catch (e) {
    // Intentar crear la pestaña
    try {
      await api.spreadsheets.batchUpdate({
        spreadsheetId: TEACH_SHEET_ID,
        requestBody: { requests: [{ addSheet: { properties: { title: CONOCIMIENTO_SHEET } } }] },
      });
    } catch {}
    // Escribir header
    await api.spreadsheets.values.update({
      spreadsheetId: TEACH_SHEET_ID,
      range: `${CONOCIMIENTO_SHEET}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [CONOCIMIENTO_COLS] },
    });
  }
}

// ── Leer todos los registros de conocimiento ─────────────────
async function readConocimientoSheet() {
  const api = await getSheetsApi();
  const resp = await api.spreadsheets.values.get({
    spreadsheetId: TEACH_SHEET_ID,
    range: `${CONOCIMIENTO_SHEET}!A1:D`,
  });
  const rows = resp.data.values || [];
  if (rows.length < 2) return [];
  return rows.slice(1).map((row, idx) => ({
    _rowIndex: idx + 2,
    Fecha:     row[0] || "",
    Categoria: row[1] || "",
    Contenido: row[2] || "",
    Fuente:    row[3] || "",
  })).filter(r => r.Contenido); // ignorar filas vacías
}

// ── Agregar filas al sheet ────────────────────────────────────
async function appendConocimientoRows(rows) {
  await ensureConocimientoHeader();
  const api = await getSheetsApi();
  await api.spreadsheets.values.append({
    spreadsheetId:  TEACH_SHEET_ID,
    range:          `${CONOCIMIENTO_SHEET}!A1`,
    valueInputOption:  "USER_ENTERED",
    insertDataOption:  "INSERT_ROWS",
    requestBody: { values: rows.map(r => [r.Fecha, r.Categoria, r.Contenido, r.Fuente]) },
  });
}

// ── Actualizar una fila ───────────────────────────────────────
async function updateConocimientoRow(rowIndex, data) {
  const api = await getSheetsApi();
  await api.spreadsheets.values.update({
    spreadsheetId: TEACH_SHEET_ID,
    range:         `${CONOCIMIENTO_SHEET}!A${rowIndex}:D${rowIndex}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[data.Fecha || "", data.Categoria || "", data.Contenido || "", data.Fuente || ""]] },
  });
}

// ── Eliminar una fila (borra contenido) ──────────────────────
async function deleteConocimientoRow(rowIndex) {
  const api = await getSheetsApi();
  await api.spreadsheets.values.clear({
    spreadsheetId: TEACH_SHEET_ID,
    range: `${CONOCIMIENTO_SHEET}!A${rowIndex}:D${rowIndex}`,
  });
}

// ── Leer conocimiento como texto (para system prompt del admin bot)
// Sync: lee del cache .md local para no bloquear el bot
function getConocimiento() {
  try {
    if (fs.existsSync(CONOCIMIENTO_MD)) return fs.readFileSync(CONOCIMIENTO_MD, "utf8");
  } catch {}
  return "";
}

// Reconstruir cache .md a partir de Sheets (llamar al iniciar o después de editar)
async function rebuildMdCache() {
  try {
    const rows = await readConocimientoSheet();
    if (!rows.length) return;
    const grouped = {};
    for (const r of rows) {
      const cat = r.Categoria || "General";
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(r.Contenido);
    }
    let text = "# 🌿 Conocimiento de Citrino\n*Base de conocimiento acumulada por el dueño.*\n\n---\n\n";
    for (const [cat, items] of Object.entries(grouped)) {
      text += `## ${cat}\n${items.map(i => `- ${i}`).join("\n")}\n\n`;
    }
    fs.writeFileSync(CONOCIMIENTO_MD, text, "utf8");
  } catch (e) {
    console.error("❌ Error reconstruyendo cache conocimiento:", e.message);
  }
}

// ── System prompt del modo enseñanza ─────────────────────────
const TEACH_SYSTEM = `Sos el asistente de aprendizaje de Citrino (centro de estética en Uruguay). Nico, el dueño, te está enseñando cosas sobre el negocio.

Tu rol:
- Escuchás lo que dice Nico y confirmás que entendiste en UNA oración
- Hacés UNA pregunta de seguimiento si falta info concreta (no más)
- Sos conciso: máx 3 líneas por respuesta
- Usás "vos" y tono cálido pero directo

Podés aprender sobre:
• Clientas específicas (preferencias, historia, actitud)
• Reglas y excepciones del negocio
• Precios, productos, terapeutas
• Contexto empresarial y contable
• Cualquier cosa que Nico quiera que sepas`;

// ── Iniciar o continuar sesión ────────────────────────────────
function ensureSession() {
  if (!session.active) {
    session = { active: true, messages: [], fileContext: "", startedAt: new Date().toISOString() };
  }
}

// ── Chat ──────────────────────────────────────────────────────
async function chat(userMessage) {
  ensureSession();
  session.messages.push({ role: "user", content: userMessage });

  const msgsToSend = session.messages.map((m, i) => ({
    role:    m.role,
    content: (i === 0 && session.fileContext)
      ? `[Archivos subidos:]\n${session.fileContext}\n\n${m.content}`
      : m.content,
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
  const truncated = textContent.substring(0, 3000);
  session.fileContext += `\n=== ${filename} ===\n${truncated}\n`;
  return `Entendido, leí "${filename}". ¿Qué querés que aprenda de este archivo?`;
}

// ── Finalizar sesión y guardar en Sheets + .md cache ─────────
async function endSession() {
  if (!session.active || session.messages.length < 2) {
    session.active = false;
    return { ok: false, aprendizajes: [] };
  }

  // Construir transcripción
  let transcript = "TRANSCRIPCIÓN:\n\n";
  if (session.fileContext) transcript += `ARCHIVOS:\n${session.fileContext}\n\n`;
  transcript += session.messages
    .map(m => `${m.role === "user" ? "Nico" : "Bot"}: ${m.content}`)
    .join("\n\n");

  // Extraer aprendizajes como JSON estructurado
  const response = await anthropic.messages.create({
    model:      "claude-haiku-4-5-20251001",
    max_tokens: 1200,
    system: `Extraés conocimiento de negocio de una conversación de entrenamiento del bot de Citrino.
Devolvés SOLO un JSON válido: array de objetos con { "categoria": "...", "contenido": "..." }

Categorías posibles: "Clientas", "Terapeutas", "Precios y Productos", "Reglas de Negocio", "Contabilidad", "Situaciones Especiales", "Sistema"

Incluí SOLO info factual y concreta. Ignorá conversación genérica o preguntas sin respuesta.
Cada "contenido" debe ser autoexplicativo (una oración completa).
Máx 10 aprendizajes por sesión.

Ejemplo: [{"categoria":"Clientas","contenido":"Marta Rodríguez prefiere siempre la terapeuta Nadia y va los martes."}]`,
    messages: [{ role: "user", content: transcript }],
  });

  let aprendizajes = [];
  try {
    const txt = response.content[0].text.trim().replace(/```json\n?|\n?```/g, "");
    aprendizajes = JSON.parse(txt);
  } catch {
    // Si no parsea, hacer un aprendizaje genérico
    aprendizajes = [{ categoria: "General", contenido: "Clase registrada pero sin aprendizajes estructurables." }];
  }

  // Construir filas para Sheets
  const fecha = new Date().toLocaleDateString("es-UY", {
    day: "numeric", month: "long", year: "numeric", timeZone: "America/Montevideo",
  });
  const rowsToAdd = aprendizajes.map(a => ({
    Fecha:     fecha,
    Categoria: a.categoria || "General",
    Contenido: a.contenido || "",
    Fuente:    "clase",
  }));

  // Guardar en Sheets
  try {
    await appendConocimientoRows(rowsToAdd);
  } catch (e) {
    console.error("❌ Error guardando en Sheets:", e.message);
  }

  // Reconstruir cache .md
  await rebuildMdCache();

  // Reset sesión
  session = { active: false, messages: [], fileContext: "", startedAt: null };
  return { ok: true, aprendizajes: rowsToAdd };
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

module.exports = {
  chat, addFile, endSession, getSessionInfo, getConocimiento,
  readConocimientoSheet, appendConocimientoRows, updateConocimientoRow, deleteConocimientoRow, rebuildMdCache,
};
