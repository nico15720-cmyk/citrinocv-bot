// ============================================================
// CITRINO BOT — Módulo Admin (solo para el dueño)
// ============================================================

const Anthropic = require("@anthropic-ai/sdk");
const { enviarMensaje } = require("./sender");
const {
  leerTodosLosClientes,
  getStats,
  registrarAsistencia,
  registrarCuponera,
  actualizarNotas,
  buscarCliente,
  actualizarEstado,
} = require("./crm");
const {
  crearTurno,
  resolverSlot,
  getEventosAgenda,
  getDisponibilidad,
  marcarAsistencia,
  cancelarTurno,
} = require("./calendar");
const { detectarYAplicarCambio } = require("./self-fix");
const { reporteLeads, reporteVIP, reporteInactivos, reporteCuponeras, reporteAgendadas } = require("./reportes");

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const TIMEZONE = "America/Montevideo";

// Historial de conversación admin (en memoria)
const historialAdmin = [];
function agregarAdmin(role, content) {
  historialAdmin.push({ role, content });
  if (historialAdmin.length > 30) historialAdmin.splice(0, 30);
}

// ============================================================
// RECOLECTAR DATOS DEL NEGOCIO PARA CONTEXTO
// ============================================================
async function recolectarDatosNegocio() {
  try {
    const ahora = new Date();
    const en7dias = new Date(ahora.getTime() + 7 * 24 * 60 * 60 * 1000);
    const haceUnaSemana = new Date(ahora.getTime() - 7 * 24 * 60 * 60 * 1000);
    const haceUnMes = new Date(ahora.getTime() - 30 * 24 * 60 * 60 * 1000);
    const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1);

    const [stats, clientes, sesiones] = await Promise.all([
      getStats(),
      leerTodosLosClientes(),
      getEventosAgenda(ahora, en7dias).catch(() => []),
    ]);

    // Métricas del CRM
    const nuevasEstaSemana = clientes.filter(c => c.FechaAlta && new Date(c.FechaAlta) >= haceUnaSemana).length;
    const sinRegresarMes = clientes.filter(c =>
      c.UltimoContacto && new Date(c.UltimoContacto) < haceUnMes && c.Estado === "vino"
    ).length;
    const leadsSinAtender = clientes.filter(c =>
      c.Estado === "lead" && c.UltimoContacto && new Date(c.UltimoContacto) < new Date(ahora.getTime() - 24 * 60 * 60 * 1000)
    ).length;
    const vinieronEsteMes = clientes.filter(c =>
      c.Estado === "vino" && c.UltimoContacto && new Date(c.UltimoContacto) >= inicioMes
    ).length;

    // Sesiones de la hoja Sesiones — agrupadas por día, con ID para acciones
    const sesionesMapeadas = sesiones
      .filter(ev => ev.estado !== "cancelado")
      .map(ev => {
        const inicio = new Date(ev.inicio);
        return {
          id: ev.id,
          clienteNombre: ev.clienteNombre || "?",
          clienteId: ev.clienteId || "",
          terapeuta: ev.terapeuta || "",
          servicio: ev.servicio || "",
          estado: ev.estado || "confirmado",
          fecha: inicio.toLocaleDateString("es-UY", { weekday: "short", day: "numeric", month: "short", timeZone: TIMEZONE }),
          hora: inicio.toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", timeZone: TIMEZONE }),
          fechaISO: ev.inicio,
        };
      });

    // Agrupar sesiones por día para el contexto
    const sesionesAgrupadas = {};
    sesionesMapeadas.forEach(s => {
      if (!sesionesAgrupadas[s.fecha]) sesionesAgrupadas[s.fecha] = [];
      sesionesAgrupadas[s.fecha].push(s);
    });

    return {
      stats,
      totales: {
        clientes: clientes.length,
        agendadas: stats.agendados,
        vinieron: stats.vinieron,
        leads: stats.leads,
        canceladas: stats.cancelados,
        conCuponera: stats.conCuponera,
        ingresosMes: vinieronEsteMes * 1400,
      },
      nuevasEstaSemana,
      sinRegresar30dias: sinRegresarMes,
      leadsSinAtender,
      sesiones: sesionesMapeadas,        // lista plana con IDs para acciones
      sesionesAgrupadas,                  // agrupadas por día para el contexto
      totalClientes: clientes,
    };
  } catch (e) {
    console.error("❌ Error recolectarDatosNegocio:", e.message);
    return { error: e.message, totales: {}, sesiones: [], sesionesAgrupadas: {}, totalClientes: [] };
  }
}

// ============================================================
// EJECUTAR ACCIONES ADMIN
// ============================================================
async function ejecutarAccionAdmin(accion, datos) {
  const clientes = datos.totalClientes || [];
  const sesiones = datos.sesiones || [];

  try {
    switch (accion.tipo) {

      // ── Marcar asistencia de sesión en hoja Sesiones ─────────
      case "marcar_sesion": {
        const estadoSesion = accion.vino !== false ? "vino" : "no_vino";

        // Buscar sesión por nombre de cliente (case-insensitive, parcial)
        const busqueda = (accion.nombre || "").toLowerCase();
        let sesion = sesiones.find(s =>
          s.clienteNombre?.toLowerCase().includes(busqueda) && s.estado !== "vino" && s.estado !== "no_vino"
        );

        // Si no encontró pendiente, buscar cualquiera del día
        if (!sesion && accion.nombre) {
          sesion = sesiones.find(s => s.clienteNombre?.toLowerCase().includes(busqueda));
        }

        if (!sesion?.id) {
          return `⚠️ No encontré sesión para "${accion.nombre}". Sesiones disponibles: ${sesiones.slice(0,5).map(s => s.clienteNombre).join(", ")}`;
        }

        await marcarAsistencia(sesion.id, estadoSesion);

        // También actualizar CRM si tiene ID de cliente
        if (sesion.clienteId) {
          await registrarAsistencia(sesion.clienteId, accion.vino !== false).catch(() => {});
        }

        const emoji = estadoSesion === "vino" ? "✅" : "❌";
        return `${emoji} *${sesion.clienteNombre}* — marcada como *${estadoSesion}* (${sesion.hora})`;
      }

      // ── Cancelar sesión en hoja Sesiones ─────────────────────
      case "cancelar_sesion": {
        const busqueda = (accion.nombre || accion.hora || "").toLowerCase();
        const sesion = sesiones.find(s =>
          s.clienteNombre?.toLowerCase().includes(busqueda) ||
          s.hora?.includes(busqueda)
        );

        if (!sesion?.id) {
          return `⚠️ No encontré la sesión de "${accion.nombre || accion.hora}". Sesiones: ${sesiones.slice(0,5).map(s => `${s.hora} ${s.clienteNombre}`).join(", ")}`;
        }

        await cancelarTurno(sesion.id);
        return `🗑️ Sesión cancelada: *${sesion.clienteNombre}* — ${sesion.hora}`;
      }

      // ── Marcar asistencia en CRM (cliente por nombre/tel) ────
      case "marcar_asistencia": {
        const cliente = clientes.find(c =>
          c.Nombre?.toLowerCase().includes((accion.nombre || "").toLowerCase()) ||
          c.ID === accion.telefono
        );
        if (!cliente) return `⚠️ No encontré a "${accion.nombre}" en el CRM.`;
        await registrarAsistencia(cliente.ID, accion.vino !== false);
        return `✅ ${cliente.Nombre} — marcada como ${accion.vino !== false ? "vino" : "no vino"} en el CRM.`;
      }

      // ── Nota de cliente ───────────────────────────────────────
      case "agregar_nota": {
        const cliente = clientes.find(c =>
          c.Nombre?.toLowerCase().includes((accion.nombre || "").toLowerCase()) ||
          c.ID === accion.telefono
        );
        if (!cliente) return `⚠️ No encontré a "${accion.nombre}".`;
        await actualizarNotas(cliente.ID, accion.nota);
        return `📝 Nota agregada a *${cliente.Nombre}*: "${accion.nota}"`;
      }

      // ── Registrar cuponera ────────────────────────────────────
      case "registrar_cuponera": {
        const cliente = clientes.find(c =>
          c.Nombre?.toLowerCase().includes((accion.nombre || "").toLowerCase()) ||
          c.ID === accion.telefono
        );
        if (!cliente) return `⚠️ No encontré a "${accion.nombre}".`;
        const sesionesN = accion.sesiones || 4;
        await registrarCuponera(cliente.ID, sesionesN);
        return `🎟️ Cuponera de *${sesionesN} sesiones* registrada para *${cliente.Nombre}*.`;
      }

      // ── Cambiar estado CRM ───────────────────────────────────
      case "cambiar_estado": {
        const cliente = clientes.find(c =>
          c.Nombre?.toLowerCase().includes((accion.nombre || "").toLowerCase()) ||
          c.ID === accion.telefono
        );
        if (!cliente) return `⚠️ No encontré a "${accion.nombre}".`;
        await actualizarEstado(cliente.ID, accion.estado);
        return `✅ *${cliente.Nombre}* → estado cambiado a "${accion.estado}".`;
      }

      // ── Agendar turno nuevo ───────────────────────────────────
      case "agendar_turno": {
        let slot;
        if (accion.slot_id) {
          // Slot ya resuelto
          const slots = await getDisponibilidad();
          slot = slots.find(s => s.inicioISO === accion.slot_id) || slots[0];
        } else {
          slot = await resolverSlot(accion.dia || accion.fecha || "", accion.hora || "").catch(() => null);
        }

        if (!slot) {
          const slots = await getDisponibilidad();
          const proximos = slots.slice(0, 5).map(s => s.label).join(", ");
          return `⚠️ No encontré el horario ${accion.hora || ""} del ${accion.dia || accion.fecha || ""}.\nSlots disponibles: ${proximos}`;
        }

        const evento = await crearTurno({
          nombre: accion.nombre || "Clienta",
          telefono: accion.telefono || "sin-tel",
          servicio: accion.servicio || "Masaje Descontracturante",
          slot,
        });

        return `✅ *Turno creado en la Agenda*\n📅 ${slot.label}\n👤 ${accion.nombre || "Clienta"}\n💆 ${accion.servicio || "Masaje"}`;
      }

      // ── Generar reporte en Sheets ─────────────────────────────
      case "generar_reporte": {
        let resultado;
        const tipo = (accion.tipo_reporte || "").toLowerCase();
        if (tipo.includes("lead")) resultado = await reporteLeads(clientes);
        else if (tipo.includes("vip")) resultado = await reporteVIP(clientes);
        else if (tipo.includes("inacti")) resultado = await reporteInactivos(clientes, accion.dias || 30);
        else if (tipo.includes("cupon")) resultado = await reporteCuponeras(clientes);
        else if (tipo.includes("agend")) resultado = await reporteAgendadas(clientes);
        else resultado = await reporteLeads(clientes);
        return `📊 *Reporte "${resultado.tab}"* — ${resultado.registros} registros\n🔗 ${resultado.url}`;
      }

      default:
        return null;
    }
  } catch (e) {
    console.error("❌ Error acción admin:", e.message);
    return `❌ Error: ${e.message}`;
  }
}

// ============================================================
// CONSTRUIR CONTEXTO DE SESIONES PARA EL SYSTEM PROMPT
// ============================================================
function formatearSesionesContexto(sesionesAgrupadas) {
  if (!sesionesAgrupadas || !Object.keys(sesionesAgrupadas).length) {
    return "Sin sesiones en los próximos 7 días.";
  }
  return Object.entries(sesionesAgrupadas).map(([fecha, ss]) => {
    const items = ss.map(s => `  • ${s.hora} | ${s.clienteNombre} | ${s.terapeuta || "–"} | ${s.estado}`).join("\n");
    return `📅 ${fecha} (${ss.length} turno${ss.length !== 1 ? "s" : ""}):\n${items}`;
  }).join("\n\n");
}

// ============================================================
// HANDLER PRINCIPAL ADMIN
// ============================================================
async function handleAdminMessage({ text, platform }) {
  const ownerId = process.env.OWNER_WHATSAPP;
  console.log(`🔑 [ADMIN] Mensaje: ${text?.slice(0, 80)}`);

  // Recolectar datos frescos
  const datos = await recolectarDatosNegocio();
  const clientes = datos.totalClientes || [];

  // ── SELF-FIX: detectar instrucción de cambio de config ──
  const cambioAplicado = await detectarYAplicarCambio(text);
  if (cambioAplicado) {
    await enviarMensaje(ownerId, `✅ *Cambio aplicado:* ${cambioAplicado}`, platform);
    return;
  }

  // Construir contexto de negocio
  const resumenNegocio = `
=== DATOS DEL NEGOCIO (${new Date().toLocaleDateString("es-UY", { timeZone: TIMEZONE })}) ===

CRM:
• Total clientas: ${datos.totales?.clientes || 0}
• Agendadas: ${datos.totales?.agendadas || 0} | Vinieron: ${datos.totales?.vinieron || 0}
• Leads activos: ${datos.totales?.leads || 0} | Sin atender +24hs: ${datos.leadsSinAtender || 0}
• Con cuponera: ${datos.totales?.conCuponera || 0}
• Nuevas esta semana: ${datos.nuevasEstaSemana || 0}
• Sin regresar +30 días: ${datos.sinRegresar30dias || 0}
• Ingresos estimados este mes: $${(datos.totales?.ingresosMes || 0).toLocaleString("es-UY")} UYU

SESIONES PRÓXIMOS 7 DÍAS (hoja Sesiones — misma fuente que /app/agenda/):
${formatearSesionesContexto(datos.sesionesAgrupadas)}

CLIENTAS EN CRM (primeras 20):
${clientes.slice(0, 20).map(c =>
    `• ${c.Nombre || "–"} | ${c.ID} | ${c.Estado} | ${c.Servicio || "–"} | última visita: ${c.UltimoContacto?.split("T")[0] || "–"}`
  ).join("\n")}${clientes.length > 20 ? `\n... y ${clientes.length - 20} más` : ""}
`.trim();

  agregarAdmin("user", text);

  let respuesta;
  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1000,
      system: `Sos el panel de control privado de Citrino. Solo hablás con Nico, el dueño.
Sos directo, conciso, usás "vos". Respondés siempre en base a los datos reales del contexto.

⚠️ IMPORTANTE:
- Google Sheets (CRM + hoja Sesiones) están CONECTADOS. Los datos son REALES.
- Las sesiones del contexto son las mismas que ve Nico en citrinobienestar.uy/app/agenda/
- NUNCA digas que no estás conectado o que no tenés datos.

═══ ACCIONES DISPONIBLES ═══
Cuando Nico te manda texto libre, extraés la info y ejecutás las acciones necesarias.
Podés ejecutar MÚLTIPLES acciones seguidas (un bloque por acción).

<admin_accion>{"tipo":"marcar_sesion","nombre":"Nadia","vino":true}</admin_accion>
→ Marca sesión en la hoja Sesiones (por nombre de clienta). vino:false para ausencia.

<admin_accion>{"tipo":"marcar_sesion","nombre":"Nadia","vino":false}</admin_accion>
→ Marca ausencia de Nadia en la hoja Sesiones.

<admin_accion>{"tipo":"cancelar_sesion","nombre":"Ana"}</admin_accion>
→ Cancela la sesión de Ana en la hoja Sesiones. También podés buscar por hora: {"hora":"15:30"}

<admin_accion>{"tipo":"agregar_nota","nombre":"María","nota":"le dolía la zona lumbar"}</admin_accion>
→ Agrega nota en el CRM de María.

<admin_accion>{"tipo":"registrar_cuponera","nombre":"Laura","sesiones":6}</admin_accion>
→ Registra cuponera de N sesiones en el CRM.

<admin_accion>{"tipo":"cambiar_estado","nombre":"Julia","estado":"cancelado"}</admin_accion>
→ Cambia estado en el CRM. Estados: lead, agendado, vino, no_vino, cancelado.

<admin_accion>{"tipo":"agendar_turno","nombre":"Susana","telefono":"098123456","dia":"mañana","hora":"10:30","servicio":"Masaje Descontracturante"}</admin_accion>
→ Crea nueva sesión en la hoja Sesiones. Usá siempre esta acción para agendar.

<admin_accion>{"tipo":"generar_reporte","tipo_reporte":"leads"}</admin_accion>
→ Crea pestaña en Sheets. Tipos: leads, vip, inactivas, cuponeras, agendadas.

═══ EJEMPLOS DE PROCESAMIENTO ═══
"Nadia vino hoy, le dolía la zona lumbar"
→ marcar_sesion (vino:true) + agregar_nota

"Ana no vino"
→ marcar_sesion (vino:false)

"Cancelá el turno de las 15:30"
→ cancelar_sesion (hora:"15:30")

"Laura compró cuponera de 6"
→ registrar_cuponera (sesiones:6)

"Agendá a Susana mañana a las 10:30"
→ agendar_turno

"¿Qué tengo mañana?" / "¿Hay algo mañana?"
→ Mirá las sesiones del contexto y respondé con los datos reales. Formato: hora + nombre + terapeuta.

"Dame la lista de leads"
→ generar_reporte (tipo:leads)

"¿Quién faltó esta semana?"
→ Buscá sesiones con estado no_vino en el contexto.

═══ CLASIFICACIÓN DE CLIENTAS ═══
VIP 🌟 cuponera activa + viene seguido | Regular 💚 cada 2-4 semanas
Lead tibio 🌡️ consultó, tiene potencial | Lead frío ❄️ sin respuesta +48hs
En riesgo ⚠️ no volvió en +30 días

${resumenNegocio}`,
      messages: historialAdmin.map(m => ({ role: m.role, content: m.content })),
    });

    const textoRespuesta = response.content[0].text;
    console.log(`🔑 [ADMIN] Respuesta: ${textoRespuesta.slice(0, 100)}`);

    // ── Ejecutar TODAS las acciones (múltiples bloques) ──────
    const accionRegex = /<admin_accion>([\s\S]*?)<\/admin_accion>/g;
    const matches = [...textoRespuesta.matchAll(accionRegex)];
    let respuestaFinal = textoRespuesta.replace(accionRegex, "").trim();
    const resultadosAcciones = [];

    for (const match of matches) {
      try {
        const accion = JSON.parse(match[1]);
        const resultado = await ejecutarAccionAdmin(accion, datos);
        if (resultado) resultadosAcciones.push(resultado);
      } catch (e) {
        console.error("❌ Error ejecutando acción:", e.message);
      }
    }

    if (resultadosAcciones.length) {
      respuestaFinal = respuestaFinal
        ? `${respuestaFinal}\n\n${resultadosAcciones.join("\n")}`
        : resultadosAcciones.join("\n");
    }

    respuesta = respuestaFinal || "✅ Hecho.";
  } catch (err) {
    console.error("❌ Error admin:", err.message);
    respuesta = `❌ Error: ${err.message}`;
  }

  agregarAdmin("assistant", respuesta);
  await enviarMensaje(ownerId, respuesta, platform);
}

module.exports = { handleAdminMessage };
