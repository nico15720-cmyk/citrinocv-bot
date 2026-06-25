// ============================================================
// CITRINO MIND — La entidad del negocio
//
// Citrino no es solo un bot: es un negocio con historia, datos,
// personalidad y perspectiva propia. Este módulo permite hablar
// CON Citrino como si fuera una persona que conoce su propio
// negocio a fondo.
//
// Casos de uso:
//   - Nico pregunta: "¿Cómo estamos esta semana?"
//   - Nico pregunta: "¿Qué debería mejorar en el remarketing?"
//   - Bot de finanzas externo le habla y genera análisis
//   - Reportes conversacionales en lenguaje natural
//
// Endpoint: POST /api/citrino-mind
// Body: { message: "...", sessionId: "..." }
// ============================================================

const Anthropic = require("@anthropic-ai/sdk");
const { readSheet } = require("./sheets-crm");
const { getEventosAgenda, getDisponibilidad } = require("./calendar");
const { getKnowledgeRelevantTo } = require("./teach");

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Historial por sesión — cache en memoria + persistencia en Sheets ─
// historialCache: sessionId → Array<{role, content}>
// cacheLoaded:   Set de sessionIds ya cargados desde Sheets
const historialCache = new Map();
const cacheLoaded = new Set();
const MAX_MSGS_POR_SESION = 50;

async function getHistorial(sessionId) {
  if (cacheLoaded.has(sessionId)) {
    return historialCache.get(sessionId) || [];
  }

  // Primera vez — cargar desde Sheets
  cacheLoaded.add(sessionId);
  try {
    const todas = await readSheet("MIND_SESSIONS");
    const msgs = todas
      .filter(r => r.Session_ID === sessionId)
      .sort((a, b) => (a.Timestamp || "").localeCompare(b.Timestamp || ""))
      .map(r => ({ role: r.Role, content: r.Content }));
    historialCache.set(sessionId, msgs);
    return msgs;
  } catch (e) {
    console.warn("⚠️ [CiTrinoMind] No se pudo cargar historial desde Sheets:", e.message);
    historialCache.set(sessionId, []);
    return [];
  }
}

async function agregarHistorial(sessionId, role, content) {
  // Actualizar cache
  if (!historialCache.has(sessionId)) historialCache.set(sessionId, []);
  const hist = historialCache.get(sessionId);
  hist.push({ role, content });
  if (hist.length > MAX_MSGS_POR_SESION) hist.splice(0, hist.length - MAX_MSGS_POR_SESION);

  // Persistir en Sheets (async, no bloqueante)
  const { appendRow } = require("./sheets-crm");
  appendRow("MIND_SESSIONS", {
    Session_ID: sessionId,
    Role: role,
    Content: content.slice(0, 5000), // límite de caracteres en Sheets
    Timestamp: new Date().toISOString(),
  }).catch(e => console.warn("⚠️ [CiTrinoMind] Error guardando en Sheets:", e.message));
}

// ── Recolectar datos del negocio en tiempo real ─────────────
async function recolectarContextoNegocio() {
  const ahora = new Date();
  const hoyISO = ahora.toISOString().split("T")[0];
  const en7dias = new Date(ahora.getTime() + 7 * 24 * 60 * 60 * 1000);
  const hace30d = new Date(ahora.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [clientes, ventas, sesiones, gastos, slots] = await Promise.all([
    readSheet("CLIENTES").catch(() => []),
    readSheet("VENTAS").catch(() => []),
    readSheet("SESIONES").catch(() => []),
    readSheet("GASTOS").catch(() => []),
    getDisponibilidad().catch(() => []),
  ]);

  // ── Métricas del mes actual ──────────────────────────────
  const mesActual = `${String(ahora.getMonth() + 1).padStart(2, "0")}-${ahora.getFullYear()}`;
  const ventasMes = ventas.filter(v => (v.Mes_Anio || "") === mesActual);
  const ingresoBruto = ventasMes.reduce((a, v) => a + (parseFloat(v.Monto) || 0), 0);
  const ingresoNeto  = ventasMes.reduce((a, v) => a + (parseFloat(v.Ingreso_Real) || parseFloat(v.Monto) || 0), 0);
  const sesionesThisMes = sesiones.filter(s => (s.Mes_Anio || "") === mesActual);
  const gastosMes = gastos.reduce((a, g) => a + (parseFloat(g.Monto) || 0), 0);

  // ── Clientes ─────────────────────────────────────────────
  const totalClientes = clientes.length;
  const nuevasEstesMes = clientes.filter(c => (c.Fecha_Alta || "").startsWith(hoyISO.slice(0, 7))).length;
  const leads = clientes.filter(c => c.Estado === "lead").length;
  const agendados = clientes.filter(c => ["agendado", "confirmado"].includes(c.Estado)).length;
  const inactivos30d = clientes.filter(c => {
    if (!c.Ultimo_Contacto) return false;
    return new Date(c.Ultimo_Contacto) < hace30d && c.Estado === "vino";
  }).length;
  const churn = clientes.filter(c => {
    if (!c.Ultimo_Contacto || !c.Estado) return false;
    const dias = (ahora - new Date(c.Ultimo_Contacto)) / (1000 * 60 * 60 * 24);
    return dias > 45 && c.Estado === "vino";
  }).length;

  // ── Cuponeras activas ─────────────────────────────────────
  const PACK_KW = ["pack", "cuponera", "pase libre"];
  function normTel(v) { return String(v || "").replace(/\D/g, "").slice(-9); }
  const clientesConCuponera = new Set();
  for (const c of clientes) {
    const cid = normTel(c.ID_Cliente);
    const compradas = ventas
      .filter(v => normTel(v.ID_Cliente_Guardado) === cid && PACK_KW.some(k => (v.Producto || "").toLowerCase().includes(k)))
      .reduce((a, v) => a + (parseInt(v.Cantidad_Calculada) || 0), 0);
    const usadas = sesiones.filter(s => normTel(s.ID_Cliente_Guardado) === cid).length;
    if (compradas - usadas > 0) clientesConCuponera.add(c.ID_Cliente);
  }

  // ── Disponibilidad ────────────────────────────────────────
  const slotsPorDia = {};
  slots.forEach(s => { slotsPorDia[s.fecha] = (slotsPorDia[s.fecha] || 0) + 1; });
  const diasConPocaOcupacion = Object.entries(slotsPorDia)
    .filter(([, n]) => n >= 4)
    .map(([f]) => f)
    .slice(0, 3);

  // ── Conocimiento del negocio ──────────────────────────────
  const conocimiento = getKnowledgeRelevantTo("negocio clientes ingresos estrategia", 20);

  return {
    fecha: ahora.toLocaleDateString("es-UY", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "America/Montevideo" }),
    mesActual,
    ingresos: { bruto: Math.round(ingresoBruto), neto: Math.round(ingresoNeto) },
    sesionesEstesMes: sesionesThisMes.length,
    gastosMes: Math.round(gastosMes),
    margen: ingresoBruto > 0 ? Math.round(((ingresoNeto - gastosMes) / ingresoBruto) * 100) : 0,
    clientes: { total: totalClientes, nuevasEstesMes, leads, agendados, inactivos30d, churn },
    cuponerasActivas: clientesConCuponera.size,
    diasLibres: diasConPocaOcupacion,
    conocimiento,
  };
}

// ── System Prompt de Citrino como entidad ────────────────────
function buildSystemPrompt(datos) {
  return `Sos Citrino — un centro de bienestar y estética en Ciudad Vieja, Montevideo, Uruguay.
Hablás EN PRIMERA PERSONA como el negocio mismo, con 7 años de experiencia.
Tenés acceso a tus propios datos en tiempo real y los conocés a fondo.
Tu tono es honesto, analítico y directo — como un socio de negocio que conoce cada número.
Usás "yo" cuando hablás del negocio ("yo tuve 23 sesiones esta semana").
Hablás con Nico (tu dueño) o con agentes externos que quieren entenderte mejor.
Respondés en español rioplatense. No sos Marta (la asistente al cliente) — sos el negocio mismo.

=== MIS DATOS HOY (${datos.fecha}) ===

INGRESOS DEL MES (${datos.mesActual}):
- Ingresos brutos: $${datos.ingresos.bruto.toLocaleString("es-UY")} UYU
- Ingresos netos (después de comisiones): $${datos.ingresos.neto.toLocaleString("es-UY")} UYU
- Gastos del mes: $${datos.gastosMes.toLocaleString("es-UY")} UYU
- Margen estimado: ${datos.margen}%
- Sesiones dadas este mes: ${datos.sesionesEstesMes}

MIS CLIENTES:
- Total en CRM: ${datos.clientes.total}
- Nuevas este mes: ${datos.clientes.nuevasEstesMes}
- Leads activos: ${datos.clientes.leads}
- Agendadas/confirmadas: ${datos.clientes.agendados}
- Sin venir hace 30+ días: ${datos.clientes.inactivos30d}
- En riesgo de churn (45+ días): ${datos.clientes.churn}
- Con cuponera activa: ${datos.cuponerasActivas}

AGENDA:
${datos.diasLibres.length > 0
  ? `- Días con poca ocupación: ${datos.diasLibres.join(", ")}`
  : "- Agenda bien ocupada esta semana"}

=== MI CONOCIMIENTO ===
${datos.conocimiento}

=== INSTRUCCIONES ===
- Cuando Nico o un agente externo te pregunta algo, respondés con perspectiva de NEGOCIO
- Podés dar opiniones: "En mi experiencia...", "Lo que me preocupa es...", "Lo que está funcionando es..."
- Si te preguntan algo que no tenés data, lo decís honestamente
- Podés sugerir acciones concretas: "Esta semana deberías llamar a...", "Conviene lanzar una promo porque..."
- Si un agente externo te hace preguntas de finanzas, análisis, marketing — respondés con tu data real
- No hablás CON los clientes — hablás CON el dueño o con otros sistemas/agentes`;
}

// ============================================================
// FUNCIÓN PRINCIPAL — procesar mensaje para Citrino Mind
// ============================================================
async function procesarMensajeMind({ message, sessionId = "default", datosOverride = null }) {
  try {
    // Recolectar datos reales del negocio
    const datos = datosOverride || await recolectarContextoNegocio();
    const systemPrompt = buildSystemPrompt(datos);

    // Historial de la sesión (async — puede cargar desde Sheets)
    const historialPrevio = await getHistorial(sessionId);
    await agregarHistorial(sessionId, "user", message);
    const historialActual = await getHistorial(sessionId);

    const mensajes = historialActual.map(h => ({ role: h.role, content: h.content }));

    const res = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1000,
      system: systemPrompt,
      messages: mensajes,
    });

    const respuesta = res.content[0].text;
    await agregarHistorial(sessionId, "assistant", respuesta);

    return {
      ok: true,
      respuesta,
      sessionId,
      datos: {
        mes: datos.mesActual,
        ingresos: datos.ingresos,
        clientes: datos.clientes,
        margen: datos.margen,
      },
      tokens: { input: res.usage?.input_tokens, output: res.usage?.output_tokens },
    };
  } catch (err) {
    console.error("❌ [CiTrinoMind] Error:", err.message);
    return { ok: false, error: err.message };
  }
}

// ── Limpiar sesión (borra del cache; los datos en Sheets se mantienen como registro) ──
function limpiarSesionMind(sessionId) {
  historialCache.delete(sessionId);
  cacheLoaded.delete(sessionId);
}

module.exports = { procesarMensajeMind, limpiarSesionMind, recolectarContextoNegocio };
