// ============================================================
// CITRINO BOT — Scheduler
// Fase 3: Recordatorios automáticos
// Fase 4: Remarketing y seguimiento post-sesión
// ============================================================

const cron = require("node-cron");
const Anthropic = require("@anthropic-ai/sdk");
const { enviarMensaje } = require("./sender");
const {
  getClientesConTurnoManana,
  getLeadsParaRemarketing,
  getClientesParaSeguimiento,
  registrarRemarketing,
  actualizarEstado,
  getStats,
  leerTodosLosClientes,
} = require("./crm");
const { getDisponibilidad, formatearDisponibilidad, crearReservasFantasma, liberarGhostExpiradas, getEventosAgenda } = require("./calendar");
const { tomarDecisiones } = require("./consciousness");
const { procesarMensajesPendientes, npsEsperando } = require("./conversation");
const { verificarSalud } = require("./utils");

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const OWNER = process.env.OWNER_WHATSAPP;

// Lock global para evitar que crons y el handler SÍ/NO actúen sobre el mismo usuario simultáneamente
const confirmandoUsers = new Set();
module.exports_confirmandoUsers = confirmandoUsers; // accesible desde conversation.js

// ============================================================
// MENSAJES
// ============================================================
const MENSAJES = {
  confirmacionTurno: (nombre, fecha, hora, servicio) =>
    `¡Hola ${nombre}! 🌿 Su turno en Citrino quedó confirmado.\n\n` +
    `📅 *${fecha} a las ${hora}*\n` +
    `💆 ${servicio}\n` +
    `📍 Sarandí 554 apto. 1 — Frente a Plaza Matriz, Ciudad Vieja\n\n` +
    `Le pedimos llegar 5 minutitos antes 🙏 Cualquier consulta por acá.`,

  recordatorio24hs: (nombre, fecha, hora) =>
    `¡Hola ${nombre}! 👋 Le recordamos que mañana tiene turno en Citrino.\n\n` +
    `📅 *${fecha} a las ${hora}*\n\n` +
    `¿Confirma que viene? Responda *SÍ* para confirmar o *NO* si necesita cancelar/reagendar.`,

  // ── REMARKETING DIFERENCIADO POR OBJECIÓN ──────────────────
  remarketingPrecio: (nombre) =>
    `¡Hola ${nombre || ""}! 🌿 Le escribimos de Citrino.\n\n` +
    `Sabemos que el precio a veces es una barrera, por eso le contamos: si paga por transferencia o en efectivo tiene un *10% de descuento* 💛\n\n` +
    `¿Le buscamos un horario esta semana?`,

  remarketingDuda: (nombre, servicio) =>
    `¡Hola ${nombre || ""}! 🌿 Le escribimos de Citrino.\n\n` +
    `Consultó sobre ${servicio || "el Método Citrino"} y queremos contarle que muchas clientas vienen con las mismas dudas y después de la primera sesión se enamoran 💆‍♀️\n\n` +
    `¿Le contamos más o le buscamos un horario para que lo pruebe?`,

  remarketingTiempo: (nombre) =>
    `¡Hola ${nombre || ""}! 🌿 Le escribimos de Citrino.\n\n` +
    `Sabemos que el tiempo es lo que más escasea 😅 Por eso le avisamos: tenemos turnos disponibles de 50 min que puede encajar en cualquier parte del día.\n\n` +
    `¿Cuál sería el mejor horario para usted esta semana?`,

  remarketingLead: (nombre, servicio) =>
    `¡Hola ${nombre || ""}! 🌿 Le escribimos de Citrino.\n\n` +
    `Vimos que consultó sobre ${servicio || "nuestros masajes"} y queríamos saber si pudimos ayudarle.\n\n` +
    `Si todavía le interesa agendar, tenemos buenos horarios disponibles esta semana ✨\n` +
    `¿Le contamos más?`,

  // ── Lead tibio: preguntó horarios o mostró intención de agendar ──
  remarketingLeadTibio: (nombre, servicio) =>
    `¡Hola ${nombre || ""}! 🌿 Le escribimos de Citrino.\n\n` +
    `La última vez estaba a punto de coordinar su turno para ${servicio || "su sesión"}. Esta semana tenemos buenos horarios disponibles, incluso de mañana y de tarde.\n\n` +
    `¿Agendamos?`,

  remarketingClientaVino: (nombre) =>
    `¡Hola ${nombre || ""}! 🌿 ¿Cómo está?\n\n` +
    `Hace un tiempo que no la vemos por Citrino y la extrañamos 💛\n\n` +
    `Si necesita un espacio para usted, tenemos turnos disponibles. ¿Agendamos?`,

  // ── UPSELL PACK POST-SESIÓN (24-48hs después de venir) ──────
  upsellPack: (nombre) =>
    `¡Hola ${nombre}! 🌿 Esperamos que haya disfrutado mucho su sesión en Citrino 💆‍♀️\n\n` +
    `Le contamos que si quiere continuar con el tratamiento, los packs le salen mucho mejor:\n\n` +
    `✨ *Pack 4 sesiones → $5.100* (ahorra $900)\n` +
    `✨ *Pack 6 sesiones → $7.400* (ahorra $1.600)\n` +
    `✨ *Pack 8 sesiones → $9.600* (ahorra $2.400)\n\n` +
    `Los resultados se notan mucho más cuando es constante 🌿 ¿Le interesa?`,

  seguimientoPostSesion: (nombre) =>
    `¡Hola ${nombre}! 🌿 ¿Cómo quedó después de su sesión en Citrino?\n\n` +
    `Esperamos que haya disfrutado mucho 💆 Si quiere repetir o tiene algún comentario, acá estamos.\n\n` +
    `¿Agendamos el próximo turno?`,

  seguimientoConCuponera: (nombre, sesRest) =>
    `¡Hola ${nombre}! 🌿 ¿Cómo está? Le recordamos que tiene *${sesRest} ${sesRest === "1" ? "sesión" : "sesiones"} disponibles* en su cuponera de Citrino.\n\n` +
    `¿Cuándo agendamos? 🌿`,

  // ── REMARKETING ETAPA 2 — social proof + oferta ─────────────
  remarketingEtapa2: (nombre) =>
    `¡Hola ${nombre || ""}! 🌿 Volvemos a escribirle de Citrino.\n\n` +
    `Una cosa que muchas clientas no saben: si paga con transferencia o efectivo, tiene un *10% de descuento* 💛 Y las que empezaron con el pack de 4 sesiones notaron la diferencia mucho más rápido que viniendo de a una.\n\n` +
    `¿Le buscamos un horario esta semana?`,

  // ── REMARKETING ETAPA 3 — cierre cálido ─────────────────────
  remarketingEtapa3: (nombre) =>
    `¡Hola ${nombre || ""}! 🌿 Le escribimos por última vez para no saturarle.\n\n` +
    `Si en algún momento quiere un espacio para cuidarse y desconectarse, en Citrino siempre hay lugar para usted 💛\n\n` +
    `Cuando esté lista, acá estamos. ¡Que esté muy bien!`,

  // ── RECUPERACIÓN DE NO-SHOW ──────────────────────────────────
  recuperacionNoShow: (nombre) =>
    `¡Hola ${nombre || ""}! 🌿 Vimos que hoy no pudo venir a su turno en Citrino, esperamos que esté bien 🙏\n\n` +
    `Cuando quiera reagendamos sin problema. ¿Cuándo le quedaría bien esta semana?`,

  // ── RECORDATORIO 2 HORAS ANTES ───────────────────────────────
  recordatorio2hs: (nombre, hora) =>
    `¡Hola ${nombre || ""}! 🌿 Le recordamos que su turno en Citrino es *hoy a las ${hora}*.\n\n` +
    `📍 Sarandí 554 apto. 1 — Frente a Plaza Matriz, Ciudad Vieja\n\n` +
    `¡La esperamos! 💛`,

  // ── NPS POST-SESIÓN ───────────────────────────────────────────
  npsPostSesion: (nombre) =>
    `¡Hola ${nombre || ""}! 🌿 Esperamos que haya disfrutado su sesión en Citrino 💆‍♀️\n\n` +
    `¿Nos podría contar cómo estuvo su experiencia? *Responda con un número del 1 al 5:*\n\n` +
    `⭐ 1 = Mejorable\n⭐⭐ 2 = Regular\n⭐⭐⭐ 3 = Bien\n⭐⭐⭐⭐ 4 = Muy bien\n⭐⭐⭐⭐⭐ 5 = Excelente\n\n` +
    `Su opinión nos ayuda a mejorar 🙏`,

  // ── RE-BOOKING POST-SESIÓN ────────────────────────────────────
  rebooking: (nombre) =>
    `¡Hola ${nombre || ""}! 🌿 ¿Cómo se siente después de su sesión?\n\n` +
    `Los resultados se notan mucho más cuando se mantiene la frecuencia. ¿Le reservamos el próximo turno para que no pierda el ritmo? 💆‍♀️\n\n` +
    `¿Qué día de la semana le quedaría mejor?`,

  // ── BIENVENIDA PRIMERA VISITA ─────────────────────────────────
  bienvenidaPrimeraVisita: (nombre, hora) =>
    `¡Hola ${nombre || ""}! 🌿 Le escribimos de Citrino para recordarle que *mañana tiene su primera sesión con nosotros* 💛\n\n` +
    `📍 *Sarandí 554 apto. 1* — frente a Plaza Matriz, Ciudad Vieja\n` +
    `🕐 Le esperamos a las *${hora}* — le pedimos llegar 5 minutos antes\n\n` +
    `*Para aprovechar al máximo su sesión:*\n` +
    `✅ Ropa cómoda y holgada\n` +
    `✅ Hidratarse bien antes y después\n` +
    `✅ Evitar comidas pesadas las 2hs previas\n` +
    `✅ Si tiene alguna condición médica, avisarnos\n\n` +
    `¡La esperamos con muchas ganas! 🌿`,

  // ── CUMPLEAÑOS ────────────────────────────────────────────────
  cumpleanos: (nombre) =>
    `¡Feliz cumpleaños ${nombre || ""}! 🎂🌿\n\n` +
    `En Citrino queremos celebrar este día especial con usted. *Como regalo, tiene un 15% de descuento* en cualquier sesión durante los próximos 7 días 🎁\n\n` +
    `¿Le agendamos algo especial para celebrar? 💛`,

  // ── PUNTOS FIDELIDAD: NOTIFICACIÓN ───────────────────────────
  puntosAcumulados: (nombre, puntos) =>
    `¡Hola ${nombre || ""}! 🌿 Tiene *${puntos} puntos* de fidelidad en Citrino.\n\n` +
    (puntos >= 8
      ? `🎉 *¡Llegó a 8 puntos!* Tiene una sesión de regalo disponible. ¿La agendamos? 💛`
      : `Le faltan *${8 - puntos} sesiones* para ganar una sesión de regalo 🎁\n¡Siga así! 💪`),
};

// ============================================================
// RECORDATORIOS 24 HORAS ANTES
// Corre cada hora a los :00
// ============================================================
async function enviarRecordatorios() {
  console.log("⏰ Verificando turnos para recordatorio 24hs...");

  let clientes;
  try {
    clientes = await getClientesConTurnoManana();
  } catch (err) {
    console.error("❌ Error al obtener clientes para recordatorio:", err.message);
    return;
  }

  for (const cliente of clientes) {
    try {
      const fechaTurno = new Date(cliente.fechaTurno);
      const fecha = fechaTurno.toLocaleDateString("es-UY", {
        weekday: "long",
        day: "numeric",
        month: "long",
        timeZone: "America/Montevideo",
      });
      const hora = fechaTurno.toLocaleTimeString("es-UY", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "America/Montevideo",
      });

      const nombre = cliente.nombre || "cliente";
      const mensaje = MENSAJES.recordatorio24hs(nombre, fecha, hora);

      await enviarMensaje(cliente.userId, mensaje, cliente.canal);
      console.log(`✅ Recordatorio enviado a ${cliente.userId} (${nombre})`);
    } catch (err) {
      console.error(`❌ Error enviando recordatorio a ${cliente.userId}:`, err.message);
    }
  }
}

// ============================================================
// REMARKETING — Secuencia en 3 etapas
//   Etapa 0→1: primer mensaje a las 48hs de contacto inicial (o último reset)
//   Etapa 1→2: segundo mensaje 48hs después del primero
//   Etapa 2→3: tercer mensaje 10 días después del segundo
//
// Auto-excluye si Estado = vino/agendado/confirmado/pendiente_confirmacion.
// Se resetea automáticamente cuando el cliente responde (conversation.js
// actualiza Ultimo_Remarketing a now y Remarketing_Etapa a "0").
//
// Corre todos los días a las 10:30
// ============================================================
async function enviarRemarketing() {
  console.log("📣 Ejecutando remarketing secuencial...");
  try {
    const { readSheet, upsertCliente } = require("./sheets-crm");
    const clientes = await readSheet("CLIENTES");
    const ahora = Date.now();

    // Estados que excluyen completamente del remarketing
    const estadosExcluidos = new Set(["vino", "agendado", "confirmado", "pendiente_confirmacion", "cancelado"]);

    let enviados = 0;
    let saltados = 0;

    // Pre-cargar VENTAS y SESIONES para detectar cuponeras sin usar
    let ventasSheet = [], sesionesSheet = [];
    try {
      [ventasSheet, sesionesSheet] = await Promise.all([
        readSheet("VENTAS").catch(() => []),
        readSheet("SESIONES").catch(() => []),
      ]);
    } catch {}

    const PACK_KW_REMARK = ["pack", "cuponera", "pase libre"];
    function normIdRemark(v) { return String(v || "").replace(/\D/g, "").slice(-9); }
    function saldoCuponeraRapido(clienteId) {
      const cid = normIdRemark(clienteId);
      if (!cid) return 0;
      const compradas = ventasSheet
        .filter(v => normIdRemark(v.ID_Cliente_Guardado) === cid &&
          PACK_KW_REMARK.some(k => (v.Producto || "").toLowerCase().includes(k)))
        .reduce((a, v) => a + (parseInt(v.Cantidad_Calculada) || 0), 0);
      const usadas = sesionesSheet
        .filter(s => normIdRemark(s.ID_Cliente_Guardado) === cid).length;
      return Math.max(0, compradas - usadas);
    }

    for (const c of clientes) {
      try {
        // Saltar si ya es cliente activo / convertida
        if (estadosExcluidos.has(c.Estado)) { saltados++; continue; }

        const userId = c.ID_Cliente || c.Telefono;
        if (!userId) continue;

        const etapa = parseInt(c.Remarketing_Etapa) || 0;

        // Etapa 3+ = ciclo agotado
        if (etapa >= 3) continue;

        // ── Calcular referencia de tiempo según etapa ──────────────
        let refDate;
        let horasRequeridas;

        if (etapa === 0) {
          // Msg1: 48h desde Ultimo_Remarketing (reset por respuesta) o Fecha_Alta
          const base = c.Ultimo_Remarketing || c.Fecha_Alta;
          refDate = base ? new Date(base) : null;
          horasRequeridas = 48;
        } else {
          // Msg2 y Msg3: basado en cuándo se envió el mensaje anterior
          refDate = c.Ultimo_Remarketing ? new Date(c.Ultimo_Remarketing) : null;
          horasRequeridas = etapa === 1 ? 48 : 10 * 24; // 48h → msg2, 10 días → msg3
        }

        if (!refDate || isNaN(refDate.getTime())) { saltados++; continue; }

        const diffHoras = (ahora - refDate.getTime()) / (1000 * 60 * 60);
        if (diffHoras < horasRequeridas) { saltados++; continue; }

        // ── Seleccionar mensaje según etapa y segmento ─────────────
        const nombre   = c.Nombre || "";
        const objecion = (c.Objecion || "").toLowerCase();
        const servicio = c.Intencion_Compra || "nuestros masajes";

        // Detectar si es lead tibio (preguntó por horarios en el historial)
        let preguntoPorHorario = false;
        try {
          const hist = JSON.parse(c.Historial_JSON || "[]");
          const textoHist = hist.map(m => m.content || m.msg || m.text || "").join(" ").toLowerCase();
          preguntoPorHorario = /horario|turno|cuando|agendar|disponib|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado/.test(textoHist);
        } catch {}

        // Detectar cuponera con saldo (clientes que ya pagaron pero no usaron)
        const saldoCuponera = saldoCuponeraRapido(userId);

        let mensaje;

        if (etapa === 0) {
          // Prioridad 1: tiene cuponera con saldo → recordar que las espera
          if (saldoCuponera > 0) {
            mensaje = MENSAJES.seguimientoConCuponera(nombre, String(saldoCuponera));
          // Prioridad 2: objeción específica conocida
          } else if (objecion.includes("precio") || objecion.includes("caro") || objecion.includes("plata")) {
            mensaje = MENSAJES.remarketingPrecio(nombre);
          } else if (objecion.includes("tiempo") || objecion.includes("ocupad")) {
            mensaje = MENSAJES.remarketingTiempo(nombre);
          } else if (objecion.includes("duda") || objecion.includes("piensa") || objecion.includes("segur")) {
            mensaje = MENSAJES.remarketingDuda(nombre, servicio);
          // Prioridad 3: lead tibio (preguntó horarios pero no completó)
          } else if (preguntoPorHorario) {
            mensaje = MENSAJES.remarketingLeadTibio(nombre, servicio);
          // Prioridad 4: lead frío (nunca mostró intención clara)
          } else {
            mensaje = MENSAJES.remarketingLead(nombre, servicio);
          }
        } else if (etapa === 1) {
          // Social proof + oferta concreta
          mensaje = MENSAJES.remarketingEtapa2(nombre);
        } else {
          // Cierre cálido — último intento
          mensaje = MENSAJES.remarketingEtapa3(nombre);
        }

        // ── Enviar — solo avanzar etapa si el envío fue exitoso ────
        await enviarMensaje(userId, mensaje, c.Origen || "whatsapp");
        // Si enviarMensaje lanzó, el catch externo lo captura y no llega acá
        const nuevaEtapa = String(etapa + 1);
        await upsertCliente({
          ID_Cliente:           userId,
          Remarketing_Etapa:    nuevaEtapa,
          Ultimo_Remarketing:   new Date().toISOString(),
        });

        enviados++;
        console.log(`✅ Remarketing etapa ${etapa + 1} enviado a ${userId} (${nombre}) [objecion: ${c.Objecion || "–"}]`);

        // Pausa breve entre envíos para no saturar la API
        await new Promise(r => setTimeout(r, 1200));

      } catch (err) {
        console.error(`❌ Error remarketing a ${c.ID_Cliente}:`, err.message);
      }
    }

    console.log(`📣 Remarketing finalizado: ${enviados} enviados, ${saltados} saltados`);
  } catch (err) {
    console.error("❌ Error en enviarRemarketing:", err.message);
  }
}

// ============================================================
// UPSELL PACK — 36hs después de la primera sesión
// Corre todos los días a las 11:30
// ============================================================
async function enviarUpsellPack() {
  console.log("💰 Ejecutando upsell de pack post-sesión...");
  try {
    const { readSheet, updateClienteEstado } = require("./sheets-crm");
    const clientes = await readSheet("CLIENTES");
    const ahora = Date.now();

    // Pre-cargar VENTAS y SESIONES para verificar cuponera real
    // (el campo c.Cuponera no existe en el CRM actual — hay que calcularlo)
    const PACK_KW_UP = ["pack", "cuponera", "pase libre"];
    let ventasUp = [], sesionesUp = [];
    try {
      [ventasUp, sesionesUp] = await Promise.all([
        readSheet("VENTAS").catch(() => []),
        readSheet("SESIONES").catch(() => []),
      ]);
    } catch {}
    function normIdUp(v) { return String(v || "").replace(/\D/g, "").slice(-9); }
    function tieneCuponeraActiva(clienteId) {
      const cid = normIdUp(clienteId);
      if (!cid) return false;
      const compradas = ventasUp
        .filter(v => normIdUp(v.ID_Cliente_Guardado) === cid &&
          PACK_KW_UP.some(k => (v.Producto || "").toLowerCase().includes(k)))
        .reduce((a, v) => a + (parseInt(v.Cantidad_Calculada) || 0), 0);
      if (!compradas) return false;
      const usadas = sesionesUp.filter(s => normIdUp(s.ID_Cliente_Guardado) === cid).length;
      return compradas - usadas > 0;
    }

    for (const c of clientes) {
      try {
        if (c.Estado !== "vino") continue;
        if (!c.Fecha_Turno) continue;
        // Solo si vino entre 24 y 48hs atrás
        const diffHoras = (ahora - new Date(c.Fecha_Turno)) / (1000 * 60 * 60);
        if (diffHoras < 24 || diffHoras > 48) continue;
        // Evitar reenviar (NOTAS como flag)
        if ((c.NOTAS || "").includes("[upsell_enviado]")) continue;
        // Solo si no tiene cuponera activa (verificación real vs VENTAS-SESIONES)
        const userId = c.ID_Cliente || c.Telefono;
        if (!userId) continue;
        if (tieneCuponeraActiva(userId)) continue;

        await enviarMensaje(userId, MENSAJES.upsellPack(c.Nombre || ""), c.Origen || "whatsapp");
        await updateClienteEstado(userId, "vino", { NOTAS: ((c.NOTAS || "") + " [upsell_enviado]").trim() });
        console.log(`✅ Upsell pack enviado a ${userId} (${c.Nombre})`);
      } catch (err) {
        console.error(`❌ Error upsell a ${c.ID_Cliente}:`, err.message);
      }
    }
  } catch (err) {
    console.error("❌ Error en upsell pack:", err.message);
  }
}

// ============================================================
// SALDO CUPONERA — helper compartido (mismo que en admin.js)
// ============================================================
const PACK_KW_SCH = ["pack", "cuponera", "pase libre"];

function normDigitsSch(v) {
  return String(v || "").replace(/\D/g, "");
}
function phoneMatchSch(a, b) {
  const na = normDigitsSch(a);
  const nb = normDigitsSch(b);
  if (!na || !nb) return false;
  const min = Math.min(na.length, nb.length);
  return na.slice(-min) === nb.slice(-min);
}
function normIdSch(v) {
  return normDigitsSch(v).slice(-9);
}
const PROD_CANT_SCH = { "pack 2": 2, "pack 4": 4, "pack 6": 6, "pack 8": 8, "pase libre": 1, "sesión individual": 1, "sesion individual": 1 };
function cantidadProductoSch(producto, cantHoja) {
  const n = parseInt(cantHoja) || 0;
  if (n > 0) return n;
  const p = (producto || "").toLowerCase();
  for (const [k, v] of Object.entries(PROD_CANT_SCH)) { if (p.includes(k)) return v; }
  const m = p.match(/\d+/);
  return m ? parseInt(m[0]) : 0;
}

// ============================================================
// CHECK-IN DIARIO — 21hs
// Envía al admin la lista de sesiones del día y pregunta quién vino
// ============================================================
async function enviarCheckInDiario() {
  if (!OWNER) return;
  console.log("📋 Enviando check-in diario...");
  try {
    const { readSheet } = require("./sheets-crm");
    const sesiones = await readSheet("SESIONES");

    const hoy = new Date();
    const inicioHoy = new Date(hoy); inicioHoy.setHours(0, 0, 0, 0);
    const finHoy = new Date(hoy);   finHoy.setHours(23, 59, 59, 999);

    const sesionesHoy = sesiones
      .filter(s => {
        if (!s.Fecha_Hora) return false;
        const f = new Date(s.Fecha_Hora);
        return !isNaN(f) && f >= inicioHoy && f <= finHoy;
      })
      .sort((a, b) => new Date(a.Fecha_Hora) - new Date(b.Fecha_Hora));

    if (sesionesHoy.length === 0) {
      await enviarMensaje(OWNER, "📋 Sin sesiones registradas hoy.", "whatsapp");
      return;
    }

    const lista = sesionesHoy.map((s, i) => {
      const hora = new Date(s.Fecha_Hora).toLocaleTimeString("es-UY", {
        hour: "2-digit", minute: "2-digit", timeZone: "America/Montevideo",
      });
      const terapeuta = s.Terapeuta ? ` — ${s.Terapeuta}` : "";
      return `${i + 1}. *${s.Cliente}* ${hora}hs${terapeuta}`;
    }).join("\n");

    // Revisar saldos de cuponera para las sesiones de hoy
    const alertasCuponera = [];
    for (const s of sesionesHoy) {
      const cid = s.ID_Cliente_Guardado || s.ID_Cliente;
      if (!cid) continue;
      const { getSaldoClienteBot } = require("./sheets-crm");
      const saldo = await getSaldoClienteBot(cid, s.Cliente);
      if (saldo.compradas > 0 && saldo.saldo <= 1) {
        const iconoSaldo = saldo.saldo === 0 ? "⛔" : "⚠️";
        const textoSaldo = saldo.saldo === 0
          ? `agotada (${saldo.usadas}/${saldo.compradas})`
          : `última sesión (${saldo.usadas}/${saldo.compradas})`;
        alertasCuponera.push(`${iconoSaldo} *${s.Cliente}* — cuponera ${textoSaldo}`);
      }
    }

    let msg =
      `✅ *Check-in del día*\n\n${lista}\n\n` +
      `¿Quién vino? Respondé con algo como:\n` +
      `_"Silvia sí, María no, Laura sí y compró Pack 6 transferencia 7200"_`;

    if (alertasCuponera.length > 0) {
      msg += `\n\n🎟️ *Cuponeras por vencer hoy:*\n${alertasCuponera.join("\n")}`;
    }

    await enviarMensaje(OWNER, msg, "whatsapp");
    console.log(`✅ Check-in enviado (${sesionesHoy.length} sesiones)`);
  } catch (err) {
    console.error("❌ Error check-in diario:", err.message);
  }
}

// ============================================================
// CIERRE DE NO-SHOWS — 23hs
// Auto-marca como no_vino a quien sigue en "confirmado" (Nico no respondió)
// ============================================================
async function cerrarNoShows() {
  console.log("🔍 Verificando no-shows del día...");
  try {
    const { readSheet, updateClienteEstado, upsertCliente } = require("./sheets-crm");
    const clientes = await readSheet("CLIENTES");
    const ahora = new Date();
    const inicioHoy = new Date(ahora); inicioHoy.setHours(0, 0, 0, 0);
    const finHoy = new Date(ahora); finHoy.setHours(23, 0, 0, 0); // cron corre 23:30, cerramos hasta 23:00

    for (const c of clientes) {
      try {
        if (!["confirmado", "pendiente_confirmacion"].includes(c.Estado)) continue;
        if (!c.Fecha_Turno) continue;
        const ft = new Date(c.Fecha_Turno);
        if (ft < inicioHoy || ft > finHoy) continue; // no era hoy

        const userId = c.ID_Cliente || c.Telefono;
        if (!userId) continue;

        // Marcar como no_vino
        await updateClienteEstado(userId, "no_vino");

        // Notificar a Nico
        if (OWNER) {
          await enviarMensaje(OWNER,
            `⚠️ *No-show*: ${c.Nombre || userId} no vino a las ${new Date(c.Fecha_Turno).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", timeZone: "America/Montevideo" })}`,
            "whatsapp"
          ).catch(() => {});
        }

        // Mensaje de recuperación — enviado a las 9:00 del día siguiente via NOTAS flag
        // (no setTimeout que se pierde al reiniciar Railway)
        upsertCliente({ ID_Cliente: userId, NOTAS: ((c.NOTAS || "") + " [noshow_pendiente_followup]").trim() }).catch(() => {});

        console.log(`✅ No-show registrado: ${c.Nombre || userId}`);
      } catch (err) {
        console.error(`❌ Error no-show ${c.ID_Cliente}:`, err.message);
      }
    }
  } catch (err) {
    console.error("❌ Error en cerrarNoShows:", err.message);
  }
}

// ============================================================
// SEGUIMIENTO POST-SESIÓN — 7 días después
// Corre todos los días a las 11:00
// ============================================================
async function enviarSeguimientoPostSesion() {
  console.log("💆 Ejecutando seguimiento post-sesión...");

  let clientes;
  try {
    clientes = await getClientesParaSeguimiento();
  } catch (err) {
    console.error("❌ Error al obtener clientes para seguimiento:", err.message);
    return;
  }

  const { getSaldoClienteBot } = require("./sheets-crm");

  for (const cliente of clientes) {
    try {
      const nombre = cliente.nombre || "amig@";
      let mensaje;

      // Usar getSaldoClienteBot (real, cross-join VENTAS+SESIONES) en vez del campo legacy cuponera
      let saldo = { saldo: 0 };
      try { saldo = await getSaldoClienteBot(cliente.userId, nombre); } catch {}

      if (saldo.saldo > 0) {
        mensaje = MENSAJES.seguimientoConCuponera(nombre, saldo.saldo);
      } else {
        mensaje = MENSAJES.seguimientoPostSesion(nombre);
      }

      await enviarMensaje(cliente.userId, mensaje, cliente.canal);
      await registrarRemarketing(cliente.userId);
      console.log(`✅ Seguimiento enviado a ${cliente.userId} (${nombre}) — saldo: ${saldo.saldo}`);
    } catch (err) {
      console.error(`❌ Error en seguimiento a ${cliente.userId}:`, err.message);
    }
  }
}

// ============================================================
// ALERTA VENCIMIENTO TOKEN DE META
// Corre todos los días a las 9:00
// ============================================================
async function verificarVencimientoToken() {
  if (!OWNER) return;
  const fechaStr = process.env.META_PAGE_TOKEN_EXPIRES;
  if (!fechaStr) return;

  const expira = new Date(fechaStr);
  const hoy = new Date();
  const diasRestantes = Math.ceil((expira - hoy) / (1000 * 60 * 60 * 24));

  if (diasRestantes <= 2 && diasRestantes >= 0) {
    const msg =
      `⚠️ *URGENTE — Token de Facebook por vencer*\n\n` +
      `El *META_PAGE_ACCESS_TOKEN* vence ${diasRestantes === 0 ? "*HOY*" : `en *${diasRestantes} día${diasRestantes === 1 ? "" : "s"}*`}.\n\n` +
      `*Para renovarlo:*\n` +
      `1. Andá a developers.facebook.com/tools/explorer\n` +
      `2. Seleccioná la app y la página Citrino\n` +
      `3. Click "Generate Access Token"\n` +
      `4. Copiá el nuevo token\n` +
      `5. Actualizalo en Railway → Variables → META_PAGE_ACCESS_TOKEN\n` +
      `6. Actualizá también META_PAGE_TOKEN_EXPIRES con la nueva fecha (+60 días)\n\n` +
      `Sin renovarlo, Messenger e Instagram dejan de funcionar.`;
    await enviarMensaje(OWNER, msg, "whatsapp").catch(() => {});
    console.log(`⚠️ Token META vence en ${diasRestantes} días — alerta enviada a Nico`);
  }
}

// ============================================================
// RESUMEN DIARIO A LAS 20HS — CORTO Y DIRECTO
// ============================================================
async function enviarResumenDiario() {
  if (!OWNER) return;
  try {
    const clientes = await leerTodosLosClientes();
    const hoy = new Date();
    const manana = new Date(hoy.getTime() + 24 * 60 * 60 * 1000);
    const inicioHoy = new Date(hoy); inicioHoy.setHours(0, 0, 0, 0);

    const turnosManana = clientes.filter(c =>
      c.FechaTurno && c.Estado === "agendado" &&
      new Date(c.FechaTurno).toDateString() === manana.toDateString()
    );
    const leadsHoy = clientes.filter(c => c.FechaAlta && new Date(c.FechaAlta) >= inicioHoy).length;
    const diaManana = manana.toLocaleDateString("es-UY", { weekday: "long", timeZone: "America/Montevideo" });

    // Mensaje ultra-corto
    let msg = `🌿 *Citrino — ${hoy.toLocaleDateString("es-UY", { day: "numeric", month: "short" })}*\n`;
    msg += leadsHoy > 0 ? `Leads hoy: ${leadsHoy} 🆕\n` : "";
    if (turnosManana.length > 0) {
      msg += `\n📅 *${diaManana.charAt(0).toUpperCase()+diaManana.slice(1)}* (${turnosManana.length} turnos):\n`;
      turnosManana.forEach(c => {
        const h = new Date(c.FechaTurno).toLocaleTimeString("es-UY",{hour:"2-digit",minute:"2-digit",timeZone:"America/Montevideo"});
        msg += `• ${h} ${c.Nombre||"–"}\n`;
      });
    } else {
      msg += `📅 *${diaManana}:* sin turnos`;
    }

    await enviarMensaje(OWNER, msg.trim(), "whatsapp");
  } catch (err) {
    console.error("❌ Error resumen diario:", err.message);
  }
}

// ============================================================
// RESUMEN SEMANAL — lunes a las 8:00
// ============================================================
async function enviarResumenSemanal() {
  if (!OWNER) return;
  try {
    const clientes = await leerTodosLosClientes();
    const ahora = new Date();
    const hace7 = new Date(ahora.getTime() - 7 * 86400000);

    const nuevos = clientes.filter(c => c.FechaAlta && new Date(c.FechaAlta) >= hace7).length;
    const vinieron = clientes.filter(c => c.UltimoContacto && new Date(c.UltimoContacto) >= hace7 && c.Estado === "vino").length;
    const agendados = clientes.filter(c => c.Estado === "agendado").length;
    const conCuponera = clientes.filter(c => c.Cuponera === "si").length;

    const msg =
      `📊 *Resumen semanal Citrino*\n` +
      `Semana del ${hace7.toLocaleDateString("es-UY",{day:"numeric",month:"short"})} al ${ahora.toLocaleDateString("es-UY",{day:"numeric",month:"short"})}\n\n` +
      `🆕 Nuevos contactos: ${nuevos}\n` +
      `✅ Vinieron: ${vinieron}\n` +
      `📅 Agendados activos: ${agendados}\n` +
      `🎟 Con cuponera: ${conCuponera}\n\n` +
      `Total clientes: ${clientes.length}`;

    await enviarMensaje(OWNER, msg, "whatsapp");
  } catch (err) {
    console.error("❌ Error resumen semanal:", err.message);
  }
}

// ============================================================
// RESUMEN MENSUAL — día 1 de cada mes a las 9:00
// ============================================================
async function enviarResumenMensual() {
  if (!OWNER) return;
  try {
    const clientes = await leerTodosLosClientes();
    const ahora = new Date();
    const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1);
    const finMes = new Date(ahora.getFullYear(), ahora.getMonth(), 0);

    const nuevos = clientes.filter(c => {
      if (!c.FechaAlta) return false;
      const f = new Date(c.FechaAlta);
      return f >= inicioMes && f <= finMes;
    }).length;
    const vinieron = clientes.filter(c => {
      if (!c.UltimoContacto || c.Estado !== "vino") return false;
      const f = new Date(c.UltimoContacto);
      return f >= inicioMes && f <= finMes;
    }).length;
    const conCuponera = clientes.filter(c => c.Cuponera === "si").length;
    const mesNombre = inicioMes.toLocaleDateString("es-UY", { month: "long", year: "numeric" });

    const msg =
      `📅 *Resumen mensual — ${mesNombre.charAt(0).toUpperCase()+mesNombre.slice(1)}*\n\n` +
      `🆕 Nuevos clientes: ${nuevos}\n` +
      `✅ Sesiones realizadas: ${vinieron}\n` +
      `🎟 Cuponeras activas: ${conCuponera}\n` +
      `👥 Total acumulado: ${clientes.length} clientes\n\n` +
      `¡Buen trabajo este mes! 💛`;

    await enviarMensaje(OWNER, msg, "whatsapp");
  } catch (err) {
    console.error("❌ Error resumen mensual:", err.message);
  }
}

// ============================================================
// AGENDA DEL DÍA SIGUIENTE POR TERAPEUTA
// Se envía después del resumen (20:05) — por separado
// ============================================================
async function enviarAgendaManana() {
  if (!OWNER) return;
  try {
    const { getEventosAgenda } = require("./calendar");
    const { leerTerapeutas } = require("./terapeutas");

    const manana = new Date(); manana.setDate(manana.getDate() + 1);
    const inicioManana = new Date(manana); inicioManana.setHours(0, 0, 0, 0);
    const finManana = new Date(manana); finManana.setHours(23, 59, 59, 0);

    const [eventos, terapeutas] = await Promise.all([
      getEventosAgenda(inicioManana, finManana),
      leerTerapeutas().catch(() => []),
    ]);

    const diaLabel = manana.toLocaleDateString("es-UY", {
      weekday: "long", day: "numeric", month: "long", timeZone: "America/Montevideo"
    });
    const diaCapital = diaLabel.charAt(0).toUpperCase() + diaLabel.slice(1);

    if (!eventos.length) {
      await enviarMensaje(OWNER, `📅 *${diaCapital}*\n\nSin turnos agendados.`, "whatsapp");
      return;
    }

    // Agrupar por terapeuta
    const grupos = {};
    eventos.forEach(ev => {
      const ter = terapeutas.find(t =>
        ev.titulo?.toLowerCase().includes(t.nombre?.toLowerCase())
      );
      const nombre = ter?.nombre || "Sin asignar";
      if (!grupos[nombre]) grupos[nombre] = [];
      const hora = new Date(ev.inicio).toLocaleTimeString("es-UY", {
        hour: "2-digit", minute: "2-digit", timeZone: "America/Montevideo"
      });
      grupos[nombre].push(`${hora} — ${ev.clienteNombre || ev.titulo}`);
    });

    let msg = `📅 *Agenda ${diaCapital}*\n`;
    msg += `_(${eventos.length} turno${eventos.length !== 1 ? "s" : ""})_\n`;
    Object.entries(grupos).forEach(([ter, items]) => {
      msg += `\n*${ter}*\n`;
      items.forEach(i => msg += `• ${i}\n`);
    });

    await enviarMensaje(OWNER, msg.trim(), "whatsapp");
  } catch (err) {
    console.error("❌ Error enviando agenda mañana:", err.message);
  }
}

// ============================================================
// ALERTA URGENTE — envía 4 mensajes de alerta + 1 descriptivo
// ============================================================
async function enviarAlertaUrgente(motivo) {
  if (!OWNER) return;
  try {
    // 4 mensajes de alerta para que suene fuerte
    for (let i = 0; i < 4; i++) {
      await enviarMensaje(OWNER, "🚨 ALERTA ALERTA ALERTA 🚨", "whatsapp");
      await new Promise(r => setTimeout(r, 800));
    }
    await enviarMensaje(OWNER, motivo, "whatsapp");
  } catch {}
}

// ============================================================
// AUTO-REVIEW 6AM — revisión silenciosa: token + sistema
// Solo notifica si hay un error o alerta real. Silencio = todo OK.
// ============================================================
async function autoReview6am() {
  console.log("🔍 Revisión automática 6am...");
  if (!OWNER) return;

  const alertas = [];

  // ── 1. Verificar vencimiento token Meta ─────────────────────
  try {
    const fechaStr = process.env.META_PAGE_TOKEN_EXPIRES;
    if (fechaStr) {
      const expira = new Date(fechaStr);
      const diasRestantes = Math.ceil((expira - Date.now()) / (1000 * 60 * 60 * 24));
      if (diasRestantes <= 3 && diasRestantes >= 0) {
        alertas.push(
          `⚠️ *TOKEN META VENCE ${diasRestantes === 0 ? "HOY" : `en ${diasRestantes} día${diasRestantes === 1 ? "" : "s"}`}*\n` +
          `Ir a developers.facebook.com/tools/explorer → generar nuevo token → actualizar META_PAGE_ACCESS_TOKEN en Railway.`
        );
      }
    }
  } catch {}

  // ── 2. Análisis del sistema con Claude ──────────────────────
  try {
    const { readSheet } = require("./sheets-crm");
    const [stats, clientesCRM] = await Promise.all([
      getStats().catch(() => ({})),
      readSheet("CLIENTES").catch(() => []),
    ]);

    const ahora6 = Date.now();
    const diasDesde = (c, campo) => {
      const v = c[campo];
      if (!v) return 9999;
      const d = new Date(v);
      return isNaN(d) ? 9999 : Math.floor((ahora6 - d) / 86400000);
    };

    // Clientas que efectivamente vinieron y no han vuelto en 30+ días (churn real)
    const clientasInactivasReal = clientesCRM.filter(c =>
      c.Estado === "vino" && diasDesde(c, "Ultimo_Saludo") > 30
    ).length;

    // Leads que nunca convirtieron (normal, no es alarma)
    const leadsTotal = clientesCRM.filter(c =>
      ["prospecto", "lead"].includes(c.Estado || "")
    ).length;

    // Cuponeras con saldo sin usar > 21 días (urgente)
    // Cálculo rápido sin cross-join pesado
    const cuponeraPendiente = clientesCRM.filter(c =>
      c.Estado === "vino" && diasDesde(c, "Ultimo_Saludo") > 21 &&
      (c.NOTAS || "").toLowerCase().includes("cuponera")
    ).length;

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      system: `Monitoreás el Citrino Bot (centro de estética). Tu rol es detectar problemas técnicos reales, no comentar métricas normales de negocio. Los leads que no convierten son normales. Solo alertás si: (a) el ratio de agendadas/leads está por debajo del 5%, (b) hay un error sistémico evidente, o (c) el volumen de agendadas cayó >50% respecto a la semana anterior. Si todo está normal respondés únicamente "OK".`,
      messages: [{
        role: "user",
        content: `Revisión ${new Date().toLocaleDateString("es-UY")}: total_contactos=${stats.total||0}, leads_activos=${leadsTotal}, agendadas=${stats.agendados||0}, clientas_que_vinieron_y_no_volvieron_30d=${clientasInactivasReal}. ¿Hay algo urgente?`,
      }],
    });

    const analisis = response.content[0].text.trim();
    if (analisis !== "OK") {
      alertas.push(`🤖 ${analisis}`);
    }
  } catch (err) {
    console.error("❌ Error en análisis 6am:", err.message);
  }

  // ── 3. Liberar ghost expiradas (silencioso) ─────────────────
  try {
    await liberarGhostExpiradas();
  } catch (err) {
    console.error("❌ Error liberando ghosts:", err.message);
  }

  // ── 4. Solo notificar si hay alertas ────────────────────────
  if (alertas.length > 0) {
    await enviarMensaje(OWNER, `🔔 *Revisión 6am — Citrino*\n\n${alertas.join("\n\n")}`, "whatsapp").catch(() => {});
    console.log(`⚠️ Revisión 6am: ${alertas.length} alerta(s) enviada(s)`);
  } else {
    console.log("✅ Revisión 6am: sin alertas");
  }
}

// ============================================================
// AGENDA PARA TERAPEUTAS — enviar agenda del día siguiente
// Se envía todos los días a las 19:00
// ============================================================
async function enviarAgendaTerapeutas() {
  try {
    const { leerTerapeutas } = require("./terapeutas");
    const { getEventosAgenda } = require("./calendar");
    const { leerTodosLosClientes: leerClientes } = require("./crm");

    const terapeutas = await leerTerapeutas();
    const terapeutasConWA = terapeutas.filter(t => t.whatsapp);
    if (!terapeutasConWA.length) return;

    // Calcular rango: mañana
    const manana = new Date();
    manana.setDate(manana.getDate() + 1);
    manana.setHours(0, 0, 0, 0);
    const finManana = new Date(manana);
    finManana.setHours(23, 59, 59, 999);

    const eventos = await getEventosAgenda(manana, finManana);
    const clientes = await leerClientes();

    for (const ter of terapeutasConWA) {
      // Filtrar eventos de este terapeuta (buscar su nombre en el título/descripción)
      const misEventos = eventos.filter(ev =>
        ev.titulo.includes(ter.nombre) || ev.descripcion.includes(ter.nombre) || terapeutasConWA.length === 1
      );

      if (!misEventos.length) {
        await enviarMensaje(ter.whatsapp,
          `🌿 *Agenda de mañana — ${manana.toLocaleDateString("es-UY", { weekday: "long", day: "numeric", month: "long" })}*\n\n` +
          `No tenés turnos agendados para mañana. ¡Día libre! 😊`,
          "whatsapp"
        ).catch(() => {});
        continue;
      }

      let msg = `📅 *Tu agenda de mañana — ${manana.toLocaleDateString("es-UY", { weekday: "long", day: "numeric", month: "long" })}*\n\n`;
      for (const ev of misEventos) {
        const hora = new Date(ev.inicio).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", timeZone: "America/Montevideo" });
        const horaFin = new Date(ev.fin).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", timeZone: "America/Montevideo" });

        // Buscar info del cliente en CRM
        const clienteInfo = clientes.find(c =>
          ev.clienteTelefono && c.Teléfono?.includes(ev.clienteTelefono?.slice(-8))
        );
        const sesRest = clienteInfo ? (parseInt(clienteInfo["Ses.Rest."]) || 0) : null;
        const sesInfo = sesRest !== null ? ` · Sesiones restantes: ${sesRest}` : "";

        msg += `🕐 *${hora} – ${horaFin}*\n`;
        msg += `👤 ${ev.clienteNombre || "Cliente"}\n`;
        msg += `💆 ${ev.clienteServicio || ev.titulo}${sesInfo}\n\n`;
      }
      msg += `Si necesitás bloquear algún horario, escribime por acá y lo registro 🙏`;

      await enviarMensaje(ter.whatsapp, msg, "whatsapp").catch(() => {});
    }
  } catch (err) {
    console.error("❌ Error enviando agenda a terapeutas:", err.message);
  }
}

// ============================================================
// PROCESAR MENSAJE DE TERAPEUTA — bloqueo de horarios
// Llamado desde admin.js cuando el que escribe es terapeuta
// ============================================================
async function procesarMensajeTerapeuta(ter, texto) {
  try {
    const { invalidarCacheSlots, getDisponibilidad } = require("./calendar");
    const { GoogleAuth } = require("google-auth-library");
    const { calendar: googleCalendar } = require("@googleapis/calendar");

    const auth = new GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
      scopes: ["https://www.googleapis.com/auth/calendar"],
    });
    const cal = googleCalendar({ version: "v3", auth });

    // Intentar extraer fecha/hora del texto con Claude haiku
    const Anthropic = require("@anthropic-ai/sdk");
    const anthropicC = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const hoy = new Date().toLocaleDateString("es-UY", { timeZone: "America/Montevideo" });

    const resp = await anthropicC.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 150,
      system: `Hoy es ${hoy}. Extraé del texto una fecha y hora de bloqueo. Respondé SOLO con JSON: {"fecha":"YYYY-MM-DD","horaInicio":"HH:MM","horaFin":"HH:MM","motivo":"texto"} o {} si no encontrás.`,
      messages: [{ role: "user", content: texto }],
    });

    const rawText = resp.content[0].text.trim();
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    if (!parsed.fecha) {
      await enviarMensaje(ter.whatsapp, "No pude entender el horario a bloquear. Escribí algo como: _El martes 10 no puedo de 9 a 12_", "whatsapp");
      return;
    }

    const calId = ter.calendarId || process.env.GOOGLE_CALENDAR_ID || "primary";
    await cal.events.insert({
      calendarId: calId,
      resource: {
        summary: `🔒 BLOQUEADO — ${parsed.motivo || "No disponible"}`,
        start: { dateTime: `${parsed.fecha}T${parsed.horaInicio}:00`, timeZone: "America/Montevideo" },
        end: { dateTime: `${parsed.fecha}T${parsed.horaFin}:00`, timeZone: "America/Montevideo" },
        colorId: "4", // rojo
      },
    });

    invalidarCacheSlots();
    await enviarMensaje(ter.whatsapp,
      `✅ Bloqueé el ${parsed.fecha} de ${parsed.horaInicio} a ${parsed.horaFin}. No se van a ofrecer esos horarios 🙏`,
      "whatsapp"
    );
  } catch (err) {
    console.error("❌ Error bloqueando horario:", err.message);
    await enviarMensaje(ter.whatsapp, "Ups, hubo un error bloqueando el horario. Avisale a Nico 🙏", "whatsapp").catch(() => {});
  }
}

// ============================================================
// CONFIRMACIÓN 15HS — DÍA ANTERIOR AL TURNO
// Corre todos los días a las 15:00
// ============================================================
async function enviarConfirmacion15hs() {
  console.log("📋 Enviando confirmaciones de turno (15hs)...");
  try {
    const { getClientesParaConfirmar, updateClienteEstado } = require("./sheets-crm");
    const clientes = await getClientesParaConfirmar();

    for (const cliente of clientes) {
      const userId = cliente.ID_Cliente || cliente.Telefono;
      if (!userId) continue;
      // Lock: no enviar si el handler ya está procesando a este usuario
      if (confirmandoUsers.has(userId)) continue;
      try {
        const nombre = cliente.Nombre || "cliente";
        confirmandoUsers.add(userId);

        const fechaTurno = new Date(cliente.Fecha_Turno);
        const hora = fechaTurno.toLocaleTimeString("es-UY", {
          hour: "2-digit", minute: "2-digit", timeZone: "America/Montevideo",
        });

        const msg =
          `Hola ${nombre}! 👋 Le confirmamos que mañana tiene turno en Citrino.\n\n` +
          `🕐 *${hora} hs*\n` +
          `📍 Sarandí 554 apto. 1 — Frente a Plaza Matriz\n\n` +
          `¿Confirma que viene? Responda *SÍ* para confirmar o *NO* si necesita cancelar 🙏`;

        await enviarMensaje(userId, msg, cliente.Origen || "whatsapp");
        await updateClienteEstado(userId, "pendiente_confirmacion");
        console.log(`✅ Confirmación 15hs enviada a ${userId} (${nombre})`);
      } catch (err) {
        console.error(`❌ Error confirmación 15hs a ${userId}:`, err.message);
      } finally {
        confirmandoUsers.delete(userId);
      }
    }
  } catch (err) {
    console.error("❌ Error en confirmación 15hs:", err.message);
  }
}

// Nota: la agenda del día siguiente ya se envía a las 19hs (enviarAgendaTerapeutas)
// y el resumen a Nico a las 20:05 (enviarAgendaManana). No se necesita cron adicional.

// ============================================================
// NOTIFICAR GHOSTS — 24-48hs antes del turno esperado
// Corre todos los días a las 9:00.
// Si el cliente tiene un ghost booking en las próximas 24-48hs,
// le manda un WA preguntando si viene "como siempre" y actualiza
// CLIENTES → pendiente_confirmacion para que el handler SÍ/NO lo procese.
// ============================================================
async function notificarGhosts() {
  console.log("👻 Verificando ghost bookings para notificar...");
  try {
    const { readSheet, upsertCliente } = require("./sheets-crm");

    const ahora = new Date();
    const en24h = new Date(ahora.getTime() + 24 * 60 * 60 * 1000);
    const en48h = new Date(ahora.getTime() + 48 * 60 * 60 * 1000);

    // Obtener todos los eventos en ventana 24-48hs (incluye ghosts)
    const eventos = await getEventosAgenda(en24h, en48h);
    const ghosts = eventos.filter(ev => ev.estado === "ghost" && ev.clienteId);

    if (!ghosts.length) {
      console.log("👻 Sin ghosts para notificar");
      return;
    }

    const clientes = await readSheet("CLIENTES");

    for (const ghost of ghosts) {
      try {
        const clienteId = ghost.clienteId;
        const fechaISO  = ghost.inicio;

        // Evitar doble notificación si ya se marcó pendiente_confirmacion para este turno
        const cl = clientes.find(c => c.ID_Cliente === clienteId || c.Telefono === clienteId);
        if (cl?.Estado === "pendiente_confirmacion" && cl?.Fecha_Turno === fechaISO) continue;

        const fechaGhost = new Date(fechaISO);
        const diaLabel = fechaGhost.toLocaleDateString("es-UY", {
          weekday: "long", day: "numeric", month: "long", timeZone: "America/Montevideo",
        });
        const horaLabel = fechaGhost.toLocaleTimeString("es-UY", {
          hour: "2-digit", minute: "2-digit", timeZone: "America/Montevideo",
        });
        const nombre = cl?.Nombre ? `${cl.Nombre}! ` : "";

        await enviarMensaje(
          clienteId,
          `¡Hola ${nombre}🌿 ¿Venís el *${diaLabel} a las ${horaLabel}* como siempre?\n\n` +
          `Le tenemos el espacio reservado 💛 Respondé *SÍ* para confirmar o *NO* si no podés.`,
          cl?.Origen || "whatsapp"
        );

        // Actualizar CLIENTES → pendiente_confirmacion para que el handler SÍ/NO lo tome
        await upsertCliente({
          ID_Cliente:  clienteId,
          Estado:      "pendiente_confirmacion",
          Fecha_Turno: fechaISO,
        });

        console.log(`👻 Ghost notificado: ${cl?.Nombre || clienteId} — ${diaLabel} ${horaLabel}`);
        await new Promise(r => setTimeout(r, 1000)); // pausa entre envíos
      } catch (err) {
        console.error(`❌ Error notificando ghost ${ghost.clienteId}:`, err.message);
      }
    }
  } catch (err) {
    console.error("❌ Error en notificarGhosts:", err.message);
  }
}

// ============================================================
// SEGUNDO RECORDATORIO — 18hs
// Para clientes con turno mañana que todavía no respondieron
// la confirmación de las 15hs ni la notificación de ghost.
// ============================================================
async function enviarRecordatorio18hs() {
  console.log("🔔 Segundo recordatorio (18hs) — turnos pendientes de confirmación...");
  try {
    const { readSheet } = require("./sheets-crm");
    const clientes = await readSheet("CLIENTES");

    const ahora = new Date();
    const manana = new Date(ahora);
    manana.setDate(manana.getDate() + 1);
    const mananaStr = manana.toLocaleDateString("en-CA", { timeZone: "America/Montevideo" });

    for (const c of clientes) {
      try {
        if (c.Estado !== "pendiente_confirmacion") continue;
        const fechaTurnoStr = c.Fecha_Turno?.split("T")[0];
        if (fechaTurnoStr !== mananaStr) continue;

        const userId = c.ID_Cliente || c.Telefono;
        if (!userId) continue;

        const hora = new Date(c.Fecha_Turno).toLocaleTimeString("es-UY", {
          hour: "2-digit", minute: "2-digit", timeZone: "America/Montevideo",
        });

        await enviarMensaje(
          userId,
          `Buenas tardes ${c.Nombre ? `${c.Nombre}` : ""}! 🌿 ¿Pudiste ver el mensaje de antes?\n\n` +
          `Mañana a las *${hora}hs* tenés turno en Citrino — respondé *SÍ* o *NO* para avisarnos 🙏`,
          c.Origen || "whatsapp"
        );
        console.log(`✅ Segundo recordatorio 18hs → ${userId} (${c.Nombre || ""})`);
        await new Promise(r => setTimeout(r, 1000));
      } catch (err) {
        console.error(`❌ Error segundo recordatorio a ${c.ID_Cliente}:`, err.message);
      }
    }
  } catch (err) {
    console.error("❌ Error en enviarRecordatorio18hs:", err.message);
  }
}

// ============================================================
// RECORDATORIO 2 HORAS ANTES DEL TURNO
// Corre cada 30 min y envía recordatorio a clientas con turno en 1.5–2.5 hs
// ============================================================
async function enviarRecordatorio2hs() {
  try {
    const { readSheet } = require("./sheets-crm");
    const clientes = await readSheet("CLIENTES");
    const ahora = new Date();

    const candidatas = clientes.filter(c => {
      if (!c.Fecha_Turno || !c.ID_Cliente) return false;
      const estados = ["confirmado", "agendado", "pendiente_confirmacion"];
      if (!estados.includes(c.Estado)) return false;
      const turno = new Date(c.Fecha_Turno);
      const diffMin = (turno - ahora) / 60000;
      return diffMin >= 90 && diffMin <= 150; // entre 1.5h y 2.5h
    });

    for (const c of candidatas) {
      try {
        const hora = new Date(c.Fecha_Turno).toLocaleTimeString("es-UY", {
          hour: "2-digit", minute: "2-digit", timeZone: "America/Montevideo"
        });
        await enviarMensaje(
          c.ID_Cliente,
          MENSAJES.recordatorio2hs(c.Nombre || "", hora),
          c.Canal || "whatsapp"
        );
        console.log(`⏰ [2hs] Recordatorio enviado → ${c.ID_Cliente} (${c.Nombre})`);
        await new Promise(r => setTimeout(r, 800));
      } catch (e) {
        console.error(`❌ [2hs] Error con ${c.ID_Cliente}:`, e.message);
      }
    }
  } catch (e) {
    console.error("❌ [recordatorio2hs] Error:", e.message);
  }
}

// ============================================================
// NPS POST-SESIÓN — corre diario a las 13:00
// Envía encuesta 1-5 a clientas que vinieron ayer
// ============================================================
async function enviarNPSPostSesion() {
  console.log("⭐ [NPS] Enviando encuestas post-sesión...");
  try {
    const { readSheet, upsertCliente: upsert } = require("./sheets-crm");
    const { npsEsperando } = require("./conversation");

    const clientes = await readSheet("CLIENTES");
    const ahora = new Date();
    const ayer = new Date(ahora);
    ayer.setDate(ayer.getDate() - 1);
    const ayerStr = ayer.toISOString().split("T")[0];

    const candidatas = clientes.filter(c => {
      if (!c.ID_Cliente) return false;
      if (c.NPS_Pendiente === "si") return false; // ya enviado
      if (c.Estado !== "vino") return false;
      if (!c.Fecha_Turno) return false;
      const fechaTurno = c.Fecha_Turno.split("T")[0];
      return fechaTurno === ayerStr;
    });

    for (const c of candidatas) {
      try {
        await enviarMensaje(
          c.ID_Cliente,
          MENSAJES.npsPostSesion(c.Nombre || ""),
          c.Canal || "whatsapp"
        );
        npsEsperando.set(c.ID_Cliente, true);
        await upsert({ ID_Cliente: c.ID_Cliente, NPS_Pendiente: "si" });
        // Incrementar puntos de fidelidad por la sesión completada
        incrementarPuntosFidelidad(c.ID_Cliente, c.Nombre || "", c.Canal || "whatsapp").catch(() => {});
        console.log(`⭐ [NPS] Enviado → ${c.ID_Cliente} (${c.Nombre})`);
        await new Promise(r => setTimeout(r, 800));
      } catch (e) {
        console.error(`❌ [NPS] Error con ${c.ID_Cliente}:`, e.message);
      }
    }
  } catch (e) {
    console.error("❌ [NPS] Error general:", e.message);
  }
}

// ============================================================
// RE-BOOKING POST-SESIÓN — corre diario a las 10:00
// Invita a reservar el próximo turno a clientas que vinieron hace 2 días
// ============================================================
async function enviarRebooking() {
  console.log("📅 [rebooking] Enviando invitaciones de próxima sesión...");
  try {
    const { readSheet } = require("./sheets-crm");
    const clientes = await readSheet("CLIENTES");
    const ahora = new Date();
    const hace2dias = new Date(ahora);
    hace2dias.setDate(hace2dias.getDate() - 2);
    const hace2diasStr = hace2dias.toISOString().split("T")[0];

    const candidatas = clientes.filter(c => {
      if (!c.ID_Cliente || c.Estado !== "vino") return false;
      if (!c.Fecha_Turno) return false;
      const fechaTurno = c.Fecha_Turno.split("T")[0];
      // Solo si NO tiene otro turno agendado ya
      if (c.Estado === "agendado" || c.Estado === "confirmado") return false;
      return fechaTurno === hace2diasStr;
    });

    for (const c of candidatas) {
      try {
        await enviarMensaje(
          c.ID_Cliente,
          MENSAJES.rebooking(c.Nombre || ""),
          c.Canal || "whatsapp"
        );
        console.log(`📅 [rebooking] Enviado → ${c.ID_Cliente} (${c.Nombre})`);
        await new Promise(r => setTimeout(r, 800));
      } catch (e) {
        console.error(`❌ [rebooking] Error con ${c.ID_Cliente}:`, e.message);
      }
    }
  } catch (e) {
    console.error("❌ [rebooking] Error general:", e.message);
  }
}

// ============================================================
// BIENVENIDA PRIMERA VISITA — corre junto al recordatorio 24hs
// Detecta si es la primera vez de la clienta y manda info especial
// ============================================================
async function enviarBienvenidaPrimeraVisita() {
  try {
    const { readSheet, upsertCliente: upsert } = require("./sheets-crm");
    const clientes = await readSheet("CLIENTES");
    const ahora = new Date();
    const manana = new Date(ahora);
    manana.setDate(manana.getDate() + 1);
    const mananaStr = manana.toISOString().split("T")[0];

    const candidatas = clientes.filter(c => {
      if (!c.ID_Cliente || !c.Fecha_Turno) return false;
      if (c.Bienvenida_Enviada === "si") return false;
      if (!["confirmado", "agendado"].includes(c.Estado)) return false;
      const fechaTurno = c.Fecha_Turno.split("T")[0];
      // Primera visita: Estado nunca fue "vino" (no tiene historial) y es nueva
      const esNueva = !c.NOTAS?.includes("vino") && (c.Intencion_Compra === "" || !c.Intencion_Compra || c.Origen === "lead");
      return fechaTurno === mananaStr && esNueva;
    });

    for (const c of candidatas) {
      try {
        const hora = new Date(c.Fecha_Turno).toLocaleTimeString("es-UY", {
          hour: "2-digit", minute: "2-digit", timeZone: "America/Montevideo"
        });
        await enviarMensaje(
          c.ID_Cliente,
          MENSAJES.bienvenidaPrimeraVisita(c.Nombre || "", hora),
          c.Canal || "whatsapp"
        );
        await upsert({ ID_Cliente: c.ID_Cliente, Bienvenida_Enviada: "si" });
        console.log(`🎉 [bienvenida] Enviada → ${c.ID_Cliente} (${c.Nombre})`);
        await new Promise(r => setTimeout(r, 800));
      } catch (e) {
        console.error(`❌ [bienvenida] Error con ${c.ID_Cliente}:`, e.message);
      }
    }
  } catch (e) {
    console.error("❌ [bienvenida] Error general:", e.message);
  }
}

// ============================================================
// CUMPLEAÑOS — corre diario a las 9:00
// Envía saludo + descuento 15% a clientas que cumplen hoy
// ============================================================
async function enviarCumpleanos() {
  console.log("🎂 [cumpleaños] Verificando cumpleaños de hoy...");
  try {
    const { readSheet } = require("./sheets-crm");
    const clientes = await readSheet("CLIENTES");
    const hoy = new Date();
    const diaHoy = String(hoy.getDate()).padStart(2, "0");
    const mesHoy = String(hoy.getMonth() + 1).padStart(2, "0");

    const candidatas = clientes.filter(c => {
      if (!c.ID_Cliente || !c.Fecha_Nacimiento) return false;
      // Fecha_Nacimiento puede ser YYYY-MM-DD o DD/MM/YYYY
      const fn = c.Fecha_Nacimiento.replace(/\//g, "-");
      const partes = fn.includes("-") ? fn.split("-") : [];
      if (partes.length < 3) return false;
      // Normalizar: si es YYYY-MM-DD → partes[1]=mes, partes[2]=dia
      // si es DD-MM-YYYY → partes[0]=dia, partes[1]=mes
      const esIso = partes[0].length === 4;
      const diaNac = esIso ? partes[2].padStart(2, "0") : partes[0].padStart(2, "0");
      const mesNac = esIso ? partes[1].padStart(2, "0") : partes[1].padStart(2, "0");
      return diaNac === diaHoy && mesNac === mesHoy;
    });

    for (const c of candidatas) {
      try {
        await enviarMensaje(
          c.ID_Cliente,
          MENSAJES.cumpleanos(c.Nombre || ""),
          c.Canal || "whatsapp"
        );
        console.log(`🎂 [cumpleaños] Mensaje enviado → ${c.ID_Cliente} (${c.Nombre})`);
        await new Promise(r => setTimeout(r, 800));
      } catch (e) {
        console.error(`❌ [cumpleaños] Error con ${c.ID_Cliente}:`, e.message);
      }
    }
  } catch (e) {
    console.error("❌ [cumpleaños] Error general:", e.message);
  }
}

// ============================================================
// PUNTOS DE FIDELIDAD — incrementa al marcar sesión como realizada
// Se llama desde cerrarNoShows cuando actualiza estado a "vino"
// ============================================================
async function incrementarPuntosFidelidad(clienteId, nombre, canal) {
  try {
    const { readSheet, upsertCliente: upsert } = require("./sheets-crm");
    const clientes = await readSheet("CLIENTES");
    const c = clientes.find(f => f.ID_Cliente === clienteId || f.Telefono === clienteId);
    if (!c) return;

    const puntosActuales = parseInt(c.Puntos_Fidelidad || "0");
    const nuevosPuntos = puntosActuales + 1;
    await upsert({ ID_Cliente: clienteId, Puntos_Fidelidad: String(nuevosPuntos) });

    // Notificar si acaba de alcanzar 8 (sesión de regalo) o en hitos intermedios (4)
    const notificarEn = [4, 8, 12, 16];
    if (notificarEn.includes(nuevosPuntos)) {
      await enviarMensaje(
        clienteId,
        MENSAJES.puntosAcumulados(nombre || "", nuevosPuntos),
        canal || "whatsapp"
      );
      console.log(`🏆 [fidelidad] Notificación de ${nuevosPuntos} puntos → ${clienteId}`);
    }
    console.log(`⭐ [fidelidad] ${clienteId}: ${puntosActuales} → ${nuevosPuntos} puntos`);
  } catch (e) {
    console.error("❌ [fidelidad] Error:", e.message);
  }
}

// ============================================================
// FOLLOW-UP LEAD TIBIO — "luego confirmo" → al día siguiente
// Detecta leads que pidieron horarios ayer pero no confirmaron.
// Corre todos los días a las 10:00
// ============================================================
async function followUpLeadTibio() {
  console.log("📨 Follow-up leads tibios (10am)...");
  try {
    const { readSheet, upsertCliente } = require("./sheets-crm");
    const clientes = await readSheet("CLIENTES");
    const ahora = Date.now();
    const hoyStr = new Date().toISOString().slice(0, 10); // "2026-06-22"

    const estadosExcluidos = new Set(["vino", "agendado", "confirmado", "pendiente_confirmacion", "cancelado"]);

    for (const c of clientes) {
      try {
        if (estadosExcluidos.has(c.Estado)) continue;
        const userId = c.ID_Cliente || c.Telefono;
        if (!userId) continue;

        // Evitar doble envío en el mismo día
        if ((c.NOTAS || "").includes(`[followup_tibio:${hoyStr}]`)) continue;

        // Leads con objeción ya están en el flujo de remarketing — no duplicar con follow-up tibio
        if (c.Lead_Score === "objecion") continue;

        // Verificar que el historial incluye conversación sobre horarios/turnos
        // (o que el Lead_Score ya indica alta intención — en ese caso confiamos en eso)
        let preguntoPorHorario = c.Lead_Score === "alta";
        if (!preguntoPorHorario) {
          try {
            const hist = JSON.parse(c.Historial_JSON || "[]");
            if (hist.length >= 2) {
              const textoHist = hist.map(m => m.content || m.msg || m.text || "").join(" ").toLowerCase();
              preguntoPorHorario = /horario|turno|cuando|agendar|disponib|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|semana/.test(textoHist);
            }
          } catch {}
        }
        if (!preguntoPorHorario) continue;

        // Solo si el último contacto fue hace entre 14 y 30 horas (ayer)
        const refDate = c.Ultimo_Remarketing || c.Fecha_Alta;
        if (!refDate) continue;
        const diffHoras = (ahora - new Date(refDate).getTime()) / (1000 * 60 * 60);
        if (diffHoras < 14 || diffHoras > 30) continue;

        const nombre = c.Nombre || "";
        // Lead con alta intención → mensaje más directo y concreto
        // Lead sin score → mensaje estándar
        const msg = c.Lead_Score === "alta"
          ? (nombre
              ? `Holii ${nombre}, que tal? 😊 Le escribía porque quedó pendiente definir el horario para su sesión — tenemos lugar esta semana si le interesa 🌿`
              : `Holii, que tal? 😊 Quedó pendiente definir el horario para su sesión — tenemos lugar esta semana si le interesa 🌿`)
          : (nombre
              ? `Holii ${nombre}, que tal? 😊 Le consultaba si pudo definir algún horario para la sesión.`
              : `Holii, que tal? 😊 Le consultaba si pudo definir algún horario para la sesión.`);

        await enviarMensaje(userId, msg, c.Origen || "whatsapp");

        // Marcar para no reenviar hoy + resetear clock de remarketing
        // (evita que el remarketing de las 10:30 mande un segundo mensaje el mismo día)
        await upsertCliente({
          ID_Cliente:          userId,
          NOTAS:               ((c.NOTAS || "") + ` [followup_tibio:${hoyStr}]`).trim(),
          Ultimo_Remarketing:  new Date().toISOString(),
        });

        console.log(`✅ Follow-up tibio → ${userId} (${nombre})`);
        await new Promise(r => setTimeout(r, 1200));
      } catch (err) {
        console.error(`❌ Error follow-up tibio ${c.ID_Cliente}:`, err.message);
      }
    }
  } catch (err) {
    console.error("❌ Error en followUpLeadTibio:", err.message);
  }
}

// ============================================================
// INICIAR TODOS LOS SCHEDULERS
// ============================================================
function startScheduler() {
  // ── Salud del sistema ──────────────────────────────────────
  cron.schedule("0 */4 * * *", verificarSalud, { timezone: "America/Montevideo" });

  // ── Recuperación no-shows — 9:05 (flag [noshow_pendiente_followup] del día anterior) ──
  cron.schedule("5 9 * * *", async () => {
    try {
      const { readSheet, upsertCliente: upsert } = require("./sheets-crm");
      const clientes = await readSheet("CLIENTES");
      for (const c of clientes) {
        if (!(c.NOTAS || "").includes("[noshow_pendiente_followup]")) continue;
        const userId = c.ID_Cliente || c.Telefono;
        if (!userId) continue;
        await enviarMensaje(userId, MENSAJES.recuperacionNoShow(c.Nombre || ""), c.Origen || "whatsapp");
        const notasLimpias = (c.NOTAS || "").replace(/\[noshow_pendiente_followup\]/g, "").trim();
        await upsert({ ID_Cliente: userId, NOTAS: notasLimpias });
        await new Promise(r => setTimeout(r, 800));
      }
    } catch (e) {
      console.error("❌ [noshow-followup]:", e.message);
    }
  }, { timezone: "America/Montevideo" });

  // ── Cumpleaños — 9:00 diario ──────────────────────────────────
  cron.schedule("0 9 * * *", enviarCumpleanos, { timezone: "America/Montevideo" });

  // ── Notificar ghosts — 9:00 diario (ventana 24-48hs antes del turno) ───
  cron.schedule("0 9 * * *", notificarGhosts, { timezone: "America/Montevideo" });

  // ── Confirmaciones 15hs (día anterior al turno) ────────────
  cron.schedule("0 15 * * *", enviarConfirmacion15hs, { timezone: "America/Montevideo" });

  // ── Segundo recordatorio — 18hs (para pendiente_confirmacion de mañana) ─
  cron.schedule("0 18 * * *", enviarRecordatorio18hs, { timezone: "America/Montevideo" });

  // ── Agenda mañana para terapeutas — DESACTIVADO por ahora ──
  // cron.schedule("0 19 * * *", enviarAgendaTerapeutas, { timezone: "America/Montevideo" });

  // ── Agenda del día siguiente para Nico — 20:00 ────────────
  cron.schedule("0 20 * * *", enviarAgendaManana, { timezone: "America/Montevideo" });

  // ── Re-booking post-sesión — 10:00 (invitar próximo turno) — DESACTIVADO por ahora ──
  // cron.schedule("0 10 * * *", enviarRebooking, { timezone: "America/Montevideo" });

  // ── Follow-up lead tibio — 10:00 ("luego confirmo" → al día siguiente) ──
  cron.schedule("0 10 * * *", () => {
    followUpLeadTibio().catch(err => console.error("❌ followUpLeadTibio:", err.message));
  }, { timezone: "America/Montevideo" });

  // ── Re-marketing leads sin turno (+7 días) — 10:30 ────────
  cron.schedule("30 10 * * *", enviarRemarketing, { timezone: "America/Montevideo" });

  // ── Seguimiento post-sesión — 11:00 ───────────────────────
  cron.schedule("0 11 * * *", enviarSeguimientoPostSesion, { timezone: "America/Montevideo" });

  // ── NPS post-sesión — 13:00 — DESACTIVADO por ahora ────────
  // cron.schedule("0 13 * * *", enviarNPSPostSesion, { timezone: "America/Montevideo" });

  // ── Recordatorio 2hs antes del turno — cada 30 min — DESACTIVADO por ahora ──
  // cron.schedule("*/30 * * * *", enviarRecordatorio2hs, { timezone: "America/Montevideo" });

  // ── Bienvenida primera visita — 16:00 — DESACTIVADO por ahora ──
  // cron.schedule("0 16 * * *", enviarBienvenidaPrimeraVisita, { timezone: "America/Montevideo" });

  // ── Check-in diario — 21:00 ────────────────────────────────
  cron.schedule("0 21 * * *", enviarCheckInDiario, { timezone: "America/Montevideo" });

  // ── No-shows: cierre automático — 23:30 (después del check-in de 21hs) ─
  cron.schedule("30 23 * * *", cerrarNoShows, { timezone: "America/Montevideo" });

  // ── Auto-aprendizaje nocturno — 02:00 (analiza conversaciones del día y extrae patrones) ─
  // Corre cada 3 días a las 02:00 (días 1, 4, 7... del mes) — era diario, reducido para ahorrar tokens
  cron.schedule("0 2 */3 * *", async () => {
    try {
      const { autoAprendizajeDesdeConversaciones } = require("./consciousness");
      const resultado = await autoAprendizajeDesdeConversaciones();
      if (resultado.aprendidos > 0) {
        console.log(`🧠 [auto-learn] Noche: ${resultado.aprendidos} nuevos patrones guardados en La Conciencia.`);
      }
    } catch (e) {
      console.error("❌ [auto-learn] Error en cron nocturno:", e.message);
    }
  }, { timezone: "America/Montevideo" });

  // ── Resumen semanal — lunes 8:00 ──────────────────────────
  cron.schedule("0 8 * * 1", enviarResumenSemanal, { timezone: "America/Montevideo" });

  // ── Resumen mensual — día 1 de cada mes 9:00 ──────────────
  cron.schedule("0 9 1 * *", enviarResumenMensual, { timezone: "America/Montevideo" });

  // ── Seguimiento pendiente — 9:30 (clientes que vinieron pero no reagendaron) ─
  cron.schedule("30 9 * * *", async () => {
    if (!OWNER) return;
    try {
      const { readSheet } = require("./sheets-crm");
      const clientes = await readSheet("CLIENTES");
      const ahora = Date.now();
      const pendientes = clientes.filter(c => {
        if (!(c.NOTAS || "").includes("[seguimiento_pendiente]")) return false;
        const ult = c.Ultimo_Saludo ? new Date(c.Ultimo_Saludo) : null;
        if (!ult) return false;
        const diasDesde = (ahora - ult) / 86400000;
        return diasDesde >= 3 && diasDesde < 14; // entre 3 y 14 días sin agendar
      });
      if (!pendientes.length) return;
      const lista = pendientes.map(c => `• ${c.Nombre || c.ID_Cliente} (${c.Telefono || c.ID_Cliente})`).join("\n");
      await enviarMensaje(OWNER,
        `📋 *Seguimiento pendiente — clientas sin reagendar*\n\nVinieron hace 3+ días y no reagendaron:\n\n${lista}\n\n¿Las contactamos o las dejamos para la semana que viene?`,
        "whatsapp"
      ).catch(() => {});
      // Marcar como notificado para no repetir
      const { upsertCliente } = require("./sheets-crm");
      for (const c of pendientes) {
        try {
          const notas = (c.NOTAS || "").replace("[seguimiento_pendiente]", "[seguimiento_notificado]");
          await upsertCliente({ ID_Cliente: c.ID_Cliente || c.Telefono, NOTAS: notas });
        } catch {}
      }
    } catch {}
  }, { timezone: "America/Montevideo" });

  // ── Auto-review silencioso — 6:00 (token + sistema + liberar ghosts) ───────
  cron.schedule("0 6 * * *", autoReview6am, { timezone: "America/Montevideo" });

  // ── Mensajes fuera de horario — 6:30 (responder consultas overnight) ────
  cron.schedule("30 6 * * 1-6", async () => {
    console.log("🌅 [pendientes] Procesando mensajes fuera de horario...");
    try {
      await procesarMensajesPendientes();
    } catch (err) {
      console.error("❌ [pendientes] Error:", err.message);
    }
  }, { timezone: "America/Montevideo" });

  // ── Ghost bookings — lunes 7:00 (detectar patrones y crear reservas fantasma)
  cron.schedule("0 7 * * 1", async () => {
    console.log("👻 Analizando patrones para ghost bookings...");
    try {
      const creados = await crearReservasFantasma(2);
      console.log(`👻 Ghost bookings: ${creados} creado(s)`);
    } catch (err) {
      console.error("❌ Error ghost bookings:", err.message);
    }
  }, { timezone: "America/Montevideo" });

  // ── Escalación bot→Nico — 12:00 (leads sin respuesta 48hs) ──
  cron.schedule("0 12 * * *", async () => {
    if (!OWNER) return;
    try {
      const { readSheet } = require("./sheets-crm");
      const clientes = await readSheet("CLIENTES");
      const ahora = Date.now();
      const LIMITE_MS = 48 * 60 * 60 * 1000; // 48 horas

      const sinRespuesta = clientes.filter(c => {
        // Solo leads activos (no ya atendidos o perdidos)
        const estadosActivos = ["nuevo", "contactado", "interesado", "pendiente_confirmacion", "confirmado"];
        if (!estadosActivos.includes(c.Estado || "")) return false;
        // Que tengan último contacto registrado
        const ult = c.Ultimo_Saludo ? new Date(c.Ultimo_Saludo).getTime() : 0;
        if (!ult) return false;
        const sinActividadMs = ahora - ult;
        return sinActividadMs >= LIMITE_MS && sinActividadMs < 7 * 24 * 60 * 60 * 1000; // entre 48hs y 7 días
      });

      if (!sinRespuesta.length) return;

      // Máximo 10 para no spamear a Nico
      const lista = sinRespuesta.slice(0, 10).map(c => {
        const tel = c.Telefono || c.ID_Cliente || "?";
        const nombre = c.Nombre || "Sin nombre";
        const estado = c.Estado || "?";
        const canal = c.Canal === "instagram" ? "📸" : "📱";
        const horasDesde = Math.round((ahora - new Date(c.Ultimo_Saludo).getTime()) / 3600000);
        return `${canal} *${nombre}* (${tel}) — ${estado} — sin respuesta hace ${horasDesde}hs`;
      }).join("\n");

      const total = sinRespuesta.length;
      const msg = `🚨 *Leads sin respuesta +48hs* (${total} total)\n\n${lista}${total > 10 ? `\n\n_...y ${total - 10} más_` : ""}\n\n¿Intervengo yo o los tomás vos?`;

      await enviarMensaje(OWNER, msg, "whatsapp").catch(() => {});
      console.log(`📣 Escalación: ${total} lead(s) sin respuesta notificados a Nico`);
    } catch (err) {
      console.error("❌ Error en escalación bot→Nico:", err.message);
    }
  }, { timezone: "America/Montevideo" });

  console.log("🗓️ Scheduler iniciado:");
  console.log("  • 06:00 revisión silenciosa (token + sistema + liberar ghosts expiradas)");
  console.log("  • 07:00 (lunes) detectar patrones y crear ghost bookings");
  console.log("  • 09:00 notificar ghost bookings próximos (24-48hs antes)");
  console.log("  • 10:30 remarketing secuencial (48h → 48h → 10d)");
  console.log("  • 11:00 seguimiento post-sesión");
  console.log("  • 15:00 confirmaciones día siguiente");
  console.log("  • 18:00 segundo recordatorio (pendiente_confirmacion de mañana)");
  console.log("  • 20:00 agenda del día siguiente para Nico");
  console.log("  • 20:05 cierre de no-shows automático");
  console.log("  • 21:00 check-in diario + alertas cuponera");
  console.log("  • lunes 08:00 resumen semanal");
  console.log("  • día 1 09:00 resumen mensual");
  console.log("  • 06:30 (Lun-Sab) responder mensajes overnight (fuera de horario)");
  console.log("  • */4hs verificar salud del sistema");
}

// ============================================================
// PLANTILLAS META — Código para enviar a aprobación
// Documentación para Nico de cómo crear las templates
// ============================================================
const TEMPLATES_META = {
  confirmacion: {
    nombre: "citrino_confirmacion_turno",
    idioma: "es_AR",
    categoria: "UTILITY",
    cuerpo: `¡Hola {{1}}! 🌿 Tu turno en Citrino quedó confirmado.

📅 *{{2}} a las {{3}}*
💆 {{4}}
📍 Sarandí 554 apto. 1 — Frente a Plaza Matriz, Ciudad Vieja

Acordate de llegar 5 minutitos antes 🙏`,
    variables: ["nombre del cliente", "fecha (ej: lunes 15 de enero)", "hora (ej: 10:00)", "servicio"],
  },

  recordatorio: {
    nombre: "citrino_recordatorio_24hs",
    idioma: "es_AR",
    categoria: "UTILITY",
    cuerpo: `¡Hola {{1}}! 👋 Mañana tenés turno en Citrino.

📅 *{{2}} a las {{3}}*

¿Confirmás? Respondé SÍ para confirmar o NO si necesitás cancelar.`,
    variables: ["nombre", "fecha", "hora"],
  },

  remarketing: {
    nombre: "citrino_remarketing_lead",
    idioma: "es_AR",
    categoria: "MARKETING",
    cuerpo: `¡Hola {{1}}! 🌿

Vimos que consultaste sobre nuestros masajes y queríamos saber si podemos ayudarte.

Tenemos horarios disponibles esta semana ✨ ¿Agendamos?`,
    variables: ["nombre"],
  },

  seguimiento: {
    nombre: "citrino_seguimiento_postsesion",
    idioma: "es_AR",
    categoria: "MARKETING",
    cuerpo: `¡Hola {{1}}! 🌿

¿Cómo te quedaste después de tu sesión en Citrino? Esperamos que hayas disfrutado mucho 💆

¿Agendamos el próximo turno?`,
    variables: ["nombre"],
  },
};

// Exportar las templates por si Nico quiere verlas
function getTemplatesMeta() {
  return TEMPLATES_META;
}

module.exports = { startScheduler, getTemplatesMeta, enviarAlertaUrgente, procesarMensajeTerapeuta };
