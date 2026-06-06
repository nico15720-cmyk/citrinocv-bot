// ============================================================
// CITRINO BOT — Self-fix: Nico corrige el sistema por WhatsApp
// Nico manda: "cambiá el precio del descontracturante a $1400"
// El bot actualiza la config automáticamente
// ============================================================

const Anthropic = require("@anthropic-ai/sdk");
const { sheets: googleSheets } = require("@googleapis/sheets");
const { GoogleAuth } = require("google-auth-library");

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID;
const SHEET_CONFIG = "Config";
const SHEET_CHANGELOG = "Changelog";

// Cache en memoria para no consultar Sheets en cada request
let configCache = null;
let changelogCache = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

function getSheets() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
  return googleSheets({ version: "v4", auth });
}

// ============================================================
// LEER / ESCRIBIR CONFIG DINÁMICA (persistida en Google Sheets)
// ============================================================
async function leerConfig() {
  if (configCache && Date.now() - cacheTime < CACHE_TTL) return configCache;
  try {
    const sheets = getSheets();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_CONFIG}!A:B`,
    });
    const rows = res.data.values || [];
    const config = {};
    for (const row of rows.slice(1)) {
      if (row[0]) config[row[0]] = row[1] || "";
    }
    configCache = config;
    cacheTime = Date.now();
    return config;
  } catch {
    return configCache || {};
  }
}

async function guardarConfig(clave, valor) {
  try {
    const sheets = getSheets();
    // Buscar si ya existe la clave
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_CONFIG}!A:A`,
    });
    const rows = res.data.values || [];
    const idx = rows.findIndex(r => r[0] === clave);

    if (idx >= 1) {
      // Actualizar fila existente
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_CONFIG}!B${idx + 1}`,
        valueInputOption: "RAW",
        resource: { values: [[valor]] },
      });
    } else {
      // Agregar nueva fila
      if (rows.length <= 1) {
        // Crear header si no existe
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `${SHEET_CONFIG}!A1:B1`,
          valueInputOption: "RAW",
          resource: { values: [["Clave", "Valor"]] },
        });
      }
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_CONFIG}!A:B`,
        valueInputOption: "RAW",
        resource: { values: [[clave, valor]] },
      });
    }
    configCache = null; // invalidar cache
  } catch (err) {
    console.error("❌ Error guardando config:", err.message);
  }
}

async function leerChangelog() {
  if (changelogCache && Date.now() - cacheTime < CACHE_TTL) return changelogCache;
  try {
    const sheets = getSheets();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_CHANGELOG}!A:E`,
    });
    const rows = (res.data.values || []).slice(1);
    changelogCache = rows.map(r => ({
      fecha: r[0] || "",
      tipo: r[1] || "",
      descripcion: r[2] || "",
      clave: r[3] || "",
      valor: r[4] || "",
    })).reverse();
    return changelogCache;
  } catch {
    return changelogCache || [];
  }
}

async function agregarChangelog(entrada) {
  try {
    const sheets = getSheets();
    const rows = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_CHANGELOG}!A1:A1`,
    });
    if (!rows.data.values?.length) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_CHANGELOG}!A1:E1`,
        valueInputOption: "RAW",
        resource: { values: [["Fecha", "Tipo", "Descripción", "Clave", "Valor"]] },
      });
    }
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_CHANGELOG}!A:E`,
      valueInputOption: "RAW",
      resource: { values: [[new Date().toISOString(), entrada.tipo || "", entrada.descripcion || "", entrada.clave || "", entrada.valor || ""]] },
    });
    changelogCache = null;
  } catch (err) {
    console.error("❌ Error en changelog:", err.message);
  }
}

// ============================================================
// EXPORTAR CONFIG PARA QUE CONVERSATION.JS LA USE
// ============================================================
async function getConfigDinamica() {
  return await leerConfig();
}

// ============================================================
// DETECTAR SI UN MENSAJE DE NICO ES UNA INSTRUCCIÓN DE CAMBIO
// ============================================================
async function detectarYAplicarCambio(texto) {
  try {
    const configActual = await leerConfig();

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      system: `Analizás mensajes del dueño de Citrino (spa de masajes en Uruguay) para detectar instrucciones de configuración del bot.

Si el mensaje contiene una instrucción de cambio, devolvé JSON con:
{
  "es_cambio": true,
  "tipo": "precio|servicio|horario|texto|otro",
  "descripcion": "descripción breve del cambio",
  "clave": "nombre_clave_para_guardar",
  "valor": "nuevo valor"
}

Si NO es una instrucción de cambio (es una pregunta normal, saludo, etc.), devolvé: {"es_cambio": false}

Ejemplos de instrucciones de cambio:
- "cambiá el precio del descontracturante a $1400" → precio_descontracturante: "1400"
- "el sábado ahora hasta las 14hs" → horario_sabado_fin: "14"
- "agregá un servicio: Masaje Prenatal $1.500" → nuevo_servicio: "Masaje Prenatal $1.500"
- "Marta se llama ahora Luna" → nombre_bot: "Luna"
- "el número de WhatsApp es 091 234 567" → whatsapp_contacto: "091 234 567"

Config actual: ${JSON.stringify(configActual)}`,
      messages: [{ role: "user", content: texto }],
    });

    const raw = response.content[0].text;
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const resultado = JSON.parse(jsonMatch[0]);

    if (!resultado.es_cambio) return null;

    // Aplicar el cambio a la config en Google Sheets
    await guardarConfig(resultado.clave, resultado.valor);

    // Registrar en changelog
    await agregarChangelog({
      tipo: resultado.tipo,
      descripcion: resultado.descripcion,
      clave: resultado.clave,
      valor: resultado.valor,
      mensaje_original: texto,
    });

    console.log(`🔧 Self-fix aplicado: ${resultado.descripcion}`);
    return resultado.descripcion;

  } catch (err) {
    console.error("❌ Error en self-fix:", err.message);
    return null;
  }
}

// ============================================================
// CONSTRUIR CONTEXTO DINÁMICO PARA EL SYSTEM PROMPT
// Se llama desde conversation.js para enriquecer el prompt
// ============================================================
// Versión sync que usa el cache (no bloquea el request)
function buildContextoDinamico() {
  const config = configCache || {};
  if (Object.keys(config).length === 0) return "";

  const partes = [];

  if (config.nombre_bot) partes.push(`El bot se llama "${config.nombre_bot}" (no Marta).`);
  if (config.whatsapp_contacto) partes.push(`Número de contacto actualizado: ${config.whatsapp_contacto}`);
  if (config.horario_sabado_fin) partes.push(`Horario sábado: hasta las ${config.horario_sabado_fin}:00 hs`);

  // Precios actualizados
  const precios = Object.entries(config).filter(([k]) => k.startsWith("precio_"));
  if (precios.length > 0) {
    partes.push("PRECIOS ACTUALIZADOS (prevalecen sobre los del prompt base):");
    precios.forEach(([k, v]) => {
      const servicio = k.replace("precio_", "").replace(/_/g, " ");
      partes.push(`- ${servicio}: $${v} UYU`);
    });
  }

  // Servicios nuevos
  const nuevos = Object.entries(config).filter(([k]) => k.startsWith("nuevo_servicio"));
  if (nuevos.length > 0) {
    partes.push("SERVICIOS AGREGADOS:");
    nuevos.forEach(([, v]) => partes.push(`- ${v}`));
  }

  // Notas extra
  if (config.notas_extra) partes.push(`NOTA IMPORTANTE: ${config.notas_extra}`);

  return partes.length > 0
    ? `\n\n=== ACTUALIZACIONES DEL SISTEMA ===\n${partes.join("\n")}`
    : "";
}

module.exports = {
  detectarYAplicarCambio,
  buildContextoDinamico,
  getConfigDinamica,
  leerChangelog,
};
