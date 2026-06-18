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

// ── Hoja FLUJOS ───────────────────────────────────────────────
const FLUJOS_SHEET = "FLUJOS";
const FLUJOS_COLS  = ["ID", "Nombre", "Categoria", "Descripcion", "Pasos", "Ultima_Actualizacion"];

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

// ── Cache en memoria de filas del conocimiento (para retrieval rápido) ──
let _conocimientoRows = []; // array de { Categoria, Contenido }
let _conocimientoTs = 0;   // timestamp de la última carga

// Leer conocimiento COMPLETO como texto (para system prompt del admin bot)
// Sync: lee del cache .md local para no bloquear el bot
function getConocimiento() {
  try {
    if (fs.existsSync(CONOCIMIENTO_MD)) return fs.readFileSync(CONOCIMIENTO_MD, "utf8");
  } catch {}
  return "";
}

// ── Smart retrieval: devuelve solo los fragmentos MÁS RELEVANTES al contexto ──
// Evita inyectar TODA la base de conocimiento en cada prompt (que crece con el tiempo).
// Usa scoring de palabras clave: busca términos del contexto en cada entrada.
// Siempre incluye las categorías de alto impacto (Reglas, Flujos).
function getKnowledgeRelevantTo(contexto = "", maxEntradas = 20) {
  try {
    if (!fs.existsSync(CONOCIMIENTO_MD)) return "";

    // Parsear el .md en líneas de items
    const raw = fs.readFileSync(CONOCIMIENTO_MD, "utf8");
    const lineas = raw.split("\n").filter(l => l.startsWith("- "));
    const items = lineas.map(l => l.slice(2).trim()).filter(Boolean);

    if (!items.length) return "";

    // Si hay pocas entradas, devolver todo
    if (items.length <= maxEntradas) return raw;

    // Palabras clave del contexto (normalizado)
    const palabras = contexto.toLowerCase()
      .replace(/[^a-záéíóúüñ\s]/gi, " ")
      .split(/\s+/)
      .filter(w => w.length > 3);

    // Categorías siempre incluidas (alto impacto para el bot)
    const CATS_PRIORITARIAS = ["reglas de negocio", "flujos del negocio", "precios", "horarios", "identidad"];

    // Score cada item
    const scored = items.map(item => {
      const itemLow = item.toLowerCase();
      let score = 0;
      // Palabras del contexto que aparecen en el item
      for (const p of palabras) { if (itemLow.includes(p)) score += 2; }
      // Boost para categorías prioritarias
      for (const cat of CATS_PRIORITARIAS) { if (itemLow.includes(cat)) score += 1; }
      // Items muy cortos son menos valiosos
      if (item.length < 40) score -= 1;
      return { item, score };
    });

    // Ordenar por score, tomar los top N
    const seleccionados = scored
      .sort((a, b) => b.score - a.score)
      .slice(0, maxEntradas)
      .map(s => s.item);

    return "## Conocimiento relevante de Citrino\n" + seleccionados.map(i => `- ${i}`).join("\n");
  } catch {
    return getConocimiento(); // fallback al texto completo
  }
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
const TEACH_SYSTEM = `Sos La Conciencia de Citrino — el cerebro que aprende y recuerda todo sobre este negocio de estética y bienestar en Uruguay. Nico (el dueño) te está enseñando.

TU MISIÓN: construir un conocimiento RICO y COMPLETO, no solo registrar lo que te dicen. Sos un colaborador activo que ayuda a Nico a articular y formalizar el saber del negocio.

CÓMO RESPONDÉS (en orden):
1. Confirmás en 1 oración lo que entendiste — sin repetir textualmente lo que dijo Nico
2. Hacés 1-2 preguntas de PROFUNDIZACIÓN para enriquecer ese conocimiento. Preguntás por:
   - Excepciones o casos edge ("¿y si la clienta tiene pack vigente?")
   - El "por qué" detrás de la regla ("¿qué pasa si no se hace así?")
   - Quién tiene autoridad para decidir en ese tema
   - Si hay casos especiales con alguna clienta o terapeuta específica
   - Cómo impacta en el flujo de trabajo o en la contabilidad
3. Si Nico da info incompleta, lo guiás a completarla

CUANDO NICO DESCRIBE UN FLUJO O PROCESO:
- Lo escuchás completo primero
- Después lo resumís paso a paso y preguntás si está correcto
- Preguntás por el paso que falta o la excepción más común
- Sugerís si hay algo que podría mejorarse ("¿qué pasa si X? ¿tienen definido eso?")

TONO: cálido, directo, con "vos". Máx 4 líneas por respuesta. No seas repetitivo.

ÁREAS DE CONOCIMIENTO:
• Clientas (preferencias, historial, actitud, quién es VIP, quién da problemas)
• Terapeutas (fortalezas, horarios, comisiones, situaciones especiales)
• Precios, productos, packs, excepciones de precios
• Flujos del negocio (proceso de venta, agendamiento, cobro, seguimiento)
• Reglas y excepciones (cuándo se hace una excepción y quién la autoriza)
• Contabilidad (qué se registra, qué no, cómo se manejan los ingresos)
• Situaciones especiales (conflictos, problemas frecuentes, cómo se resuelven)`;

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
  // Usa claude-sonnet para mayor calidad en la extracción de conocimiento
  const response = await anthropic.messages.create({
    model:      "claude-haiku-4-5-20251001",
    max_tokens: 2000,
    system: `Sos un extractor experto de conocimiento de negocio. Analizás una conversación entre Nico (dueño de Citrino, centro de estética en Uruguay) y su asistente de aprendizaje.

Tu trabajo: extraer TODO el conocimiento factual y concreto que emergió en la conversación — incluyendo las respuestas a las preguntas de seguimiento, que suelen contener la info más valiosa.

DEVOLVÉS SOLO JSON válido: array de objetos con exactamente estas propiedades:
{ "categoria": "...", "contenido": "...", "confianza": "alta|media", "tipo": "hecho|regla|flujo|excepcion|persona" }

CATEGORÍAS: "Clientas" | "Terapeutas" | "Precios y Productos" | "Reglas de Negocio" | "Flujos del Negocio" | "Contabilidad" | "Situaciones Especiales" | "Sistema" | "Identidad del Negocio"

TIPOS:
- "hecho": dato fijo (precio, horario, nombre)
- "regla": cómo funciona algo normalmente
- "excepcion": cuándo NO aplica la regla general
- "flujo": proceso paso a paso
- "persona": info sobre clienta o terapeuta específica

REGLAS:
- Solo info que fue CONFIRMADA por Nico (no suposiciones del bot)
- Cada contenido es autoexplicativo — incluye suficiente contexto
- Si Nico describió un flujo, resúmilo como pasos concretos en UN solo entrada
- Ignorá conversación genérica, saludos, y preguntas sin respuesta
- Máx 15 aprendizajes por sesión, priorizá los de mayor valor informativo

EJEMPLO:
[
  {"categoria":"Reglas de Negocio","contenido":"Las cuponeras tienen vigencia de 90 días desde la compra. Nico puede extenderlas a 120 días si la clienta tuvo un problema de salud. Las extensiones se registran en las notas del cliente.","confianza":"alta","tipo":"regla"},
  {"categoria":"Flujos del Negocio","contenido":"Flujo de cobro: 1) Clienta elige pack, 2) Marta cotiza por WhatsApp, 3) Clienta transfiere o paga en efectivo, 4) Nico confirma pago y activa la cuponera en el sistema.","confianza":"alta","tipo":"flujo"},
  {"categoria":"Clientas","contenido":"Laura Méndez (tel 091234567) prefiere siempre a Nadia como terapeuta y no acepta que la atienda Milena.","confianza":"alta","tipo":"persona"}
]`,
    messages: [{ role: "user", content: transcript }],
  });

  let aprendizajes = [];
  try {
    const txt = response.content[0].text.trim().replace(/```json\n?|\n?```/g, "");
    aprendizajes = JSON.parse(txt);
    // Filtrar solo los de confianza alta o media
    aprendizajes = aprendizajes.filter(a => a.contenido && a.contenido.length > 15);
  } catch {
    aprendizajes = [{ categoria: "General", contenido: "Clase registrada pero sin aprendizajes estructurables.", confianza: "baja", tipo: "hecho" }];
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

// ============================================================
// FLUJOS DEL NEGOCIO — procesos paso a paso
// ============================================================
async function ensureFlujoHeader() {
  const api = await getSheetsApi();
  try {
    const r = await api.spreadsheets.values.get({ spreadsheetId: TEACH_SHEET_ID, range: `${FLUJOS_SHEET}!A1:F1` });
    if (!r.data.values?.length) throw new Error("no header");
  } catch {
    try {
      await api.spreadsheets.batchUpdate({
        spreadsheetId: TEACH_SHEET_ID,
        requestBody: { requests: [{ addSheet: { properties: { title: FLUJOS_SHEET } } }] },
      });
    } catch {}
    await api.spreadsheets.values.update({
      spreadsheetId: TEACH_SHEET_ID, range: `${FLUJOS_SHEET}!A1`,
      valueInputOption: "RAW", requestBody: { values: [FLUJOS_COLS] },
    });
  }
}

async function readFlujos() {
  await ensureFlujoHeader();
  const api = await getSheetsApi();
  const r = await api.spreadsheets.values.get({ spreadsheetId: TEACH_SHEET_ID, range: `${FLUJOS_SHEET}!A1:F` });
  const rows = r.data.values || [];
  if (rows.length < 2) return [];
  return rows.slice(1).map((row, idx) => ({
    _rowIndex: idx + 2,
    ID:          row[0] || "",
    Nombre:      row[1] || "",
    Categoria:   row[2] || "",
    Descripcion: row[3] || "",
    Pasos:       row[4] || "",
    Ultima_Actualizacion: row[5] || "",
  })).filter(r => r.Nombre);
}

async function appendFlujo(data) {
  await ensureFlujoHeader();
  const api = await getSheetsApi();
  const id = "F" + Date.now();
  const fecha = new Date().toLocaleDateString("es-UY", { day:"numeric",month:"long",year:"numeric",timeZone:"America/Montevideo" });
  await api.spreadsheets.values.append({
    spreadsheetId: TEACH_SHEET_ID, range: `${FLUJOS_SHEET}!A1`,
    valueInputOption: "USER_ENTERED", insertDataOption: "INSERT_ROWS",
    requestBody: { values: [[id, data.nombre||"", data.categoria||"General", data.descripcion||"", data.pasos||"", fecha]] },
  });
  return id;
}

async function updateFlujo(rowIndex, data) {
  const api = await getSheetsApi();
  const fecha = new Date().toLocaleDateString("es-UY", { day:"numeric",month:"long",year:"numeric",timeZone:"America/Montevideo" });
  await api.spreadsheets.values.update({
    spreadsheetId: TEACH_SHEET_ID, range: `${FLUJOS_SHEET}!A${rowIndex}:F${rowIndex}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[data.ID||"", data.nombre||"", data.categoria||"General", data.descripcion||"", data.pasos||"", fecha]] },
  });
}

async function deleteFlujo(rowIndex) {
  const api = await getSheetsApi();
  await api.spreadsheets.values.clear({ spreadsheetId: TEACH_SHEET_ID, range: `${FLUJOS_SHEET}!A${rowIndex}:F${rowIndex}` });
}

// Obtener flujos como texto para inyectar en el system prompt
function getFlujos() {
  try {
    const p = path.join(__dirname, "../FLUJOS.md");
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
  } catch {}
  return "";
}

async function rebuildFlujosMdCache() {
  try {
    const flujos = await readFlujos();
    if (!flujos.length) return;
    let text = "# 🔄 Flujos del Negocio Citrino\n\n";
    for (const f of flujos) {
      text += `## ${f.Nombre} (${f.Categoria})\n`;
      if (f.Descripcion) text += `**Descripción:** ${f.Descripcion}\n`;
      if (f.Pasos) text += `**Pasos:**\n${f.Pasos}\n`;
      text += "\n";
    }
    fs.writeFileSync(path.join(__dirname, "../FLUJOS.md"), text, "utf8");
  } catch (e) { console.error("❌ Error rebuilding FLUJOS cache:", e.message); }
}

module.exports = {
  chat, addFile, endSession, getSessionInfo, getConocimiento, getKnowledgeRelevantTo,
  readConocimientoSheet, appendConocimientoRows, updateConocimientoRow, deleteConocimientoRow, rebuildMdCache,
  readFlujos, appendFlujo, updateFlujo, deleteFlujo, getFlujos, rebuildFlujosMdCache,
};
