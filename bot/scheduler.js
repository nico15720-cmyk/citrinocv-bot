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

  // ── REMARKETING DIFERENCIADO POR OBJECIÓN ──────────────────
  remarketingPrecio: (nombre) =>
    `¡Hola ${nombre || ""}! 🌿 Te escribimos de Citrino.\n\n` +
    `Sabemos que el precio a veces es una barrera, así que te cuento: si pagás por transferencia o en efectivo tenés un *10% de descuento* 💛\n\n` +
    `¿Querés que te busquemos un horario esta semana?`,

  remarketingDuda: (nombre, servicio) =>
    `¡Hola ${nombre || ""}! 🌿 Te escribimos de Citrino.\n\n` +
    `Consultaste sobre ${servicio || "el Método Citrino"} y queremos contarte que muchas clientas vienen con las mismas dudas y después de la primera sesión se enamoran 💆‍♀️\n\n` +
    `¿Querés que te cuente más o te buscamos un horario para que lo pruebes?`,

  remarketingTiempo: (nombre) =>
    `¡Hola ${nombre || ""}! 🌿 Te escribimos de Citrino.\n\n` +
    `Sabemos que el tiempo es lo que más escasea 😅 Por eso te avisamos: tenemos turnos disponibles de 50 min que podés encajar en cualquier parte del día.\n\n` +
    `¿Cuál sería el mejor horario para vos esta semana?`,

  remarketingLead: (nombre, servicio) =>
    `¡Hola ${nombre || ""}! 🌿 Te escribimos de Citrino.\n\n` +
    `Vimos que consultaste sobre ${servicio || "nuestros masajes"} y queríamos saber si pudimos ayudarte.\n\n` +
    `Si todavía te interesa agendar, tenemos buenos horarios disponibles esta semana ✨\n` +
    `¿Te cuento más?`,

  remarketingClientaVino: (nombre) =>
    `¡Hola ${nombre || ""}! 🌿 ¿Cómo andás?\n\n` +
    `Hace un tiempo que no te vemos por Citrino y te extrañamos 💛\n\n` +
    `Si necesitás un espacio para vos, tenemos turnos disponibles. ¿Agendamos?`,

  // ── UPSELL PACK POST-SESIÓN (24-48hs después de venir) ──────
  upsellPack: (nombre) =>
    `¡Hola ${nombre}! 🌿 Esperamos que hayas disfrutado mucho tu sesión en Citrino 💆‍♀️\n\n` +
    `Te cuento que si querés continuar con el tratamiento, los packs te salen mucho mejor:\n\n` +
    `✨ *Pack 4 sesiones → $5.100* (te ahorras $900)\n` +
    `✨ *Pack 6 sesiones → $7.400* (te ahorras $1.600)\n` +
    `✨ *Pack 8 sesiones → $9.600* (te ahorras $2.400)\n\n` +
    `Los resultados se notan mucho más cuando es constante 🌿 ¿Te interesa?`,

  seguimientoPostSesion: (nombre) =>
    `¡Hola ${nombre}! 🌿 ¿Cómo te quedaste después de tu sesión en Citrino?\n\n` +
    `Esperamos que hayas disfrutado mucho 💆 Si querés repetir o tenés algún comentario, acá estamos.\n\n` +
    `¿Agendamos el próximo turno?`,

  seguimientoConCuponera: (nombre, sesRest) =>
    `¡Hola ${nombre}! 🌿 ¿Cómo estás? Te recuerdo que tenés *${sesRest} ${sesRest === "1" ? "sesión" : "sesiones"} disponibles* en tu cuponera de Citrino.\n\n` +
    `¿Cuándo agendamos? 🌿`,

  // ── RECUPERACIÓN DE NO-SHOW ──────────────────────────────────
  recuperacionNoShow: (nombre) =>
    `¡Hola ${nombre || ""}! 🌿 Vimos que hoy no pudiste venir a tu turno en Citrino, esperamos que estés bien 🙏\n\n` +
    `Cuando quieras reagendamos sin problema. ¿Cuándo te quedaría bien esta semana?`,
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
        // Remarketing diferenciado por objeción
        const objecion = (lead.objecion || "").toLowerCase();
        if (objecion.includes("precio") || objecion.includes("caro") || objecion.includes("plata")) {
          mensaje = MENSAJES.remarketingPrecio(nombre);
        } else if (objecion.includes("tiempo") || objecion.includes("horario") || objecion.includes("ocupad")) {
          mensaje = MENSAJES.remarketingTiempo(nombre);
        } else if (objecion.includes("duda") || objecion.includes("piensa") || objecion.includes("segur")) {
          mensaje = MENSAJES.remarketingDuda(nombre, lead.servicio);
        } else {
          mensaje = MENSAJES.remarketingLead(nombre, lead.servicio);
        }
      }

      await enviarMensaje(lead.userId, mensaje, lead.canal || "whatsapp");
      await registrarRemarketing(lead.userId);
      console.log(`✅ Remarketing enviado a ${lead.userId} (${nombre}) [objecion: ${lead.objecion || "ninguna"}]`);
    } catch (err) {
      console.error(`❌ Error en remarketing a ${lead.userId}:`, err.message);
    }
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

    for (const c of clientes) {
      try {
        if (c.Estado !== "vino") continue;
        if (!c.Fecha_Turno) continue;
        // Solo si vino entre 24 y 48hs atrás
        const diffHoras = (ahora - new Date(c.Fecha_Turno)) / (1000 * 60 * 60);
        if (diffHoras < 24 || diffHoras > 48) continue;
        // Solo si no tiene cuponera activa
        if (c.Cuponera === "si") continue;
        // Evitar reenviar (NOTAS como flag)
        if ((c.NOTAS || "").includes("[upsell_enviado]")) continue;

        const userId = c.ID_Cliente || c.Telefono;
        if (!userId) continue;

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

function normIdSch(v) {
  return String(v || "").replace(/[\s+\-().]/g, "").slice(-9);
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

async function getSaldoClienteBotSch(clienteId, clienteNombre) {
  try {
    const { readSheet } = require("./sheets-crm");
    const [clientesSheet, ventas, sesiones] = await Promise.all([
      readSheet("CLIENTES"),
      readSheet("VENTAS"),
      readSheet("SESIONES"),
    ]);
    const id9 = normIdSch(clienteId);
    const clienteRow = clientesSheet.find(c =>
      c.ID_Cliente === clienteId ||
      (id9 && normIdSch(c.Telefono) === id9) ||
      (clienteNombre && c.Nombre?.toLowerCase() === clienteNombre?.toLowerCase())
    );
    const hashId = clienteRow ? clienteRow.ID_Cliente : clienteId;
    const matchId = v => v === hashId || (id9 && normIdSch(v) === id9);

    const ventasCli = ventas.filter(v =>
      matchId(v.ID_Cliente_Guardado) &&
      PACK_KW_SCH.some(k => (v.Producto || "").toLowerCase().includes(k))
    );
    const sesionesCli = sesiones.filter(s =>
      matchId(s.ID_Cliente_Guardado || s.ID_Cliente)
    );
    const compradas = ventasCli.reduce((a, v) => a + cantidadProductoSch(v.Producto, v.Cantidad_Calculada), 0);
    const usadas    = sesionesCli.length;
    return { compradas, usadas, saldo: compradas - usadas };
  } catch {
    return { compradas: 0, usadas: 0, saldo: 0 };
  }
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
      const saldo = await getSaldoClienteBotSch(cid, s.Cliente);
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
    const { readSheet, updateClienteEstado } = require("./sheets-crm");
    const clientes = await readSheet("CLIENTES");
    const ahora = new Date();
    const inicioHoy = new Date(ahora); inicioHoy.setHours(0, 0, 0, 0);
    const finHoy = new Date(ahora); finHoy.setHours(21, 0, 0, 0);

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

        // Mensaje de recuperación (después de 1 hora)
        setTimeout(async () => {
          try {
            await enviarMensaje(userId, MENSAJES.recuperacionNoShow(c.Nombre || ""), c.Origen || "whatsapp");
          } catch {}
        }, 60 * 60 * 1000);

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
// CONFIRMACIÓN 15HS — DÍA ANTERIOR AL TURNO
// Corre todos los días a las 15:00
// ============================================================
async function enviarConfirmacion15hs() {
  console.log("📋 Enviando confirmaciones de turno (15hs)...");
  try {
    const { getClientesParaConfirmar, updateClienteEstado } = require("./sheets-crm");
    const clientes = await getClientesParaConfirmar();

    for (const cliente of clientes) {
      try {
        const nombre = cliente.Nombre || "cliente";
        const userId = cliente.ID_Cliente || cliente.Telefono;
        if (!userId) continue;

        const fechaTurno = new Date(cliente.Fecha_Turno);
        const hora = fechaTurno.toLocaleTimeString("es-UY", {
          hour: "2-digit", minute: "2-digit", timeZone: "America/Montevideo",
        });

        const msg =
          `¡Hola ${nombre}! 👋 Te confirmo que mañana tenés turno en Citrino.\n\n` +
          `🕐 *${hora} hs*\n` +
          `📍 Sarandí 554 apto. 1 — Frente a Plaza Matriz\n\n` +
          `¿Confirmás que venís? Respondé *SÍ* para confirmar o *NO* si necesitás cancelar 🙏`;

        await enviarMensaje(userId, msg, cliente.Origen || "whatsapp");
        // Marcar como pendiente de confirmación
        await updateClienteEstado(userId, "pendiente_confirmacion");
        console.log(`✅ Confirmación 15hs enviada a ${userId} (${nombre})`);
      } catch (err) {
        console.error(`❌ Error confirmación 15hs a ${cliente.ID_Cliente}:`, err.message);
      }
    }
  } catch (err) {
    console.error("❌ Error en confirmación 15hs:", err.message);
  }
}

// Nota: la agenda del día siguiente ya se envía a las 19hs (enviarAgendaTerapeutas)
// y el resumen a Nico a las 20:05 (enviarAgendaManana). No se necesita cron adicional.

// ============================================================
// INICIAR TODOS LOS SCHEDULERS
// ============================================================
function startScheduler() {
  // ── Salud del sistema ──────────────────────────────────────
  cron.schedule("0 */4 * * *", verificarSalud, { timezone: "America/Montevideo" });

  // ── Confirmaciones 15hs (día anterior al turno) ────────────
  cron.schedule("0 15 * * *", enviarConfirmacion15hs, { timezone: "America/Montevideo" });

  // ── Agenda mañana para terapeutas — 19:00 ─────────────────
  cron.schedule("0 19 * * *", enviarAgendaTerapeutas, { timezone: "America/Montevideo" });

  // ── Resumen diario para Nico — 20:05 ──────────────────────
  cron.schedule("5 20 * * *", enviarAgendaManana, { timezone: "America/Montevideo" });

  // ── Re-marketing leads sin turno (+7 días) — 10:30 ────────
  cron.schedule("30 10 * * *", enviarRemarketing, { timezone: "America/Montevideo" });

  // ── Seguimiento post-sesión — 11:00 ───────────────────────
  cron.schedule("0 11 * * *", enviarSeguimientoPostSesion, { timezone: "America/Montevideo" });

  // ── Upsell cuponera — 11:30 ───────────────────────────────
  cron.schedule("30 11 * * *", enviarUpsellPack, { timezone: "America/Montevideo" });

  // ── Check-in diario — 21:00 ────────────────────────────────
  cron.schedule("0 21 * * *", enviarCheckInDiario, { timezone: "America/Montevideo" });

  // ── No-shows: auto-cierre si Nico no respondió — 23:00 ─────
  cron.schedule("0 23 * * *", cerrarNoShows, { timezone: "America/Montevideo" });

  // ── Resumen semanal — lunes 8:00 ──────────────────────────
  cron.schedule("0 8 * * 1", enviarResumenSemanal, { timezone: "America/Montevideo" });

  // ── Resumen mensual — día 1 de cada mes 9:00 ──────────────
  cron.schedule("0 9 1 * *", enviarResumenMensual, { timezone: "America/Montevideo" });

  // ── Verificar vencimiento token WA — diario 9:00 ──────────
  if (typeof verificarVencimientoToken === "function") {
    cron.schedule("0 9 * * *", verificarVencimientoToken, { timezone: "America/Montevideo" });
  }

  // ── Auto-review nocturno — 3:00 ───────────────────────────
  cron.schedule("0 3 * * *", autoReview3am, { timezone: "America/Montevideo" });

  console.log("🗓️ Scheduler iniciado:");
  console.log("  • 03:00 auto-review nocturno");
  console.log("  • 09:00 verificar token WA");
  console.log("  • 10:30 remarketing leads +7d");
  console.log("  • 11:00 seguimiento post-sesión");
  console.log("  • 11:30 upsell cuponera");
  console.log("  • 15:00 confirmaciones día siguiente");
  console.log("  • 19:00 agenda para terapeutas");
  console.log("  • 20:05 resumen diario para Nico");
  console.log("  • 21:00 cerrar no-shows");
  console.log("  • lunes 08:00 resumen semanal");
  console.log("  • día 1 09:00 resumen mensual");
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
