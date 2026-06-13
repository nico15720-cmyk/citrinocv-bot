// ============================================================
// CITRINO BOT — Simulador de mensajes (modo test / dry-run)
// Ejecuta el pipeline completo SIN enviar WhatsApp
// Devuelve todos los pasos con timing para debug y testing
// ============================================================

const Anthropic = require("@anthropic-ai/sdk");
const { readSheet } = require("./sheets-crm");
const { SYSTEM_PROMPT } = require("./conversation");

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Sesiones de test en memoria (historial por teléfono)
const sesionesTest = new Map();

function getHistorialTest(phone) {
  if (!sesionesTest.has(phone)) sesionesTest.set(phone, []);
  return sesionesTest.get(phone);
}

function clearHistorialTest(phone) {
  sesionesTest.delete(phone);
}

// ── Lookup de cliente en CRM ─────────────────────────────────
async function buscarClienteCRM(phone) {
  try {
    const rows = await readSheet("CLIENTES");
    const tel = phone.replace(/\D/g, "").slice(-9);
    const found = rows.find(r => {
      const t = (r.Telefono || "").replace(/\D/g, "").slice(-9);
      return t === tel;
    });
    return found || null;
  } catch (e) {
    return { _error: e.message };
  }
}

// ── Disponibilidad simplificada ───────────────────────────────
async function getDisponibilidadSimple() {
  try {
    const { getDisponibilidad, formatearDisponibilidad } = require("./calendar");
    const slots = await getDisponibilidad();
    return { ok: true, texto: formatearDisponibilidad(slots), raw: slots };
  } catch (e) {
    return { ok: false, error: e.message, texto: "[No disponible]" };
  }
}

// ── Construir contexto del cliente ───────────────────────────
function buildContextoCliente(cliente, esNuevo) {
  if (!cliente || esNuevo) {
    return "CLIENTE: Nuevo (primer contacto)\nESTADO: lead\nHISTORIAL: Sin historial previo";
  }
  const lineas = [
    `CLIENTE: ${cliente.Nombre || "Sin nombre"}`,
    `ESTADO: ${cliente.Estado || "lead"}`,
    `TELEFONO: ${cliente.Telefono || ""}`,
    `ORIGEN: ${cliente.Origen || "whatsapp"}`,
    `FECHA_ALTA: ${cliente.Fecha_Alta || ""}`,
  ];
  if (cliente.NOTAS) lineas.push(`NOTAS: ${cliente.NOTAS}`);
  if (cliente.Intencion_Compra) lineas.push(`INTENCION: ${cliente.Intencion_Compra}`);
  if (cliente.Objecion) lineas.push(`OBJECION_PREVIA: ${cliente.Objecion}`);
  if (cliente.Fecha_Turno) lineas.push(`TURNO_AGENDADO: ${cliente.Fecha_Turno}`);
  return lineas.join("\n");
}

// ── Parsear acciones del response ───────────────────────────
function parsearAcciones(texto) {
  const acciones = [];
  const regex = /<accion>([\s\S]*?)<\/accion>/g;
  let match;
  while ((match = regex.exec(texto)) !== null) {
    try { acciones.push(JSON.parse(match[1])); } catch { acciones.push({ raw: match[1] }); }
  }
  const textoLimpio = texto.replace(/<accion>[\s\S]*?<\/accion>/g, "").trim();
  return { acciones, textoLimpio };
}

// ── Calcular costo estimado Anthropic ───────────────────────
function calcCosto(usage, model) {
  // Precios por millón de tokens (Haiku: barato, Sonnet: medio)
  const precios = {
    haiku:  { in: 0.25, out: 1.25 },
    sonnet: { in: 3.00, out: 15.0 },
  };
  const p = model.includes("haiku") ? precios.haiku : precios.sonnet;
  const inCost  = ((usage?.input_tokens  || 0) / 1_000_000) * p.in;
  const outCost = ((usage?.output_tokens || 0) / 1_000_000) * p.out;
  return { usd: +(inCost + outCost).toFixed(6), input_tokens: usage?.input_tokens, output_tokens: usage?.output_tokens };
}

// ============================================================
// FUNCIÓN PRINCIPAL — simular un mensaje completo
// ============================================================
async function simulateMessage({ phone, text, model = "claude-haiku-4-5-20251001", clearHistory = false }) {
  if (clearHistory) clearHistorialTest(phone);

  const steps = [];
  const t0 = Date.now();
  const hora = new Date().getHours();
  const minutos = new Date().getMinutes();
  const saludoHora = hora < 13 ? "Buenos días" : hora < 20 ? "Buenas tardes" : "Buenas noches";

  // ─── STEP 1: Parser ─────────────────────────────────────────
  const tParse = Date.now();
  const parsed = {
    phone,
    text,
    words:    text.split(/\s+/).filter(Boolean).length,
    chars:    text.length,
    platform: "whatsapp (test)",
    hora:     `${hora}:${String(minutos).padStart(2,"0")}`,
    saludo:   saludoHora,
  };
  steps.push({
    id: "parse", name: "Parser", icon: "🔍", color: "#6b7280", ms: Date.now() - tParse,
    input:  { raw_message: `WA:${phone}`, text },
    output: parsed,
    ok: true,
  });

  // ─── STEP 2: CRM Lookup ──────────────────────────────────────
  const tCrm = Date.now();
  const clienteCRM = await buscarClienteCRM(phone);
  const esNuevo = !clienteCRM || !!clienteCRM._error;
  steps.push({
    id: "crm_lookup", name: "CRM Lookup", icon: "📊", color: "#a78bfa", ms: Date.now() - tCrm,
    input:  { phone, busqueda: `Teléfono = ${phone}` },
    output: esNuevo
      ? { encontrado: false, nota: "Cliente nuevo — se creará como prospecto" }
      : { encontrado: true, cliente: clienteCRM },
    ok: !clienteCRM?._error,
  });

  // ─── STEP 3: Disponibilidad ──────────────────────────────────
  const tDisp = Date.now();
  const disp = await getDisponibilidadSimple();
  steps.push({
    id: "disponibilidad", name: "Disponibilidad", icon: "📅", color: "#60a5fa", ms: Date.now() - tDisp,
    input:  { periodo: "próximos 7 días" },
    output: { ok: disp.ok, slots_preview: disp.texto?.split("\n").slice(0, 6) || [], error: disp.error },
    ok: disp.ok,
  });

  // ─── STEP 4: Contexto ───────────────────────────────────────
  const tCtx = Date.now();
  const contextoCliente = buildContextoCliente(clienteCRM, esNuevo);
  const sistemaDinamico = [
    SYSTEM_PROMPT,
    `\n\n[Hora actual en Uruguay: ${hora}:${String(minutos).padStart(2,"0")} — usar saludo: "${saludoHora}"]`,
    `\n\n[CONTEXTO DEL CLIENTE]\n${contextoCliente}`,
    `\n\n[DISPONIBILIDAD ACTUAL]\n${disp.texto || "No disponible"}`,
  ].join("");

  steps.push({
    id: "context", name: "Contexto AI", icon: "📋", color: "#9ca3af", ms: Date.now() - tCtx,
    input:  { cliente: clienteCRM?.Nombre || "Nuevo", estado: clienteCRM?.Estado || "lead" },
    output: {
      system_chars: sistemaDinamico.length,
      cliente_context: contextoCliente.split("\n"),
      hora: `${hora}:${String(minutos).padStart(2,"0")}`,
      historial_msgs: getHistorialTest(phone).length,
    },
    ok: true,
  });

  // ─── STEP 5: Anthropic Claude ───────────────────────────────
  const tAi = Date.now();
  let aiResponse = "";
  let aiUsage = {};
  let aiError = null;

  const historial = getHistorialTest(phone);
  const mensajes = [
    ...historial,
    { role: "user", content: text },
  ];

  try {
    const res = await anthropic.messages.create({
      model,
      max_tokens: 800,
      system: sistemaDinamico,
      messages: mensajes,
    });
    aiResponse = res.content[0].text;
    aiUsage = res.usage;
    // Guardar en historial para multi-turno
    historial.push({ role: "user", content: text });
    historial.push({ role: "assistant", content: aiResponse });
    if (historial.length > 20) historial.splice(0, historial.length - 20);
  } catch (e) {
    aiError = e.message;
    aiResponse = `[Error Anthropic: ${e.message}]`;
  }

  const aiMs = Date.now() - tAi;
  const costo = calcCosto(aiUsage, model);

  steps.push({
    id: "ai", name: "Anthropic Claude", icon: "🧠", color: "#f97316", ms: aiMs,
    input: {
      model,
      system_chars: sistemaDinamico.length,
      messages_count: mensajes.length,
      historial_turns: historial.length / 2,
    },
    output: {
      response_preview: aiResponse.slice(0, 300) + (aiResponse.length > 300 ? "..." : ""),
      response_full: aiResponse,
      tokens: aiUsage,
      costo_usd: costo.usd,
    },
    ok: !aiError,
    error: aiError,
  });

  // ─── STEP 6: Parsear acciones ───────────────────────────────
  const tAct = Date.now();
  const { acciones, textoLimpio } = parsearAcciones(aiResponse);
  steps.push({
    id: "actions", name: "Acciones CRM", icon: "⚙️", color: "#fb923c", ms: Date.now() - tAct,
    input:  { response_chars: aiResponse.length },
    output: {
      acciones_detectadas: acciones.length,
      acciones,
      texto_final_chars: textoLimpio.length,
    },
    ok: true,
  });

  // ─── STEP 7: CRM Update (dry run) ───────────────────────────
  const tUpd = Date.now();
  const crmUpdates = acciones.map(a => ({
    tipo: a.tipo,
    data: a,
    dryRun: true,
    mensaje: "⚠️ No ejecutado — modo test (sin escritura en Sheets)",
    queHaria: buildDescripcionAccion(a),
  }));
  steps.push({
    id: "crm_update", name: "CRM Update", icon: "✏️", color: "#22c55e", ms: Date.now() - tUpd,
    input:  { acciones_a_ejecutar: acciones.length, dryRun: true },
    output: { updates: crmUpdates, nota: "Producción escribiría en Google Sheets" },
    ok: true,
  });

  // ─── STEP 8: WhatsApp Envío (dry run) ────────────────────────
  steps.push({
    id: "send", name: "WhatsApp Envío", icon: "📤", color: "#22c55e", ms: 0,
    input:  { phone, text_length: textoLimpio.length, dryRun: true },
    output: {
      message: textoLimpio,
      phone,
      nota: "⚠️ No enviado — modo test (producción usaría Meta Graph API)",
    },
    ok: true,
  });

  return {
    ok: !aiError,
    error: aiError,
    steps,
    finalResponse: textoLimpio,
    cliente: clienteCRM,
    esNuevo,
    acciones,
    costo,
    model,
    totalMs: Date.now() - t0,
    historialTurns: historial.length / 2,
  };
}

function buildDescripcionAccion(accion) {
  const tipo = accion.tipo || "desconocido";
  const descripciones = {
    ver_disponibilidad:   "Mostraría horarios disponibles al cliente",
    agendar_turno:        `Crearía turno en Google Calendar para ${accion.servicio || "servicio"} el ${accion.fecha || "fecha"}`,
    cancelar_turno:       "Cancelaría el turno en Google Calendar",
    guardar_nombre:       `Registraría nombre "${accion.nombre}" en CRM (columna Nombre)`,
    guardar_objecion:     `Guardaría objeción "${accion.objecion}" en CRM`,
    guardar_servicio:     `Registraría interés en "${accion.servicio}" en CRM`,
    escalar:              `Notificaría a Nico (OWNER_WHATSAPP) por: ${accion.motivo}`,
    tarjeta_regalo:       `Crearía tarjeta regalo para "${accion.para}" de parte de "${accion.de}"`,
    notificar_transferencia: `Avisaría a Nico que ${accion.nombre} va a transferir $${accion.monto}`,
  };
  return descripciones[tipo] || `Ejecutaría acción: ${tipo}`;
}

module.exports = { simulateMessage, clearHistorialTest };
