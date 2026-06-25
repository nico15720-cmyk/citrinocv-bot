// ============================================================
// CITRINO BOT — Sender multi-canal
// Envía mensajes por WhatsApp, Facebook e Instagram
// con delay aleatorio para parecer más humano
// ============================================================

const axios = require("axios");

const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const META_PAGE_ACCESS_TOKEN = process.env.META_PAGE_ACCESS_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;

// ============================================================
// DELAY ALEATORIO — 3 a 8 segundos
// ============================================================
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay() {
  const ms = Math.floor(Math.random() * 5000) + 3000; // 3000-8000ms
  return delay(ms);
}

// ============================================================
// TYPING INDICATOR — marca como leído y simula que escribe (solo WhatsApp)
// ============================================================
async function marcarLeidoYEscribiendo(messageId) {
  if (!messageId || !WHATSAPP_PHONE_NUMBER_ID || !META_ACCESS_TOKEN) return;
  try {
    // Marcar como leído
    await axios.post(
      `https://graph.facebook.com/v19.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
      { messaging_product: "whatsapp", status: "read", message_id: messageId },
      { headers: { Authorization: `Bearer ${META_ACCESS_TOKEN}`, "Content-Type": "application/json" } }
    );
  } catch {}
}

// ============================================================
// ENVIAR MENSAJE DE TEXTO
// ============================================================
async function enviarMensaje(userId, texto, canal) {
  await randomDelay();

  try {
    switch (canal) {
      case "whatsapp":
        return await enviarWhatsApp(userId, texto);
      case "facebook":
        return await enviarFacebook(userId, texto);
      case "instagram":
        return await enviarInstagram(userId, texto);
      default:
        console.error(`Canal desconocido: ${canal}`);
    }
  } catch (err) {
    console.error(`❌ Error enviando mensaje por ${canal} a ${userId}:`, err.response?.data || err.message);
  }
}

// ============================================================
// WHATSAPP
// ============================================================
async function enviarWhatsApp(to, texto) {
  const url = `https://graph.facebook.com/v19.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

  await axios.post(
    url,
    {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: texto },
    },
    {
      headers: {
        Authorization: `Bearer ${META_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
  console.log(`📤 [WA] → ${to}: ${texto.slice(0, 50)}...`);
}

// ============================================================
// WHATSAPP — Template (para recordatorios y remarketing)
// ============================================================
async function enviarTemplateWhatsApp(to, templateName, languageCode, components = []) {
  await randomDelay();

  const url = `https://graph.facebook.com/v19.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

  await axios.post(
    url,
    {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode || "es_AR" },
        components,
      },
    },
    {
      headers: {
        Authorization: `Bearer ${META_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
  console.log(`📤 [WA Template] → ${to}: ${templateName}`);
}

// ============================================================
// FACEBOOK MESSENGER
// ============================================================
async function enviarFacebook(recipientId, texto) {
  const url = `https://graph.facebook.com/v19.0/me/messages`;

  await axios.post(
    url,
    {
      recipient: { id: recipientId },
      message: { text: texto },
    },
    {
      headers: {
        Authorization: `Bearer ${META_PAGE_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
  console.log(`📤 [FB] → ${recipientId}: ${texto.slice(0, 50)}...`);
}

// ============================================================
// INSTAGRAM — Messenger Platform for Instagram
// Endpoint: POST /me/messages con Page Access Token
// Token: INSTAGRAM_ACCESS_TOKEN (Page Token con instagram_manage_messages)
// IMPORTANTE: usar siempre /me/messages, NO el IG Business Account ID
// ============================================================

// Elimina markdown de WhatsApp (*negrita* / _itálica_) que en Instagram
// se muestran como asteriscos literales en vez de formatear el texto.
function sanitizarParaInstagram(texto) {
  return texto
    .replace(/\*([^*\n]+)\*/g, "$1")  // *texto* → texto
    .replace(/_([^_\n]+)_/g, "$1");   // _texto_ → texto
}

async function enviarInstagram(recipientId, texto) {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN || META_PAGE_ACCESS_TOKEN;
  const url = `https://graph.facebook.com/v19.0/me/messages`;

  // Eliminar markdown de WhatsApp antes de enviar a Instagram
  const textoLimpio = sanitizarParaInstagram(texto);

  console.log(`📤 [IG] Enviando a ${recipientId}, token: ${token ? token.slice(0, 15) + "..." : "NO TOKEN"}`);

  try {
    await axios.post(
      url,
      {
        recipient: { id: recipientId },
        message: { text: textoLimpio },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );
    console.log(`✅ [IG] → ${recipientId}: ${textoLimpio.slice(0, 50)}...`);
  } catch (err) {
    const errData = err.response?.data || err.message;
    console.error(`❌ [IG] Error enviando a ${recipientId}:`, JSON.stringify(errData));
    throw err;
  }
}

// ============================================================
// MARCAR COMO ESCRIBIENDO (solo WhatsApp)
// ============================================================
async function marcarEscribiendo(userId, canal) {
  if (canal !== "whatsapp") return;

  try {
    const url = `https://graph.facebook.com/v19.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
    await axios.post(
      url,
      {
        messaging_product: "whatsapp",
        status: "read",
        message_id: userId,
      },
      {
        headers: {
          Authorization: `Bearer ${META_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
  } catch {
    // No es crítico si falla
  }
}

module.exports = {
  enviarMensaje,
  enviarTemplateWhatsApp,
  marcarLeidoYEscribiendo,
  randomDelay,
};
