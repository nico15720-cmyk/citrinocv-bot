// ============================================================
// CITRINO BOT — Motor de conversación con Claude AI
// Integra Calendar, CRM y Sender
// ============================================================

const Anthropic = require("@anthropic-ai/sdk");
const { enviarMensaje, marcarLeidoYEscribiendo } = require("./sender");
const {
  getDisponibilidad,
  formatearDisponibilidad,
  crearTurno,
  cancelarTurno,
  buscarTurnoCliente,
  resolverSlot,
} = require("./calendar");
const {
  registrarCliente,
  actualizarEstado,
  registrarTurno,
  registrarCancelacion,
  actualizarNotas,
  buscarCliente,
} = require("./crm");

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ============================================================
// ESTADO EN MEMORIA (por sesión — se pierde al reiniciar)
// Para producción con muchos usuarios, usar Redis o similar
// ============================================================
const conversaciones = new Map(); // userId → [{ role, content }]
const slotsPendientes = new Map(); // userId → slots disponibles (para cuando eligen horario)

function getHistorial(userId) {
  if (!conversaciones.has(userId)) {
    conversaciones.set(userId, []);
  }
  return conversaciones.get(userId);
}

function agregarMensaje(userId, role, content) {
  const historial = getHistorial(userId);
  historial.push({ role, content });
  // Mantener solo los últimos 20 mensajes para no explotar el contexto
  if (historial.length > 20) historial.splice(0, historial.length - 20);
}

// ============================================================
// SYSTEM PROMPT
// ============================================================
const SYSTEM_PROMPT = `Sos el asistente virtual de Citrino, un espacio de masajes en Uruguay.
Tu nombre es Citi. Hablás en español rioplatense, de forma cálida, casual pero profesional.
Usás "vos" siempre. Usás emojis con moderación (1-2 por mensaje máximo).
Sos eficiente: respondés en 1-3 oraciones salvo que te pidan más info.

=== SOBRE CITRINO ===
Servicios y precios:
- Masaje relajante (60 min): $1.200 UYU
- Masaje relajante (90 min): $1.600 UYU
- Masaje descontracturante (60 min): $1.400 UYU
- Masaje descontracturante (90 min): $1.800 UYU
- Reflexología (60 min): $1.300 UYU
- Cuponera x5 masajes relajantes 60 min: $5.000 UYU (ahorros de $1.000)
- Cuponera x5 masajes descontracturantes 60 min: $5.500 UYU

Dirección: [COMPLETAR — ej: Av. 18 de Julio 1234, Montevideo]
Teléfono/WhatsApp: [COMPLETAR]
Instagram: @citrino.uy

=== TU ROL ===
1. Respondé preguntas sobre servicios y precios
2. Mostrá disponibilidad cuando te la pidan o cuando alguien quiera agendar
3. Tomá el nombre del cliente antes de agendar
4. Confirmá los datos antes de crear el turno
5. Manejá cancelaciones y reagendamientos con amabilidad

=== FLUJO DE AGENDAMIENTO ===
Cuando alguien quiere agendar:
1. Preguntá su nombre (si no lo sabés)
2. Preguntá qué servicio quiere
3. Mostrá disponibilidad
4. Cuando elijan horario, confirmá: "¿Confirmo tu turno para [día] a las [hora] para [servicio]?"
5. Si confirma → creá el turno

=== ACCIONES ESPECIALES ===
Cuando necesites hacer algo en el sistema, respondé EXACTAMENTE con este formato JSON
(no lo envíes al cliente, es para el sistema):

Para pedir disponibilidad:
<accion>{"tipo":"ver_disponibilidad"}</accion>

Para agendar un turno:
<accion>{"tipo":"agendar","slot_label":"lunes 10:00","nombre":"nombre del cliente","servicio":"masaje relajante 60 min"}</accion>

Para cancelar:
<accion>{"tipo":"cancelar"}</accion>

Para registrar el nombre del cliente:
<accion>{"tipo":"guardar_nombre","nombre":"Juan Pérez"}</accion>

Para registrar qué servicio consulta:
<accion>{"tipo":"guardar_servicio","servicio":"masaje descontracturante"}</accion>

IMPORTANTE: Incluí la acción dentro de tu respuesta normal. El sistema la va a procesar y reemplazar.
Si no necesitás hacer ninguna acción, respondé normalmente sin JSON.

=== REGLAS ===
- NUNCA inventés horarios. Siempre mostrá la disponibilidad real del sistema.
- Si no hay turnos disponibles, decilo claramente y ofrecé mirar para la próxima semana.
- Si alguien cancela, sé empático y ofrecé reagendar.
- No divulgues información personal de otros clientes.
- Si no podés responder algo, decí "Te consulto con Natalia y te aviso 🙏"`;

// ============================================================
// PROCESAR ACCIONES DEL BOT
// ============================================================
async function procesarAccion(accion, userId, canal, nombre) {
  switch (accion.tipo) {
    case "ver_disponibilidad": {
      const slots = await getDisponibilidad();
      slotsPendientes.set(userId, slots);
      return formatearDisponibilidad(slots);
    }

    case "agendar": {
      const slots = slotsPendientes.get(userId) || (await getDisponibilidad());
      slotsPendientes.set(userId, slots);

      // Buscar el slot que coincida con lo que pidió
      const slotLabel = accion.slot_label || "";
      const partes = slotLabel.split(" ");
      const dia = partes.slice(0, -1).join(" ");
      const hora = partes[partes.length - 1] || "";

      const slot = await resolverSlot(dia, hora);
      if (!slot) {
        return "No encontré ese horario en los disponibles. ¿Podés decirme exactamente cuál querés del listado que te mandé?";
      }

      const nombreCliente = accion.nombre || nombre || "Cliente";
      const servicio = accion.servicio || "masaje";

      const evento = await crearTurno({
        nombre: nombreCliente,
        telefono: userId,
        servicio,
        slot,
      });

      // Actualizar CRM
      await registrarTurno(userId, {
        fechaTurno: slot.inicioISO,
        eventId: evento.id,
        servicio,
      });

      return (
        `✅ ¡Turno confirmado!\n\n` +
        `📅 *${slot.label}*\n` +
        `💆 ${servicio}\n` +
        `📍 [COMPLETAR DIRECCIÓN]\n\n` +
        `Te mando un recordatorio el día anterior. Cualquier cosa me avisás 🙏`
      );
    }

    case "cancelar": {
      const turno = await buscarTurnoCliente(userId);
      if (!turno) {
        return "No encontré ningún turno a tu nombre. ¿Seguro que lo tenías agendado acá?";
      }
      await cancelarTurno(turno.id);
      await registrarCancelacion(userId);
      return "Cancelé tu turno sin problema 🙏 ¿Querés que te busque otro horario?";
    }

    case "guardar_nombre": {
      if (accion.nombre) {
        await registrarCliente({ userId, nombre: accion.nombre, canal });
      }
      return null; // sin respuesta visible
    }

    case "guardar_servicio": {
      if (accion.servicio) {
        await registrarCliente({ userId, servicio: accion.servicio, canal });
      }
      return null;
    }

    default:
      return null;
  }
}

// ============================================================
// EXTRAER Y PROCESAR ACCIÓN DEL TEXTO DEL BOT
// ============================================================
async function extraerYProcesarAccion(texto, userId, canal, nombre) {
  const match = texto.match(/<accion>([\s\S]*?)<\/accion>/);
  if (!match) return texto;

  let accion;
  try {
    accion = JSON.parse(match[1]);
  } catch {
    return texto.replace(/<accion>[\s\S]*?<\/accion>/, "").trim();
  }

  const resultado = await procesarAccion(accion, userId, canal, nombre);
  const textoLimpio = texto.replace(/<accion>[\s\S]*?<\/accion>/, "").trim();

  if (resultado) {
    return textoLimpio ? `${textoLimpio}\n\n${resultado}` : resultado;
  }
  return textoLimpio;
}

// ============================================================
// HANDLER PRINCIPAL
// ============================================================
async function handleIncomingMessage({ userId, text, platform, messageId = null }) {
  const canal = platform;
  console.log(`📩 [${canal.toUpperCase()}] De ${userId}: ${text}`);

  // Marcar como leído (para activar el doble tilde azul en WhatsApp)
  if (platform === "whatsapp" && messageId) {
    marcarLeidoYEscribiendo(messageId).catch(() => {});
  }

  // Registrar cliente en CRM (sin bloquear)
  registrarCliente({ userId, canal }).catch(console.error);

  // Obtener datos del cliente para contexto
  let nombreCliente = "";
  try {
    const clienteCRM = await buscarCliente(userId);
    nombreCliente = clienteCRM?.datos?.[1] || ""; // columna NOMBRE
  } catch {}

  // Agregar mensaje del usuario al historial
  agregarMensaje(userId, "user", text);

  // Construir contexto adicional para Claude
  let contextoCliente = "";
  if (nombreCliente) {
    contextoCliente = `[Contexto: el cliente se llama ${nombreCliente}]`;
  }

  const mensajes = getHistorial(userId).map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // Llamar a Claude
  let respuestaBot;
  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 600,
      system: contextoCliente ? `${SYSTEM_PROMPT}\n\n${contextoCliente}` : SYSTEM_PROMPT,
      messages: mensajes,
    });
    respuestaBot = response.content[0].text;
  } catch (err) {
    console.error("❌ Error con Claude:", err.message);
    respuestaBot = "Uy, tuve un problemita técnico. Intentá de nuevo en un momento 🙏";
  }

  // Agregar respuesta al historial
  agregarMensaje(userId, "assistant", respuestaBot);

  // Procesar acciones si las hay
  const respuestaFinal = await extraerYProcesarAccion(respuestaBot, userId, canal, nombreCliente);

  // Enviar respuesta
  if (respuestaFinal) {
    await enviarMensaje(userId, respuestaFinal, canal);
  }
}

module.exports = { handleIncomingMessage };
