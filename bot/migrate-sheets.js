// ============================================================
// CITRINO — Migración de Google Sheets
// Agrega columnas faltantes a la pestaña CLIENTES sin tocar los datos
// Uso: node bot/migrate-sheets.js
// ============================================================

require("dotenv").config();
const { sheets: googleSheets } = require("@googleapis/sheets");
const { GoogleAuth } = require("google-auth-library");

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID;

const COLUMNAS_NUEVAS = [
  "Ultimo_Saludo",
  "Historial_JSON",
  "Remarketing_Etapa",
  "Ultimo_Remarketing",
];

async function getSheets() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return googleSheets({ version: "v4", auth });
}

function colLetter(n) {
  let s = "";
  while (n > 0) { n--; s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26); }
  return s;
}

async function migrar() {
  console.log("🔧 Iniciando migración de CLIENTES...");
  const api = await getSheets();

  // Leer fila de headers actual
  const resp = await api.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "CLIENTES!1:1",
  });

  const headersActuales = resp.data.values?.[0] || [];
  console.log(`📋 Columnas actuales (${headersActuales.length}): ${headersActuales.join(", ")}`);

  // Determinar cuáles faltan
  const faltantes = COLUMNAS_NUEVAS.filter(c => !headersActuales.includes(c));

  if (faltantes.length === 0) {
    console.log("✅ Todas las columnas ya existen. Nada que hacer.");
    return;
  }

  console.log(`➕ Columnas a agregar: ${faltantes.join(", ")}`);

  // Escribir las columnas nuevas al final de la fila de headers
  const startCol = headersActuales.length + 1; // 1-based
  const endCol   = startCol + faltantes.length - 1;
  const range    = `CLIENTES!${colLetter(startCol)}1:${colLetter(endCol)}1`;

  await api.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range,
    valueInputOption: "RAW",
    requestBody: { values: [faltantes] },
  });

  console.log(`✅ Columnas agregadas en ${range}: ${faltantes.join(", ")}`);
  console.log("🎉 Migración completada. El bot ya puede escribir los nuevos campos.");
}

migrar().catch(err => {
  console.error("❌ Error en migración:", err.message);
  process.exit(1);
});
