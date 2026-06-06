// ============================================================
// CITRINO BOT — Módulo de Media
// Descarga y procesa imágenes, documentos y audio de WhatsApp
// ============================================================

const axios = require("axios");

const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;

// Tipos MIME que Claude Vision puede procesar directamente
const MIME_IMAGEN_SOPORTADOS = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
];

// ============================================================
// DESCARGAR MEDIA DE WHATSAPP
// Usa el Media ID de la API de Meta para obtener URL y descargar
// ============================================================
async function descargarMediaWhatsApp(mediaId) {
  if (!META_ACCESS_TOKEN) throw new Error("META_ACCESS_TOKEN no configurado");

  // Paso 1: Obtener la URL real del archivo
  const metaRes = await axios.get(
    `https://graph.facebook.com/v19.0/${mediaId}`,
    {
      headers: { Authorization: `Bearer ${META_ACCESS_TOKEN}` },
      timeout: 10000,
    }
  );

  const url = metaRes.data.url;
  const mimeType = metaRes.data.mime_type || "image/jpeg";
  const fileSize = metaRes.data.file_size || 0;

  // Limitar a 5MB para no colapsar memoria
  if (fileSize > 5 * 1024 * 1024) {
    throw new Error(`Archivo muy grande (${Math.round(fileSize / 1024)}KB). Máximo 5MB.`);
  }

  // Paso 2: Descargar el binario
  const fileRes = await axios.get(url, {
    headers: { Authorization: `Bearer ${META_ACCESS_TOKEN}` },
    responseType: "arraybuffer",
    timeout: 15000,
    maxContentLength: 5 * 1024 * 1024,
  });

  const base64 = Buffer.from(fileRes.data).toString("base64");
  return { base64, mimeType, url };
}

// ============================================================
// CONSTRUIR CONTENIDO MULTIMODAL PARA CLAUDE
// Cuando hay imagen, arma el array de content blocks
// ============================================================
function construirContenidoConImagen(texto, base64, mimeType) {
  const mediaType = MIME_IMAGEN_SOPORTADOS.includes(mimeType)
    ? mimeType
    : "image/jpeg";

  const partes = [];

  partes.push({
    type: "image",
    source: {
      type: "base64",
      media_type: mediaType,
      data: base64,
    },
  });

  const textoFinal = texto && texto.trim()
    ? texto.trim()
    : "[La clienta envió una imagen sin texto adicional]";

  partes.push({ type: "text", text: textoFinal });

  return partes;
}

// ============================================================
// DETECTAR TIPO DE MEDIA EN MENSAJE DE WHATSAPP
// Devuelve "image" | "document" | "audio" | "video" | null
// ============================================================
function detectarTipoMedia(msg) {
  if (!msg) return null;
  const tipos = ["image", "document", "audio", "video", "sticker"];
  return tipos.find((t) => msg.type === t) || null;
}

// ============================================================
// TRANSCRIBIR AUDIO CON GEMINI
// Usa Google Gemini Flash (gratis y soporte de audio nativo)
// Requiere GEMINI_API_KEY en .env
// ============================================================
async function transcribirAudioConGemini(base64, mimeType) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        contents: [{
          parts: [
            {
              inline_data: {
                mime_type: mimeType || "audio/ogg",
                data: base64,
              }
            },
            {
              text: "Transcribí este audio en español rioplatense (Uruguay). Devolvé SOLO el texto transcripto, sin comentarios ni explicaciones. Si el audio no tiene palabras claras, devolvé: [audio inaudible]"
            }
          ]
        }]
      },
      { timeout: 20000 }
    );
    const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
    if (text && !text.includes("[audio inaudible]")) return text.trim();
    return null;
  } catch (err) {
    console.error("❌ Gemini transcripción:", err.response?.data?.error?.message || err.message);
    return null;
  }
}

// ============================================================
// PROCESAR MENSAJE DE MEDIA COMPLETO
// Descarga si es imagen/documento, transcribe audio con Gemini
// ============================================================
async function procesarMensajeMedia(msg) {
  const tipo = detectarTipoMedia(msg);
  if (!tipo) return null;

  if (tipo === "audio") {
    // Intentar transcribir con Gemini si hay API key
    if (process.env.GEMINI_API_KEY && msg.audio?.id) {
      try {
        const { base64, mimeType } = await descargarMediaWhatsApp(msg.audio.id);
        const transcripcion = await transcribirAudioConGemini(base64, mimeType || "audio/ogg");
        if (transcripcion) {
          console.log(`🎤 Transcripción Gemini: ${transcripcion.slice(0, 80)}`);
          return { type: "audio_transcripto", texto: transcripcion };
        }
      } catch (err) {
        console.error("❌ No se pudo transcribir el audio:", err.message);
      }
    }
    // Sin Gemini o falló la transcripción → Marta pedirá que escriban
    return { type: "audio" };
  }

  if (tipo === "image" || tipo === "document") {
    const mediaData = msg[tipo]; // msg.image o msg.document
    const mediaId = mediaData?.id;
    if (!mediaId) return null;

    try {
      const { base64, mimeType } = await descargarMediaWhatsApp(mediaId);
      const caption = mediaData.caption || "";

      return {
        type: tipo,
        base64,
        mimeType,
        caption,
        filename: mediaData.filename || null,
      };
    } catch (err) {
      console.error(`❌ Error descargando ${tipo} (${mediaId}):`, err.message);
      return { type: tipo, error: err.message };
    }
  }

  // video, sticker, etc — no procesamos
  return { type: tipo, unsupported: true };
}

module.exports = {
  descargarMediaWhatsApp,
  construirContenidoConImagen,
  detectarTipoMedia,
  procesarMensajeMedia,
};
