// ============================================================
// CITRINO BOT — Gestión de Terapeutas
// Guarda config en Google Sheets, hoja "Terapeutas"
// ============================================================

const { sheets: googleSheets } = require("@googleapis/sheets");
const { GoogleAuth } = require("google-auth-library");

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID;
const SHEET_TER = "Terapeutas";

function getAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  return new GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

async function getSheets() {
  const auth = getAuth();
  return googleSheets({ version: "v4", auth });
}

// ============================================================
// INICIALIZAR HOJA
// ============================================================
async function inicializarHojaTerapeutas() {
  const sheets = await getSheets();

  // Verificar si ya existe
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_TER}!A1:F1`,
    });
    if (res.data.values?.[0]?.[0] === "ID") return;
  } catch {}

  // Crear la hoja
  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: { requests: [{ addSheet: { properties: { title: SHEET_TER } } }] },
    });
  } catch {}

  // Headers + fila default (Citrino)
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_TER}!A1:G3`,
    valueInputOption: "RAW",
    resource: {
      values: [
        ["ID", "Nombre", "Color", "Horarios", "CalendarID", "Activa", "WhatsApp"],
        [
          "default",
          "Citrino",
          "#4a6f4a",
          JSON.stringify({
            1: { dia: "Lunes",     franjas: [{ inicio: 8, fin: 18 }] },
            2: { dia: "Martes",    franjas: [{ inicio: 8, fin: 18 }] },
            3: { dia: "Miércoles", franjas: [{ inicio: 8, fin: 18 }] },
            4: { dia: "Jueves",    franjas: [{ inicio: 8, fin: 18 }] },
            5: { dia: "Viernes",   franjas: [{ inicio: 8, fin: 18 }] },
            6: { dia: "Sábado",    franjas: [{ inicio: 9, fin: 14 }] }, // 9:00–13:00
          }),
          process.env.GOOGLE_CALENDAR_ID || "primary",
          "si",
        ],
      ],
    },
  });
  console.log("✅ Hoja Terapeutas inicializada");
}

// ============================================================
// LEER TERAPEUTAS
// ============================================================
async function leerTerapeutas() {
  const sheets = await getSheets();
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_TER}!A:F`,
    });
    const filas = res.data.values || [];
    if (filas.length <= 1) return [];

    return filas.slice(1)
      .filter(f => f[0] && f[5] !== "no") // activas
      .map(f => {
        let horarios = {};
        try { horarios = JSON.parse(f[3] || "{}"); } catch {}
        return {
          id:         f[0] || "",
          nombre:     f[1] || "Sin nombre",
          color:      f[2] || "#4a6f4a",
          horarios,
          calendarId: f[4] || process.env.GOOGLE_CALENDAR_ID || "primary",
          activa:     f[5] !== "no",
          whatsapp:   f[6] || "",
          pin:        f[7] || "",   // PIN de 4 dígitos para vista tablet
        };
      });
  } catch {
    // Fallback a config hardcoded si falla Sheets
    return [{
      id: "default",
      nombre: "Citrino",
      color: "#4a6f4a",
      horarios: {
        1: { dia: "Lunes",     franjas: [{ inicio: 8, fin: 18 }] },
        2: { dia: "Martes",    franjas: [{ inicio: 8, fin: 18 }] },
        3: { dia: "Miércoles", franjas: [{ inicio: 8, fin: 18 }] },
        4: { dia: "Jueves",    franjas: [{ inicio: 8, fin: 18 }] },
        5: { dia: "Viernes",   franjas: [{ inicio: 8, fin: 18 }] },
        6: { dia: "Sábado",    franjas: [{ inicio: 9, fin: 14 }] }, // 9:00–13:00
      },
      calendarId: process.env.GOOGLE_CALENDAR_ID || "primary",
      activa: true,
    }];
  }
}

// ============================================================
// AGREGAR / ACTUALIZAR TERAPEUTA
// ============================================================
async function guardarTerapeuta({ id, nombre, color, horarios, calendarId }) {
  const sheets = await getSheets();
  const todas = await leerTodas();

  // Generar ID si no tiene
  const terId = id || nombre.toLowerCase().replace(/[^a-z0-9]/g, "_") + "_" + Date.now();

  // Buscar si ya existe
  const existeIdx = todas.findIndex(f => f[0] === terId);

  const fila = [
    terId,
    nombre,
    color || "#4a6f4a",
    JSON.stringify(horarios || {}),
    calendarId || process.env.GOOGLE_CALENDAR_ID || "primary",
    "si",
  ];

  if (existeIdx >= 0) {
    const rowNum = existeIdx + 2; // +2 por header y 0-based
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_TER}!A${rowNum}:F${rowNum}`,
      valueInputOption: "RAW",
      resource: { values: [fila] },
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_TER}!A:F`,
      valueInputOption: "RAW",
      resource: { values: [fila] },
    });
  }

  return terId;
}

// ============================================================
// ELIMINAR (desactivar) TERAPEUTA
// ============================================================
async function eliminarTerapeuta(id) {
  const sheets = await getSheets();
  const todas = await leerTodas();
  const idx = todas.findIndex(f => f[0] === id);
  if (idx < 0) return;
  const rowNum = idx + 2;
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_TER}!F${rowNum}`,
    valueInputOption: "RAW",
    resource: { values: [["no"]] },
  });
}

// Helper: leer filas crudas
async function leerTodas() {
  const sheets = await getSheets();
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_TER}!A:F`,
    });
    return (res.data.values || []).slice(1);
  } catch { return []; }
}

module.exports = {
  inicializarHojaTerapeutas,
  leerTerapeutas,
  guardarTerapeuta,
  eliminarTerapeuta,
};
