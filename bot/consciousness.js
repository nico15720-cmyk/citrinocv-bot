// ============================================================
// CITRINO BOT — Conciencia (Motor de decisiones autónomo)
// Analiza todo el negocio periódicamente y toma decisiones:
// - Detecta patrones en conversaciones
// - Identifica oportunidades de venta
// - Alerta a Nico sobre situaciones importantes
// - Aprende del comportamiento de las clientas
// ============================================================

const Anthropic = require("@anthropic-ai/sdk");
const { enviarMensaje } = require("./sender");
const {
  leerTodosLosClientes,
  getStats,
  obtenerTodosLosPerfiles,
  actualizarNotas,
  calcularScore,
} = require("./crm");
const { getDisponibilidad } = require("./calendar");

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const OWNER = process.env.OWNER_WHATSAPP;

// Estado interno de la conciencia
const estadoConciencia = {
  ultimoAnalisis: null,
  decisiones: [], // historial de decisiones tomadas
  alertasEnviadas: new Set(), // para no repetir alertas
};

// ============================================================
// ANÁLISIS PROFUNDO DEL NEGOCIO
// ============================================================
async function analizarNegocio() {
  try {
    const [clientes, stats, perfiles] = await Promise.all([
      leerTodosLosClientes(),
      getStats(),
      obtenerTodosLosPerfiles(),
    ]);

    const ahora = new Date();
    const hoy = ahora.toLocaleDateString("es-UY", {
      timeZone: "America/Montevideo",
      weekday: "long", day: "numeric", month: "long"
    });

    // Clasificar todas las clientas
    const clientasConScore = clientes.map(c => {
      const fila = [
        c.ID, c.Nombre, c.Teléfono, c.Canal, c.Servicio, c.Estado,
        c.Cuponera, c["Ses.Rest."], c.FechaAlta, c.FechaTurno,
        c.EventID, c.Notas, c.UltimoContacto, c.Remarketing, c.Perfil
      ];
      const { score, categoria } = calcularScore(fila);
      return { ...c, score, categoria };
    });

    // Detectar situaciones críticas
    const alertas = [];

    // 1. Clientas VIP que no vienen hace más de 21 días
    const vipEnRiesgo = clientasConScore.filter(c => {
      if (!c.categoria?.includes("VIP")) return false;
      if (!c.UltimoContacto) return false;
      const dias = Math.floor((ahora - new Date(c.UltimoContacto)) / (1000 * 60 * 60 * 24));
      return dias > 21;
    });
    if (vipEnRiesgo.length > 0) {
      alertas.push({
        tipo: "vip_en_riesgo",
        prioridad: "alta",
        mensaje: `⚠️ *VIP en riesgo:* ${vipEnRiesgo.map(c => c.Nombre || c.ID).join(", ")} no vienen hace más de 21 días`,
        clientas: vipEnRiesgo,
      });
    }

    // 2. Muchos leads del mismo servicio → oportunidad de campaña
    const serviciosMasConsultados = {};
    clientes.filter(c => c.Estado === "lead" && c.Servicio).forEach(c => {
      serviciosMasConsultados[c.Servicio] = (serviciosMasConsultados[c.Servicio] || 0) + 1;
    });
    const servicioTop = Object.entries(serviciosMasConsultados).sort((a, b) => b[1] - a[1])[0];
    if (servicioTop && servicioTop[1] >= 3) {
      alertas.push({
        tipo: "oportunidad_campana",
        prioridad: "media",
        mensaje: `💡 *Oportunidad:* ${servicioTop[1]} leads consultaron por *${servicioTop[0]}* — conviene hacer una campaña`,
      });
    }

    // 3. Muchas cancelaciones recientes → posible problema
    const cancelacionesRecientes = clientes.filter(c => {
      if (c.Estado !== "cancelado") return false;
      if (!c.UltimoContacto) return false;
      const dias = Math.floor((ahora - new Date(c.UltimoContacto)) / (1000 * 60 * 60 * 24));
      return dias <= 7;
    });
    if (cancelacionesRecientes.length >= 2) {
      alertas.push({
        tipo: "cancelaciones",
        prioridad: "media",
        mensaje: `📊 *Atención:* ${cancelacionesRecientes.length} cancelaciones en los últimos 7 días — puede ser un patrón`,
      });
    }

    // 4. Cuponeras por vencer (1 sesión restante)
    const cuponerasPorVencer = clientasConScore.filter(c =>
      c.Cuponera === "si" && parseInt(c["Ses.Rest."]) === 1
    );
    if (cuponerasPorVencer.length > 0) {
      alertas.push({
        tipo: "cuponeras_por_vencer",
        prioridad: "media",
        mensaje: `🎫 *Cuponeras con 1 sesión restante:* ${cuponerasPorVencer.map(c => c.Nombre || c.ID).join(", ")} — oportunidad de renovación`,
        clientas: cuponerasPorVencer,
      });
    }

    // 5. Día con baja ocupación → sugerir promoción
    const slots = await getDisponibilidad().catch(() => []);
    const slotsPorDia = {};
    slots.forEach(s => {
      slotsPorDia[s.fecha] = (slotsPorDia[s.fecha] || 0) + 1;
    });
    const diasLibres = Object.entries(slotsPorDia).filter(([, n]) => n >= 4);
    if (diasLibres.length > 0) {
      const [fecha] = diasLibres[0];
      const fechaLabel = new Date(fecha + "T12:00:00").toLocaleDateString("es-UY", {
        weekday: "long", day: "numeric", month: "long", timeZone: "America/Montevideo"
      });
      alertas.push({
        tipo: "agenda_libre",
        prioridad: "baja",
        mensaje: `📅 *Agenda poco ocupada:* el *${fechaLabel}* tiene ${slotsPorDia[fecha]} turnos libres — ¿activamos alguna promo?`,
      });
    }

    return { alertas, stats, clientasConScore, perfiles, hoy };

  } catch (err) {
    console.error("❌ Error en análisis de conciencia:", err.message);
    return { alertas: [], stats: {}, clientasConScore: [], perfiles: [] };
  }
}

// ============================================================
// TOMAR DECISIONES Y NOTIFICAR
// ============================================================
async function tomarDecisiones() {
  console.log("🧠 Conciencia: analizando el negocio...");

  const { alertas, stats, clientasConScore, perfiles, hoy } = await analizarNegocio();

  if (!OWNER) return;

  // Solo mandar alertas de prioridad alta automáticamente
  const alertasAltas = alertas.filter(a =>
    a.prioridad === "alta" && !estadoConciencia.alertasEnviadas.has(a.tipo + JSON.stringify(a.clientas?.map(c => c.ID)))
  );

  for (const alerta of alertasAltas) {
    await enviarMensaje(OWNER, alerta.mensaje + "\n\n_¿Querés que le escriba?_", "whatsapp").catch(() => {});
    estadoConciencia.alertasEnviadas.add(alerta.tipo + JSON.stringify(alerta.clientas?.map(c => c.ID)));
  }

  // Generar análisis con Claude para el resumen semanal (solo lunes)
  const diaSemana = new Date().getDay();
  if (diaSemana === 1) { // lunes
    await generarInsightSemanal(alertas, stats, clientasConScore, perfiles, hoy);
  }

  estadoConciencia.ultimoAnalisis = new Date();
  console.log(`🧠 Conciencia: análisis completado. ${alertas.length} alertas detectadas.`);
}

// ============================================================
// INSIGHT SEMANAL — análisis profundo los lunes
// ============================================================
async function generarInsightSemanal(alertas, stats, clientes, perfiles, hoy) {
  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 600,
      system: `Sos el asistente de análisis de negocio de Citrino, un spa de masajes en Montevideo.
Analizás los datos semanales y generás un insight accionable para el dueño (Nico).
Sé conciso, directo y enfocado en acciones concretas. Usás "vos". Máximo 5 puntos.`,
      messages: [{
        role: "user",
        content: `Datos de la semana (${hoy}):
- Total clientas: ${stats.total || 0}
- Agendadas: ${stats.agendados || 0}
- Vinieron: ${stats.vinieron || 0}
- Leads activos: ${stats.leads || 0}
- Con cuponera: ${stats.conCuponera || 0}
- Ingresos estimados: $${stats.ingresosEstimados || 0} UYU
- Alertas detectadas: ${alertas.map(a => a.tipo).join(", ") || "ninguna"}
- Perfiles con datos: ${perfiles.length}

Generá un análisis semanal con: qué está yendo bien, qué mejorar, y 2-3 acciones concretas para esta semana.`,
      }],
    });

    const insight = `🧠 *Análisis semanal — ${hoy}*\n\n${response.content[0].text}`;
    await enviarMensaje(OWNER, insight, "whatsapp").catch(() => {});

  } catch (err) {
    console.error("❌ Error generando insight semanal:", err.message);
  }
}

// ============================================================
// ANALIZAR UNA CONVERSACIÓN ESPECÍFICA
// Llamado después de cada intercambio para detectar señales
// OPTIMIZADO: pre-screening por keywords + rate limit por usuario
// ============================================================

// Palabras que indican situaciones que ameritan análisis LLM
const KEYWORDS_ALERTA = [
  "urgente", "urgente!", "dolor", "duele", "me lastimé", "accidente",
  "queja", "molesta", "enojada", "mal", "terrible", "pésimo", "horrible",
  "devolver", "reembolso", "reintegro", "estafa", "fraude",
  "alérgica", "reacción", "hinchazón",
  "vip", "empresa", "empleadas", "grupo", "todas",
  "nunca más", "cancelo", "cancelar todo",
];

// Rate limit: un análisis por usuario cada 15 minutos
const _ultimoAnalisisPorUser = new Map();

function _necesitaAnalisis(userId, historial) {
  // Mínimo 6 mensajes (antes era 4)
  if (historial.length < 6) return false;

  // Rate limit: no analizar si se analizó hace menos de 15 minutos
  const ahora = Date.now();
  const ultimoTs = _ultimoAnalisisPorUser.get(userId);
  if (ultimoTs && (ahora - ultimoTs) < 15 * 60 * 1000) return false;

  // Pre-screening: solo llamar LLM si hay keywords de alerta en los últimos 4 mensajes
  const ultimos = historial.slice(-4).map(m => (m.content || "").toLowerCase()).join(" ");
  return KEYWORDS_ALERTA.some(kw => ultimos.includes(kw));
}

async function analizarConversacion(userId, historial, datosCliente) {
  try {
    if (!_necesitaAnalisis(userId, historial)) return null;

    // Registrar timestamp antes de llamar para evitar llamadas simultáneas
    _ultimoAnalisisPorUser.set(userId, Date.now());

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 150,
      system: `Analizás conversaciones de un spa de masajes. Detectás señales importantes y decidís si hay que actuar.
Respondé SOLO con JSON: {"accion": "ninguna"} o {"accion": "alertar_dueno", "motivo": "..."}
Alertar solo si: cliente muy frustrado, consulta urgente médica, queja seria, oportunidad de venta VIP clara.`,
      messages: [{
        role: "user",
        content: `Cliente: ${datosCliente?.nombre || userId}
Últimos mensajes: ${historial.slice(-4).map(m => `${m.role}: ${m.content}`).join("\n")}`,
      }],
    });

    const rawText = response.content[0].text.trim();
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    const resultado = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    if (resultado.accion === "alertar_dueno" && OWNER) {
      await enviarMensaje(
        OWNER,
        `🔔 *Marta detectó algo importante*\nClienta: ${datosCliente?.nombre || userId}\nMotivo: ${resultado.motivo}\n\n¿Tomás el chat? Escribí /nicolas en ese número para tomar control.`,
        "whatsapp"
      ).catch(() => {});
    }
    return resultado;
  } catch {
    return null;
  }
}

// ============================================================
// AUTO-APRENDIZAJE DESDE CONVERSACIONES DE CLIENTES
// Corre periódicamente (ej: cada noche) y extrae patrones de
// las conversaciones reales de WhatsApp para enriquecer La Conciencia.
// ============================================================
async function autoAprendizajeDesdeConversaciones() {
  try {
    const { appendConocimientoRows, rebuildMdCache, readConocimientoSheet } = require("./teach");
    const { readSheet } = require("./sheets-crm");

    // Leer clientes con historial de conversaciones
    const clientes = await readSheet("CLIENTES");
    const conHistorial = clientes.filter(c => c.Historial_JSON && c.Historial_JSON.length > 50);

    if (!conHistorial.length) {
      console.log("🧠 [auto-learn] Sin conversaciones para analizar.");
      return { ok: true, aprendidos: 0 };
    }

    // Leer conocimiento existente para evitar duplicados
    const yaConocido = await readConocimientoSheet();
    const contenidosExistentes = new Set(yaConocido.map(r => r.Contenido.substring(0, 60).toLowerCase()));

    // Gate de actividad: solo procesar si hay conversaciones con actividad en las últimas 24h
    const hace24h = Date.now() - 24 * 60 * 60 * 1000;
    const conActividadReciente = conHistorial.filter(c => {
      try {
        const hist = JSON.parse(c.Historial_JSON);
        const ultimoMsg = hist[hist.length - 1];
        if (!ultimoMsg?.timestamp) return false;
        return new Date(ultimoMsg.timestamp).getTime() > hace24h;
      } catch { return false; }
    });

    if (!conActividadReciente.length) {
      console.log("🧠 [auto-learn] Sin actividad en las últimas 24h — saltando.");
      return { ok: true, aprendidos: 0 };
    }

    // Construir muestra de conversaciones (últimas 8 con historial, reducido de 20)
    const muestra = conHistorial.slice(-8).map(c => {
      let hist = [];
      try { hist = JSON.parse(c.Historial_JSON); } catch {}
      const resumen = hist.slice(-6).map(m => `${m.role === "user" ? "Cliente" : "Marta"}: ${m.content}`).join("\n");
      return `=== ${c.Nombre || c.ID_Cliente || "Anónima"} ===\n${resumen}`;
    }).join("\n\n");

    if (!muestra.trim()) return { ok: true, aprendidos: 0 };

    // Pedir a Claude que extraiga patrones aprendibles
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1200,
      system: `Analizás conversaciones de WhatsApp entre el bot Marta (de Citrino, centro de estética en Uruguay) y clientas.

Tu tarea: extraer PATRONES DE NEGOCIO útiles que el bot debería recordar. Buscás:
- Preguntas frecuentes que hacen las clientas (y su respuesta correcta)
- Objeciones o dudas recurrentes
- Preferencias que mencionan las clientas
- Situaciones que el bot manejó bien o mal
- Info sobre clientas específicas relevante para futuras interacciones

DEVOLVÉS SOLO JSON:
[{"categoria":"...", "contenido":"...", "tipo":"patron|preferencia|faq|situacion"}]

Categorías: "Clientas" | "Reglas de Negocio" | "Precios y Productos" | "Situaciones Especiales"
Máx 8 patrones. Solo info CONCRETA y accionable. Ignorá saludos y conversación genérica.`,
      messages: [{ role: "user", content: muestra }],
    });

    let patrones = [];
    try {
      const txt = response.content[0].text.trim().replace(/```json\n?|\n?```/g, "");
      patrones = JSON.parse(txt);
    } catch { return { ok: false, aprendidos: 0 }; }

    // Filtrar duplicados contra lo ya conocido
    const nuevos = patrones.filter(p => {
      if (!p.contenido || p.contenido.length < 20) return false;
      const key = p.contenido.substring(0, 60).toLowerCase();
      return !contenidosExistentes.has(key);
    });

    if (!nuevos.length) {
      console.log("🧠 [auto-learn] Sin patrones nuevos.");
      return { ok: true, aprendidos: 0 };
    }

    // Guardar en CONOCIMIENTO
    const fecha = new Date().toLocaleDateString("es-UY", {
      day: "numeric", month: "long", year: "numeric", timeZone: "America/Montevideo",
    });
    const rows = nuevos.map(p => ({
      Fecha:     fecha,
      Categoria: p.categoria || "General",
      Contenido: p.contenido,
      Fuente:    "auto_wa",
    }));
    await appendConocimientoRows(rows);
    await rebuildMdCache();

    console.log(`🧠 [auto-learn] ${rows.length} patrones aprendidos de conversaciones de clientes.`);
    return { ok: true, aprendidos: rows.length };
  } catch (e) {
    console.error("❌ [auto-learn] Error:", e.message);
    return { ok: false, error: e.message };
  }
}

module.exports = { tomarDecisiones, analizarConversacion, estadoConciencia, autoAprendizajeDesdeConversaciones };
