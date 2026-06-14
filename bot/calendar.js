// ============================================================
// CITRINO BOT — Calendar vía Google Sheets (hoja "Sesiones")
// Reemplaza Google Calendar API — toda la agenda vive en Sheets
// ============================================================

const { sheets: googleSheets } = require("@googleapis/sheets");
const { GoogleAuth } = require("google-auth-library");
const { conRetry } = require("./utils");

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID;
const SHEET_SESIONES = "Sesiones";
const TIMEZONE = "America/Montevideo";
const DURACION_MIN = 90;    // duración de cada sesión en minutos
const DIAS_A_MOSTRAR = 7;  // ventana de disponibilidad (días)

// ─── Columnas de la hoja Sesiones (0-based) ──────────────────
const COL = {
  ID_SESION:       0,  // A — UUID único
  FECHA:           1,  // B — ISO datetime inicio  (2026-06-15T10:00:00-03:00)
  CLIENTE:         2,  // C — Nombre
  TRATAMIENTO:     3,  // D
  TERAPEUTA:       4,  // E — nombre de la terapeuta
  ID_CLIENTE:      5,  // F — teléfono / userId
  MONTO_TERAPEUTA: 6,  // G
  OBSERVACIONES:   7,  // H
  FECHA_FIN:       8,  // I — ISO datetime fin (inicio + 90 min)
  ESTADO:          9,  // J — pendiente | confirmado | cancelado | vino | no_vino
};

// ─── Horarios por defecto (se sobreescriben con hoja Terapeutas) ───
// TEMPORAL: sin restricción de horario para pruebas
const HORARIOS_DEFAULT = {
  0: { dia: "Domingo",   franjas: [{ inicio: 0, fin: 24 }] },
  1: { dia: "Lunes",     franjas: [{ inicio: 0, fin: 24 }] },
  2: { dia: "Martes",    franjas: [{ inicio: 0, fin: 24 }] },
  3: { dia: "Miércoles", franjas: [{ inicio: 0, fin: 24 }] },
  4: { dia: "Jueves",    franjas: [{ inicio: 0, fin: 24 }] },
  5: { dia: "Viernes",   franjas: [{ inicio: 0, fin: 24 }] },
  6: { dia: "Sábado",    franjas: [{ inicio: 0, fin: 24 }] },
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

// ─── Helpers de tiempo ────────────────────────────────────────
function toMVD(date) {
  // Convierte a hora de Montevideo
  return new Date(date.toLocaleString("en-US", { timeZone: TIMEZONE }));
}

function horaToFloat(hhmm) {
  // "10:30" → 10.5
  const [h, m] = hhmm.split(":").map(Number);
  return h + (m || 0) / 60;
}

function floatToHHMM(h) {
  const hh = Math.floor(h);
  const mm = Math.round((h % 1) * 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function buildISO(fechaStr, horaFloat) {
  // "2026-06-15" + 10.5 → "2026-06-15T10:30:00-03:00"
  return `${fechaStr}T${floatToHHMM(horaFloat)}:00-03:00`;
}

function formatFecha(dateStr) {
  const d = new Date(dateStr + "T12:00:00-03:00");
  return d.toLocaleDateString("es-UY", {
    weekday: "long", day: "numeric", month: "long", timeZone: TIMEZONE,
  });
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ─── Leer todas las filas de Sesiones ─────────────────────────
let _cache = null;
let _cacheTs = 0;
const TTL = 5 * 60 * 1000; // 5 min

async function _leerSesiones(forzar = false) {
  const ahora = Date.now();
  if (!forzar && _cache && (ahora - _cacheTs) < TTL) return _cache;

  const api = await getSheets();
  const res = await conRetry(
    () => api.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_SESIONES}!A:J`,
    }),
    { nombre: "Sheets - leer Sesiones", intentos: 3 }
  );
  const filas = (res.data.values || []).slice(1); // saltar header
  _cache = filas;
  _cacheTs = ahora;
  return filas;
}

function _invalidarCache() {
  _cache = null;
  _cacheTs = 0;
}

// ─── Leer terapeutas — primero desde HORARIOS (CRM), luego default ──
async function _leerTerapeutas() {
  try {
    const { getHorariosParaCalendar } = require("./sheets-crm");
    const fromCrm = await getHorariosParaCalendar();
    if (fromCrm?.length) return fromCrm;
  } catch {}
  // Fallback: terapeutas con horario default
  return [{
    id: "default", nombre: "Citrino", color: "#5a7a5a",
    horarios: HORARIOS_DEFAULT, activa: true,
  }];
}

// ─── DISPONIBILIDAD ───────────────────────────────────────────
// Genera slots libres para los próximos DIAS_A_MOSTRAR días
// Cada terapeuta puede atender simultáneamente (columnas paralelas)
async function getDisponibilidad(diasDesdeHoy = 0) {
  const ahora = Date.now();
  if (diasDesdeHoy === 0 && _slotsCache && (ahora - _slotsCacheTs) < TTL) {
    return _slotsCache;
  }

  const [sesiones, terapeutas] = await Promise.all([
    _leerSesiones(),
    _leerTerapeutas(),
  ]);

  // Sesiones ocupadas (estado != cancelado)
  const ocupadas = sesiones
    .filter(f => f[COL.ESTADO] !== "cancelado" && f[COL.FECHA])
    .map(f => ({
      inicio: new Date(f[COL.FECHA]),
      fin:    f[COL.FECHA_FIN] ? new Date(f[COL.FECHA_FIN]) : new Date(new Date(f[COL.FECHA]).getTime() + DURACION_MIN * 60000),
      terapeuta: (f[COL.TERAPEUTA] || "").toLowerCase(),
    }));

  const ahoraMVD = toMVD(new Date());
  const slots = [];

  for (const ter of terapeutas.filter(t => t.activa !== false && t.activa !== "no")) {
    const horarios = ter.horarios || HORARIOS_DEFAULT;

    for (let d = diasDesdeHoy; d < diasDesdeHoy + DIAS_A_MOSTRAR; d++) {
      const fecha = new Date(ahoraMVD);
      fecha.setDate(fecha.getDate() + d);
      const diaSemana = fecha.getDay();
      const horario = typeof horarios === "object" && !Array.isArray(horarios)
        ? horarios[diaSemana]
        : null;
      if (!horario) continue;

      const fechaStr = fecha.toLocaleDateString("en-CA", { timeZone: TIMEZONE }); // YYYY-MM-DD

      for (const franja of (horario.franjas || [])) {
        let h = franja.inicio;
        while (h + DURACION_MIN / 60 <= franja.fin) {
          const inicioISO = buildISO(fechaStr, h);
          const finISO   = buildISO(fechaStr, h + DURACION_MIN / 60);
          const inicioDate = new Date(inicioISO);
          const finDate    = new Date(finISO);

          // No mostrar slots pasados
          if (inicioDate <= new Date()) { h += DURACION_MIN / 60; continue; }

          // Chequear si está ocupado para ESTE terapeuta
          const ocupado = ocupadas.some(o => {
            const mismoTer = !o.terapeuta || o.terapeuta === ter.nombre.toLowerCase();
            return mismoTer && inicioDate < o.fin && finDate > o.inicio;
          });

          if (!ocupado) {
            slots.push({
              fecha: fechaStr,
              fechaLabel: formatFecha(fechaStr),
              horaInicio: floatToHHMM(h),
              horaFin:    floatToHHMM(h + DURACION_MIN / 60),
              label: `${formatFecha(fechaStr)} a las ${floatToHHMM(h)} con ${ter.nombre}`,
              inicioISO,
              finISO,
              terapeutaId:     ter.id,
              terapeutaNombre: ter.nombre,
              terapeutaColor:  ter.color || "#5a7a5a",
            });
          }

          h += DURACION_MIN / 60;
        }
      }
    }
  }

  // Ordenar por fecha/hora
  slots.sort((a, b) => a.inicioISO.localeCompare(b.inicioISO));

  if (diasDesdeHoy === 0) {
    _slotsCache = slots;
    _slotsCacheTs = ahora;
  }
  return slots;
}

// Cache de slots independiente
let _slotsCache = null;
let _slotsCacheTs = 0;

function invalidarCacheSlots() {
  _slotsCache = null;
  _slotsCacheTs = 0;
  _invalidarCache();
}

// ─── FORMATEAR DISPONIBILIDAD para el cliente ─────────────────
function formatearDisponibilidad(slots) {
  if (!slots?.length) {
    return "No tengo turnos disponibles en los próximos 7 días 😔\n¿Querés que busquemos para más adelante?";
  }

  const terapeutasUnicos = [...new Set(slots.map(s => s.terapeutaNombre).filter(Boolean))];
  const hayMultiples = terapeutasUnicos.length > 1;

  // Agrupar por fecha
  const porFecha = {};
  for (const slot of slots) {
    if (!porFecha[slot.fecha]) {
      porFecha[slot.fecha] = { label: slot.fechaLabel, terapeutas: {} };
    }
    const t = slot.terapeutaNombre || "Citrino";
    if (!porFecha[slot.fecha].terapeutas[t]) porFecha[slot.fecha].terapeutas[t] = [];
    if (!porFecha[slot.fecha].terapeutas[t].includes(slot.horaInicio)) {
      porFecha[slot.fecha].terapeutas[t].push(slot.horaInicio);
    }
  }

  let texto = "📅 *Turnos disponibles:*\n\n";
  for (const [, info] of Object.entries(porFecha)) {
    const cap = info.label.charAt(0).toUpperCase() + info.label.slice(1);
    texto += `*${cap}*\n`;
    if (hayMultiples) {
      for (const [terNombre, horarios] of Object.entries(info.terapeutas)) {
        texto += `_${terNombre}_: ${horarios.map(h => `${h}hs`).join(", ")}\n`;
      }
    } else {
      const horarios = Object.values(info.terapeutas).flat();
      texto += horarios.map(h => `• ${h} hs`).join("\n");
    }
    texto += "\n\n";
  }
  return (texto + "¿Cuál te queda mejor?").trim();
}

// ─── CREAR TURNO ──────────────────────────────────────────────
async function crearTurno({ nombre, telefono, servicio, slot, notas = "", terapeutaId = null }) {
  const api = await getSheets();
  const id  = generateId();

  const terNombre = slot?.terapeutaNombre || terapeutaId || "Citrino";

  const fila = [
    id,                          // A: ID_Sesion
    slot.inicioISO,              // B: Fecha (ISO)
    nombre || "",                // C: Cliente
    servicio || "",              // D: Tratamiento
    terNombre,                   // E: Terapeuta
    telefono || "",              // F: ID_Cliente
    500,                         // G: Monto_Terapeuta (default)
    notas || "",                 // H: Observaciones
    slot.finISO,                 // I: Fecha_Fin (ISO)
    "pendiente",                 // J: Estado
  ];

  await conRetry(
    () => api.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_SESIONES}!A:J`,
      valueInputOption: "USER_ENTERED",
      resource: { values: [fila] },
    }),
    { nombre: "Sheets - crearTurno", intentos: 3 }
  );

  invalidarCacheSlots();

  // Devuelve objeto compatible con el que devolvía Google Calendar
  return {
    id,
    terapeutaId: slot?.terapeutaId || terapeutaId || "default",
    terapeutaNombre: terNombre,
    inicio: slot.inicioISO,
    fin:    slot.finISO,
  };
}

// ─── CANCELAR TURNO ───────────────────────────────────────────
async function cancelarTurno(eventId) {
  const sesiones = await _leerSesiones();
  const idx = sesiones.findIndex(f => f[COL.ID_SESION] === eventId);
  if (idx === -1) return false;

  const api = await getSheets();
  const row = idx + 2; // +1 header, +1 1-based

  await conRetry(
    () => api.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_SESIONES}!J${row}`,
      valueInputOption: "RAW",
      resource: { values: [["cancelado"]] },
    }),
    { nombre: "Sheets - cancelarTurno", intentos: 3 }
  );

  invalidarCacheSlots();
  return true;
}

// ─── MARCAR ASISTENCIA ────────────────────────────────────────
async function marcarAsistencia(eventId, estado = "vino") {
  const sesiones = await _leerSesiones();
  const idx = sesiones.findIndex(f => f[COL.ID_SESION] === eventId);
  if (idx === -1) return false;

  const api = await getSheets();
  const row = idx + 2;

  await conRetry(
    () => api.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_SESIONES}!J${row}`,
      valueInputOption: "RAW",
      resource: { values: [[estado]] },
    }),
    { nombre: "Sheets - marcarAsistencia", intentos: 3 }
  );

  _invalidarCache();
  return true;
}

// ─── BUSCAR TURNO DE UN CLIENTE ───────────────────────────────
async function buscarTurnoCliente(telefono) {
  const sesiones = await _leerSesiones();
  const ahora = new Date();

  const futuros = sesiones
    .filter(f => {
      const telOk = f[COL.ID_CLIENTE] === telefono || f[COL.TELEFONO] === telefono;
      const noCanc = f[COL.ESTADO] !== "cancelado";
      const futuro = f[COL.FECHA] && new Date(f[COL.FECHA]) > ahora;
      return telOk && noCanc && futuro;
    })
    .sort((a, b) => new Date(a[COL.FECHA]) - new Date(b[COL.FECHA]));

  if (!futuros.length) return null;
  const f = futuros[0];
  return {
    id:        f[COL.ID_SESION],
    inicio:    f[COL.FECHA],
    fin:       f[COL.FECHA_FIN],
    terapeuta: f[COL.TERAPEUTA],
    servicio:  f[COL.TRATAMIENTO],
    estado:    f[COL.ESTADO],
  };
}

// ─── RESOLVER SLOT POR TEXTO ("lunes a las 10") ───────────────
// Primero busca match exacto; si no lo encuentra, devuelve el slot más cercano del mismo día.
// Esto evita errores cuando el bot ofrece "10:00" pero el slot real es "09:30" o "11:00".
async function resolverSlot(textoFecha, textoHora) {
  const slots = await getDisponibilidad();
  const diasNombres = ["domingo","lunes","martes","miércoles","jueves","viernes","sábado"];
  const texto = (textoFecha + " " + textoHora).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

  const horaMatch = texto.match(/(\d{1,2})(?::(\d{2}))?/);
  const horaStr = horaMatch
    ? `${String(horaMatch[1]).padStart(2, "0")}:${horaMatch[2] || "00"}`
    : null;
  const horaPedida = horaStr
    ? parseInt(horaMatch[1]) + parseInt(horaMatch[2] || 0) / 60
    : null;

  // Filtrar slots del día pedido (normaliza acentos para comparar)
  const slotsDelDia = slots.filter(slot => {
    const diaSlot = diasNombres[new Date(slot.fecha + "T12:00:00-03:00").getDay()]
      .normalize("NFD").replace(/[̀-ͯ]/g, "");
    return texto.includes(diaSlot) || texto.includes(slot.fecha);
  });

  if (!slotsDelDia.length) return null;

  // 1. Match exacto de hora
  if (horaStr) {
    const exacto = slotsDelDia.find(s => s.horaInicio === horaStr);
    if (exacto) return exacto;
  }

  // 2. Fallback: slot más cercano a la hora pedida en ese día
  if (horaPedida !== null) {
    return slotsDelDia.reduce((best, slot) => {
      const [h, m] = slot.horaInicio.split(":").map(Number);
      const slotH = h + m / 60;
      const [bh, bm] = best.horaInicio.split(":").map(Number);
      const bestH = bh + bm / 60;
      return Math.abs(slotH - horaPedida) < Math.abs(bestH - horaPedida) ? slot : best;
    });
  }

  // 3. Si no hay hora, devolver el primer slot disponible del día
  return slotsDelDia[0];
}

// ─── OBTENER EVENTOS PARA EL FRONTEND DE AGENDA ───────────────
// Devuelve todas las sesiones en el rango, con formato limpio
async function getEventosAgenda(desde, hasta) {
  const sesiones = await _leerSesiones(true); // siempre fresco para la agenda
  const desdeDate = desde ? new Date(desde) : new Date(Date.now() - 86400000);
  const hastaDate = hasta ? new Date(hasta) : new Date(Date.now() + 14 * 86400000);

  return sesiones
    .filter(f => {
      if (!f[COL.FECHA]) return false;
      const d = new Date(f[COL.FECHA]);
      return d >= desdeDate && d <= hastaDate;
    })
    .map(f => ({
      id:              f[COL.ID_SESION]       || "",
      titulo:          `${f[COL.CLIENTE] || "?"} — ${f[COL.TRATAMIENTO] || ""}`,
      inicio:          f[COL.FECHA]           || "",
      fin:             f[COL.FECHA_FIN]       || "",
      terapeuta:       f[COL.TERAPEUTA]       || "",
      clienteNombre:   f[COL.CLIENTE]         || "",
      clienteTelefono: f[COL.ID_CLIENTE]      || "",  // alias para compatibilidad
      clienteServicio: f[COL.TRATAMIENTO]     || "",  // alias para compatibilidad
      clienteId:       f[COL.ID_CLIENTE]      || "",
      servicio:        f[COL.TRATAMIENTO]     || "",
      monto:           f[COL.MONTO_TERAPEUTA] || 500,
      notas:           f[COL.OBSERVACIONES]   || "",
      estado:          f[COL.ESTADO]          || "confirmado",
    }))
    .sort((a, b) => a.inicio.localeCompare(b.inicio));
}

// ─── TURNOS DEL DÍA (para resumen diario del scheduler) ───────
async function getTurnosDelDia(fecha) {
  const sesiones = await _leerSesiones();
  const diaStr = fecha
    ? new Date(fecha).toLocaleDateString("en-CA", { timeZone: TIMEZONE })
    : new Date().toLocaleDateString("en-CA", { timeZone: TIMEZONE });

  return sesiones
    .filter(f => f[COL.FECHA]?.startsWith(diaStr) && f[COL.ESTADO] !== "cancelado")
    .map(f => ({
      id:        f[COL.ID_SESION],
      cliente:   f[COL.CLIENTE],
      clienteId: f[COL.ID_CLIENTE],
      hora:      f[COL.FECHA] ? new Date(f[COL.FECHA]).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", timeZone: TIMEZONE }) : "?",
      servicio:  f[COL.TRATAMIENTO],
      terapeuta: f[COL.TERAPEUTA],
      estado:    f[COL.ESTADO],
    }))
    .sort((a, b) => a.hora.localeCompare(b.hora));
}

// ─── DISPONIBILIDAD TODOS (alias para compatibilidad) ─────────
async function getDisponibilidadTodos(diasDesdeHoy = 0) {
  return getDisponibilidad(diasDesdeHoy);
}

// ─── COMPATIBILIDAD — ya no se usa Google Calendar ────────────
const HORARIOS = HORARIOS_DEFAULT;
const TERAPEUTAS = [
  { id: "default", nombre: "Citrino", color: "#5a7a5a", horarios: HORARIOS_DEFAULT },
];

module.exports = {
  getDisponibilidad,
  getDisponibilidadTodos,
  formatearDisponibilidad,
  crearTurno,
  cancelarTurno,
  marcarAsistencia,
  buscarTurnoCliente,
  resolverSlot,
  getEventosAgenda,
  getTurnosDelDia,
  invalidarCacheSlots,
  HORARIOS,
  TERAPEUTAS,
};
