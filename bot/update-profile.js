// ============================================================
// CITRINO — Actualizar perfil de WhatsApp Business
// Uso: node bot/update-profile.js
//
// Variables necesarias en .env (o Railway):
//   WHATSAPP_PHONE_NUMBER_ID
//   META_ACCESS_TOKEN
// ============================================================

require("dotenv").config();
const https = require("https");

const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const ACCESS_TOKEN    = process.env.META_ACCESS_TOKEN;

if (!PHONE_NUMBER_ID || !ACCESS_TOKEN) {
  console.error("❌ Faltan WHATSAPP_PHONE_NUMBER_ID o META_ACCESS_TOKEN en .env");
  process.exit(1);
}

// ─── Configuración del perfil ─────────────────────────────────
// Editá estos valores antes de correr el script
const PERFIL = {
  messaging_product: "whatsapp",
  about:       "Citrino 🌿 Centro de bienestar — Ciudad Vieja, Montevideo",
  description: "Masajes terapéuticos y relajantes en el corazón de la Ciudad Vieja. " +
               "Escribinos para consultar horarios y agendar tu sesión 💛",
  address:     "Sarandí 554 apto. 1, Ciudad Vieja, Montevideo",
  vertical:    "BEAUTY_SPA_SALON",
  websites:    [], // Ej: ["https://citrino.com.uy"]
};

// ─── Actualizar perfil de negocio ────────────────────────────
async function actualizarPerfil() {
  const body = JSON.stringify(PERFIL);
  const url  = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/whatsapp_business_profile`;

  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${ACCESS_TOKEN}`,
        "Content-Type":  "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    }, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        const parsed = JSON.parse(data);
        if (res.statusCode === 200 && parsed.success) {
          console.log("✅ Perfil actualizado correctamente");
          console.log("   About:", PERFIL.about);
          console.log("   Descripción:", PERFIL.description);
        } else {
          console.error("❌ Error:", JSON.stringify(parsed, null, 2));
        }
        resolve(parsed);
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ─── Leer perfil actual ──────────────────────────────────────
async function leerPerfil() {
  const fields = "about,address,description,email,profile_picture_url,websites,vertical";
  const url = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/whatsapp_business_profile?fields=${fields}`;

  return new Promise((resolve, reject) => {
    https.get(url, { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } }, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        const parsed = JSON.parse(data);
        console.log("📋 Perfil actual:\n", JSON.stringify(parsed.data?.[0] || parsed, null, 2));
        resolve(parsed);
      });
    }).on("error", reject);
  });
}

(async () => {
  console.log("── Perfil actual ──");
  await leerPerfil();
  console.log("\n── Actualizando perfil ──");
  await actualizarPerfil();
  console.log("\n── Perfil después del update ──");
  await leerPerfil();
})();
