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
// OBTENER EVENTOS OCUPADOS EN UN RANGO
// ============================================================
async function getEventosOcupados(desde, hasta) {
  const calendar = getCalendar();
  const res = await conRetry(
    () => calendar.events.list({
      calendarId: CALENDAR_ID,
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
// GENERAR SLOTS DISPONIBLES
// Devuelve array de { fecha, horaInicio, horaFin, label }
// ============================================================
async function getDisponibilidad(diasDesdeHoy = 0) {
  const ahora = toMontevideoDate(new Date());
  const desde = new Date(ahora);
  desde.setDate(desde.getDate() + diasDesdeHoy);
  desde.setHours(0, 0, 0, 0);

  const hasta = new Date(desde);
  hasta.setDate(hasta.getDate() + DIAS_A_MOSTRAR);

  const eventosOcupados = await getEventosOcupados(desde, hasta);

  const slots = [];

  // Iterar día por día
  for (let d = 0; d < DIAS_A_MOSTRAR; d++) {
    const fecha = new Date(desde);
    fecha.setDate(fecha.getDate() + d);

    const diaSemana = fecha.getDay(); // 0=dom, 1=lun, ...
    const horario = HORARIOS[diaSemana];
    if (!horario) continue;

    const fechaStr = fecha.toISOString().split("T")[0]; // "2024-12-30"

    for (const franja of horario.franjas) {
      // Generar slots cada 90 min dentro de la franja
      let hora = franja.inicio;
      while (hora + DURACION_SESION_MIN / 60 <= franja.fin) {
        const inicioISO = slotToISO(fechaStr, hora);
        const finISO = slotToISO(fechaStr, hora + DURACION_SESION_MIN / 60);

        const inicioDate = new Date(inicioISO + ":00-03:00");
        const finDate = new Date(finISO + ":00-03:00");

        // No mostrar slots en el pasado
        if (inicioDate <= ahora) {
          hora += DURACION_SESION_MIN / 60;
          continue;
        }

        // Chequear si el slot choca con algún evento
        const ocupado = eventosOcupados.some((ev) => {
          const evInicio = new Date(ev.start.dateTime || ev.start.date);
          const evFin = new Date(ev.end.dateTime || ev.end.date);
          // Se superpone si el inicio del slot es antes del fin del evento
          // y el fin del slot es después del inicio del evento
          // Además buffer de 90min antes y después
          const bufferMs = DURACION_SESION_MIN * 60 * 1000;
          return inicioDate < new Date(evFin.getTime() + bufferMs) &&
                 finDate > new Date(evInicio.getTime() - bufferMs);
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
            label: `${formatFecha(fechaStr)} a las ${pad(hh)}:${pad(mm)}`,
            inicioISO: inicioISO + ":00-03:00",
            finISO: finISO + ":00-03:00",
          });
        }

        hora += DURACION_SESION_MIN / 60;
      }
    }
  }

  return slots;
}

// ============================================================
// FORMATEAR DISPONIBILIDAD PARA MOSTRAR AL CLIENTE
// ============================================================
function formatearDisponibilidad(slots) {
  if (!slots.length) {
    return "No tengo turnos disponibles en los próximos 7 días. ¿Querés que miremos para más adelante?";
  }

  // Agrupar por fecha
  const porFecha = {};
  for (const slot of slots) {
    if (!porFecha[slot.fecha]) {
      porFecha[slot.fecha] = { label: slot.fechaLabel, horarios: [] };
    }
    porFecha[slot.fecha].horarios.push(slot.horaInicio);
  }

  let texto = "📅 *Turnos disponibles:*\n\n";
  for (const [, info] of Object.entries(porFecha)) {
    texto += `*${info.label.charAt(0).toUpperCase() + info.label.slice(1)}*\n`;
    texto += info.horarios.map((h) => `• ${h} hs`).join("\n");
    texto += "\n\n";
  }
  texto += "¿Cuál te queda mejor?";
  return texto.trim();
}

// ============================================================
// CREAR EVENTO EN GOOGLE CALENDAR
// ============================================================
async function crearTurno({ nombre, telefono, servicio, slot, notas = "" }) {
  const calendar = getCalendar();

  const event = {
    summary: `Turno ${nombre} — ${servicio}`,
    description: `Cliente: ${nombre}\nTeléfono: ${telefono}\nServicio: ${servicio}${notas ? "\nNotas: " + notas : ""}`,
    start: {
      dateTime: slot.inicioISO,
      timeZone: TIMEZONE,
    },
    end: {
      dateTime: slot.finISO,
      timeZone: TIMEZONE,
    },
    colorId: "2", // verde
    reminders: {
      useDefault: false,
      overrides: [{ method: "popup", minutes: 60 }],
    },
  };

  const res = await calendar.events.insert({
    calendarId: CALENDAR_ID,
    resource: event,
  });

  return res.data; // contiene .id, .htmlLink, etc.
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

module.exports = {
  getDisponibilidad,
  formatearDisponibilidad,
  crearTurno,
  cancelarTurno,
  buscarTurnoCliente,
  resolverSlot,
};
