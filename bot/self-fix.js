// ============================================================
// CITRINO BOT — Self-fix: Nico corrige el sistema por WhatsApp
// Nico manda: "cambiá el precio del descontracturante a $1400"
// El bot actualiza la config automáticamente
// ============================================================

const Anthropic = require("@anthropic-ai/sdk");
const fs = require("fs");
const path = require("path");
const { enviarMensaje } = require("./sender");

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const OWNER = process.env.OWNER_WHATSAPP;
const CONFIG_PATH = path.join(__dirname, "../config-dynamic.json");
const CHANGELOG_PATH = path.join(__dirname, "../changelog.json");

// ============================================================
// LEER / ESCRIBIR CONFIG DINÁMICA
// ============================================================
function leerConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    }
  } catch {}
  return {};
}

function guardarConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
}

function leerChangelog() {
  try {
    if (fs.existsSync(CHANGELOG_PATH)) {
      return JSON.parse(fs.readFileSync(CHANGELOG_PATH, "utf8"));
    }
  } catch {}
  return [];
}

function agregarChangelog(entrada) {
  const log = leerChangelog();
  log.unshift({ ...entrada, fecha: new Date().toISOString() });
  // Mantener últimas 50 entradas
  fs.writeFileSync(CHANGELOG_PATH, JSON.stringify(log.slice(0, 50), null, 2), "utf8");
}

// ============================================================
// EXPORTAR CONFIG PARA QUE CONVERSATION.JS LA USE
// ============================================================
function getConfigDinamica() {
  return leerConfig();
}

// ============================================================
// DETECTAR SI UN MENSAJE DE NICO ES UNA INSTRUCCIÓN DE CAMBIO
// ============================================================
async function detectarYAplicarCambio(texto) {
  try {
    const configActual = leerConfig();

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

    const resultado = JSON.parse(response.content[0].text);

    if (!resultado.es_cambio) return null;

    // Aplicar el cambio a la config
    const configNueva = { ...configActual };
    configNueva[resultado.clave] = resultado.valor;
    configNueva._ultima_actualizacion = new Date().toISOString();
    guardarConfig(configNueva);

    // Registrar en changelog
    agregarChangelog({
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
function buildContextoDinamico() {
  const config = leerConfig();
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
