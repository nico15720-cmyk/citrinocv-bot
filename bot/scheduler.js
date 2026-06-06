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
const { getDisponibilidad, formatearDisponibilidad } = require("./calendar");
const { tomarDecisiones } = require("./consciousness");
const { verificarSalud } = require("./utils");

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const OWNER = process.env.OWNER_WHATSAPP;

// ============================================================
// MENSAJES
// ============================================================
const MENSAJES = {
  confirmacionTurno: (nombre, fecha, hora, servicio) =>
    `¡Hola ${nombre}! 🌿 Tu turno en Citrino quedó confirmado.\n\n` +
    `📅 *${fecha} a las ${hora}*\n` +
    `💆 ${servicio}\n` +
    `📍 Sarandí 554 apto. 1 — Frente a Plaza Matriz, Ciudad Vieja\n\n` +
    `Acordate de llegar 5 minutitos antes 🙏 Cualquier consulta por acá.`,

  recordatorio24hs: (nombre, fecha, hora) =>
    `¡Hola ${nombre}! 👋 Te recuerdo que mañana tenés turno en Citrino.\n\n` +
    `📅 *${fecha} a las ${hora}*\n\n` +
    `¿Confirmás que venís? Respondé *SÍ* para confirmar o *NO* si necesitás cancelar/reagendar.`,

  remarketingLead: (nombre, servicio) =>
    `¡Hola ${nombre || ""}! 🌿 Te escribimos de Citrino.\n\n` +
    `Vimos que consultaste sobre ${servicio || "nuestros masajes"} y queríamos saber si pudimos ayudarte.\n\n` +
    `Si todavía te interesa agendar, tenemos buenos horarios disponibles esta semana ✨\n` +
    `¿Te cuento más?`,

  remarketingClientaVino: (nombre) =>
    `¡Hola ${nombre || ""}! 🌿 ¿Cómo andás?\n\n` +
    `Hace un tiempo que no te vemos por Citrino y te extrañamos 💛\n\n` +
    `Si necesitás un espacio para vos, tenemos turnos disponibles. ¿Agendamos?`,

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
      const nombre = lead.nombre || "";
      let mensaje;

      if (lead.estado === "vino") {
        mensaje = MENSAJES.remarketingClientaVino(nombre);
      } else {
        mensaje = MENSAJES.remarketingLead(nombre, lead.servicio);
      }

      await enviarMensaje(lead.userId, mensaje, lead.canal || "whatsapp");
      await registrarRemarketing(lead.userId);
      console.log(`✅ Remarketing enviado a ${lead.userId} (${nombre}) [${lead.categoria}]`);
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
  console.log("📊 Enviando resumen diario a Nico...");

  try {
    const [clientes, disponibilidad] = await Promise.all([
      leerTodosLosClientes(),
      getDisponibilidad(),
    ]);

    const hoy = new Date();
    const manana = new Date(hoy.getTime() + 24 * 60 * 60 * 1000);
    const inicioHoy = new Date(hoy); inicioHoy.setHours(0, 0, 0, 0);

    const turnosManana = clientes.filter(c => {
      if (!c.FechaTurno || c.Estado !== "agendado") return false;
      return new Date(c.FechaTurno).toDateString() === manana.toDateString();
    });

    const noConfirmados = turnosManana.filter(c => !c.Notas?.includes("confirmó"));

    const vinieronHoy = clientes.filter(c => c.Estado === "vino" && c.UltimoContacto && new Date(c.UltimoContacto) >= inicioHoy);
    const leadsHoy = clientes.filter(c => c.Estado === "lead" && c.FechaAlta && new Date(c.FechaAlta) >= inicioHoy);

    const diaManana = manana.toLocaleDateString("es-UY", { weekday: "long", timeZone: "America/Montevideo" });

    // Mensaje CORTO
    let msg = `📋 *Citrino — resumen 20hs*\n`;
    msg += `Hoy vinieron: ${vinieronHoy.length} · Leads nuevos: ${leadsHoy.length}\n\n`;

    if (turnosManana.length > 0) {
      msg += `📅 *${diaManana.charAt(0).toUpperCase() + diaManana.slice(1)}:*\n`;
      turnosManana.forEach(c => {
        const hora = new Date(c.FechaTurno).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", timeZone: "America/Montevideo" });
        msg += `• ${c.Nombre || c.ID} ${hora} — ${c.Servicio || ""}\n`;
      });
    } else {
      msg += `📅 *${diaManana}:* sin turnos agendados`;
    }

    if (noConfirmados.length > 0) {
      msg += `\n⚠️ Sin confirmar: ${noConfirmados.map(c => c.Nombre || c.ID).join(", ")}`;
    }

    await enviarMensaje(OWNER, msg.trim(), "whatsapp");
    console.log("✅ Resumen diario enviado a Nico");
  } catch (err) {
    console.error("❌ Error enviando resumen diario:", err.message);
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
      leerTerapeutas().catch(() => [{ nombre: "Citrino" }]),
    ]);

    if (!eventos.length) return; // sin agenda, no molestar

    const diaLabel = manana.toLocaleDateString("es-UY", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Montevideo" });

    // Agrupar por terapeuta
    const grupos = {};
    eventos.forEach(ev => {
      const terapeuta = terapeutas.find(t => ev.titulo?.toLowerCase().includes(t.nombre?.toLowerCase())) || terapeutas[0];
      const nombre = terapeuta?.nombre || "Citrino";
      if (!grupos[nombre]) grupos[nombre] = [];
      const hora = new Date(ev.inicio).toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", timeZone: "America/Montevideo" });
      grupos[nombre].push(`${hora} ${ev.clienteNombre || ev.titulo}`);
    });

    let msg = `📅 *Agenda ${diaLabel.charAt(0).toUpperCase() + diaLabel.slice(1)}*\n`;
    Object.entries(grupos).forEach(([ter, items]) => {
      msg += `\n*${ter}:*\n`;
      items.forEach(i => msg += `• ${i}\n`);
    });
    msg += `\n_Agenda confirmada ✓_`;

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
// AUTO-REVIEW 3AM — Claude analiza el sistema y se auto-corrige
// ============================================================
async function autoReview3am() {
  console.log("🔍 Auto-review 3am iniciado...");
  if (!OWNER) return;

  try {
    const [stats, clientes] = await Promise.all([
      getStats().catch(() => ({})),
      leerTodosLosClientes().catch(() => []),
    ]);

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      system: `Sos el sistema de auto-monitoreo del Citrino Bot. Analizás el estado del negocio de madrugada y detectás problemas o oportunidades. Respondés en español, directo y conciso.`,
      messages: [{
        role: "user",
        content: `Análisis nocturno del sistema (${new Date().toLocaleDateString("es-UY")}):
- Total clientas CRM: ${stats.total || 0}
- Leads sin atender: ${stats.leads || 0}
- Agendadas: ${stats.agendados || 0}
- Sin volver en 30+ días: ${clientes.filter(c => {
  if (!c.UltimoContacto) return false;
  return Math.floor((Date.now() - new Date(c.UltimoContacto)) / 86400000) > 30;
}).length}
- Con cuponera pero sin turno: ${clientes.filter(c => c.Cuponera === "si" && c.Estado !== "agendado").length}

Identificá: ¿hay algo urgente que atender? ¿alguna oportunidad de negocio obvia? ¿algún problema en los datos?
Sé muy breve, máximo 3 puntos. Si todo está bien, decí solo "✅ Sistema OK, sin alertas nocturnas."`,
      }],
    });

    const analisis = response.content[0].text;
    const hayProblema = !analisis.includes("✅ Sistema OK");

    if (hayProblema) {
      await enviarMensaje(
        OWNER,
        `🌙 *Auto-revisión 3am*\n\n${analisis}`,
        "whatsapp"
      ).catch(() => {});
    }

    console.log("✅ Auto-review 3am completado");
  } catch (err) {
    console.error("❌ Error en auto-review:", err.message);
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

    const parsed = JSON.parse(resp.content[0].text.trim());
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

  // Resumen diario para Nico a las 20:00
  cron.schedule("0 20 * * *", enviarResumenDiario, {
    timezone: "America/Montevideo",
  });

  // Agenda del día siguiente a las 20:05
  cron.schedule("5 20 * * *", enviarAgendaManana, {
    timezone: "America/Montevideo",
  });

  // Agenda para terapeutas a las 19:00
  cron.schedule("0 19 * * *", enviarAgendaTerapeutas, {
    timezone: "America/Montevideo",
  });

  // Conciencia: análisis del negocio cada 6 horas
  cron.schedule("0 */6 * * *", tomarDecisiones, {
    timezone: "America/Montevideo",
  });

  // Verificación de salud cada 4 horas
  cron.schedule("0 */4 * * *", verificarSalud, {
    timezone: "America/Montevideo",
  });

  // Alerta vencimiento token Meta — todos los días a las 9:00
  cron.schedule("0 9 * * *", verificarVencimientoToken, {
    timezone: "America/Montevideo",
  });

  // Auto-review nocturno a las 3:00am
  cron.schedule("0 3 * * *", autoReview3am, {
    timezone: "America/Montevideo",
  });

  console.log("🗓️ Schedulers iniciados: recordatorios (c/hora), remarketing (L/X/V 10:00), seguimiento (11:00), resumen diario (20:00), conciencia (c/6hs), salud (c/4hs)");
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
