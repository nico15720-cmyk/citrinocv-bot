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

// ─── Lock de reserva simultánea ───────────────────────────────
// Previene que dos clientas reserven el mismo slot si mandan mensaje al mismo tiempo
const _slotsEnProceso = new Set(); // key: "YYYY-MM-DDTHH:MM:SS|terapeutaId"
const DURACION_MIN  = 60;   // duración de cada sesión en minutos (1 hora exacta)
const SLOT_CADA_MIN = 30;   // paso entre slots ofrecidos (cada 30 min: 8:30, 9:00, 9:30…)
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
// Primera sesión: 8:30  |  Última sesión empieza: 19:30 (termina 20:30)
// Horarios válidos: solo horas exactas o medias (8:30, 9:00, 9:30 … 19:30)
const HORARIOS_DEFAULT = {
  0: { dia: "Domingo",   franjas: [] },                               // cerrado
  1: { dia: "Lunes",     franjas: [{ inicio: 8.5, fin: 20.5 }] },
  2: { dia: "Martes",    franjas: [{ inicio: 8.5, fin: 20.5 }] },
  3: { dia: "Miércoles", franjas: [{ inicio: 8.5, fin: 20.5 }] },
  4: { dia: "Jueves",    franjas: [{ inicio: 8.5, fin: 20.5 }] },
  5: { dia: "Viernes",   franjas: [{ inicio: 8.5, fin: 20.5 }] },
  6: { dia: "Sábado",    franjas: [{ inicio: 9.0, fin: 14.0 }] },   // 9:00–13:00 (último slot empieza 13:00, termina 14:00)
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
  if (!hhmm || typeof hhmm !== "string") return NaN;
  const parts = hhmm.split(":");
  const h = Number(parts[0]);
  const m = Number(parts[1] ?? 0);
  if (isNaN(h)) return NaN;
  return h + (isNaN(m) ? 0 : m) / 60;
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

  // Sesiones ocupadas (estado != cancelado) — incluye ghost para bloquear slots
  const ocupadas = sesiones
    .filter(f => f[COL.ESTADO] !== "cancelado" && f[COL.FECHA])
    .map(f => ({
      inicio:    new Date(f[COL.FECHA]),
      fin:       f[COL.FECHA_FIN] ? new Date(f[COL.FECHA_FIN]) : new Date(new Date(f[COL.FECHA]).getTime() + DURACION_MIN * 60000),
      terapeuta: (f[COL.TERAPEUTA] || "").toLowerCase(),
      estado:    f[COL.ESTADO] || "pendiente",
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
        const durH  = DURACION_MIN  / 60; // 1.0
        const stepH = SLOT_CADA_MIN / 60; // 0.5 → slots cada 30 min
        while (h + durH <= franja.fin) {
          const inicioISO = buildISO(fechaStr, h);
          const finISO   = buildISO(fechaStr, h + durH);
          const inicioDate = new Date(inicioISO);
          const finDate    = new Date(finISO);

          // No mostrar slots pasados
          if (inicioDate <= new Date()) { h += stepH; continue; }

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
              horaFin:    floatToHHMM(h + durH),
              label: `${formatFecha(fechaStr)} a las ${floatToHHMM(h)} con ${ter.nombre}`,
              inicioISO,
              finISO,
              terapeutaId:     ter.id,
              terapeutaNombre: ter.nombre,
              terapeutaColor:  ter.color || "#5a7a5a",
            });
          }

          h += stepH;
        }
      }
    }
  }

  // Aplicar clustering: solo ofrecer slots próximos a sesiones ya agendadas ese día
  const slotsCluster = filtrarSlotsAgrupados(slots, ocupadas);
  slotsCluster.sort((a, b) => a.inicioISO.localeCompare(b.inicioISO));

  if (diasDesdeHoy === 0) {
    _slotsCache = slotsCluster;
    _slotsCacheTs = ahora;
  }
  return slotsCluster;
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
// momento: null | "mañana" | "tarde"
// "mañana" = slots antes de 13:00 | "tarde" = slots 13:00 en adelante
function formatearDisponibilidad(slots, maxSlots = 3, momento = null) {
  // ── Filtrar por momento del día ───────────────────────────────
  let slotsFiltrados = slots || [];
  if (momento) {
    const esTarde = momento === "tarde";
    slotsFiltrados = slotsFiltrados.filter(s => {
      const h = parseInt(s.horaInicio.split(":")[0], 10);
      return esTarde ? h >= 13 : h < 13;
    });
  }

  if (!slotsFiltrados.length) {
    // Sin slots para el momento pedido — sugerir alternativa útil
    if (momento === "tarde") {
      // Buscar el primer día con tarde entre todos los slots originales
      const conTarde = (slots || []).filter(s => parseInt(s.horaInicio.split(":")[0], 10) >= 13);
      if (conTarde.length) {
        const diasNombre = ["domingo","lunes","martes","miércoles","jueves","viernes","sábado"];
        const dias = [...new Set(conTarde.map(s => {
          const d = new Date(s.fecha + "T12:00:00-03:00");
          return { fecha: s.fecha, dia: diasNombre[d.getDay()], hora: s.horaInicio };
        }))];
        const primero = dias[0];
        return `Para la tarde, el próximo turno disponible es el *${primero.dia}* a las ${primero.hora} hs. ¿Le queda bien?`;
      }
      return "Para la tarde no tenemos disponible esta semana. ¿Algún horario de la mañana le quedaría?";
    }
    if (momento === "mañana") {
      return "Para la mañana no tenemos disponible ese día. ¿Algún horario de la tarde le quedaría?";
    }
    return "No tenemos turnos disponibles en los próximos 7 días.\n\nSi quiere le buscamos para la semana que viene, solo dígame qué día le queda mejor.";
  }

  // ── Agrupar por fecha ─────────────────────────────────────────
  const porFecha = {};
  for (const slot of slotsFiltrados) {
    if (!porFecha[slot.fecha]) porFecha[slot.fecha] = { label: slot.fechaLabel, slots: [] };
    const ya = porFecha[slot.fecha].slots.find(
      s => s.hora === slot.horaInicio && s.ter === (slot.terapeutaNombre || "Citrino")
    );
    if (!ya) porFecha[slot.fecha].slots.push({ hora: slot.horaInicio, ter: slot.terapeutaNombre || "Citrino" });
  }

  const fechas = Object.keys(porFecha);
  const primerDia = fechas[0];
  const info = porFecha[primerDia];

  // Con filtro de momento mostramos hasta 5 opciones (la clienta ya dijo mañana/tarde)
  const limite = momento ? Math.max(maxSlots, 5) : maxSlots;
  const slotsDelDia = info.slots.slice(0, limite);

  const terapeutasUnicos = [...new Set(slotsDelDia.map(s => s.ter))];
  const hayMultiples = terapeutasUnicos.length > 1;

  const hoyStr = new Date().toLocaleDateString("sv-SE", { timeZone: TIMEZONE });
  const mananaStr = new Date(Date.now() + 86400000).toLocaleDateString("sv-SE", { timeZone: TIMEZONE });
  const esHoy = primerDia === hoyStr;
  const esManana = primerDia === mananaStr;
  const cap = info.label.charAt(0).toUpperCase() + info.label.slice(1);
  let texto;
  if (esHoy) {
    texto = `Para hoy tenemos disponible:\n`;
  } else if (esManana) {
    texto = `Para mañana tenemos disponible:\n`;
  } else {
    texto = `Tenemos disponible el *${cap}*:\n`;
  }

  if (hayMultiples) {
    for (const ter of terapeutasUnicos) {
      const horas = slotsDelDia.filter(s => s.ter === ter).map(s => `${s.hora} hs`).join(", ");
      texto += `_${ter}_: ${horas}\n`;
    }
  } else {
    texto += slotsDelDia.map(s => `• ${s.hora} hs`).join("\n");
  }

  // Mencionar otros días si los hay
  if (fechas.length > 1) {
    const otrosDias = fechas.slice(1, 3).map(f => {
      if (f === hoyStr) return "hoy";
      if (f === mananaStr) return "mañana";
      return porFecha[f].label;
    }).join(" y ");
    texto += `\n\n_(Si ninguno le queda bien, también tenemos el ${otrosDias})_`;
  }

  return (texto + "\n\n¿Cuál le queda mejor?").trim();
}

// ─── CREAR TURNO ──────────────────────────────────────────────
async function crearTurno({ nombre, telefono, servicio, slot, notas = "", terapeutaId = null }) {
  // LOCK ANTI-RESERVA-SIMULTÁNEA: bloquear el slot mientras se procesa
  const lockKey = `${slot.inicioISO}|${slot.terapeutaId || terapeutaId || "default"}`;
  if (_slotsEnProceso.has(lockKey)) {
    console.log(`🔒 crearTurno: slot ${lockKey} ya está siendo reservado — rechazando concurrencia`);
    throw new Error("SLOT_EN_PROCESO");
  }
  _slotsEnProceso.add(lockKey);

  try {
  // ANTI-DUPLICADO: antes de insertar, verificar que no exista ya
  // la misma sesión (mismo slot + mismo cliente). Evita que un retry
  // o una doble llamada del bot creen dos filas idénticas.
  const existentes = await _leerSesiones(true); // forzar lectura fresca
  const telNorm = (telefono || "").replace(/\D/g, "").slice(-9);
  const yaExiste = existentes.find(f => {
    if (f[COL.ESTADO] === "cancelado") return false;
    if (f[COL.FECHA] !== slot.inicioISO) return false;
    // Match por teléfono O por nombre (case-insensitive)
    const telFila = (f[COL.ID_CLIENTE] || "").replace(/\D/g, "").slice(-9);
    const nomFila = (f[COL.CLIENTE] || "").toLowerCase().trim();
    const nomBusc = (nombre || "").toLowerCase().trim();
    const matchTel = telNorm && telFila && telNorm === telFila;
    const matchNom = nomBusc && nomFila && nomFila.includes(nomBusc.split(" ")[0]);
    return matchTel || matchNom;
  });

  if (yaExiste) {
    console.log(`⚠️ crearTurno: sesión duplicada detectada para "${nombre}" a las ${slot.inicioISO} — usando la existente`);
    const terExist = yaExiste[COL.TERAPEUTA] || terapeutaId || "Citrino";
    return {
      id:              yaExiste[COL.ID_SESION],
      terapeutaId:     terExist,
      terapeutaNombre: terExist,
      inicio:          yaExiste[COL.FECHA],
      fin:             yaExiste[COL.FECHA_FIN],
      _duplicate:      true,
    };
  }

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
    slot.finISO || "",           // I: Fecha_Fin (ISO)
    "pendiente",                 // J: Estado
  ];

  // intentos: 1 porque append NO es idempotente — el retry crea filas duplicadas
  await conRetry(
    () => api.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_SESIONES}!A:J`,
      valueInputOption: "USER_ENTERED",
      resource: { values: [fila] },
    }),
    { nombre: "Sheets - crearTurno", intentos: 1 }
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
  } finally {
    // Liberar lock siempre, incluso si hubo error
    _slotsEnProceso.delete(lockKey);
  }
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
  // Normalizar para comparar tanto "5989..." como "+5989..." como "989..."
  const telNorm = (telefono || "").replace(/\D/g, "").slice(-9);

  const futuros = sesiones
    .filter(f => {
      // Match por últimos 9 dígitos para tolerar prefijos internacionales distintos
      const telFila = (f[COL.ID_CLIENTE] || "").replace(/\D/g, "").slice(-9);
      const telOk = telFila && telNorm && telFila === telNorm;
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

// ─── CLUSTERING: filtrar slots demasiado alejados de sesiones existentes ──
// ─── REGLAS DE AGENDA — filtrar slots según las 5 reglas de Citrino ──────────
//
// Regla 2: Entre el fin de una sesión y el inicio de la siguiente ≤ 2.5 horas.
// Regla 3: Agendar una sesión nueva no puede CREAR un hueco > 2.5h entre sesiones.
// Regla 4: Se puede expandir hacia atrás siempre que el hueco resultante sea ≤ 2.5h.
// Las reservas fantasma (ghost) bloquean el slot pero NO anclan el clúster.
//
// Lógica: para cada slot candidato, con sesiones existentes del día ordenadas
// por hora de inicio, se valida:
//   - gap entre fin de sesión anterior y este slot start ≤ maxGapHoras
//   - gap entre fin de este slot y el inicio de la siguiente sesión ≤ maxGapHoras
// Si no hay sesión antes/después, el lado libre no genera restricción.
// Si el día está vacío → todos los slots son válidos.
function filtrarSlotsAgrupados(slotsLibres, ocupadasConEstado, maxGapHoras = 2.5) {
  const durH = DURACION_MIN / 60; // 1.0h

  // Agrupar sesiones reales (no ghost, no canceladas) por día → array de {start, end} en horas
  const sesionesPorDia = {};
  for (const o of ocupadasConEstado) {
    if (["cancelado", "ghost"].includes(o.estado)) continue;
    const diaKey = o.inicio.toLocaleDateString("en-CA", { timeZone: TIMEZONE });
    if (!sesionesPorDia[diaKey]) sesionesPorDia[diaKey] = [];
    const mvd   = toMVD(o.inicio);
    const start = mvd.getHours() + mvd.getMinutes() / 60;
    sesionesPorDia[diaKey].push(start);
  }
  // Ordenar cada día
  for (const dia of Object.keys(sesionesPorDia)) {
    sesionesPorDia[dia].sort((a, b) => a - b);
  }

  return slotsLibres.filter(slot => {
    const sesiones = sesionesPorDia[slot.fecha];
    // Día sin sesiones reales → cualquier slot es válido (sin restricción)
    if (!sesiones?.length) return true;

    const slotStart = horaToFloat(slot.horaInicio);
    const slotEnd   = slotStart + durH;

    // Sesiones que terminan antes de que empiece este slot (prev)
    const prevStarts = sesiones.filter(s => s + durH <= slotStart);
    // Sesiones que empiezan después de que termina este slot (next)
    const nextStarts = sesiones.filter(s => s >= slotEnd);

    // ── Reglas 2 y 4: gap entre sesión anterior y este slot ──────────────
    if (prevStarts.length > 0) {
      const lastPrevEnd = prevStarts[prevStarts.length - 1] + durH;
      if (slotStart - lastPrevEnd > maxGapHoras) return false;
    }

    // ── Regla 3: gap entre este slot y la próxima sesión ─────────────────
    if (nextStarts.length > 0) {
      const firstNextStart = nextStarts[0];
      if (firstNextStart - slotEnd > maxGapHoras) return false;
    }

    // Si hay sesiones pero ninguna antes ni después → el slot se solapa (no debería pasar,
    // ya fue filtrado como "ocupado"). Permitir para no bloquear erróneamente.
    return true;
  });
}

// ─── DETECTAR PATRONES de asistencia semanal recurrente ───────
// Devuelve clientes que vinieron 3+ semanas consecutivas al mismo día/hora
async function detectarPatrones() {
  const sesiones = await _leerSesiones();
  const ahora = new Date();

  // Solo sesiones pasadas no canceladas y no fantasma
  const pasadas = sesiones.filter(f =>
    f[COL.FECHA] &&
    new Date(f[COL.FECHA]) < ahora &&
    !["cancelado", "ghost"].includes(f[COL.ESTADO]) &&
    f[COL.ID_CLIENTE]
  );

  // Agrupar por clienteId + diaSemana + hora (redondeada a 30 min)
  const grupos = {};
  for (const s of pasadas) {
    const mvd = toMVD(new Date(s[COL.FECHA]));
    const dia = mvd.getDay();
    const hora = Math.round((mvd.getHours() + mvd.getMinutes() / 60) * 2) / 2;
    const clienteId = s[COL.ID_CLIENTE];
    const key = `${clienteId}|${dia}|${hora}`;
    if (!grupos[key]) {
      grupos[key] = { clienteId, cliente: s[COL.CLIENTE] || "", dia, hora, fechas: [] };
    }
    grupos[key].fechas.push(new Date(s[COL.FECHA]));
  }

  const patrones = [];
  for (const [, g] of Object.entries(grupos)) {
    if (g.fechas.length < 3) continue;
    g.fechas.sort((a, b) => a - b);

    // Buscar racha de 3+ semanas consecutivas (gap 6-8 días)
    let racha = 1;
    let ultimaEnRacha = g.fechas[0];
    for (let i = 1; i < g.fechas.length; i++) {
      const diffDias = (g.fechas[i] - g.fechas[i - 1]) / 86400000;
      if (diffDias >= 6 && diffDias <= 8) {
        racha++;
        ultimaEnRacha = g.fechas[i];
        if (racha >= 3) {
          // Solo patrones activos (última sesión hace 30 días o menos)
          const diasDesdeUltima = (ahora - ultimaEnRacha) / 86400000;
          if (diasDesdeUltima <= 30) {
            patrones.push({
              clienteId:  g.clienteId,
              cliente:    g.cliente,
              diaSemana:  g.dia,
              hora:       g.hora,
              ultimaFecha: ultimaEnRacha,
            });
          }
          break;
        }
      } else {
        racha = 1;
        ultimaEnRacha = g.fechas[i];
      }
    }
  }
  return patrones;
}

// ─── CREAR RESERVAS FANTASMA para patrones detectados ─────────
// Para cada patrón activo, crea hasta maxSemanas ghost entries en el futuro.
async function crearReservasFantasma(maxSemanas = 2) {
  const [patrones, sesiones] = await Promise.all([
    detectarPatrones(),
    _leerSesiones(),
  ]);
  if (!patrones.length) return 0;

  const api = await getSheets();
  const ahora = new Date();
  let creados = 0;

  for (const patron of patrones) {
    for (let semana = 1; semana <= maxSemanas; semana++) {
      // Siguiente ocurrencia = última fecha + semana * 7 días
      const fechaGhost = new Date(patron.ultimaFecha);
      fechaGhost.setDate(fechaGhost.getDate() + semana * 7);
      if (fechaGhost <= ahora) continue; // ya pasó

      const fechaStr = fechaGhost.toLocaleDateString("en-CA", { timeZone: TIMEZONE });
      const inicioISO = buildISO(fechaStr, patron.hora);
      const finISO   = buildISO(fechaStr, patron.hora + DURACION_MIN / 60);

      // Evitar duplicados: ya existe turno de ese cliente ese día a esa hora
      const yaExiste = sesiones.some(f => {
        if (f[COL.ID_CLIENTE] !== patron.clienteId) return false;
        if (!f[COL.FECHA]?.startsWith(fechaStr)) return false;
        if (!["ghost", "pendiente", "confirmado"].includes(f[COL.ESTADO])) return false;
        const d = toMVD(new Date(f[COL.FECHA]));
        return Math.abs((d.getHours() + d.getMinutes() / 60) - patron.hora) < 0.5;
      });
      if (yaExiste) continue;

      const fila = [
        generateId(),          // A: ID_Sesion
        inicioISO,             // B: Fecha
        patron.cliente || patron.clienteId, // C: Cliente
        "ghost",               // D: Tratamiento (marcador)
        "",                    // E: Terapeuta
        patron.clienteId,      // F: ID_Cliente
        0,                     // G: Monto_Terapeuta
        "Reserva fantasma — patrón semanal automático", // H: Observaciones
        finISO,                // I: Fecha_Fin
        "ghost",               // J: Estado
      ];

      await conRetry(
        () => api.spreadsheets.values.append({
          spreadsheetId: SPREADSHEET_ID,
          range: `${SHEET_SESIONES}!A:J`,
          valueInputOption: "USER_ENTERED",
          resource: { values: [fila] },
        }),
        { nombre: "Sheets - crearGhost", intentos: 3 }
      );
      console.log(`👻 Ghost creado: ${patron.cliente} — ${fechaStr} ${floatToHHMM(patron.hora)}`);
      creados++;
    }
  }

  if (creados > 0) invalidarCacheSlots();
  return creados;
}

// ─── LIBERAR GHOST EXPIRADAS ──────────────────────────────────
// Cancela reservas fantasma cuya fecha ya pasó (el cliente no vino o no confirmó)
async function liberarGhostExpiradas() {
  const sesiones = await _leerSesiones();
  const ahora = new Date();
  const api = await getSheets();
  let liberadas = 0;

  for (let i = 0; i < sesiones.length; i++) {
    const f = sesiones[i];
    if (f[COL.ESTADO] !== "ghost") continue;
    if (!f[COL.FECHA]) continue;
    if (new Date(f[COL.FECHA]) >= ahora) continue; // todavía futura

    const row = i + 2; // +1 header, +1 1-based
    await conRetry(
      () => api.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_SESIONES}!J${row}`,
        valueInputOption: "RAW",
        resource: { values: [["cancelado"]] },
      }),
      { nombre: "Sheets - liberarGhost", intentos: 2 }
    ).catch(() => {});
    liberadas++;
  }

  if (liberadas > 0) {
    invalidarCacheSlots();
    console.log(`👻 ${liberadas} ghost(s) expirada(s) liberada(s)`);
  }
  return liberadas;
}

// ─── ACTUALIZAR ESTADO DE UN GHOST BOOKING ────────────────────
// Convierte el ghost a "confirmado" o "cancelado" cuando el cliente responde.
// Busca por ID_CLIENTE + fecha (YYYY-MM-DD). Devuelve true si encontró y actualizó.
async function actualizarEstadoGhost(clienteId, fechaISO, nuevoEstado) {
  if (!clienteId || !fechaISO) return false;
  const sesiones = await _leerSesiones();
  const api = await getSheets();
  const fechaStr = fechaISO.split("T")[0]; // YYYY-MM-DD

  for (let i = 0; i < sesiones.length; i++) {
    const f = sesiones[i];
    if (f[COL.ESTADO] !== "ghost") continue;
    if (f[COL.ID_CLIENTE] !== clienteId) continue;
    if (!f[COL.FECHA]?.startsWith(fechaStr)) continue;

    const row = i + 2; // +1 cabecera, +1 índice 1-based
    await conRetry(
      () => api.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_SESIONES}!J${row}`,
        valueInputOption: "RAW",
        resource: { values: [[nuevoEstado]] },
      }),
      { nombre: "Sheets - actualizarEstadoGhost", intentos: 2 }
    );
    invalidarCacheSlots();
    console.log(`👻 Ghost ${clienteId} → ${nuevoEstado} (${fechaStr})`);
    return true;
  }
  return false;
}

// ─── PRÓXIMA FECHA DE UN DÍA DE SEMANA ───────────────────────
// diaSemana: 0=Dom...6=Sab, semanaOffset: 1=próxima, 2=siguiente, etc.
function proximaFechaDiaSemana(diaSemana, semanaOffset = 1) {
  const hoy = toMVD(new Date());
  const diasHastaProximo = ((diaSemana - hoy.getDay() + 7) % 7) || 7;
  const fecha = new Date(hoy);
  fecha.setDate(hoy.getDate() + diasHastaProximo + (semanaOffset - 1) * 7);
  return fecha;
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
  // clustering + ghost bookings
  filtrarSlotsAgrupados,
  detectarPatrones,
  crearReservasFantasma,
  liberarGhostExpiradas,
  actualizarEstadoGhost,
  proximaFechaDiaSemana,
  HORARIOS,
  TERAPEUTAS,
};
