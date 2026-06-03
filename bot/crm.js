// ============================================================
// CITRINO BOT — CRM en Google Sheets
// Fase 2: registro de leads, estados, cuponera
// ============================================================

const { sheets: googleSheets } = require("@googleapis/sheets");
const { GoogleAuth } = require("google-auth-library");

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID;
const SHEET_NAME = "CRM";

// Columnas del sheet (índice 0-based)
const COL = {
  ID:           0,   // A: ID único (número de teléfono / user ID)
  NOMBRE:       1,   // B: Nombre
  TELEFONO:     2,   // C: Teléfono / User ID
  CANAL:        3,   // D: whatsapp / facebook / instagram
  SERVICIO:     4,   // E: Servicio consultado
  ESTADO:       5,   // F: lead / agendado / vino / no_vino / cancelado
  CUPONERA:     6,   // G: si/no
  SES_REST:     7,   // H: Sesiones restantes de cuponera
  FECHA_ALTA:   8,   // I: Fecha de primer contacto
  FECHA_TURNO:  9,   // J: Fecha del próximo turno
  EVENT_ID:     10,  // K: ID del evento en Google Calendar
  NOTAS:        11,  // L: Notas
  ULTIMO_CONT:  12,  // M: Último contacto (timestamp)
  REMARKETING:  13,  // N: Fecha de último remarketing enviado
};

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
// LEER TODAS LAS FILAS
// ============================================================
async function leerTodasLasFilas() {
  const sheets = await getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:N`,
  });
  return res.data.values || [];
}

// ============================================================
// BUSCAR FILA DE UN CLIENTE (por ID/teléfono)
// Retorna { rowIndex, datos } o null
// ============================================================
async function buscarCliente(userId) {
  const filas = await leerTodasLasFilas();
  // filas[0] es el header
  for (let i = 1; i < filas.length; i++) {
    if (filas[i][COL.ID] === String(userId)) {
      return { rowIndex: i + 1, datos: filas[i] }; // rowIndex es 1-based para Sheets
    }
  }
  return null;
}

// ============================================================
// CREAR HEADER SI NO EXISTE
// ============================================================
async function inicializarSheet() {
  const sheets = await getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A1:N1`,
  });

  const header = res.data.values?.[0];
  if (!header || header[0] !== "ID") {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A1:N1`,
      valueInputOption: "RAW",
      resource: {
        values: [[
          "ID", "Nombre", "Teléfono", "Canal", "Servicio", "Estado",
          "Cuponera", "Ses. Rest.", "Fecha Alta", "Fecha Turno",
          "Event ID", "Notas", "Último Contacto", "Remarketing"
        ]],
      },
    });
    console.log("✅ Sheet CRM inicializado con headers");
  }
}

// ============================================================
// REGISTRAR O ACTUALIZAR CLIENTE
// ============================================================
async function registrarCliente({ userId, nombre, canal, servicio }) {
  const existente = await buscarCliente(userId);
  const ahora = new Date().toISOString();

  if (existente) {
    // Actualizar último contacto y servicio si cambió
    const sheets = await getSheets();
    const row = existente.rowIndex;
    const datos = existente.datos;

    // Actualizar nombre si no lo teníamos
    const nuevoNombre = nombre || datos[COL.NOMBRE] || "";
    const nuevoServicio = servicio || datos[COL.SERVICIO] || "";

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!B${row}:E${row}`,
      valueInputOption: "RAW",
      resource: {
        values: [[nuevoNombre, datos[COL.TELEFONO] || userId, datos[COL.CANAL] || canal, nuevoServicio]],
      },
    });

    // Último contacto
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!M${row}`,
      valueInputOption: "RAW",
      resource: { values: [[ahora]] },
    });

    return { nuevo: false, rowIndex: row };
  }

  // Nuevo cliente → agregar fila
  const sheets = await getSheets();
  const filas = await leerTodasLasFilas();
  const nuevaFila = filas.length + 1; // próxima fila libre

  const fila = new Array(14).fill("");
  fila[COL.ID]         = String(userId);
  fila[COL.NOMBRE]     = nombre || "";
  fila[COL.TELEFONO]   = String(userId);
  fila[COL.CANAL]      = canal || "";
  fila[COL.SERVICIO]   = servicio || "";
  fila[COL.ESTADO]     = "lead";
  fila[COL.CUPONERA]   = "no";
  fila[COL.SES_REST]   = "0";
  fila[COL.FECHA_ALTA] = ahora;
  fila[COL.ULTIMO_CONT]= ahora;

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:N`,
    valueInputOption: "RAW",
    resource: { values: [fila] },
  });

  return { nuevo: true, rowIndex: nuevaFila };
}

// ============================================================
// ACTUALIZAR ESTADO
// ============================================================
async function actualizarEstado(userId, estado) {
  const cliente = await buscarCliente(userId);
  if (!cliente) return;

  const sheets = await getSheets();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!F${cliente.rowIndex}`,
    valueInputOption: "RAW",
    resource: { values: [[estado]] },
  });
}

// ============================================================
// REGISTRAR TURNO AGENDADO
// ============================================================
async function registrarTurno(userId, { fechaTurno, eventId, servicio }) {
  const cliente = await buscarCliente(userId);
  if (!cliente) return;

  const sheets = await getSheets();
  const row = cliente.rowIndex;

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!E${row}:K${row}`,
    valueInputOption: "RAW",
    resource: {
      values: [[
        servicio || cliente.datos[COL.SERVICIO],
        "agendado",
        cliente.datos[COL.CUPONERA],
        cliente.datos[COL.SES_REST],
        cliente.datos[COL.FECHA_ALTA],
        fechaTurno,
        eventId,
      ]],
    },
  });
}

// ============================================================
// REGISTRAR CANCELACIÓN
// ============================================================
async function registrarCancelacion(userId) {
  const cliente = await buscarCliente(userId);
  if (!cliente) return;

  const sheets = await getSheets();
  const row = cliente.rowIndex;

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!F${row}:K${row}`,
    valueInputOption: "RAW",
    resource: {
      values: [["cancelado", cliente.datos[COL.CUPONERA], cliente.datos[COL.SES_REST], cliente.datos[COL.FECHA_ALTA], "", ""]],
    },
  });
}

// ============================================================
// REGISTRAR QUE EL CLIENTE VINO (marcar asistencia)
// ============================================================
async function registrarAsistencia(userId, vino = true) {
  await actualizarEstado(userId, vino ? "vino" : "no_vino");

  if (vino) {
    // Descontar sesión de cuponera si tiene
    const cliente = await buscarCliente(userId);
    if (!cliente) return;
    const sesRest = parseInt(cliente.datos[COL.SES_REST]) || 0;
    const tieneCuponera = cliente.datos[COL.CUPONERA] === "si" && sesRest > 0;

    if (tieneCuponera) {
      const sheets = await getSheets();
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!H${cliente.rowIndex}`,
        valueInputOption: "RAW",
        resource: { values: [[String(sesRest - 1)]] },
      });
    }
  }
}

// ============================================================
// ACTUALIZAR NOTAS
// ============================================================
async function actualizarNotas(userId, notas) {
  const cliente = await buscarCliente(userId);
  if (!cliente) return;

  const sheets = await getSheets();
  const notasActuales = cliente.datos[COL.NOTAS] || "";
  const nuevasNotas = notasActuales
    ? `${notasActuales}\n${new Date().toLocaleDateString("es-UY")}: ${notas}`
    : notas;

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!L${cliente.rowIndex}`,
    valueInputOption: "RAW",
    resource: { values: [[nuevasNotas]] },
  });
}

// ============================================================
// REGISTRAR CUPONERA
// ============================================================
async function registrarCuponera(userId, sesiones) {
  const cliente = await buscarCliente(userId);
  if (!cliente) return;

  const sheets = await getSheets();
  const row = cliente.rowIndex;

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!G${row}:H${row}`,
    valueInputOption: "RAW",
    resource: { values: [["si", String(sesiones)]] },
  });
}

// ============================================================
// OBTENER CLIENTES PARA REMARKETING
// Leads sin respuesta > 48hs y sin turno agendado
// ============================================================
async function getLeadsParaRemarketing() {
  const filas = await leerTodasLasFilas();
  const ahora = new Date();
  const limite = 48 * 60 * 60 * 1000; // 48 horas en ms

  return filas.slice(1).filter((fila) => {
    if (fila[COL.ESTADO] !== "lead") return false;
    if (fila[COL.REMARKETING]) return false; // ya le enviamos remarketing

    const ultimoContacto = new Date(fila[COL.ULTIMO_CONT]);
    return ahora - ultimoContacto > limite;
  }).map((fila) => ({
    userId: fila[COL.ID],
    nombre: fila[COL.NOMBRE],
    canal: fila[COL.CANAL],
    servicio: fila[COL.SERVICIO],
  }));
}

// ============================================================
// OBTENER CLIENTES PARA SEGUIMIENTO POST-SESIÓN (7 días)
// ============================================================
async function getClientesParaSeguimiento() {
  const filas = await leerTodasLasFilas();
  const ahora = new Date();
  const siete_dias = 7 * 24 * 60 * 60 * 1000;

  return filas.slice(1).filter((fila) => {
    if (fila[COL.ESTADO] !== "vino") return false;
    if (fila[COL.REMARKETING]) return false;

    const ultimoContacto = new Date(fila[COL.ULTIMO_CONT]);
    return ahora - ultimoContacto >= siete_dias;
  }).map((fila) => ({
    userId: fila[COL.ID],
    nombre: fila[COL.NOMBRE],
    canal: fila[COL.CANAL],
    servicio: fila[COL.SERVICIO],
    cuponera: fila[COL.CUPONERA],
    sesRest: fila[COL.SES_REST],
  }));
}

// ============================================================
// OBTENER CLIENTES CON TURNO PRÓXIMO (para recordatorios 24hs)
// ============================================================
async function getClientesConTurnoManana() {
  const filas = await leerTodasLasFilas();
  const ahora = new Date();
  const en24 = new Date(ahora.getTime() + 24 * 60 * 60 * 1000);
  const en26 = new Date(ahora.getTime() + 26 * 60 * 60 * 1000);

  return filas.slice(1).filter((fila) => {
    if (fila[COL.ESTADO] !== "agendado") return false;
    if (!fila[COL.FECHA_TURNO]) return false;

    const fechaTurno = new Date(fila[COL.FECHA_TURNO]);
    return fechaTurno >= en24 && fechaTurno < en26;
  }).map((fila) => ({
    userId: fila[COL.ID],
    nombre: fila[COL.NOMBRE],
    canal: fila[COL.CANAL],
    servicio: fila[COL.SERVICIO],
    fechaTurno: fila[COL.FECHA_TURNO],
    eventId: fila[COL.EVENT_ID],
  }));
}

// ============================================================
// REGISTRAR ENVÍO DE REMARKETING
// ============================================================
async function registrarRemarketing(userId) {
  const cliente = await buscarCliente(userId);
  if (!cliente) return;

  const sheets = await getSheets();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!N${cliente.rowIndex}`,
    valueInputOption: "RAW",
    resource: { values: [[new Date().toISOString()]] },
  });
}

// ============================================================
// STATS PARA EL DASHBOARD
// ============================================================
async function getStats() {
  const filas = await leerTodasLasFilas();
  const datos = filas.slice(1);

  const total = datos.length;
  const agendados = datos.filter((f) => f[COL.ESTADO] === "agendado").length;
  const vinieron = datos.filter((f) => f[COL.ESTADO] === "vino").length;
  const noVinieron = datos.filter((f) => f[COL.ESTADO] === "no_vino").length;
  const leads = datos.filter((f) => f[COL.ESTADO] === "lead").length;
  const cancelados = datos.filter((f) => f[COL.ESTADO] === "cancelado").length;
  const conCuponera = datos.filter((f) => f[COL.CUPONERA] === "si").length;

  const porCanal = { whatsapp: 0, facebook: 0, instagram: 0 };
  datos.forEach((f) => {
    const canal = f[COL.CANAL];
    if (porCanal[canal] !== undefined) porCanal[canal]++;
  });

  return {
    total,
    leads,
    agendados,
    vinieron,
    noVinieron,
    cancelados,
    conCuponera,
    tasaConversion: total > 0 ? Math.round((vinieron / total) * 100) : 0,
    tasaAgendamiento: total > 0 ? Math.round(((agendados + vinieron) / total) * 100) : 0,
    porCanal,
    // Estimado de ingresos: sesiones * precio promedio ($1500 UYU ejemplo)
    ingresosEstimados: vinieron * 1500,
  };
}

// ============================================================
// LEER TODOS LOS CLIENTES (para el panel admin)
// ============================================================
async function leerTodosLosClientes() {
  const filas = await leerTodasLasFilas();
  if (filas.length <= 1) return [];

  const headers = ["ID","Nombre","Teléfono","Canal","Servicio","Estado","Cuponera","Ses.Rest.","FechaAlta","FechaTurno","EventID","Notas","UltimoContacto","Remarketing"];

  return filas.slice(1).map((fila) => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = fila[i] || ""; });
    return obj;
  });
}

module.exports = {
  inicializarSheet,
  registrarCliente,
  buscarCliente,
  actualizarEstado,
  registrarTurno,
  registrarCancelacion,
  registrarAsistencia,
  actualizarNotas,
  registrarCuponera,
  leerTodosLosClientes,
  getLeadsParaRemarketing,
  getClientesParaSeguimiento,
  getClientesConTurnoManana,
  registrarRemarketing,
  getStats,
};
