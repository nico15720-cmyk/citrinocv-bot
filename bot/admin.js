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
const { getDisponibilidad, formatearDisponibilidad } = require("./calendar");

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
    const [stats, clientes, disponibilidad] = await Promise.all([
      getStats(),
      leerTodosLosClientes(),
      getDisponibilidad(),
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
      disponibilidadHoy: formatearDisponibilidad(disponibilidad.filter(s =>
        s.fecha === hoy.toISOString().split("T")[0]
      )),
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

      default:
        return null;
    }
  } catch (e) {
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

Próximos turnos (48hs): ${datos.proximas48h?.length > 0
    ? datos.proximas48h.map(c => `${c.Nombre} — ${c.FechaTurno}`).join(", ")
    : "ninguno"}

Disponibilidad hoy: ${datos.disponibilidadHoy || "sin slots hoy"}

Lista de clientas (primeras 20):
${clientes.slice(0, 20).map(c =>
    `- ${c.Nombre || "Sin nombre"} | Tel: ${c.ID} | Estado: ${c.Estado} | Servicio: ${c.Servicio} | Último contacto: ${c.UltimoContacto?.split("T")[0] || "-"}`
  ).join("\n")}
${clientes.length > 20 ? `... y ${clientes.length - 20} más` : ""}
`;

  agregarAdmin("user", text);

  let respuesta;
  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 800,
      system: `Sos el asistente administrativo interno de Citrino. Solo hablás con Nico, el dueño.
Sos directo, conciso y útil. Usás "vos". No sos el bot de clientas — sos el panel de control privado.

Tenés acceso a todos los datos del negocio en tiempo real.

Cuando Nico te pida hacer una acción (marcar asistencia, agregar nota, registrar cuponera, cambiar estado), respondé con una acción JSON al final:
<admin_accion>{"tipo":"marcar_asistencia","nombre":"Ana","vino":true}</admin_accion>
<admin_accion>{"tipo":"agregar_nota","nombre":"María","nota":"prefiere masajes de mañana"}</admin_accion>
<admin_accion>{"tipo":"registrar_cuponera","nombre":"Laura","sesiones":6}</admin_accion>
<admin_accion>{"tipo":"cambiar_estado","nombre":"Julia","estado":"vino"}</admin_accion>

${resumenNegocio}

Respondé siempre en base a los datos reales de arriba. Si no tenés el dato, decilo.`,
      messages: historialAdmin.map(m => ({ role: m.role, content: m.content })),
    });

    const textoRespuesta = response.content[0].text;

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
