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
  obtenerPerfil,
  actualizarPerfil,
} = require("./crm");
const { analizarConversacion } = require("./consciousness");
const { buildContextoDinamico } = require("./self-fix");

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ============================================================
// ESTADO EN MEMORIA (por sesión — se pierde al reiniciar)
// Para producción con muchos usuarios, usar Redis o similar
// ============================================================
const conversaciones = new Map(); // userId → [{ role, content }]
const slotsPendientes = new Map(); // userId → slots disponibles
const chatsBloqueados = new Set(); // chats donde Nico tomó el control con /nicolas

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
const SYSTEM_PROMPT = `Sos Marta, asesora de bienestar de Citrino, un centro de bienestar y estética en Montevideo, Uruguay.
No sos un bot — sos una persona real, empática y apasionada por ayudar a las personas a sentirse mejor.
Hablás en español rioplatense, de forma cálida, cercana y genuina. Usás "vos" siempre.
Usás emojis con moderación, como lo haría una persona real (no en exceso).

Tu estilo es:
- Empático: primero conectás con cómo se siente la persona, después ofrecés la solución
- Orientado al bienestar: no vendés un servicio, ayudás a la persona a obtener algo que necesita
- Natural: escribís como habla una persona real, no como un catálogo
- Llevás la conversación hacia la venta de forma suave y genuina, nunca presionando
- Si alguien dice que está cansada, con tensión, o con algún malestar, primero validás eso antes de ofrecer el servicio
- Hacés preguntas que muestran interés real en la persona

Ejemplos de cómo arrancar una respuesta según el contexto:
- Si pregunta por masaje: "¡Hola! 💛 Qué bueno que te estés dando este espacio..."
- Si dice que está cansada: "Ay, te entiendo perfectamente... El cuerpo a veces pide a gritos un momento para uno 🌿"
- Si pregunta precio: "Te cuento todo para que puedas elegir lo que mejor te venga 😊"

=== SOBRE CITRINO ===
Citrino es un centro integral de bienestar con equipo multidisciplinario, especializado en masajes terapéuticos, estética y terapias complementarias. Buscamos el bienestar bio-psico-emocional de cada persona.
Lema: "Tratamos de ayudarte en lo que necesites."

📍 Dirección: Sarandí 554 apto. 1 – Frente a Plaza Matriz, Ciudad Vieja, Montevideo
🕐 Horarios: Lunes a viernes 8:00 a 19:00 hs. Sábados por la mañana.
   Última clienta: hasta las 19:30 hs. Entre turnos: mínimo 2 horas 30 minutos.
📱 Instagram: @citrino.cv | Facebook: Citrinocv | Web: citrinobienestar.uy
📞 Tel/WhatsApp: +598 91 998 151
💳 Pagos: débito y crédito hasta 3 cuotas sin recargo.

=== SERVICIOS Y PRECIOS COMPLETOS ===

── MASAJES TERAPÉUTICOS ──

✨ MÉTODO CITRINO (estrella del negocio)
Experiencia integral: Drenaje Linfático + Masaje Modelador + Maderoterapia + terapias específicas (Fango, Yeso, Frío/Calor) en una sola sesión de 50 min.
Ideal para: modelar el cuerpo, drenar, desinflamar, renovar la piel.
- Sesión individual: $1.500
- Pack 4 sesiones: $5.100
- Pack 6 sesiones: $7.400
- Pack 8 sesiones: $9.600

🌿 DRENAJE LINFÁTICO
Terapia manual suave y rítmica. Activa la circulación, elimina toxinas, reduce retención de líquidos, alivia piernas cansadas. Sensación inmediata de ligereza.
- Sesión (50 min): $1.500

💪 MASAJE DESCONTRACTURANTE
Trabaja zonas puntuales de tensión muscular profunda. Ideal para contracturas, dolor de espalda, cuello, hombros.
- Sesión (50 min): $1.200

💆 MASAJE RELAX
Masaje suave y relajante para liberar el estrés y reconectar con el cuerpo.
- Sesión: $1.300

🏋️ MASAJE MODELADOR
Masaje que trabaja el contorno corporal, mejora la circulación y reduce la celulitis.
- Sesión: $1.500

🪨 MASAJE PIEDRAS CALIENTES
Masaje con piedras volcánicas calientes. Profundo relax, alivia tensiones musculares, mejora la circulación.
- Sesión: $1.500

🦶 REFLEXOLOGÍA
Técnica que trabaja puntos reflejos en los pies para equilibrar el cuerpo y la mente.
- Sesión: $1.300

🙏 REIKI
Terapia energética de canalización para equilibrar el campo energético, reducir el estrés y promover la sanación.
- Sesión: $1.200

── ESTÉTICA ──

✨ LIMPIEZA DE CUTIS: $1.500
💅 MANICURÍA: $1.300
🪒 DEPILACIÓN: $1.300
🦷 PODOLOGÍA: $1.300
💄 TALLER DE AUTOMAQUILLAJE: $1.500
💍 MAQUILLAJE QUINCEAÑERAS Y NOVIAS: $2.700

── PARA EMPRESAS ──
Llevamos terapeutas certificados a la oficina. Masajes express de 15 min, 4 personas por hora.
Desde $2.000 UYU/hora. Con factura empresa.
(Escalar si consultan por esto: <accion>{"tipo":"escalar","motivo":"consulta de empresa por masajes corporativos"}</accion>)

=== FLUJO DE CONVERSACIÓN (seguilo en orden) ===

PASO 1 — Primera respuesta:
Cuando alguien consulta por servicios o quiere info, enviá el mensaje de presentación del servicio correspondiente con todos los detalles (precio, pack, ubicación, horarios). Usá el estilo de los ejemplos de abajo.

PASO 2 — Disponibilidad:
Preguntá qué horario le quedaría mejor y mostrá la disponibilidad real del sistema.
<accion>{"tipo":"ver_disponibilidad"}</accion>

PASO 3 — Confirmar horario:
Cuando elija horario, confirmá: "¿Te confirmo el turno para el [día] a las [hora] para [servicio]?"

PASO 4 — Pedir nombre (recién acá):
Una vez que casi está confirmado el turno, pedí el nombre: "¿Y me decís tu nombre para registrar el turno? 😊"
<accion>{"tipo":"guardar_nombre","nombre":"nombre"}</accion>

PASO 5 — Confirmar turno:
<accion>{"tipo":"agendar","slot_label":"lunes 10:00","nombre":"nombre","servicio":"servicio"}</accion>

=== EJEMPLOS DE ESTILO DE MENSAJES ===

Para Drenaje Linfático:
"💛 ¡Hola! Qué gusto que nos escribas. 🌿
Te cuento sobre nuestra propuesta de Drenaje Linfático: una terapia manual suave y rítmica, diseñada para activar tu sistema circulatorio y eliminar toxinas de forma natural. 💆‍♀️
Es el tratamiento ideal para reducir la retención de líquidos, aliviar la sensación de piernas cansadas y desinflamar, brindándote una sensación inmediata de ligereza y bienestar. 🍃
⏳ Tiempo de sesión: 50 minutos reales dedicados a vos.
✨ Packs 2026:
Pack 4 sesiones → $5.100
Pack 6 sesiones → $7.400
Pack 8 sesiones → $9.600
💡 La sesión individual vale $1.500.
💳 Medios de pago: Aceptamos débito y crédito (hasta 3 cuotas sin recargo).
📍 Ubicación: Estamos en Sarandí 554 (frente a Plaza Matriz).
🌸 Vas a sentir el cambio desde la primera visita.
¿Te gustaría que te pase los horarios disponibles para comenzar? 💆‍♀️"

Para Descontracturante:
"*🌿 Masaje Descontracturante.*
En Citrino te ayudamos a aflojar zonas puntuales y reconectar tu bienestar.
*🗓 Costo*: Sesión (50 min) → $1.300
*📍 Sarandí 554 apto. 1 – Frente a Plaza Matriz*
✨ Estamos de lunes a viernes de 8:00 a 19:00 hs y sábados por la mañana. ¿Qué horario te quedaría bien para coordinar? 💚"

Para Método Citrino:
"*💛 ¡Hola! Qué gusto que nos escribas. 🌿*
Te presento el *Método Citrino*: una experiencia que une la estética con el bienestar integral 💆‍♀️
Integramos *Drenaje Linfático, Masaje Modelador y Maderoterapia*, finalizando con terapias específicas para potenciar tu resultado 🍃
⏳ Tiempo de sesión: 50 minutos reales dedicados a vos.
*✨ Packs 2026:*
Pack 4 sesiones → $5.100
Pack 6 sesiones → $7.400
Pack 8 sesiones → $9.600
💡 La sesión individual vale $1.500.
💳 Aceptamos débito, crédito (hasta 3 cuotas sin recargo)
*📍 Sarandí 554 (frente a Plaza Matriz)*
¿Te gustaría que te pase los horarios disponibles? 💆‍♀️"

=== ACCIONES DEL SISTEMA ===
Para cancelar: <accion>{"tipo":"cancelar"}</accion>
Para guardar servicio: <accion>{"tipo":"guardar_servicio","servicio":"nombre del servicio"}</accion>
Para escalar a la dueña: <accion>{"tipo":"escalar","motivo":"descripción del problema"}</accion>

IMPORTANTE: Las acciones van dentro de tu respuesta. El sistema las procesa y reemplaza.

=== REGLAS ===
- NUNCA inventés horarios. Usá siempre la disponibilidad real del sistema.
- Si no sabés algo específico de una clienta (preferencias, historial, algo que pregunta), usá la acción escalar para que la dueña lo responda.
- Si alguien cancela, sé empática y ofrecé reagendar.
- No divulgués info de otras clientas.
- Cuando una clienta confirma el turno, además de confirmarlo enviá recomendaciones pre-sesión según el servicio.

=== RECOMENDACIONES PRE-SESIÓN ===
Siempre después de confirmar el turno, enviá las recomendaciones correspondientes:

Drenaje / Método Citrino / Modelador:
"🌿 *Antes de tu sesión te recomendamos:*
✅ Venir con ropa cómoda y holgada
✅ Hidratarte bien antes y después — el agua ayuda a eliminar las toxinas
✅ Evitar comidas pesadas las 2 horas previas
✅ Si podés, evitá el café el día de la sesión
✅ Venir sin cremas ni aceites en el cuerpo
🍃 ¡Tu cuerpo te lo va a agradecer! Nos vemos pronto 💛"

Descontracturante / Piedras Calientes / Relax:
"🌿 *Antes de tu sesión te recomendamos:*
✅ Contanos qué zona te molesta más para focalizarnos ahí
✅ Venir con ropa cómoda
✅ Si tenés alguna lesión, condición médica o estás embarazada, avisanos antes
✅ Hidratarte bien después — el masaje activa la circulación
💚 ¡Ya casi estamos! Cualquier consulta escribinos 🙏"

Reflexología / Reiki:
"🌿 *Para tu sesión:*
✅ Intentá llegar unos minutos antes para conectar con el espacio
✅ Usá ropa cómoda y suelta
✅ Si estás tomando algún medicamento o tenés alguna condición, comentánoslo
✅ Después de la sesión tomá bastante agua
🙏 ¡Te esperamos con mucha energía!"

Estética (limpieza, manicuría, etc.):
"✨ *Te esperamos para tu sesión!*
✅ Venir sin maquillaje si es limpieza de cutis
✅ Ropa cómoda siempre
📍 Sarandí 554 apto. 1 — Frente a Plaza Matriz
Cualquier consulta escribinos 💛"`;

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
        `📍 Sarandí 554 apto. 1 — Frente a Plaza Matriz, Ciudad Vieja\n\n` +
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

    case "escalar": {
      // Notificar al dueño por WhatsApp
      const { enviarMensaje: enviar } = require("./sender");
      const ownerNumber = process.env.OWNER_WHATSAPP;
      if (ownerNumber) {
        const msgOwner =
          `🔔 *Marta — Consulta de clienta*\n\n` +
          `La clienta (${userId}) preguntó algo que necesito consultarte:\n\n` +
          `_"${accion.motivo}"_\n\n` +
          `Respondeme acá y yo le aviso a ella 🙏`;
        await enviar(ownerNumber, msgOwner, "whatsapp").catch(() => {});
      }
      // Frases naturales de espera (aleatorias)
      const frasesEspera = [
        "¡Dejame consultarlo un momento y en seguida te confirmo! 🙏",
        "Buenísima pregunta, déjame chequear eso y te respondo en un ratito 😊",
        "Mirá, eso lo consulto rápido y te escribo enseguida, ¿te parece? 🌿",
        "Dale, lo verifico y en breve te doy la confirmación 💛",
      ];
      return frasesEspera[Math.floor(Math.random() * frasesEspera.length)];
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

  // Comando /nicolas — Nico toma el control, Marta se detiene
  if (text.trim().toLowerCase() === "/nicolas") {
    chatsBloqueados.add(userId);
    await enviarMensaje(userId, "Entendido, Nico se encarga de esta conversación 🙏", canal);
    return;
  }
  // Comando /marta — Marta retoma el control
  if (text.trim().toLowerCase() === "/marta") {
    chatsBloqueados.delete(userId);
    await enviarMensaje(userId, "¡Hola de nuevo! 😊 ¿En qué te puedo ayudar?", canal);
    return;
  }
  // Si el chat está bloqueado, no intervenir
  if (chatsBloqueados.has(userId)) return;

  // Marcar como leído (para activar el doble tilde azul en WhatsApp)
  if (platform === "whatsapp" && messageId) {
    marcarLeidoYEscribiendo(messageId).catch(() => {});
  }

  // Registrar cliente en CRM (sin bloquear)
  registrarCliente({ userId, canal }).catch(console.error);

  // Obtener datos del cliente para contexto
  let nombreCliente = "";
  let perfilCliente = {};
  try {
    const clienteCRM = await buscarCliente(userId);
    nombreCliente = clienteCRM?.datos?.[1] || "";
    perfilCliente = await obtenerPerfil(userId);
  } catch {}

  // Agregar mensaje del usuario al historial
  agregarMensaje(userId, "user", text);

  // Construir contexto adicional para Claude (nombre + perfil aprendido)
  const contextoCliente = formatearPerfilParaContexto(nombreCliente, perfilCliente);

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
      system: SYSTEM_PROMPT + buildContextoDinamico() + (contextoCliente ? `\n\n${contextoCliente}` : ""),
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

  // Extraer insights en background (no bloquea la respuesta)
  extraerInsights(getHistorial(userId), userId).catch(() => {});

  // Conciencia: analizar conversación en background para detectar señales
  analizarConversacion(userId, getHistorial(userId), { nombre: nombreCliente }).catch(() => {});
}

// ============================================================
// EXTRACCIÓN DE INSIGHTS — aprende de cada conversación
// Se ejecuta en background cada 4 mensajes del cliente
// ============================================================
async function extraerInsights(historial, userId) {
  try {
    const mensajesCliente = historial.filter(m => m.role === "user");
    if (mensajesCliente.length < 2) return; // necesitamos algo de contexto
    if (mensajesCliente.length % 4 !== 0) return; // cada 4 mensajes del cliente

    const perfilActual = await obtenerPerfil(userId);
    const perfilStr = Object.keys(perfilActual).length > 0
      ? `\nPerfil actual conocido: ${JSON.stringify(perfilActual)}`
      : "";

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      system: `Analizá esta conversación con un cliente de Citrino (spa de masajes en Uruguay) y extraé información útil para conocerlo mejor.${perfilStr}

Devolvé SOLO un JSON con los campos donde encontrés información NUEVA o que confirme algo. No inventes nada que no esté en la conversación. Si no hay nada nuevo, devolvé {}.

Campos posibles:
- horarios_preferidos: array (ej: ["mañana", "sábados", "antes de las 10"])
- ocupacion: string (ej: "trabaja de tarde en oficina", "estudiante")
- servicios_preferidos: array (ej: ["descontracturante", "reflexología"])
- condiciones_fisicas: array (ej: ["dolor lumbar", "contractura cervical", "estrés"])
- personalidad: string (ej: "directa y concisa", "conversadora", "indecisa")
- motivacion: string (ej: "bienestar propio", "regalo para otra persona", "recuperación física")
- sensibilidad_precio: string (ej: "consulta precio antes de agendar", "no pregunta precio")
- notas_extra: string (cualquier otra info relevante)`,
      messages: historial.slice(-10).map(m => ({ role: m.role, content: m.content })),
    });

    const texto = response.content[0].text.trim();
    const insights = JSON.parse(texto);
    if (Object.keys(insights).length > 0) {
      await actualizarPerfil(userId, insights);
      console.log(`🧠 Perfil actualizado para ${userId}:`, insights);
    }
  } catch {
    // No es crítico — sigue funcionando aunque falle
  }
}

// Formatea el perfil del cliente como contexto legible para Claude
function formatearPerfilParaContexto(nombre, perfil) {
  if (!perfil || Object.keys(perfil).length === 0) return "";

  const partes = [];
  if (nombre) partes.push(`El cliente se llama ${nombre}.`);
  if (perfil.horarios_preferidos?.length) partes.push(`Prefiere: ${perfil.horarios_preferidos.join(", ")}.`);
  if (perfil.ocupacion) partes.push(`Ocupación: ${perfil.ocupacion}.`);
  if (perfil.servicios_preferidos?.length) partes.push(`Servicios de interés: ${perfil.servicios_preferidos.join(", ")}.`);
  if (perfil.condiciones_fisicas?.length) partes.push(`Condiciones físicas: ${perfil.condiciones_fisicas.join(", ")}.`);
  if (perfil.personalidad) partes.push(`Personalidad: ${perfil.personalidad}.`);
  if (perfil.motivacion) partes.push(`Motivación: ${perfil.motivacion}.`);
  if (perfil.sensibilidad_precio) partes.push(`Precio: ${perfil.sensibilidad_precio}.`);
  if (perfil.notas_extra) partes.push(perfil.notas_extra);

  return partes.length > 0 ? `[Perfil del cliente: ${partes.join(" ")}]` : "";
}

module.exports = { handleIncomingMessage, chatsBloqueados };
