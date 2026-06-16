// ============================================================
// CITRINO CRM — CRUD directo a Google Sheets
// Hojas: CLIENTES, SESIONES, VENTAS, GASTOS
// (distintas de las hojas internas del bot)
// ============================================================

const { sheets: googleSheets } = require("@googleapis/sheets");
const { GoogleAuth } = require("google-auth-library");

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID;

// ─── Columnas por hoja ────────────────────────────────────────
const HEADERS = {
  CLIENTES: ['ID_Cliente', 'Nombre', 'Telefono', 'Origen', 'Fecha_Alta', 'NOTAS', 'Fecha_Nacimiento', 'Estado', 'Intencion_Compra', 'Objecion', 'Fecha_Turno', 'Ultimo_Saludo', 'Historial_JSON', 'Remarketing_Etapa', 'Ultimo_Remarketing'],
  SESIONES: ['ID_Sesion', 'Fecha_Hora', 'Cliente', 'Tratamiento', 'Terapeuta', 'ID_Cliente_Guardado', 'Semana_Anio', 'Mes_Anio', 'A_Pagar_Terapeuta', 'ID_Cliente_Guardado2', 'Observaciones'],
  VENTAS:   ['Fecha', 'ID_Venta', 'Cliente', 'Producto', 'Monto', 'Forma_Pago', 'Notas', 'ID_Cliente_Guardado', 'Cantidad_Calculada', 'Ingreso_Real', 'Fecha_Vencimiento', 'Mes_Anio'],
  GASTOS:   ['Nombre', 'Monto', 'Mes_ID', 'Notas', 'Recurrente', 'Dia_Vencimiento'],
  HORARIOS: ['Terapeuta', 'Dia_Semana', 'Hora_Inicio', 'Hora_Fin', 'Activo', 'Semana_Inicio'],
};

// ─── Auth ─────────────────────────────────────────────────────
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

// ─── Leer hoja completa (devuelve array de objetos) ───────────
async function readSheet(sheetName) {
  await createSheetIfNotExists(sheetName);
  const api = await getSheets();
  const resp = await api.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A1:Z`,
  });

  const rows = resp.data.values || [];
  if (rows.length === 0) return [];

  // Primera fila = headers (o usamos los hardcoded si la hoja está vacía)
  const headers = rows[0];
  return rows.slice(1).map((row, idx) => {
    const obj = { _rowIndex: idx + 2 }; // 1-based, +1 por header
    headers.forEach((h, i) => { obj[h] = row[i] ?? ""; });
    return obj;
  });
}

// ─── Asegurar que la hoja tenga header ───────────────────────
async function ensureHeader(sheetName) {
  const api = await getSheets();
  const resp = await api.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A1:Z1`,
  });
  const firstRow = resp.data.values?.[0] || [];
  if (firstRow.length === 0) {
    await api.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [HEADERS[sheetName] || []] },
    });
  }
}

// ─── Agregar fila ─────────────────────────────────────────────
async function appendRow(sheetName, rowObj) {
  await ensureHeader(sheetName);
  const api = await getSheets();
  const headers = HEADERS[sheetName] || Object.keys(rowObj);
  const row = headers.map(h => rowObj[h] ?? "");

  await api.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A1`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] },
  });
}

// ─── Actualizar fila (por _rowIndex 1-based) ──────────────────
async function updateRow(sheetName, rowIndex, rowObj) {
  const api = await getSheets();
  const headers = HEADERS[sheetName] || Object.keys(rowObj);
  const row = headers.map(h => rowObj[h] ?? "");

  await api.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A${rowIndex}:${colLetter(headers.length)}${rowIndex}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [row] },
  });
}

// ─── Eliminar fila (borra el contenido, no la fila física) ───
// Para evitar desplazamiento de índices usamos clearValues
async function deleteRow(sheetName, rowIndex) {
  const api = await getSheets();
  const headers = HEADERS[sheetName] || [];
  await api.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A${rowIndex}:${colLetter(headers.length || 26)}${rowIndex}`,
  });
}

// ─── Crear pestaña si no existe ──────────────────────────────
async function createSheetIfNotExists(sheetName) {
  const api = await getSheets();
  try {
    await api.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [{ addSheet: { properties: { title: sheetName } } }],
      },
    });
    // Pestaña recién creada → escribir header
    await api.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [HEADERS[sheetName] || []] },
    });
  } catch (e) {
    // Si ya existe, ignorar; cualquier otro error sí lo propagamos
    if (!e.message || !e.message.includes("already exists")) throw e;
  }
}

// ─── Importación masiva (limpia + reescribe) ──────────────────
async function bulkImport(sheetName, rows) {
  await createSheetIfNotExists(sheetName);
  const api = await getSheets();
  const headers = HEADERS[sheetName] || [];

  // Forzar header correcto en fila 1 (por si el sheet tenía nombres viejos)
  if (headers.length > 0) {
    await api.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [headers] },
    });
  }

  // Limpiar desde fila 2 (conserva el header)
  await api.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A2:Z`,
  });

  if (rows.length === 0) return;

  const values = rows.map(obj => headers.map(h => obj[h] ?? ""));

  await api.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A2`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values },
  });
}

// ─── Helpers ─────────────────────────────────────────────────
function colLetter(n) {
  // convierte número de columna (1-based) a letra: 1→A, 26→Z, 27→AA
  let s = "";
  while (n > 0) {
    n--;
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

// ─── Upsert cliente (crea si no existe, actualiza Estado/Fecha_Turno si existe) ───
async function upsertCliente(clienteObj) {
  try {
    await createSheetIfNotExists("CLIENTES");
    const api = await getSheets();
    const resp = await api.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "CLIENTES!A:A",
    });
    const ids = (resp.data.values || []).map(r => r[0]);
    const existingIdx = ids.indexOf(clienteObj.ID_Cliente);
    if (existingIdx === -1) {
      // Nuevo cliente → prospecto por defecto
      if (!clienteObj.Estado) clienteObj.Estado = "prospecto";
      await appendRow("CLIENTES", clienteObj);
    } else {
      // Ya existe → solo actualizar campos que vienen en el objeto (Estado, Fecha_Turno, etc.)
      // No sobreescribir todo para preservar datos existentes
      const rowIndex = existingIdx + 1; // 1-based (no hay +1 extra porque row 0 = header)
      const headers = HEADERS.CLIENTES;
      // Leer fila actual
      const rowResp = await api.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `CLIENTES!A${rowIndex}:${colLetter(headers.length)}${rowIndex}`,
      });
      const currentRow = rowResp.data.values?.[0] || [];
      const currentObj = {};
      headers.forEach((h, i) => { currentObj[h] = currentRow[i] ?? ""; });
      // Merge: solo actualizar campos que vienen en clienteObj y no están vacíos
      const fieldsToUpdate = ['Estado', 'Intencion_Compra', 'Objecion', 'Fecha_Turno', 'Nombre', 'NOTAS', 'Ultimo_Saludo', 'Historial_JSON', 'Remarketing_Etapa', 'Ultimo_Remarketing'];
      fieldsToUpdate.forEach(f => {
        if (clienteObj[f] !== undefined && clienteObj[f] !== "") {
          currentObj[f] = clienteObj[f];
        }
      });
      await updateRow("CLIENTES", rowIndex, currentObj);
    }
  } catch (e) {
    console.error("[sheets-crm] upsertCliente error:", e.message);
  }
}

// ─── Actualizar solo el estado de un cliente ──────────────────
async function updateClienteEstado(userId, estado, extras = {}) {
  try {
    await createSheetIfNotExists("CLIENTES");
    const api = await getSheets();
    const resp = await api.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "CLIENTES!A:A",
    });
    const ids = (resp.data.values || []).map(r => r[0]);
    const idx = ids.indexOf(userId);
    if (idx === -1) {
      // No existe → crear con estado
      await appendRow("CLIENTES", {
        ID_Cliente: userId, Telefono: userId, Origen: "whatsapp",
        Fecha_Alta: new Date().toISOString().split("T")[0],
        Estado: estado, ...extras,
      });
      return;
    }
    const rowIndex = idx + 1;
    const headers = HEADERS.CLIENTES;
    const rowResp = await api.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `CLIENTES!A${rowIndex}:${colLetter(headers.length)}${rowIndex}`,
    });
    const currentRow = rowResp.data.values?.[0] || [];
    const currentObj = {};
    headers.forEach((h, i) => { currentObj[h] = currentRow[i] ?? ""; });
    currentObj.Estado = estado;
    Object.assign(currentObj, extras);
    await updateRow("CLIENTES", rowIndex, currentObj);
  } catch (e) {
    console.error("[sheets-crm] updateClienteEstado error:", e.message);
  }
}

// ─── Obtener clientes con turno mañana (para confirmación 15hs) ───
async function getClientesParaConfirmar() {
  try {
    const filas = await readSheet("CLIENTES");
    const manana = new Date();
    manana.setDate(manana.getDate() + 1);
    const mananaStr = manana.toISOString().split("T")[0];

    return filas.filter(f => {
      if (!f.Fecha_Turno) return false;
      const fechaTurno = f.Fecha_Turno.split("T")[0];
      return fechaTurno === mananaStr && f.Estado !== "no_confirmado" && f.Estado !== "cancelado";
    });
  } catch (e) {
    console.error("[sheets-crm] getClientesParaConfirmar error:", e.message);
    return [];
  }
}

// ─── Leer HORARIOS estructurados por terapeuta ────────────────
// Devuelve objeto compatible con getDisponibilidad() de calendar.js
async function getHorariosParaCalendar() {
  try {
    const filas = await readSheet("HORARIOS");
    const activas = filas.filter(f => f.Activo !== "no" && f.Activo !== "false");
    if (!activas.length) return null;

    // Agrupar por terapeuta
    const mapa = {};
    for (const f of activas) {
      const ter = f.Terapeuta;
      if (!ter) continue;
      if (!mapa[ter]) mapa[ter] = { nombre: ter, horarios: {}, activa: true };

      const diasMap = { Domingo:0, Lunes:1, Martes:2, Miercoles:3, Miércoles:3, Jueves:4, Viernes:5, Sabado:6, Sábado:6 };
      const dia = diasMap[f.Dia_Semana];
      if (dia === undefined) continue;

      if (!mapa[ter].horarios[dia]) mapa[ter].horarios[dia] = { dia: f.Dia_Semana, franjas: [] };

      const inicio = parseFloat(f.Hora_Inicio) || 8;
      const fin    = parseFloat(f.Hora_Fin)    || 18;
      mapa[ter].horarios[dia].franjas.push({ inicio, fin });
    }
    return Object.values(mapa);
  } catch {
    return null;
  }
}

// ─── Saldo de cuponera (fuente de verdad: VENTAS - SESIONES) ──
// Función compartida usada por admin.js, scheduler.js y conversation.js
const PACK_KW = ["pack", "cuponera", "pase libre"];
const PROD_CANT = {
  "pack 2": 2, "pack 4": 4, "pack 6": 6, "pack 8": 8,
  "pase libre": 1, "sesión individual": 1, "sesion individual": 1,
};

function _normDigits(v) { return String(v || "").replace(/\D/g, ""); }
function _phoneMatch(a, b) {
  const na = _normDigits(a); const nb = _normDigits(b);
  if (!na || !nb) return false;
  const min = Math.min(na.length, nb.length);
  return na.slice(-min) === nb.slice(-min);
}
function _cantProd(producto, cantHoja) {
  const n = parseInt(cantHoja) || 0;
  if (n > 0) return n;
  const p = (producto || "").toLowerCase();
  for (const [k, v] of Object.entries(PROD_CANT)) { if (p.includes(k)) return v; }
  const m = p.match(/\d+/);
  return m ? parseInt(m[0]) : 0;
}

async function getSaldoClienteBot(clienteId, clienteNombre) {
  try {
    const [clientesSheet, ventas, sesiones] = await Promise.all([
      readSheet("CLIENTES"),
      readSheet("VENTAS"),
      readSheet("SESIONES"),
    ]);
    const clienteRow = clientesSheet.find(c =>
      c.ID_Cliente === clienteId ||
      _phoneMatch(c.Telefono, clienteId) ||
      (clienteNombre && c.Nombre?.toLowerCase() === clienteNombre?.toLowerCase())
    );
    const hashId = clienteRow ? clienteRow.ID_Cliente : clienteId;
    const matchId = v => v === hashId || _phoneMatch(v, clienteId);

    const ventasCli = ventas.filter(v =>
      matchId(v.ID_Cliente_Guardado) &&
      PACK_KW.some(k => (v.Producto || "").toLowerCase().includes(k))
    );
    const sesionesCli = sesiones.filter(s =>
      matchId(s.ID_Cliente_Guardado || s.ID_Cliente_Guardado2 || s.ID_Cliente)
    );
    const compradas = ventasCli.reduce((a, v) => a + _cantProd(v.Producto, v.Cantidad_Calculada), 0);
    const usadas    = sesionesCli.length;
    return { compradas, usadas, saldo: Math.max(0, compradas - usadas) };
  } catch {
    return { compradas: 0, usadas: 0, saldo: 0 };
  }
}

module.exports = {
  readSheet,
  appendRow,
  updateRow,
  deleteRow,
  bulkImport,
  upsertCliente,
  updateClienteEstado,
  getClientesParaConfirmar,
  getHorariosParaCalendar,
  getSaldoClienteBot,
  HEADERS,
};
