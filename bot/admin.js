// ============================================================
// CITRINO BOT — Módulo Admin (solo para el dueño)
// El dueño le escribe por WhatsApp y Marta responde con datos
// del negocio, CRM, estadísticas y acciones de gestión.
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
  obtenerTodosLosPerfiles,
  actualizarEstado,
} = require("./crm");
const { crearTurno, resolverSlot, getEventosAgenda, getDisponibilidad, formatearDisponibilidad } = require("./calendar");
const { detectarYAplicarCambio } = require("./self-fix");
const { reporteLeads, reporteVIP, reporteInactivos, reporteCuponeras, reporteAgendadas } = require("./reportes");

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Historial de conversación admin (en memoria)
const historialAdmin = [];

function agregarAdmin(role, content) {
  historialAdmin.push({ role, content });
  if (historialAdmin.length > 30) historialAdmin.splice(0, historialAdmin.length - 30);
}

// ============================================================
// RECOLECTAR DATOS DEL NEGOCIO PARA CONTEXTO
// ============================================================
async function recolectarDatosNegocio() {
  try {
    // Eventos del calendar: hoy + próximos 7 días
    const ahora = new Date();
    const en7dias = new Date(ahora.getTime() + 7 * 24 * 60 * 60 * 1000);

    const [stats, clientes, eventosCalendar] = await Promise.all([
      getStats(),
      leerTodosLosClientes(),
      getEventosAgenda(ahora, en7dias).catch(() => []),
    ]);

    const hoy = new Date();
    const haceUnaSemana = new Date(hoy - 7 * 24 * 60 * 60 * 1000);
    const haceUnMes = new Date(hoy - 30 * 24 * 60 * 60 * 1000);

    // Clientas con turno próximo (próximos 2 días)
    const proximas48h = new Date(hoy.getTime() + 48 * 60 * 60 * 1000);
    const conTurnoProximo = clientes.filter(c => {
      if (!c.FechaTurno || c.Estado !== "agendado") return false;
      const fecha = new Date(c.FechaTurno);
      return fecha >= hoy && fecha <= proximas48h;
    });

    // Clientas nuevas esta semana
    const nuevasEstaSemana = clientes.filter(c => {
      if (!c.FechaAlta) return false;
      return new Date(c.FechaAlta) >= haceUnaSemana;
    });

    // Clientas que no volvieron en 30+ días
    const sinRegresarMes = clientes.filter(c => {
      if (!c.UltimoContacto || c.Estado === "agendado") return false;
      return new Date(c.UltimoContacto) < haceUnMes && c.Estado === "vino";
    });

    // Leads sin atender (más de 24hs sin respuesta)
    const hace24h = new Date(hoy - 24 * 60 * 60 * 1000);
    const leadsSinAtender = clientes.filter(c =>
      c.Estado === "lead" && c.UltimoContacto && new Date(c.UltimoContacto) < hace24h
    );

    // Ingresos estimados del mes
    const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    const vinieronEsteMes = clientes.filter(c =>
      c.Estado === "vino" && c.UltimoContacto && new Date(c.UltimoContacto) >= inicioMes
    );

    return {
      stats,
      totales: {
        clientes: clientes.length,
        agendadas: stats.agendados,
        vinieron: stats.vinieron,
        leads: stats.leads,
        canceladas: stats.cancelados,
        conCuponera: stats.conCuponera,
        ingresosMes: vinieronEsteMes.length * 1400, // precio promedio estimado
      },
      proximas48h: conTurnoProximo,
      nuevasEstaSemana: nuevasEstaSemana.length,
      sinRegresar30dias: sinRegresarMes.length,
      leadsSinAtender: leadsSinAtender.length,
      // Sesiones de la hoja Sesiones (mismos datos que /app/agenda/)
      eventosCalendar: eventosCalendar.map(ev => ({
        clienteNombre: ev.clienteNombre || "Desconocido",
        terapeuta: ev.terapeuta || "",
        servicio: ev.servicio || "",
        estado: ev.estado || "confirmado",
        inicio: new Date(ev.inicio).toLocaleString("es-UY", {
          weekday: "short", day: "numeric", month: "short",
          hour: "2-digit", minute: "2-digit", timeZone: "America/Montevideo"
        }),
      })),
      totalClientes: clientes,
    };
  } catch (e) {
    return { error: e.message };
  }
}

// ============================================================
// EJECUTAR ACCIONES ADMIN (detectadas por Claude)
// ============================================================
async function ejecutarAccionAdmin(accion, clientes) {
  try {
    switch (accion.tipo) {

      case "marcar_asistencia": {
        // Buscar cliente por nombre o teléfono
        const cliente = clientes.find(c =>
          c.Nombre?.toLowerCase().includes(accion.nombre?.toLowerCase()) ||
          c.ID === accion.telefono
        );
        if (!cliente) return `No encontré a "${accion.nombre}" en el CRM.`;
        await registrarAsistencia(cliente.ID, accion.vino !== false);
        return `✅ Registré que ${cliente.Nombre} ${accion.vino !== false ? "vino" : "no vino"} a su sesión.`;
      }

      case "agregar_nota": {
        const cliente = clientes.find(c =>
          c.Nombre?.toLowerCase().includes(accion.nombre?.toLowerCase()) ||
          c.ID === accion.telefono
        );
        if (!cliente) return `No encontré a "${accion.nombre}".`;
        await actualizarNotas(cliente.ID, accion.nota);
        return `✅ Nota agregada a ${cliente.Nombre}: "${accion.nota}"`;
      }

      case "registrar_cuponera": {
        const cliente = clientes.find(c =>
          c.Nombre?.toLowerCase().includes(accion.nombre?.toLowerCase()) ||
          c.ID === accion.telefono
        );
        if (!cliente) return `No encontré a "${accion.nombre}".`;
        const sesiones = accion.sesiones || 4;
        await registrarCuponera(cliente.ID, sesiones);
        return `✅ Cuponera de ${sesiones} sesiones registrada para ${cliente.Nombre}.`;
      }

      case "cambiar_estado": {
        const cliente = clientes.find(c =>
          c.Nombre?.toLowerCase().includes(accion.nombre?.toLowerCase()) ||
          c.ID === accion.telefono
        );
        if (!cliente) return `No encontré a "${accion.nombre}".`;
        await actualizarEstado(cliente.ID, accion.estado);
        return `✅ Estado de ${cliente.Nombre} cambiado a "${accion.estado}".`;
      }

      case "agendar_turno": {
        // Buscar el slot en Calendar
        const slots = await getDisponibilidad();
        // Buscar por fecha y hora aproximada
        const slotBuscado = slots.find(s => {
          const fechaSlot = new Date(s.inicioISO);
          const diaCorrecto = accion.fecha
            ? fechaSlot.toLocaleDateString("es-UY", { timeZone: "America/Montevideo" }).includes(accion.fecha) ||
              s.fecha === accion.fecha ||
              fechaSlot.toLocaleDateString("es-UY", { weekday: "long", timeZone: "America/Montevideo" }).toLowerCase().includes((accion.dia || "").toLowerCase())
            : false;
          const horaSlot = fechaSlot.toLocaleTimeString("es-UY", { hour: "2-digit", minute: "2-digit", timeZone: "America/Montevideo" });
          const horaCorrecto = accion.hora ? horaSlot === accion.hora || horaSlot.startsWith(accion.hora.replace(":00","").replace("hs","").trim()) : false;
          return diaCorrecto && horaCorrecto;
        });

        if (!slotBuscado) {
          // Intentar con resolverSlot
          const slot = await resolverSlot(accion.dia || accion.fecha || "", accion.hora || "").catch(() => null);
          if (!slot) {
            return `⚠️ No encontré el horario ${accion.hora} del ${accion.dia || accion.fecha}. Los slots disponibles son:\n${slots.slice(0,5).map(s=>s.label).join(", ")}`;
          }
          const evento = await crearTurno({
            nombre: accion.nombre || "Clienta",
            telefono: accion.telefono || "sin-tel",
            servicio: accion.servicio || "Sesión",
            slot,
          });
          return `✅ *Turno creado en Google Calendar*\n📅 ${slot.label}\n👤 ${accion.nombre || "Clienta"}\n💆 ${accion.servicio || "Sesión"}\n🔗 Link: ${evento.htmlLink || "ver en Calendar"}`;
        }

        const evento = await crearTurno({
          nombre: accion.nombre || "Clienta",
          telefono: accion.telefono || "sin-tel",
          servicio: accion.servicio || "Sesión",
          slot: slotBuscado,
        });
        return `✅ *Turno creado en Google Calendar*\n📅 ${slotBuscado.label}\n👤 ${accion.nombre || "Clienta"}\n💆 ${accion.servicio || "Sesión"}\n🔗 Link: ${evento.htmlLink || "ver en Calendar"}`;
      }

      case "generar_reporte": {
        let resultado;
        const tipo = (accion.tipo_reporte || "").toLowerCase();
        if (tipo.includes("lead")) resultado = await reporteLeads(clientes);
        else if (tipo.includes("vip")) resultado = await reporteVIP(clientes);
        else if (tipo.includes("inacti")) resultado = await reporteInactivos(clientes, accion.dias || 30);
        else if (tipo.includes("cupon")) resultado = await reporteCuponeras(clientes);
        else if (tipo.includes("agend")) resultado = await reporteAgendadas(clientes);
        else resultado = await reporteLeads(clientes);

        return `✅ *Reporte creado en Google Sheets*\n📊 Tab: "${resultado.tab}"\n📝 ${resultado.registros} registros\n🔗 ${resultado.url}`;
      }

      default:
        return null;
    }
  } catch (e) {
    console.error("❌ Error en acción admin:", e.message);
    return `❌ Error ejecutando la acción: ${e.message}`;
  }
}

// ============================================================
// HANDLER PRINCIPAL ADMIN
// ============================================================
async function handleAdminMessage({ text, platform }) {
  const ownerId = process.env.OWNER_WHATSAPP;

  console.log(`🔑 [ADMIN] Mensaje del dueño: ${text}`);

  // Recolectar datos frescos del negocio
  const datos = await recolectarDatosNegocio();
  const clientes = datos.totalClientes || [];

  // Construir resumen de datos para Claude
  const resumenNegocio = `
=== DATOS ACTUALES DEL NEGOCIO (${new Date().toLocaleDateString("es-UY")}) ===
Total clientas en CRM: ${datos.totales?.clientes || 0}
Agendadas: ${datos.totales?.agendadas || 0}
Vinieron: ${datos.totales?.vinieron || 0}
Leads activos: ${datos.totales?.leads || 0}
Canceladas: ${datos.totales?.canceladas || 0}
Con cuponera: ${datos.totales?.conCuponera || 0}
Nuevas esta semana: ${datos.nuevasEstaSemana || 0}
Sin regresar +30 días: ${datos.sinRegresar30dias || 0}
Leads sin atender +24hs: ${datos.leadsSinAtender || 0}
Ingresos estimados este mes: $${datos.totales?.ingresosMes?.toLocaleString("es-UY") || 0} UYU

Sesiones agendadas (hoja Sesiones — próximos 7 días):
${datos.eventosCalendar?.length > 0
    ? datos.eventosCalendar.filter(ev => ev.estado !== "cancelado").map(ev =>
        `• ${ev.inicio} | ${ev.clienteNombre} | ${ev.terapeuta} | ${ev.servicio}`
      ).join("\n")
    : "sin sesiones agendadas"}

Lista de clientas (primeras 20):
${clientes.slice(0, 20).map(c =>
    `- ${c.Nombre || "Sin nombre"} | Tel: ${c.ID} | Estado: ${c.Estado} | Servicio: ${c.Servicio} | Último contacto: ${c.UltimoContacto?.split("T")[0] || "-"}`
  ).join("\n")}
${clientes.length > 20 ? `... y ${clientes.length - 20} más` : ""}
`;

  // ── SELF-FIX: detectar si es instrucción de cambio ──
  const cambioAplicado = await detectarYAplicarCambio(text);
  if (cambioAplicado) {
    const confirmacion = `✅ *Cambio aplicado:* ${cambioAplicado}\n\nEl sistema se actualizó automáticamente. Podés ver todos los cambios en el dashboard → Config.`;
    await enviarMensaje(ownerId, confirmacion, platform);
    return; // no continuar con el flujo admin normal
  }

  agregarAdmin("user", text);

  let respuesta;
  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 800,
      system: `Sos el asistente administrativo interno de Citrino. Solo hablás con Nico, el dueño.
Sos directo, conciso y útil. Usás "vos". Sos el panel de control privado del negocio.

⚠️ MUY IMPORTANTE — YA TENÉS TODO CONECTADO:
- Google Sheets CRM: conectado y funcionando. Los datos de clientas son REALES.
- Hoja Sesiones: conectada y funcionando. Las sesiones que ves arriba son las MISMAS que aparecen en citrinobienestar.uy/app/agenda/ — son datos reales.
- NUNCA digas que no estás conectado. SIEMPRE estás conectado.
- Si los datos muestran 0 sesiones o 0 clientas, es porque el negocio está arrancando, no porque no estés conectado.

Procesás TODO lo que Nico te manda en lenguaje natural: notas del día, observaciones de clientas, lo que pasó en las sesiones.
Cuando Nico te mande un texto libre → extraés la info y ejecutás las acciones automáticamente.
Podés ejecutar MÚLTIPLES acciones poniendo varios bloques seguidos.

Acciones disponibles:
<admin_accion>{"tipo":"marcar_asistencia","nombre":"Ana","vino":true}</admin_accion>
<admin_accion>{"tipo":"agregar_nota","nombre":"María","nota":"le dolía la zona lumbar"}</admin_accion>
<admin_accion>{"tipo":"registrar_cuponera","nombre":"Laura","sesiones":6}</admin_accion>
<admin_accion>{"tipo":"cambiar_estado","nombre":"Julia","estado":"vino"}</admin_accion>
<admin_accion>{"tipo":"agendar_turno","nombre":"Susana","telefono":"098123456","dia":"mañana","fecha":"2026-06-06","hora":"10:30","servicio":"Masaje"}</admin_accion>
<admin_accion>{"tipo":"generar_reporte","tipo_reporte":"leads"}</admin_accion>
<admin_accion>{"tipo":"generar_reporte","tipo_reporte":"inactivas","dias":30}</admin_accion>
<admin_accion>{"tipo":"generar_reporte","tipo_reporte":"vip"}</admin_accion>
<admin_accion>{"tipo":"generar_reporte","tipo_reporte":"cuponeras"}</admin_accion>
<admin_accion>{"tipo":"generar_reporte","tipo_reporte":"agendadas"}</admin_accion>

Reportes disponibles: leads, vip, inactivas, cuponeras, agendadas.
Cuando Nico pida "dame la lista de leads" o "exportá las inactivas" → generar_reporte.
El reporte se crea como pestaña nueva en el Google Sheet y le das el link.

IMPORTANTE sobre agendar:
- SIEMPRE usá la acción agendar_turno para crear eventos — NUNCA digas que agendaste sin ejecutarla
- La disponibilidad real está en el contexto bajo "Disponibilidad próximos 7 días"
- Si el horario pedido no aparece en los slots disponibles, decíselo a Nico
- Cuando agendás, el evento se crea REALMENTE en Google Calendar

Ejemplos de cómo procesar texto libre de Nico:
- "Alejandra vino hoy, le dolía la zona lumbar" → marcar_asistencia + agregar_nota
- "Laura compró cuponera de 6 sesiones" → registrar_cuponera
- "Sofía canceló su turno" → cambiar_estado cancelado
- "Agendá a Susana mañana a las 10:30" → agendar_turno (con los datos disponibles)
- "Hay algo mañana a las 9?" → consultá la disponibilidad del contexto y respondé
- "¿Qué tengo mañana?" → mirá los turnos proximas48h y respondé con los datos reales

Clasificación de clientas:
- VIP 🌟: viene seguido, cuponera activa
- Regular 💚: viene cada 2-4 semanas
- Lead tibio 🌡️: consultó, tiene potencial
- Lead frío ❄️: sin respuesta +48hs
- En riesgo ⚠️: vino pero no volvió en +30 días

${resumenNegocio}

Respondé siempre en base a los datos reales. Si no tenés el dato, decilo.`,
      messages: historialAdmin.map(m => ({ role: m.role, content: m.content })),
    });

    const textoRespuesta = response.content[0].text;
    console.log(`🔑 [ADMIN] Respuesta: ${textoRespuesta.slice(0, 100)}...`);

    // Detectar y ejecutar acción admin si existe
    const accionMatch = textoRespuesta.match(/<admin_accion>([\s\S]*?)<\/admin_accion>/);
    let respuestaFinal = textoRespuesta.replace(/<admin_accion>[\s\S]*?<\/admin_accion>/, "").trim();

    if (accionMatch) {
      try {
        const accion = JSON.parse(accionMatch[1]);
        const resultadoAccion = await ejecutarAccionAdmin(accion, clientes);
        if (resultadoAccion) {
          respuestaFinal = respuestaFinal
            ? `${respuestaFinal}\n\n${resultadoAccion}`
            : resultadoAccion;
        }
      } catch {}
    }

    respuesta = respuestaFinal;
  } catch (err) {
    respuesta = `❌ Error: ${err.message}`;
  }

  agregarAdmin("assistant", respuesta);

  // Enviar respuesta al dueño
  await enviarMensaje(ownerId, respuesta, platform);
}

module.exports = { handleAdminMessage };
