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
  PERFIL:       14,  // O: Perfil JSON del cliente (aprendizaje)
  CHATS:        15,  // P: Historial de chats (JSON últimos 20 mensajes)
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
    range: `${SHEET_NAME}!A:O`,
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
    range: `${SHEET_NAME}!A1:O1`,
  });

  const header = res.data.values?.[0];
  if (!header || header[0] !== "ID") {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A1:P1`,
      valueInputOption: "RAW",
      resource: {
        values: [[
          "ID", "Nombre", "Teléfono", "Canal", "Servicio", "Estado",
          "Cuponera", "Ses. Rest.", "Fecha Alta", "Fecha Turno",
          "Event ID", "Notas", "Último Contacto", "Remarketing", "Perfil", "Chats"
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
    const cliente = await buscarCliente(userId);
    if (!cliente) return;
    const sesRest = parseInt(cliente.datos[COL.SES_REST]) || 0;
    const tieneCuponera = cliente.datos[COL.CUPONERA] === "si" && sesRest > 0;

    // Descontar sesión de cuponera si tiene
    if (tieneCuponera) {
      const sheets = await getSheets();
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!H${cliente.rowIndex}`,
        valueInputOption: "RAW",
        resource: { values: [[String(sesRest - 1)]] },
      });
    }

    // Registrar ingreso automático en Finanzas
    try {
      const { registrarIngreso } = require("./finanzas");
      const servicio = cliente.datos[COL.SERVICIO] || "";
      const notasCuponera = tieneCuponera ? `Cuponera (quedan ${sesRest - 1} ses.)` : "";
      await registrarIngreso({
        clienteId: userId,
        servicio,
        notas: notasCuponera,
      });
    } catch {}
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
// SCORING DE CLIENTAS
// VIP / Regular / Lead tibio / Lead frío / En riesgo
// ============================================================
function calcularScore(fila) {
  let score = 0;
  const estado = fila[COL.ESTADO] || "";
  const cuponera = fila[COL.CUPONERA] === "si";
  const sesRest = parseInt(fila[COL.SES_REST]) || 0;
  const ultimoContacto = fila[COL.ULTIMO_CONT] ? new Date(fila[COL.ULTIMO_CONT]) : null;
  const diasDesdeContacto = ultimoContacto
    ? Math.floor((new Date() - ultimoContacto) / (1000 * 60 * 60 * 24))
    : 999;

  // Estado
  if (estado === "vino") score += 40;
  else if (estado === "agendado") score += 30;
  else if (estado === "lead") score += 5;
  else if (estado === "cancelado") score -= 10;

  // Cuponera
  if (cuponera) score += 30;
  if (sesRest > 0) score += sesRest * 5;

  // Recencia
  if (diasDesdeContacto <= 7) score += 20;
  else if (diasDesdeContacto <= 30) score += 10;
  else if (diasDesdeContacto <= 60) score += 0;
  else score -= 10;

  // Clasificar
  let categoria;
  if (score >= 70) categoria = "VIP 🌟";
  else if (score >= 40) categoria = "Regular 💚";
  else if (score >= 20) categoria = "Lead tibio 🌡️";
  else if (estado === "lead") categoria = "Lead frío ❄️";
  else categoria = "En riesgo ⚠️";

  return { score, categoria };
}

async function getLeadsParaRemarketing() {
  const filas = await leerTodasLasFilas();
  const ahora = new Date();
  const limite48h = 48 * 60 * 60 * 1000;
  const limite30d = 30 * 24 * 60 * 60 * 1000;

  return filas.slice(1).filter((fila) => {
    const estado = fila[COL.ESTADO];
    // Leads sin respuesta > 48hs
    if (estado === "lead") {
      if (fila[COL.REMARKETING]) return false;
      const ultimoContacto = new Date(fila[COL.ULTIMO_CONT]);
      return ahora - ultimoContacto > limite48h;
    }
    // Clientas que vinieron pero no volvieron en 30 días
    if (estado === "vino") {
      if (fila[COL.REMARKETING]) {
        const ultimoRemark = new Date(fila[COL.REMARKETING]);
        if (ahora - ultimoRemark < limite30d) return false;
      }
      const ultimoContacto = new Date(fila[COL.ULTIMO_CONT]);
      return ahora - ultimoContacto > limite30d;
    }
    return false;
  }).map((fila) => {
    const { categoria } = calcularScore(fila);
    return {
      userId: fila[COL.ID],
      nombre: fila[COL.NOMBRE],
      canal: fila[COL.CANAL],
      servicio: fila[COL.SERVICIO],
      estado: fila[COL.ESTADO],
      categoria,
    };
  });
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
// PERFIL DE CLIENTE — aprendizaje automático
// ============================================================
async function obtenerPerfil(userId) {
  const cliente = await buscarCliente(userId);
  if (!cliente || !cliente.datos[COL.PERFIL]) return {};
  try {
    return JSON.parse(cliente.datos[COL.PERFIL]);
  } catch {
    return {};
  }
}

async function actualizarPerfil(userId, nuevosDatos) {
  const cliente = await buscarCliente(userId);
  if (!cliente) return;

  const perfilActual = await obtenerPerfil(userId);

  // Merge inteligente: arrays se concatenan sin duplicar, strings se reemplazan
  const perfilNuevo = { ...perfilActual };
  for (const [key, val] of Object.entries(nuevosDatos)) {
    if (!val || val === "" || (Array.isArray(val) && val.length === 0)) continue;
    if (Array.isArray(val) && Array.isArray(perfilActual[key])) {
      // Unir sin duplicados
      perfilNuevo[key] = [...new Set([...perfilActual[key], ...val])];
    } else {
      perfilNuevo[key] = val;
    }
  }
  perfilNuevo.ultima_actualizacion = new Date().toISOString();

  const sheets = await getSheets();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!O${cliente.rowIndex}`,
    valueInputOption: "RAW",
    resource: { values: [[JSON.stringify(perfilNuevo)]] },
  });

  return perfilNuevo;
}

// Devuelve todos los perfiles para análisis agregado
async function obtenerTodosLosPerfiles() {
  const filas = await leerTodasLasFilas();
  return filas.slice(1)
    .filter(f => f[COL.PERFIL])
    .map(f => {
      try {
        return {
          nombre: f[COL.NOMBRE],
          estado: f[COL.ESTADO],
          canal: f[COL.CANAL],
          servicio: f[COL.SERVICIO],
          perfil: JSON.parse(f[COL.PERFIL]),
        };
      } catch { return null; }
    })
    .filter(Boolean);
}

// ============================================================
// HISTORIAL DE CHATS — guarda los últimos 20 mensajes por cliente
// ============================================================
async function guardarMensajeChat(userId, rol, mensaje) {
  try {
    const cliente = await buscarCliente(userId);
    if (!cliente) return;

    let chats = [];
    try { chats = JSON.parse(cliente.datos[COL.CHATS] || "[]"); } catch {}

    chats.push({
      rol,        // "user" | "bot"
      msg: (mensaje || "").substring(0, 500), // truncar mensajes muy largos
      fecha: new Date().toISOString(),
    });

    // Mantener solo los últimos 30 mensajes
    if (chats.length > 30) chats = chats.slice(-30);

    const sheets = await getSheets();
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!P${cliente.rowIndex}`,
      valueInputOption: "RAW",
      resource: { values: [[JSON.stringify(chats)]] },
    });
  } catch {
    // No es crítico
  }
}

async function obtenerChats(userId) {
  const cliente = await buscarCliente(userId);
  if (!cliente || !cliente.datos[COL.CHATS]) return [];
  try { return JSON.parse(cliente.datos[COL.CHATS]); } catch { return []; }
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

  const headers = ["ID","Nombre","Teléfono","Canal","Servicio","Estado","Cuponera","Ses.Rest.","FechaAlta","FechaTurno","EventID","Notas","UltimoContacto","Remarketing","Perfil","Chats"];

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
  obtenerPerfil,
  actualizarPerfil,
  obtenerTodosLosPerfiles,
  calcularScore,
  guardarMensajeChat,
  obtenerChats,
};
