// ============================================================
// CITRINO BOT — Reportes dinámicos en Google Sheets
// Cuando Nico pide "dame una lista de leads" → crea un Sheet
// ============================================================

const { sheets: googleSheets, drive: googleDrive } = require("@googleapis/sheets");
const { GoogleAuth } = require("google-auth-library");

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID;

function getAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  return new GoogleAuth({
    credentials,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive",
    ],
  });
}

function getSheets() {
  return googleSheets({ version: "v4", auth: getAuth() });
}

// ============================================================
// CREAR PESTAÑA DE REPORTE EN EL SHEET PRINCIPAL
// Retorna la URL del sheet con la pestaña activa
// ============================================================
async function crearReporteSheet(titulo, headers, filas) {
  const sheets = getSheets();
  const fecha = new Date().toLocaleDateString("es-UY").replace(/\//g, "-");
  const tabNombre = `${titulo} ${fecha}`.slice(0, 30);

  // Agregar nueva pestaña
  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: {
        requests: [{
          addSheet: {
            properties: {
              title: tabNombre,
              gridProperties: { rowCount: filas.length + 10, columnCount: headers.length },
            },
          },
        }],
      },
    });
  } catch (e) {
    // Si ya existe la tab, la borra y la recrea
    const ss = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    const tabExistente = ss.data.sheets?.find(s => s.properties.title === tabNombre);
    if (tabExistente) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        resource: { requests: [{ deleteSheet: { sheetId: tabExistente.properties.sheetId } }] },
      });
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        resource: { requests: [{ addSheet: { properties: { title: tabNombre } } }] },
      });
    }
  }

  // Escribir header con formato
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${tabNombre}!A1:${String.fromCharCode(65 + headers.length - 1)}1`,
    valueInputOption: "RAW",
    resource: { values: [headers] },
  });

  // Escribir datos
  if (filas.length > 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${tabNombre}!A2`,
      valueInputOption: "RAW",
      resource: { values: filas },
    });
  }

  return {
    url: `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}`,
    tab: tabNombre,
    registros: filas.length,
  };
}

// ============================================================
// REPORTES PREDEFINIDOS
// ============================================================

async function reporteLeads(clientes) {
  const leads = clientes.filter(c => c.Estado === "lead");
  const headers = ["Nombre", "Teléfono", "Canal", "Servicio", "Fecha Alta", "Días sin respuesta"];
  const filas = leads.map(c => {
    const dias = c.UltimoContacto
      ? Math.floor((Date.now() - new Date(c.UltimoContacto)) / 86400000)
      : "–";
    return [c.Nombre || "–", c.Teléfono || c.ID || "–", c.Canal || "–", c.Servicio || "–",
      c.FechaAlta ? new Date(c.FechaAlta).toLocaleDateString("es-UY") : "–", dias];
  });
  return crearReporteSheet("Leads", headers, filas);
}

async function reporteVIP(clientes) {
  const vip = clientes.filter(c => {
    const sesiones = parseInt(c["Ses.Rest."]) || 0;
    return c.Estado === "vino" && (c.Cuponera === "si" || sesiones > 0);
  });
  const headers = ["Nombre", "Teléfono", "Sesiones Rest.", "Cuponera", "Último contacto"];
  const filas = vip.map(c => [
    c.Nombre || "–", c.Teléfono || c.ID || "–", c["Ses.Rest."] || "0",
    c.Cuponera || "no",
    c.UltimoContacto ? new Date(c.UltimoContacto).toLocaleDateString("es-UY") : "–",
  ]);
  return crearReporteSheet("Clientas VIP", headers, filas);
}

async function reporteInactivos(clientes, dias = 30) {
  const inactivos = clientes.filter(c => {
    if (!c.UltimoContacto || c.Estado === "agendado") return false;
    return Math.floor((Date.now() - new Date(c.UltimoContacto)) / 86400000) > dias;
  });
  const headers = ["Nombre", "Teléfono", "Estado", "Servicio", "Días inactiva", "Cuponera"];
  const filas = inactivos.map(c => {
    const diasInactiva = Math.floor((Date.now() - new Date(c.UltimoContacto)) / 86400000);
    return [c.Nombre || "–", c.Teléfono || c.ID || "–", c.Estado || "–",
      c.Servicio || "–", diasInactiva, c.Cuponera || "no"];
  });
  return crearReporteSheet(`Inactivas ${dias}d`, headers, filas);
}

async function reporteCuponeras(clientes) {
  const cup = clientes.filter(c => c.Cuponera === "si");
  const headers = ["Nombre", "Teléfono", "Sesiones Rest.", "Servicio", "Último contacto"];
  const filas = cup.map(c => [
    c.Nombre || "–", c.Teléfono || c.ID || "–", c["Ses.Rest."] || "0",
    c.Servicio || "–",
    c.UltimoContacto ? new Date(c.UltimoContacto).toLocaleDateString("es-UY") : "–",
  ]);
  return crearReporteSheet("Cuponeras", headers, filas);
}

async function reporteAgendadas(clientes) {
  const agendadas = clientes.filter(c => c.Estado === "agendado" && c.FechaTurno);
  agendadas.sort((a, b) => new Date(a.FechaTurno) - new Date(b.FechaTurno));
  const headers = ["Nombre", "Teléfono", "Fecha Turno", "Hora", "Servicio", "Canal"];
  const filas = agendadas.map(c => {
    const dt = new Date(c.FechaTurno);
    return [
      c.Nombre || "–", c.Teléfono || c.ID || "–",
      dt.toLocaleDateString("es-UY", { timeZone: "America/Montevideo" }),
      dt.toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", timeZone: "America/Montevideo" }),
      c.Servicio || "–", c.Canal || "–",
    ];
  });
  return crearReporteSheet("Agendadas", headers, filas);
}

module.exports = {
  crearReporteSheet,
  reporteLeads,
  reporteVIP,
  reporteInactivos,
  reporteCuponeras,
  reporteAgendadas,
};
