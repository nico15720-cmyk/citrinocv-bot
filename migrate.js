// ============================================================
// CITRINO — Script de migración de datos
// Ejecutar UNA VEZ: node migrate.js
// ============================================================

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { sheets: googleSheets } = require("@googleapis/sheets");
const { GoogleAuth } = require("google-auth-library");

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID;
// Buscar el archivo en varias ubicaciones posibles
const posibles = [
  path.join(__dirname, "backup.json"),
  path.join(process.env.APPDATA || "", "Claude", "local-agent-mode-sessions", "722ef7b4-e19d-4bdd-9244-61ae03e6d01e", "dd934e73-ed76-4546-96a2-1b7cac18864e", "local_57ca1eb4-07fa-4644-8078-cb82410e3620", "uploads", "citrino-backup-2026-06-06 (1).json"),
  path.join(require("os").homedir(), "Downloads", "citrino-backup-2026-06-06 (1).json"),
  path.join(require("os").homedir(), "Downloads", "backup.json"),
];
const BACKUP_FILE = posibles.find(p => fs.existsSync(p)) || posibles[0];

// ── AUTH ──
function getSheets() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
  return googleSheets({ version: "v4", auth });
}

// ── NORMALIZAR TELÉFONO ──
function normalizarTel(tel) {
  if (!tel) return "";
  // Quitar todo excepto dígitos y +
  let t = String(tel).replace(/[\s\-()]/g, "");
  if (t.startsWith("+598")) return t.replace("+", "");
  if (t.startsWith("598")) return t;
  if (t.startsWith("09") || t.startsWith("0")) return "598" + t.replace(/^0/, "");
  if (t.length === 8) return "598" + t;
  return t.replace(/[^0-9]/g, "");
}

// ── NORMALIZAR ORIGEN → CANAL ──
function normalizarCanal(origen) {
  if (!origen) return "whatsapp";
  const o = origen.toLowerCase();
  if (o.includes("instagram")) return "instagram";
  if (o.includes("facebook") || o.includes("fb")) return "facebook";
  if (o.includes("ads")) return "instagram";
  return "whatsapp";
}

// ── NORMALIZAR FECHA ──
function normalizarFecha(str) {
  if (!str) return "";
  // Formatos: "1/1/25", "06/06/2026", "2026-03-28T08:48", "27/12/25, 18:31"
  str = String(str).split(",")[0].trim();
  if (str.includes("T")) return new Date(str).toISOString();
  const partes = str.split("/");
  if (partes.length === 3) {
    let [d, m, y] = partes;
    if (y.length === 2) y = "20" + y;
    return new Date(`${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`).toISOString();
  }
  return str;
}

// ── ESCRIBIR EN LOTES ──
async function escribirFilas(sheets, sheetName, filas, batchSize = 100) {
  for (let i = 0; i < filas.length; i += batchSize) {
    const batch = filas.slice(i, i + batchSize);
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A:Z`,
      valueInputOption: "RAW",
      resource: { values: batch },
    });
    console.log(`  ↳ ${Math.min(i + batchSize, filas.length)}/${filas.length} filas`);
    await new Promise(r => setTimeout(r, 600)); // rate limit
  }
}

// ── CREAR HOJA SI NO EXISTE ──
async function crearHoja(sheets, nombre) {
  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: { requests: [{ addSheet: { properties: { title: nombre } } }] },
    });
    console.log(`  ✅ Hoja "${nombre}" creada`);
  } catch {
    console.log(`  ℹ️  Hoja "${nombre}" ya existe`);
  }
}

// ============================================================
// MAIN
// ============================================================
async function migrar() {
  console.log("🌿 Citrino — Migración de datos\n");

  // Leer backup
  if (!fs.existsSync(BACKUP_FILE)) {
    console.error("❌ No encontré backup.json. Ponelo en la carpeta del bot.");
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(BACKUP_FILE, "utf8"));
  const clientes = data.CLIENTES || [];
  const sesiones = data.SESIONES || [];
  const gastos = data.GASTOS || [];

  console.log(`📊 Datos encontrados:`);
  console.log(`   Clientes: ${clientes.length}`);
  console.log(`   Sesiones: ${sesiones.length}`);
  console.log(`   Gastos:   ${gastos.length}\n`);

  const sheets = getSheets();

  // ── 1. CRM ──
  console.log("1️⃣  Migrando CRM...");

  // Contar sesiones por cliente para saber estado
  const sesionesPorCliente = {};
  sesiones.forEach(s => {
    const id = s.ID_Cliente_Guardado || s.ID_Cliente_Guardado2;
    if (id) sesionesPorCliente[id] = (sesionesPorCliente[id] || 0) + 1;
  });

  // Última sesión por cliente
  const ultimaSesionPorCliente = {};
  sesiones.forEach(s => {
    const id = s.ID_Cliente_Guardado || s.ID_Cliente_Guardado2;
    if (!id) return;
    const fecha = normalizarFecha(s.Fecha_Hora);
    if (!ultimaSesionPorCliente[id] || fecha > ultimaSesionPorCliente[id].fecha) {
      ultimaSesionPorCliente[id] = { fecha, tratamiento: s.Tratamiento };
    }
  });

  // Header CRM
  const headerCRM = [
    "ID","Nombre","Teléfono","Canal","Servicio","Estado",
    "Cuponera","Ses. Rest.","Fecha Alta","Fecha Turno",
    "Event ID","Notas","Último Contacto","Remarketing","Perfil","Chats"
  ];

  // Verificar si el header ya existe
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "CRM!A1:A1",
    });
    if (res.data.values?.[0]?.[0] !== "ID") {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: "CRM!A1:P1",
        valueInputOption: "RAW",
        resource: { values: [headerCRM] },
      });
    }
  } catch {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: "CRM!A1:P1",
      valueInputOption: "RAW",
      resource: { values: [headerCRM] },
    });
  }

  const filasCRM = clientes.map(c => {
    const tel = normalizarTel(c.Telefono);
    const id = tel || c.ID_Cliente;
    const sesCount = sesionesPorCliente[c.ID_Cliente] || 0;
    const ultimaSes = ultimaSesionPorCliente[c.ID_Cliente];
    const estado = sesCount > 0 ? "vino" : "lead";
    const canal = normalizarCanal(c.Origen);
    const fechaAlta = normalizarFecha(c.Fecha_Alta) || new Date().toISOString();
    const ultimoCont = ultimaSes?.fecha || fechaAlta;
    const servicio = ultimaSes?.tratamiento || "";

    return [
      id,                    // A: ID
      c.Nombre || "",        // B: Nombre
      tel || c.Telefono || "",// C: Teléfono
      canal,                 // D: Canal
      servicio,              // E: Servicio
      estado,                // F: Estado
      "no",                  // G: Cuponera
      "0",                   // H: Ses. Rest.
      fechaAlta,             // I: Fecha Alta
      "",                    // J: Fecha Turno
      "",                    // K: Event ID
      c.NOTAS || "",         // L: Notas
      ultimoCont,            // M: Último Contacto
      "",                    // N: Remarketing
      "",                    // O: Perfil
      "",                    // P: Chats
    ];
  });

  await escribirFilas(sheets, "CRM", filasCRM);
  console.log(`  ✅ ${filasCRM.length} clientes migrados\n`);

  // ── 2. SESIONES ──
  console.log("2️⃣  Migrando Sesiones...");
  await crearHoja(sheets, "Sesiones");

  const headerSes = ["ID_Sesion","Fecha","Cliente","Tratamiento","Terapeuta","ID_Cliente","Monto_Terapeuta","Observaciones"];
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: "Sesiones!A1:H1",
    valueInputOption: "RAW",
    resource: { values: [headerSes] },
  });

  const filasSes = sesiones.map(s => [
    s.ID_Sesion || "",
    normalizarFecha(s.Fecha_Hora) || s.Fecha_Hora || "",
    s.Cliente || "",
    s.Tratamiento || "",
    s.Terapeuta || "",
    s.ID_Cliente_Guardado || s.ID_Cliente_Guardado2 || "",
    String(s.A_Pagar_Terapeuta || ""),
    s.Observaciones || "",
  ]);

  await escribirFilas(sheets, "Sesiones", filasSes);
  console.log(`  ✅ ${filasSes.length} sesiones migradas\n`);

  // ── 3. GASTOS ──
  console.log("3️⃣  Migrando Gastos...");

  // Verificar si ya existe la hoja Finanzas
  await crearHoja(sheets, "Finanzas");
  const headerFin = ["Tipo","Fecha","Descripción","Monto","Categoría","Medio Pago","Neto","Notas"];
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: "Finanzas!A1:H1",
    valueInputOption: "RAW",
    resource: { values: [headerFin] },
  });

  const filasGastos = gastos.map(g => [
    "gasto",
    normalizarFecha(g.Mes_ID) || g.Mes_ID || "",
    g.Nombre || "",
    String(g.Monto || ""),
    g.Recurrente === "true" ? "recurrente" : "variable",
    "",
    String(g.Monto || ""),
    g.Notas || (g.Dia_Vencimiento ? `Vence día ${g.Dia_Vencimiento}` : ""),
  ]);

  await escribirFilas(sheets, "Finanzas", filasGastos);
  console.log(`  ✅ ${filasGastos.length} gastos migrados\n`);

  // ── RESUMEN ──
  console.log("═══════════════════════════════");
  console.log("✅ Migración completada:");
  console.log(`   👥 ${filasCRM.length} clientes → hoja CRM`);
  console.log(`   📅 ${filasSes.length} sesiones → hoja Sesiones`);
  console.log(`   💰 ${filasGastos.length} gastos → hoja Finanzas`);
  console.log("═══════════════════════════════");
}

migrar().catch(err => {
  console.error("❌ Error en migración:", err.message);
  process.exit(1);
});
