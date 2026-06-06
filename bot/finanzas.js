// ============================================================
// CITRINO BOT — Módulo Finanzas
// Registra ingresos, gastos y cuponeras en Google Sheets
// Hoja: "Finanzas"
// ============================================================

const { sheets: googleSheets } = require("@googleapis/sheets");
const { GoogleAuth } = require("google-auth-library");

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID;
const SHEET_FIN = "Finanzas";

// Tasas de comisión por medio de pago
const TASAS_COMISION = {
  efectivo: 0,
  transferencia: 0,
  debito: 2.75,
  credito: 3,
  credito3: 10,
  mercadopago: 8,
};

// Precios de los servicios (para ingreso automático)
const PRECIOS_SERVICIOS = {
  "Método Citrino":         1500,
  "Drenaje Linfático":      1500,
  "Masaje Descontracturante": 1200,
  "Masaje Relax":           1300,
  "Masaje Modelador":       1500,
  "Masaje Piedras Calientes": 1500,
  "Reflexología":           1300,
  "Reiki":                  1200,
  "Limpieza de Cutis":      1500,
  "Manicuría":              1300,
  "Podología":              1300,
  "Depilación":             1300,
};

// Precios de cuponeras
const PRECIOS_CUPONERAS = {
  4: 5100,
  6: 7400,
  8: 9600,
};

// Categorías de gastos
const CATEGORIAS_GASTO = [
  "Insumos", "Alquiler", "Servicios", "Marketing", "Personal",
  "Equipamiento", "Mantenimiento", "Capacitación", "Otros",
];

// ============================================================
// AUTH
// ============================================================
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
// INICIALIZAR HOJA "Finanzas"
// ============================================================
async function inicializarHojaFinanzas() {
  const sheets = await getSheets();
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_FIN}!A1:H1`,
    });
    if (res.data.values?.[0]?.[0] === "Fecha") return; // ya existe
  } catch {}

  // Crear la hoja si no existe
  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: {
        requests: [{
          addSheet: { properties: { title: SHEET_FIN } }
        }],
      },
    });
  } catch {}

  // Poner headers
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_FIN}!A1:J1`,
    valueInputOption: "RAW",
    resource: {
      values: [["Fecha", "Tipo", "Categoría", "Descripción", "Monto", "ClienteID", "Servicio", "Notas", "MedioPago", "Neto"]],
    },
  });
  console.log("✅ Hoja Finanzas inicializada");
}

// ============================================================
// REGISTRAR TRANSACCIÓN GENÉRICA
// ============================================================
async function registrarTransaccion({ fecha, tipo, categoria, descripcion, monto, clienteId = "", servicio = "", notas = "", medioPago = "" }) {
  const sheets = await getSheets();
  const fechaStr = fecha || new Date().toISOString().split("T")[0];
  const montoNum = Number(monto) || 0;

  // Calcular neto según medio de pago
  const tasa = TASAS_COMISION[medioPago] || 0;
  const neto = tipo === "ingreso" ? Math.round(montoNum * (1 - tasa / 100)) : montoNum;

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_FIN}!A:J`,
    valueInputOption: "RAW",
    resource: {
      values: [[fechaStr, tipo, categoria || "", descripcion || "", montoNum, clienteId, servicio, notas, medioPago, neto]],
    },
  });
}

// ============================================================
// REGISTRAR INGRESO (sesión individual)
// ============================================================
async function registrarIngreso({ clienteId, servicio, monto, descripcion = "", notas = "", medioPago = "" }) {
  const montoFinal = monto || PRECIOS_SERVICIOS[servicio] || 0;
  await registrarTransaccion({
    tipo: "ingreso",
    categoria: "Servicio",
    descripcion: descripcion || servicio || "Sesión",
    monto: montoFinal,
    clienteId,
    servicio,
    notas,
    medioPago,
  });
}

// ============================================================
// REGISTRAR INGRESO DE CUPONERA
// ============================================================
async function registrarIngresoCuponera({ clienteId, sesiones, monto, descripcion = "" }) {
  const montoFinal = monto || PRECIOS_CUPONERAS[sesiones] || (sesiones * 1400);
  await registrarTransaccion({
    tipo: "ingreso",
    categoria: "Cuponera",
    descripcion: descripcion || `Pack ${sesiones} sesiones`,
    monto: montoFinal,
    clienteId,
    servicio: `Cuponera ${sesiones} ses.`,
  });
}

// ============================================================
// REGISTRAR GASTO
// ============================================================
async function registrarGasto({ categoria, descripcion, monto, notas = "" }) {
  await registrarTransaccion({
    tipo: "gasto",
    categoria: categoria || "Otros",
    descripcion,
    monto: Math.abs(Number(monto)) * -1, // los gastos son negativos
    notas,
  });
}

// ============================================================
// LEER TODAS LAS TRANSACCIONES
// ============================================================
async function leerTransacciones() {
  const sheets = await getSheets();
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_FIN}!A:H`,
    });
    const filas = res.data.values || [];
    if (filas.length <= 1) return [];
    return filas.slice(1).map(f => ({
      fecha:       f[0] || "",
      tipo:        f[1] || "",
      categoria:   f[2] || "",
      descripcion: f[3] || "",
      monto:       parseFloat(f[4]) || 0,
      clienteId:   f[5] || "",
      servicio:    f[6] || "",
      notas:       f[7] || "",
      medioPago:   f[8] || "",
      neto:        parseFloat(f[9]) || parseFloat(f[4]) || 0,
    }));
  } catch { return []; }
}

// ============================================================
// RESUMEN POR MES
// ============================================================
async function getResumenMes(mes) {
  // mes = "2025-01" (YYYY-MM) — si no se pasa, usa el mes actual
  const mesStr = mes || new Date().toISOString().slice(0, 7);
  const todas = await leerTransacciones();
  const delMes = todas.filter(t => (t.fecha || "").startsWith(mesStr));

  const ingresos = delMes.filter(t => t.tipo === "ingreso").reduce((s, t) => s + t.monto, 0);
  const gastos   = delMes.filter(t => t.tipo === "gasto").reduce((s, t) => s + Math.abs(t.monto), 0);
  const neto     = ingresos - gastos;

  // Por categoría
  const porCategoria = {};
  delMes.forEach(t => {
    const cat = t.categoria || "Sin categoría";
    if (!porCategoria[cat]) porCategoria[cat] = { ingresos: 0, gastos: 0 };
    if (t.tipo === "ingreso") porCategoria[cat].ingresos += t.monto;
    else porCategoria[cat].gastos += Math.abs(t.monto);
  });

  // Resumen de últimos 6 meses
  const meses6 = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const m = d.toISOString().slice(0, 7);
    const trans = todas.filter(t => (t.fecha || "").startsWith(m));
    meses6.push({
      mes: m,
      ingresos: trans.filter(t => t.tipo === "ingreso").reduce((s, t) => s + t.monto, 0),
      gastos: trans.filter(t => t.tipo === "gasto").reduce((s, t) => s + Math.abs(t.monto), 0),
    });
  }

  return { mes: mesStr, ingresos, gastos, neto, porCategoria, tendencia: meses6 };
}

module.exports = {
  inicializarHojaFinanzas,
  registrarIngreso,
  registrarIngresoCuponera,
  registrarGasto,
  leerTransacciones,
  getResumenMes,
  PRECIOS_SERVICIOS,
  CATEGORIAS_GASTO,
  TASAS_COMISION,
};
