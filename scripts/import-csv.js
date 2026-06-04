// ============================================================
// CITRINO — Import desde clientes.csv
// Lee el CSV de citrino-agent y lo sube al Google Sheet CRM
//
// Uso: node scripts/import-csv.js
// ============================================================

require("dotenv").config();
const fs = require("fs");
const { sheets: googleSheets } = require("@googleapis/sheets");
const { GoogleAuth } = require("google-auth-library");

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID;
const CSV_PATH = "C:\\Users\\Lenovo\\Desktop\\citrino-agent\\clientes.csv";

function getSheets() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return googleSheets({ version: "v4", auth });
}

function normalizarTel(tel) {
  if (!tel) return "";
  const l = tel.replace(/[\s\-\+\(\)]/g, "");
  if (l.startsWith("598")) return l;
  if (l.startsWith("0")) return "598" + l.slice(1);
  return "598" + l;
}

function parsearFecha(f) {
  if (!f) return "";
  try {
    const p = f.split("/");
    if (p.length !== 3) return "";
    const [d, m, y] = p;
    const year = parseInt(y) < 100 ? 2000 + parseInt(y) : parseInt(y);
    return new Date(year, parseInt(m) - 1, parseInt(d)).toISOString();
  } catch { return ""; }
}

async function main() {
  console.log("📂 Leyendo CSV:", CSV_PATH);
  const contenido = fs.readFileSync(CSV_PATH, "utf8");
  const lineas = contenido.trim().split("\n");
  const headers = lineas[0].split(",");
  console.log(`📊 ${lineas.length - 1} clientes encontrados`);

  const sheets = getSheets();

  // Asegurar headers en el CRM
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: "CRM!A1:O1",
    valueInputOption: "RAW",
    resource: {
      values: [[
        "ID","Nombre","Teléfono","Canal","Servicio","Estado",
        "Cuponera","Ses. Rest.","Fecha Alta","Fecha Turno",
        "Event ID","Notas","Último Contacto","Remarketing","Perfil"
      ]]
    }
  });

  const filas = [];
  for (let i = 1; i < lineas.length; i++) {
    const cols = lineas[i].split(",");
    const id  = cols[0]?.trim() || "";
    const nombre = cols[1]?.trim() || "";
    const telOrig = cols[2]?.trim() || "";
    const fuente = cols[3]?.trim() || "";
    const fecha = parsearFecha(cols[4]?.trim() || "");
    const tel = normalizarTel(telOrig);

    filas.push([
      tel || id,      // A: ID (teléfono normalizado)
      nombre,         // B: Nombre
      telOrig,        // C: Teléfono original
      "whatsapp",     // D: Canal
      "",             // E: Servicio
      "vino",         // F: Estado (ya son clientes)
      "no",           // G: Cuponera
      "0",            // H: Ses. Rest.
      fecha,          // I: Fecha Alta
      "", "", "",     // J K L
      fecha,          // M: Último Contacto
      "",             // N: Remarketing
      JSON.stringify({ origen: fuente, importado_csv: true }), // O: Perfil
    ]);
  }

  // Subir en bloques de 100
  const BLOQUE = 100;
  let n = 0;
  for (let i = 0; i < filas.length; i += BLOQUE) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: "CRM!A:O",
      valueInputOption: "RAW",
      resource: { values: filas.slice(i, i + BLOQUE) }
    });
    n += Math.min(BLOQUE, filas.length - i);
    console.log(`  ✅ ${n}/${filas.length} clientes importados`);
    await new Promise(r => setTimeout(r, 400));
  }

  console.log(`\n🎉 Listo! ${filas.length} clientes en el Sheet.`);
  console.log(`🔗 https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}`);
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
