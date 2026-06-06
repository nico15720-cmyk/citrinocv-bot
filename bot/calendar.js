// ============================================================
// CITRINO BOT — Google Calendar Integration
// Fase 1: disponibilidad, agendamiento, cancelación
// ============================================================

const { calendar: googleCalendar } = require("@googleapis/calendar");
const { GoogleAuth } = require("google-auth-library");
const { conRetry } = require("./utils");

// ============================================================
// CONFIGURACIÓN DE HORARIOS DE LA TERAPEUTA
// Ajustá estos horarios según los de Citrino
// ============================================================
// Horarios de Citrino: lunes a viernes 8:00-19:00, sábados hasta el mediodía
// "fin" = hora máxima de inicio de slot (fin: 18 → último slot a las 16:30, termina 18:00)
// Para incluir el slot de 18:00 (termina 19:30 = última clienta), cambiá a fin: 19.5
const HORARIOS = {
  1: { dia: "Lunes",     franjas: [{ inicio: 8, fin: 18 }] },
  2: { dia: "Martes",    franjas: [{ inicio: 8, fin: 18 }] },
  3: { dia: "Miércoles", franjas: [{ inicio: 8, fin: 18 }] },
  4: { dia: "Jueves",    franjas: [{ inicio: 8, fin: 18 }] },
  5: { dia: "Viernes",   franjas: [{ inicio: 8, fin: 18 }] },
  6: { dia: "Sábado",    franjas: [{ inicio: 8, fin: 12 }] },
  // 0 = domingo: sin horario
};

const DURACION_SESION_MIN = 90;          // 90 minutos (sesión + limpieza)
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || "primary";
const TIMEZONE = "America/Montevideo";
const DIAS_A_MOSTRAR = 7;               // cuántos días hacia adelante buscar

// ============================================================
// CONFIGURACIÓN DE TERAPEUTAS
// Expandible: agregar más terapeutas con su calendar y horarios
// ============================================================
const TERAPEUTAS = [
  {
    id: "default",
    nombre: process.env.TERAPEUTA_NOMBRE || "Citrino",
    color: "#5a7a5a",
    colorBadge: "verde",
    calendarId: CALENDAR_ID,
    horarios: HORARIOS,
  },
  // Ejemplo para agregar una segunda terapeuta:
  // {
  //   id: "ana",
  //   nombre: "Ana",
  //   color: "#2980b9",
  //   colorBadge: "azul",
  //   calendarId: process.env.GOOGLE_CALENDAR_ID_ANA || CALENDAR_ID,
  //   horarios: { 1: { dia: "Lunes", franjas: [{ inicio: 14, fin: 19 }] }, ... }
  // },
];

// ============================================================
// AUTH — Service Account
// ============================================================
function getAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  return new GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/calendar"],
  });
}

function getCalendar() {
  const auth = getAuth();
  return googleCalendar({ version: "v3", auth });
}

// ============================================================
// HELPERS DE TIEMPO
// ============================================================
function toMontevideoDate(date) {
  return new Date(date.toLocaleString("en-US", { timeZone: TIMEZONE }));
}

function slotToISO(dateStr, hora) {
  // dateStr: "2024-12-30", hora: 9.5 → 9:30
  const hh = Math.floor(hora);
  const mm = (hora % 1) * 60;
  const pad = (n) => String(n).padStart(2, "0");
  return `${dateStr}T${pad(hh)}:${pad(mm)}:00`;
}

function isoToLocalTime(isoStr) {
  const d = new Date(isoStr);
  return d.toLocaleTimeString("es-UY", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TIMEZONE,
  });
}

function formatFecha(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("es-UY", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: TIMEZONE,
  });
}

// ============================================================
// OBTENER EVENTOS OCUPADOS — por calendar ID específico
// ============================================================
async function getEventosOcupados(desde, hasta, calendarId = CALENDAR_ID) {
  const calendar = getCalendar();
  const res = await conRetry(
    () => calendar.events.list({
      calendarId,
      timeMin: desde.toISOString(),
      timeMax: hasta.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
    }),
    { nombre: "Google Calendar - listar eventos", intentos: 3 }
  );
  return res.data.items || [];
}

// ============================================================
// GENERAR SLOTS PARA UN TERAPEUTA ESPECÍFICO
// Verifica solo el calendario de ESE terapeuta
// ============================================================
async function getSlotsParaTerapeuta(terapeutaConfig, ahora, desde, hasta) {
  const calendarId = terapeutaConfig.calendarId || CALENDAR_ID;
  const horariosTer = terapeutaConfig.horarios || HORARIOS;

  const eventosOcupados = await getEventosOcupados(desde, hasta, calendarId);
  const slots = [];

  for (let d = 0; d < DIAS_A_MOSTRAR; d++) {
    const fecha = new Date(desde);
    fecha.setDate(fecha.getDate() + d);
    const diaSemana = fecha.getDay();
    const horario = horariosTer[diaSemana];
    if (!horario) continue;

    const fechaStr = fecha.toISOString().split("T")[0];

    for (const franja of horario.franjas) {
      let hora = franja.inicio;
      while (hora + DURACION_SESION_MIN / 60 <= franja.fin) {
        const inicioISO = slotToISO(fechaStr, hora);
        const finISO = slotToISO(fechaStr, hora + DURACION_SESION_MIN / 60);
        const inicioDate = new Date(inicioISO + ":00-03:00");
        const finDate = new Date(finISO + ":00-03:00");

        if (inicioDate <= ahora) { hora += DURACION_SESION_MIN / 60; continue; }

        // Verificar solapamiento SOLO con eventos de ESTE terapeuta
        const ocupado = eventosOcupados.some((ev) => {
          const evI = new Date(ev.start.dateTime || ev.start.date);
          const evF = new Date(ev.end.dateTime || ev.end.date);
          // Buffer de 0 min — dos terapeutas pueden empezar a la misma hora
          return inicioDate < evF && finDate > evI;
        });

        if (!ocupado) {
          const pad = (n) => String(n).padStart(2, "0");
          const hh = Math.floor(hora);
          const mm = (hora % 1) * 60;
          const hhFin = Math.floor(hora + DURACION_SESION_MIN / 60);
          const mmFin = ((hora + DURACION_SESION_MIN / 60) % 1) * 60;
          slots.push({
            fecha: fechaStr,
            fechaLabel: formatFecha(fechaStr),
            horaInicio: `${pad(hh)}:${pad(mm)}`,
            horaFin: `${pad(hhFin)}:${pad(mmFin)}`,
            label: `${formatFecha(fechaStr)} a las ${pad(hh)}:${pad(mm)} con ${terapeutaConfig.nombre}`,
            inicioISO: inicioISO + ":00-03:00",
            finISO: finISO + ":00-03:00",
            terapeutaId: terapeutaConfig.id,
            terapeutaNombre: terapeutaConfig.nombre,
            terapeutaColor: terapeutaConfig.color || "#5a7a5a",
          });
        }

        hora += DURACION_SESION_MIN / 60;
      }
    }
  }
  return slots;
}

// ============================================================
// DISPONIBILIDAD — para todos los terapeutas en paralelo
// Cada terapeuta puede tener alguien al mismo tiempo
// ============================================================
async function getDisponibilidadTodos(diasDesdeHoy = 0) {
  let terapeutasConfig = [];
  try {
    const { leerTerapeutas } = require("./terapeutas");
    terapeutasConfig = await leerTerapeutas();
  } catch {
    terapeutasConfig = TERAPEUTAS;
  }
  if (!terapeutasConfig.length) terapeutasConfig = TERAPEUTAS;

  const ahora = toMontevideoDate(new Date());
  const desde = new Date(ahora);
  desde.setDate(desde.getDate() + diasDesdeHoy);
  desde.setHours(0, 0, 0, 0);
  const hasta = new Date(desde);
  hasta.setDate(hasta.getDate() + DIAS_A_MOSTRAR);

  // Obtener slots de todos los terapeutas en paralelo
  const resultados = await Promise.all(
    terapeutasConfig.map(ter => getSlotsParaTerapeuta(ter, ahora, desde, hasta))
  );

  // Combinar y ordenar por fecha+hora
  const todos = resultados.flat().sort((a, b) => a.inicioISO.localeCompare(b.inicioISO));
  return todos;
}

// ============================================================
// CACHÉ DE SLOTS — se refresca cada 20 minutos
// Evita llamar a Google Calendar en cada mensaje
// ============================================================
let _slotsCache = null;
let _slotsCacheTs = 0;
const SLOTS_TTL = 20 * 60 * 1000; // 20 min

function invalidarCacheSlots() {
  _slotsCache = null;
  _slotsCacheTs = 0;
}

// Backward-compatible: getDisponibilidad retorna slots de todos los terapeutas
async function getDisponibilidad(diasDesdeHoy = 0) {
  const ahora = Date.now();
  if (diasDesdeHoy === 0 && _slotsCache && (ahora - _slotsCacheTs) < SLOTS_TTL) {
    return _slotsCache;
  }
  const slots = await getDisponibilidadTodos(diasDesdeHoy);
  if (diasDesdeHoy === 0) {
    _slotsCache = slots;
    _slotsCacheTs = ahora;
  }
  return slots;
}

// ============================================================
// FORMATEAR DISPONIBILIDAD PARA MOSTRAR AL CLIENTE
// Agrupa por fecha y terapeuta
// ============================================================
function formatearDisponibilidad(slots) {
  if (!slots.length) {
    return "No tengo turnos disponibles en los próximos 7 días. ¿Querés que miremos para más adelante?";
  }

  // Verificar si hay múltiples terapeutas
  const terapeutasUnicos = [...new Set(slots.map(s => s.terapeutaNombre).filter(Boolean))];
  const hayMultiples = terapeutasUnicos.length > 1;

  // Agrupar por fecha y terapeuta
  const porFecha = {};
  for (const slot of slots) {
    if (!porFecha[slot.fecha]) {
      porFecha[slot.fecha] = { label: slot.fechaLabel, terapeutas: {} };
    }
    const terNombre = slot.terapeutaNombre || "Citrino";
    if (!porFecha[slot.fecha].terapeutas[terNombre]) {
      porFecha[slot.fecha].terapeutas[terNombre] = [];
    }
    // Evitar duplicar la misma hora si ya está (puede pasar en casos edge)
    if (!porFecha[slot.fecha].terapeutas[terNombre].includes(slot.horaInicio)) {
      porFecha[slot.fecha].terapeutas[terNombre].push(slot.horaInicio);
    }
  }

  let texto = "📅 *Turnos disponibles:*\n\n";
  for (const [, info] of Object.entries(porFecha)) {
    texto += `*${info.label.charAt(0).toUpperCase() + info.label.slice(1)}*\n`;
    if (hayMultiples) {
      for (const [terNombre, horarios] of Object.entries(info.terapeutas)) {
        texto += `_${terNombre}_: ${horarios.map(h => `${h}hs`).join(", ")}\n`;
      }
    } else {
      const horarios = Object.values(info.terapeutas).flat();
      texto += horarios.map((h) => `• ${h} hs`).join("\n");
    }
    texto += "\n\n";
  }
  texto += "¿Cuál te queda mejor?";
  return texto.trim();
}

// ============================================================
// CREAR EVENTO EN GOOGLE CALENDAR
// terapeutaId: opcional — si se pasa, usa el calendar de ese terapeuta
// ============================================================
async function crearTurno({ nombre, telefono, servicio, slot, notas = "", terapeutaId = null }) {
  const calendar = getCalendar();

  // Resolver calendar ID del terapeuta
  let calendarId = slot?.terapeutaId ? null : CALENDAR_ID;
  const terIdFinal = terapeutaId || slot?.terapeutaId || null;

  if (terIdFinal) {
    try {
      const { leerTerapeutas } = require("./terapeutas");
      const terapeutas = await leerTerapeutas();
      const ter = terapeutas.find(t => t.id === terIdFinal);
      if (ter?.calendarId) calendarId = ter.calendarId;
    } catch {}
  }
  if (!calendarId) calendarId = CALENDAR_ID;

  const terapeutaNombre = slot?.terapeutaNombre || "";

  const event = {
    summary: `${nombre} — ${servicio}${terapeutaNombre ? ` (${terapeutaNombre})` : ""}`,
    description: `Cliente: ${nombre}\nTeléfono: ${telefono}\nServicio: ${servicio}${terapeutaNombre ? `\nTerapeuta: ${terapeutaNombre}` : ""}${notas ? "\nNotas: " + notas : ""}`,
    start: { dateTime: slot.inicioISO, timeZone: TIMEZONE },
    end:   { dateTime: slot.finISO,   timeZone: TIMEZONE },
    colorId: "2",
    reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 60 }] },
  };

  const res = await calendar.events.insert({ calendarId, resource: event });
  invalidarCacheSlots(); // forzar refresh en el próximo pedido de disponibilidad
  return { ...res.data, terapeutaId: terIdFinal, calendarId };
}

// ============================================================
// CANCELAR EVENTO
// ============================================================
async function cancelarTurno(eventId) {
  const calendar = getCalendar();
  await calendar.events.delete({
    calendarId: CALENDAR_ID,
    eventId,
  });
}

// ============================================================
// BUSCAR TURNO DE UN CLIENTE (por teléfono en la descripción)
// ============================================================
async function buscarTurnoCliente(telefono) {
  const ahora = new Date();
  const hasta = new Date(ahora);
  hasta.setDate(hasta.getDate() + 60);

  const calendar = getCalendar();
  const res = await calendar.events.list({
    calendarId: CALENDAR_ID,
    timeMin: ahora.toISOString(),
    timeMax: hasta.toISOString(),
    q: telefono,
    singleEvents: true,
    orderBy: "startTime",
  });

  return res.data.items?.[0] || null;
}

// ============================================================
// BUSCAR SLOT POR TEXTO (ej: "lunes a las 10")
// Devuelve el slot de disponibilidad que coincide
// ============================================================
async function resolverSlot(textoFecha, textoHora) {
  const slots = await getDisponibilidad();

  // Intentar matchear por día de semana o fecha
  const diasNombres = ["domingo","lunes","martes","miércoles","jueves","viernes","sábado"];
  const textoLower = (textoFecha + " " + textoHora).toLowerCase();

  // Extraer hora del texto (ej: "10", "10:30", "10hs")
  const horaMatch = textoLower.match(/(\d{1,2})(?::(\d{2}))?/);
  if (!horaMatch) return null;
  const hora = String(horaMatch[1]).padStart(2, "0");
  const minutos = horaMatch[2] || "00";
  const horaStr = `${hora}:${minutos}`;

  for (const slot of slots) {
    const diaSlot = diasNombres[new Date(slot.fecha + "T12:00:00").getDay()];
    const matchDia = textoLower.includes(diaSlot) || textoLower.includes(slot.fecha);
    const matchHora = slot.horaInicio === horaStr;
    if (matchDia && matchHora) return slot;
  }

  return null;
}

// ============================================================
// OBTENER EVENTOS PARA EL DASHBOARD DE AGENDA
// Devuelve eventos reales del calendario con formato limpio
// ============================================================
async function getEventosAgenda(desde, hasta) {
  const calendar = getCalendar();
  const res = await conRetry(
    () => calendar.events.list({
      calendarId: CALENDAR_ID,
      timeMin: (desde || new Date()).toISOString(),
      timeMax: (hasta || new Date(Date.now() + 14 * 86400000)).toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 200,
    }),
    { nombre: "Google Calendar - getEventosAgenda", intentos: 3 }
  );

  return (res.data.items || []).map((ev) => {
    // Extraer datos del cliente de la descripción del evento
    const desc = ev.description || "";
    const nombreMatch = desc.match(/Cliente:\s*([^\n]+)/);
    const telMatch = desc.match(/Teléfono:\s*([^\n]+)/);
    const servicioMatch = desc.match(/Servicio:\s*([^\n]+)/);

    return {
      id: ev.id,
      titulo: ev.summary || "Turno",
      descripcion: desc,
      inicio: ev.start.dateTime || ev.start.date,
      fin: ev.end.dateTime || ev.end.date,
      colorId: ev.colorId,
      link: ev.htmlLink,
      // Datos extraídos
      clienteNombre: nombreMatch?.[1]?.trim() || "",
      clienteTelefono: telMatch?.[1]?.trim() || "",
      clienteServicio: servicioMatch?.[1]?.trim() || "",
    };
  });
}

module.exports = {
  getDisponibilidad,
  getDisponibilidadTodos,
  getSlotsParaTerapeuta,
  formatearDisponibilidad,
  crearTurno,
  cancelarTurno,
  buscarTurnoCliente,
  resolverSlot,
  getEventosAgenda,
  invalidarCacheSlots,
  TERAPEUTAS,
  HORARIOS,
};
