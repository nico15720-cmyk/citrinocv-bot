// ============================================================
// CITRINO BOT — Scheduler
// Fase 3: Recordatorios automáticos
// Fase 4: Remarketing y seguimiento post-sesión
// ============================================================

const cron = require("node-cron");
const { enviarMensaje, enviarTemplateWhatsApp } = require("./sender");
const {
  getClientesConTurnoManana,
  getLeadsParaRemarketing,
  getClientesParaSeguimiento,
  registrarRemarketing,
  actualizarEstado,
} = require("./crm");
const { cancelarTurno } = require("./calendar");

// ============================================================
// MENSAJES
// ============================================================
const MENSAJES = {
  confirmacionTurno: (nombre, fecha, hora, servicio) =>
    `¡Hola ${nombre}! 🌿 Tu turno en Citrino quedó confirmado.\n\n` +
    `📅 *${fecha} a las ${hora}*\n` +
    `💆 ${servicio}\n` +
    `📍 [COMPLETAR DIRECCIÓN]\n\n` +
    `Acordate de llegar 5 minutitos antes 🙏 Cualquier consulta por acá.`,

  recordatorio24hs: (nombre, fecha, hora) =>
    `¡Hola ${nombre}! 👋 Te recuerdo que mañana tenés turno en Citrino.\n\n` +
    `📅 *${fecha} a las ${hora}*\n\n` +
    `¿Confirmás que venís? Respondé *SÍ* para confirmar o *NO* si necesitás cancelar/reagendar.`,

  remarketingLead: (nombre, servicio) =>
    `¡Hola ${nombre}! 🌿 Te escribimos de Citrino.\n\n` +
    `Vimos que consultaste sobre ${servicio || "nuestros masajes"} y queríamos saber si pudimos ayudarte.\n\n` +
    `Si todavía te interesa agendar, tenemos buenos horarios disponibles esta semana ✨\n` +
    `¿Te cuento más?`,

  seguimientoPostSesion: (nombre) =>
    `¡Hola ${nombre}! 🌿 ¿Cómo te quedaste después de tu sesión en Citrino?\n\n` +
    `Esperamos que hayas disfrutado mucho 💆 Si querés repetir o tenés algún comentario, acá estamos.\n\n` +
    `¿Agendamos el próximo turno?`,

  seguimientoConCuponera: (nombre, sesRest) =>
    `¡Hola ${nombre}! 🌿 ¿Cómo estás? Te recuerdo que tenés *${sesRest} ${sesRest === "1" ? "sesión" : "sesiones"} disponibles* en tu cuponera de Citrino.\n\n` +
    `¿Cuándo agendamos? 🌿`,
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
// REMARKETING — Leads sin respuesta > 48hs
// Corre todos los días a las 10:00
// ============================================================
async function enviarRemarketing() {
  console.log("📣 Ejecutando remarketing de leads...");

  let leads;
  try {
    leads = await getLeadsParaRemarketing();
  } catch (err) {
    console.error("❌ Error al obtener leads para remarketing:", err.message);
    return;
  }

  for (const lead of leads) {
    try {
      const nombre = lead.nombre || "amig@";
      const mensaje = MENSAJES.remarketingLead(nombre, lead.servicio);

      await enviarMensaje(lead.userId, mensaje, lead.canal);
      await registrarRemarketing(lead.userId);
      console.log(`✅ Remarketing enviado a ${lead.userId} (${nombre})`);
    } catch (err) {
      console.error(`❌ Error en remarketing a ${lead.userId}:`, err.message);
    }
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

  for (const cliente of clientes) {
    try {
      const nombre = cliente.nombre || "amig@";
      let mensaje;

      if (cliente.cuponera === "si" && parseInt(cliente.sesRest) > 0) {
        mensaje = MENSAJES.seguimientoConCuponera(nombre, cliente.sesRest);
      } else {
        mensaje = MENSAJES.seguimientoPostSesion(nombre);
      }

      await enviarMensaje(cliente.userId, mensaje, cliente.canal);
      await registrarRemarketing(cliente.userId);
      console.log(`✅ Seguimiento enviado a ${cliente.userId} (${nombre})`);
    } catch (err) {
      console.error(`❌ Error en seguimiento a ${cliente.userId}:`, err.message);
    }
  }
}

// ============================================================
// INICIAR TODOS LOS SCHEDULERS
// ============================================================
function startScheduler() {
  // Recordatorios: cada hora en punto
  cron.schedule("0 * * * *", enviarRecordatorios, {
    timezone: "America/Montevideo",
  });

  // Remarketing: lunes, miércoles y viernes a las 10:00
  cron.schedule("0 10 * * 1,3,5", enviarRemarketing, {
    timezone: "America/Montevideo",
  });

  // Seguimiento post-sesión: todos los días a las 11:00
  cron.schedule("0 11 * * *", enviarSeguimientoPostSesion, {
    timezone: "America/Montevideo",
  });

  console.log("🗓️ Schedulers iniciados: recordatorios (c/hora), remarketing (L/X/V 10:00), seguimiento (11:00)");
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
📍 [TU DIRECCIÓN]

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

module.exports = { startScheduler, getTemplatesMeta };
