// node scripts/import-csv.js
require("dotenv").config();
const fs = require("fs");
const { sheets: googleSheets } = require("@googleapis/sheets");
const { GoogleAuth } = require("google-auth-library");

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID;
const CSV_PATH = "C:\\Users\\Lenovo\\Desktop\\citrino-agent\\clientes.csv";

function getSheets() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
  return googleSheets({ version: "v4", auth });
}

function tel(t) {
  if (!t) return "";
  const l = t.replace(/[\s\-\+\(\)]/g, "");
  if (l.startsWith("598")) return l;
  if (l.startsWith("0")) return "598" + l.slice(1);
  return "598" + l;
}

function fecha(f) {
  if (!f) return "";
  try {
    const p = f.split("/");
    if (p.length !== 3) return "";
    const y = parseInt(p[2]) < 100 ? 2000 + parseInt(p[2]) : parseInt(p[2]);
    return new Date(y, parseInt(p[1]) - 1, parseInt(p[0])).toISOString();
  } catch { return ""; }
}

async function main() {
  console.log("📂 Leyendo:", CSV_PATH);
  const lines = fs.readFileSync(CSV_PATH, "utf8").trim().split("\n");
  console.log(`📊 ${lines.length - 1} clientes`);

  const sheets = getSheets();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID, range: "CRM!A1:O1", valueInputOption: "RAW",
    resource: { values: [["ID","Nombre","Teléfono","Canal","Servicio","Estado","Cuponera","Ses. Rest.","Fecha Alta","Fecha Turno","Event ID","Notas","Último Contacto","Remarketing","Perfil"]] }
  });

  const rows = lines.slice(1).map(l => {
    const c = l.split(",");
    const t2 = tel(c[2]?.trim());
    const f2 = fecha(c[4]?.trim());
    return [t2||c[0]?.trim(), c[1]?.trim(), c[2]?.trim(), "whatsapp", "", "vino", "no", "0", f2, "", "", "", f2, "", JSON.stringify({origen:c[3]?.trim(),importado:true})];
  });

  for (let i = 0; i < rows.length; i += 100) {
    await sheets.spreadsheets.values.append({ spreadsheetId: SPREADSHEET_ID, range: "CRM!A:O", valueInputOption: "RAW", resource: { values: rows.slice(i, i+100) } });
    console.log(`  ✅ ${Math.min(i+100, rows.length)}/${rows.length}`);
    await new Promise(r => setTimeout(r, 400));
  }
  console.log(`\n🎉 ${rows.length} clientes importados`);
  console.log(`🔗 https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}`);
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
