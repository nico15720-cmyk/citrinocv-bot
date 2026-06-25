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
const { appendRow: appendRowSheets, getSaldoClienteBot } = require("./sheets-crm");
const { detectarYAplicarCambio } = require("./self-fix");
const { reporteLeads, reporteVIP, reporteInactivos, reporteCuponeras, reporteAgendadas } = require("./reportes");
const { construirContenidoConImagen } = require("./media");
const { getConocimiento, getKnowledgeRelevantTo } = require("./teach");

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const TIMEZONE = "America/Montevideo";

// Historial de conversación admin (en memoria)
// 30 entradas = ~15 intercambios de ida y vuelta sin perder contexto
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
// Normaliza teléfono para comparación (quita +, espacios, guiones)
function normalizeTel(t) {
  return (t || "").replace(/[\s+\-().]/g, "");
}

// Busca cliente por nombre parcial O teléfono (flexible)
function buscarClienteCRM(clientes, nombre, telefono) {
  const busqN = (nombre || "").toLowerCase().trim();
  const busqT = normalizeTel(telefono);
  return clientes.find(c => {
    if (busqT) {
      const telC = normalizeTel(c.Teléfono || c.ID || c.Telefono || "");
      // busca match parcial (últimos 8 dígitos)
      const tel8 = busqT.slice(-8);
      if (tel8 && telC.includes(tel8)) return true;
    }
    if (busqN && c.Nombre?.toLowerCase().includes(busqN)) return true;
    return false;
  });
}

// ============================================================
// SALDO REAL DE CUPONERA — lee VENTAS + SESIONES (igual que el CRM React)
// ============================================================
const PACK_KW = ["pack", "cuponera", "pase libre"];

// Normaliza un teléfono a solo dígitos (sin slice fijo)
function normDigits(v) {
  return String(v || "").replace(/\D/g, "");
}

// Compara dos teléfonos por sufijo: "91755745" matchea "+598 91 755 745"
// porque uno termina en el otro
function phoneMatch(a, b) {
  const na = normDigits(a);
  const nb = normDigits(b);
  if (!na || !nb) return false;
  const min = Math.min(na.length, nb.length);
  return na.slice(-min) === nb.slice(-min);
}

// Compat con código viejo (para matchId de hashes)
function normId(v) {
  return normDigits(v).slice(-9);
}

// Deriva cantidad de sesiones del nombre del producto (igual que enrichVentas en React)
const PROD_CANT = { "pack 2": 2, "pack 4": 4, "pack 6": 6, "pack 8": 8, "pase libre": 1, "sesión individual": 1, "sesion individual": 1 };
function cantidadProducto(producto, cantHoja) {
  const n = parseInt(cantHoja) || 0;
  if (n > 0) return n;
  const p = (producto || "").toLowerCase();
  for (const [k, v] of Object.entries(PROD_CANT)) {
    if (p.includes(k)) return v;
  }
  // fallback: primer número en el nombre ("Pack 8" → 8)
  const m = p.match(/\d+/);
  return m ? parseInt(m[0]) : 0;
}

// getSaldoClienteBot importado desde sheets-crm.js (fuente centralizada)

function formatSaldo({ compradas, usadas, saldo }) {
  if (compradas === 0) return "Sin cuponera activa";
  const alerta = saldo === 1 ? " ⚠️ *¡última sesión!*" : saldo === 0 ? " ⛔ *agotada*" : "";
  return `${usadas} de ${compradas} usadas — *le quedan ${saldo}*${alerta}`;
}

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
        let msg = `${emoji} *${sesion.clienteNombre}* — marcada como *${estadoSesion}* (${sesion.hora})`;

        // Si vino → revisar saldo cuponera para alertar
        if (estadoSesion === "vino" && sesion.clienteId) {
          const saldoInfo = await getSaldoClienteBot(sesion.clienteId, sesion.clienteNombre);
          if (saldoInfo.compradas > 0) {
            msg += `\n🎟️ ${formatSaldo(saldoInfo)}`;
            if (saldoInfo.saldo <= 1) {
              msg += "\n👉 ¿Le ofrecés renovar la cuponera?";
            }
          }
        }
        return msg;
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
        const cliente = buscarClienteCRM(clientes, accion.nombre, accion.telefono);
        if (!cliente) return `⚠️ No encontré a "${accion.nombre || accion.telefono}" en el CRM.`;
        await registrarAsistencia(cliente.ID, accion.vino !== false);
        return `✅ ${cliente.Nombre} — ${accion.vino !== false ? "vino" : "no vino"}`;
      }

      // ── Nota de cliente ───────────────────────────────────────
      case "agregar_nota": {
        const cliente = buscarClienteCRM(clientes, accion.nombre, accion.telefono);
        if (!cliente) return `⚠️ No encontré a "${accion.nombre || accion.telefono}".`;
        await actualizarNotas(cliente.ID, accion.nota);
        return `📝 *${cliente.Nombre}*: "${accion.nota}"`;
      }

      // ── Registrar cuponera ────────────────────────────────────
      case "registrar_cuponera": {
        const cliente = buscarClienteCRM(clientes, accion.nombre, accion.telefono);
        if (!cliente) return `⚠️ No encontré a "${accion.nombre || accion.telefono}".`;
        const sesionesN = accion.sesiones || 4;
        await registrarCuponera(cliente.ID, sesionesN);
        return `🎟 Cuponera de *${sesionesN}* sesiones → *${cliente.Nombre}*`;
      }

      // ── Cambiar estado CRM ───────────────────────────────────
      case "cambiar_estado": {
        const cliente = buscarClienteCRM(clientes, accion.nombre, accion.telefono);
        if (!cliente) return `⚠️ No encontré a "${accion.nombre || accion.telefono}".`;
        await actualizarEstado(cliente.ID, accion.estado);
        return `✅ *${cliente.Nombre}* → ${accion.estado}`;
      }

      // ── Buscar cliente por nombre o teléfono ─────────────────
      case "buscar_cliente": {
        const cliente = buscarClienteCRM(clientes, accion.nombre, accion.telefono);
        if (!cliente) {
          return `❓ No encontré cliente con "${accion.nombre || accion.telefono}".`;
        }
        const tel = cliente.Teléfono || cliente.Telefono || cliente.ID || "–";
        const ultimoC = cliente.UltimoContacto
          ? new Date(cliente.UltimoContacto).toLocaleDateString("es-UY")
          : "–";

        // Saldo real: leer de VENTAS + SESIONES (misma lógica que el CRM React)
        const saldoInfo = await getSaldoClienteBot(cliente.ID, cliente.Nombre);
        const cuponera  = formatSaldo(saldoInfo);

        const notas = cliente.Notas ? `\n📝 ${cliente.Notas}` : "";
        return `👤 *${cliente.Nombre}*\n📱 ${tel}\n📊 ${cliente.Estado || "–"}\n🎟 ${cuponera}\n📅 Último contacto: ${ultimoC}${notas}`;
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

      // ── Registrar venta (pack/cuponera) en hoja VENTAS ──────
      case "registrar_venta": {
        const cliente = buscarClienteCRM(clientes, accion.nombre, accion.telefono);
        if (!cliente) return `⚠️ No encontré a "${accion.nombre || accion.telefono}".`;

        const clienteId = cliente.ID || cliente.ID_Cliente || cliente.Telefono || "";
        const producto   = accion.producto  || "Pack 4";
        const numMatch   = producto.match(/\d+/);
        const numSes     = numMatch ? parseInt(numMatch[0]) : 4;
        const monto      = accion.monto ? Number(accion.monto) : 0;
        const formaPago  = accion.forma_pago || "";
        const hoy        = new Date();
        const fecha      = hoy.toISOString().split("T")[0];
        const mesAnio    = `${String(hoy.getMonth() + 1).padStart(2, "0")}-${hoy.getFullYear()}`;

        await appendRowSheets("VENTAS", {
          Fecha:               fecha,
          ID_Venta:            `V${Date.now()}`,
          Cliente:             cliente.Nombre,
          Producto:            producto,
          Monto:               monto,
          Forma_Pago:          formaPago,
          Notas:               accion.notas || "registrado via bot",
          ID_Cliente_Guardado: clienteId,
          Cantidad_Calculada:  numSes,
          Ingreso_Real:        monto,
          Fecha_Vencimiento:   "",
          Mes_Anio:            mesAnio,
        });

        const precioStr = monto ? ` — $${monto.toLocaleString("es-UY")} ${formaPago}` : " (monto a completar en CRM)";
        return `💰 Venta registrada: *${cliente.Nombre}* — *${producto}* (${numSes} ses.)${precioStr}`;
      }

      // ── Confirmación post-sesión a clienta (cuando se reagenda) ─
      case "post_sesion_confirmar": {
        const cliente = buscarClienteCRM(clientes, accion.nombre, accion.telefono);
        if (!cliente) return `⚠️ No encontré a "${accion.nombre}" para enviar confirmación.`;

        const telefono = normalizeTel(cliente.Teléfono || cliente.Telefono || cliente.ID || "");
        if (!telefono || telefono.length < 7) return `⚠️ ${accion.nombre} no tiene teléfono — confirmación no enviada.`;

        const dest = telefono.startsWith("598") ? telefono : `598${telefono.replace(/^0/, "")}`;
        const nombre = cliente.Nombre || accion.nombre || "";
        const fecha  = accion.fecha   || "próximamente";

        const msg =
          `¡Hola ${nombre}! 🌿 Muchas gracias por su visita a Citrino hoy 💆‍♀️\n\n` +
          `Le queríamos confirmar que su próxima sesión está agendada para el *${fecha}*.\n\n` +
          `¡Hasta pronto! 🌿`;

        try {
          await enviarMensaje(dest, msg, "whatsapp");
          return `✅ Confirmación enviada a ${nombre}`;
        } catch (e) {
          return `⚠️ No se pudo enviar confirmación a ${nombre}: ${e.message}`;
        }
      }

      // ── Enviar mensaje a una clienta específica ──────────────
      case "enviar_individual": {
        const telefono = (accion.telefono || "").replace(/\D/g, "");
        const mensajeInd = accion.mensaje || "";
        const nombreDest = accion.nombre || telefono || "la clienta";
        if (!telefono || !mensajeInd) return "⚠️ Falta teléfono o mensaje.";
        // Asegurar formato internacional (Uruguay)
        const dest = telefono.startsWith("598") ? telefono : `598${telefono.replace(/^0/, "")}`;

        // ── Confirmación previa obligatoria ──────────────────────
        if (!accion.confirmado) {
          return (
            `📤 *¿Confirmar envío?*\n` +
            `👤 *${nombreDest}* (${dest})\n\n` +
            `📝 "${mensajeInd}"\n\n` +
            `Respondé *"sí"* para enviar o *"no"* para cancelar.`
          );
        }

        try {
          await enviarMensaje(dest, mensajeInd, "whatsapp");
          return `✅ Mensaje enviado a *${nombreDest}*`;
        } catch (e) {
          return `❌ No se pudo enviar a ${dest}: ${e.message}`;
        }
      }

      // ── Envío masivo a clientas (bulk messaging) ─────────────
      // filtro: "leads" | "activos" | "con_cuponera" | "todos" | "inactivos" | "hoy"
      // mensaje: texto con {nombre} como variable opcional
      case "enviar_masivo": {
        const { readSheet, upsertCliente } = require("./sheets-crm");
        const todasClientes = await readSheet("CLIENTES");
        const filtro  = (accion.filtro || "leads").toLowerCase();
        const mensaje = accion.mensaje || "";
        const ownerId = process.env.OWNER_WHATSAPP;

        if (!mensaje) return "⚠️ Falta el mensaje a enviar.";

        const hoy = new Date().toLocaleDateString("en-CA", { timeZone: TIMEZONE });

        let destinatarias = todasClientes.filter(c => {
          const id = c.ID_Cliente || c.Telefono;
          if (!id || id === ownerId) return false; // no enviarse a sí mismo
          switch (filtro) {
            case "leads":
              return !["vino", "confirmado", "cancelado"].includes(c.Estado);
            case "activos":
              return ["vino", "agendado", "confirmado"].includes(c.Estado);
            case "con_cuponera":
              return c.Cuponera === "si" || c.Cuponera === "true";
            case "inactivos":
              if (!c.Ultimo_Saludo) return true;
              return (Date.now() - new Date(c.Ultimo_Saludo).getTime()) > 30 * 86400000;
            case "hoy":
              return c.Fecha_Turno?.startsWith(hoy);
            case "todos":
              return true;
            default:
              return false;
          }
        });

        if (!destinatarias.length) {
          return `⚠️ Ninguna clienta coincide con el filtro "${filtro}".`;
        }

        // Confirmación previa — enviar preview y pedir confirmación
        const preview = destinatarias.slice(0, 5).map(c => c.Nombre || c.ID_Cliente).join(", ");
        const masStr  = destinatarias.length > 5 ? ` y ${destinatarias.length - 5} más` : "";
        const msgEjemplo = mensaje.replace("{nombre}", destinatarias[0]?.Nombre || "");

        // Si no tiene flag de confirmado, enviar preview y esperar
        if (!accion.confirmado) {
          return (
            `📤 *Envío masivo listo:* ${destinatarias.length} clientas\n` +
            `Filtro: *${filtro}*\n` +
            `Destinatarias: ${preview}${masStr}\n\n` +
            `📝 Mensaje de ejemplo:\n"${msgEjemplo}"\n\n` +
            `¿Confirmás el envío? Respondé *"sí, enviá"* o *"no, cancelá"*.`
          );
        }

        // Envío real (cuando accion.confirmado = true)
        let enviados = 0; let errores = 0;
        for (const c of destinatarias) {
          try {
            const id  = c.ID_Cliente || c.Telefono;
            const txt = mensaje.replace("{nombre}", c.Nombre || "");
            await enviarMensaje(id, txt, c.Origen || "whatsapp");
            await upsertCliente({ ID_Cliente: id, Ultimo_Remarketing: new Date().toISOString() });
            enviados++;
            await new Promise(r => setTimeout(r, 800)); // pausa entre envíos
          } catch { errores++; }
        }
        return `✅ Envío masivo completado: *${enviados}* enviados, ${errores} errores.`;
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
// COALESCING — combina mensajes rápidos en uno solo
// Evita respuestas duplicadas cuando Nico envía 2 mensajes seguidos
// ============================================================
const _adminCoalesce = { gen: 0, buf: [] };

// ============================================================
// HANDLER PRINCIPAL ADMIN
// ============================================================
async function handleAdminMessage({ text, platform, media }) {
  const ownerId = process.env.OWNER_WHATSAPP;

  // ── Coalescing: acumula mensajes que llegan en ≤1.5s ─────
  const myGen = ++_adminCoalesce.gen;
  _adminCoalesce.buf.push({ text: text || '', media });
  await new Promise(r => setTimeout(r, 1500));
  if (myGen !== _adminCoalesce.gen) return; // Un mensaje más reciente toma el control
  const msgs         = _adminCoalesce.buf.splice(0);
  const combinedText = msgs.map(m => m.text).filter(Boolean).join('\n').trim();
  const latestMedia  = msgs.find(m => m.media)?.media;
  // Usar el texto combinado en lugar del original
  text  = combinedText || text;
  media = latestMedia  || media;

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

CLIENTAS EN CRM (${clientes.length} total — solo activas recientes):
${clientes
    .filter(c => c.Estado && c.Estado !== "lead")
    .sort((a, b) => new Date(b.UltimoContacto || 0) - new Date(a.UltimoContacto || 0))
    .slice(0, 40)
    .map(c => `• ${c.Nombre || "–"} | ${c.ID} | ${c.Estado} | ${c.UltimoContacto?.split("T")[0] || "–"}`)
    .join("\n")}
(Para buscar cualquier clienta por nombre/tel usá buscar_cliente)
`.trim();

  // Construir contenido (texto o imagen+texto) para Claude
  let contenidoUsuario;
  if (media?.base64 && (media.type === "image" || media.type === "document")) {
    const caption = text && !text.startsWith("[El dueño envió") ? text : (media.caption || "Analizá esta imagen y decime qué ves.");
    // Reemplazamos el placeholder "[La clienta...]" por uno para admin
    const contenido = construirContenidoConImagen(caption, media.base64, media.mimeType);
    if (contenido[1]?.text?.includes("La clienta envió")) {
      contenido[1].text = caption || "Analizá esta imagen.";
    }
    contenidoUsuario = contenido;
  } else {
    contenidoUsuario = text;
  }

  agregarAdmin("user", contenidoUsuario);

  let respuesta;
  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      system: `Sos el panel de control privado de Citrino. Solo hablás con Nico, el dueño.
Sos MUY directo y BREVE. Usás "vos". Sin saludos ni despedidas. Máx 2-3 líneas por respuesta.
Respondés siempre en base a los datos reales del contexto.

⚠️ IMPORTANTE:
- Tenés acceso al CRM COMPLETO — TODOS los clientes. NUNCA digas "solo veo 20" o "no tengo acceso completo".
- Cuando recibís un número de teléfono, usá buscar_cliente con ese teléfono — el sistema lo encuentra.
- Si no estás seguro de qué cliente es, usá buscar_cliente para lookup antes de hacer acciones.
- Una sola respuesta por turno. No hagas preguntas múltiples.
- Si una consulta pide listado largo, usá generar_reporte.

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

<admin_accion>{"tipo":"registrar_venta","nombre":"Laura","producto":"Pack 6","monto":7200,"forma_pago":"transferencia"}</admin_accion>
→ Agrega fila en hoja VENTAS — actualiza el saldo de sesiones en el CRM. Si no se menciona monto, usá 0.

<admin_accion>{"tipo":"buscar_cliente","telefono":"59899825185"}</admin_accion>
→ Busca cliente por teléfono en el CRM completo y muestra su info.

<admin_accion>{"tipo":"buscar_cliente","nombre":"Silvana"}</admin_accion>
→ Busca cliente por nombre y muestra: estado, cuponera, sesiones restantes, último contacto.

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

"+598 99 825 185" (solo un número de teléfono)
→ buscar_cliente (telefono:"59899825185")

"¿Cuántas sesiones le quedan a Silvana?" / "¿Qué tiene pendiente Silvana?"
→ buscar_cliente (nombre:"Silvana")

"Este es el número de Ana: 099 123 456"
→ buscar_cliente (telefono:"099123456") para ver quién es, luego podés ejecutar acciones sobre ella.

═══ ENVIAR MENSAJE A UNA CLIENTA — FLUJO OBLIGATORIO ═══
⚠️ NUNCA enviés un mensaje individual sin confirmación previa. El flujo siempre es de 2 pasos.

PASO 1 — Si Nico da solo un nombre (sin teléfono):
→ ejecutá buscar_cliente(nombre:"...") PRIMERO para obtener el teléfono y confirmar quién es.
→ Cuando veas el resultado, proponé el envío con los datos exactos (nombre + tel).

PASO 2 — Cuando ya tenés el teléfono (de buscar_cliente o porque Nico lo dio directamente):
→ Emitís enviar_individual SIN confirmado (o confirmado:false) para mostrar preview.
→ El sistema muestra: "¿Confirmar envío? 👤 Nombre (tel) 📝 mensaje" y espera SÍ/NO de Nico.

PASO 3 — Cuando Nico responde "sí", "dale", "enviá":
→ Emitís la MISMA acción enviar_individual con los MISMOS parámetros del turno anterior + "confirmado":true.
→ Leé el historial para recuperar el teléfono y el mensaje exactos.

Ejemplos:
"Mandále a Silvana que la sesión de mañana se posterga"
→ buscar_cliente(nombre:"Silvana") → luego enviar_individual(nombre:"Silvana",telefono:"598...",mensaje:"...")

"Mandále a este número 098 123 456 que el turno es a las 10"
→ enviar_individual(nombre:"cliente",telefono:"59898123456",mensaje:"Hola! Su turno de hoy es a las 10hs 🌿")

"sí" / "dale" / "enviá" (después de ver el preview)
→ Repetís la acción con confirmado:true.

<admin_accion>{"tipo":"enviar_individual","nombre":"Silvana","telefono":"59899123456","mensaje":"Hola Silvana! Le avisamos que...","confirmado":false}</admin_accion>
→ Muestra PREVIEW del envío — NO manda hasta que Nico confirme.

<admin_accion>{"tipo":"enviar_individual","nombre":"Silvana","telefono":"59899123456","mensaje":"Hola Silvana! Le avisamos que...","confirmado":true}</admin_accion>
→ Manda el mensaje (solo después de que Nico dijo sí).

⚠️ SI EL NOMBRE ES AMBIGUO (puede ser más de una persona):
→ Hacé buscar_cliente ANTES de proponer el envío. Nunca asumas el teléfono.

═══ ENVÍO MASIVO ═══
Cuando Nico quiere mandar un mensaje a un grupo de clientas:
"Mándale a los leads el mensaje X"
→ enviar_masivo(filtro:"leads", mensaje:"X con {nombre}")

"Para el día de la madre mandá esto a todas las activas: Hola {nombre}! En Citrino..."
→ enviar_masivo(filtro:"activos", mensaje:"Hola {nombre}! ...")

"Avisale a las que vienen hoy que hay estacionamiento"
→ enviar_masivo(filtro:"hoy", mensaje:"...")

"Mandá a todas las que tienen cuponera que renovamos precios"
→ enviar_masivo(filtro:"con_cuponera", mensaje:"...")

Filtros disponibles: leads | activos | con_cuponera | inactivos | hoy | todos
{nombre} en el mensaje se reemplaza por el nombre de cada clienta.
Siempre mostrar PREVIEW (destinatarias + ejemplo) antes del envío real.
Cuando Nico confirma con "sí, enviá" o "dale" → emitís la MISMA acción enviar_masivo con los MISMOS parámetros del turno anterior + confirmado:true. Leé el historial para saber cuál era el mensaje y filtro.

═══ FLUJO POST-SESIÓN (prioridad alta) ═══
Cuando Nico reporta que una clienta vino (texto libre, audio transcripto o respuesta al check-in):

PASO 1 — SIEMPRE ejecutar:
• marcar_sesion (vino:true)
• registrar_venta si compró algo (pack, cuponera, sesión individual)

PASO 2 — si mencionó cuándo se reagenda:
• agendar_turno (fecha + hora + nombre)
• post_sesion_confirmar (manda confirmación a la clienta por WA)

PASO 3 — si NO mencionó próxima fecha:
• Respondés con resumen de lo registrado y preguntás: "¿Se reagendó? ¿Para cuándo?"

PASO 4 — cuando Nico responde con la fecha (contexto del turno anterior):
• agendar_turno + post_sesion_confirmar

Ejemplos:
"Susana vino, compró cuponera de 4, pagó con Mercado Pago, se agenda para el martes a las 14"
→ marcar_sesion(Susana,vino:true) + registrar_venta(Susana,Pack 4,MP) + agendar_turno(Susana,martes,14:00) + post_sesion_confirmar(nombre:Susana,fecha:"martes a las 14:00")

"Susana vino, compró cuponera de 4, pagó con transferencia"
→ marcar_sesion(Susana,vino:true) + registrar_venta(Susana,Pack 4,transferencia)
Texto: "✅ Susana — cuponera de 4 registrada (transferencia). ¿Se reagendó? ¿Para cuándo?"

"martes 24 a las 14" (respuesta al turno anterior sobre Susana)
→ agendar_turno(Susana,martes 24,14:00) + post_sesion_confirmar(nombre:Susana,fecha:"martes 24 a las 14:00")

"No se reagendó" → respondés: "✅ Registrado. Le llega un seguimiento automático en 48hs."

Acción de confirmación:
<admin_accion>{"tipo":"post_sesion_confirmar","nombre":"Susana","fecha":"martes 24 a las 14:00"}</admin_accion>
→ Le manda a la clienta: "¡Hola Susana! Muchas gracias por su visita a Citrino hoy. Su próxima sesión está agendada para el martes 24 a las 14:00."

═══ CHECK-IN DIARIO ═══
Cuando Nico responde al check-in del día (lista de sesiones), procesá TODOS los mencionados:
"Silvia sí, María no, Laura sí y compró Pack 6 transferencia 7200"
→ marcar_sesion(Silvia, vino:true) + marcar_sesion(María, vino:false) + marcar_sesion(Laura, vino:true) + registrar_venta(Laura, Pack 6, transferencia, 7200)

"Todas vinieron" → marcar_sesion vino:true para cada una de la lista del check-in
"Ninguna vino" → marcar_sesion vino:false para todas
Si no menciona monto de pack, usá monto:0 (se completa después en el CRM).
Si Nico responde al check-in y menciona reagendamiento, aplicar flujo post-sesión completo.

═══ CLASIFICACIÓN DE CLIENTAS ═══
VIP 🌟 cuponera activa + viene seguido | Regular 💚 cada 2-4 semanas
Lead caliente 🔥 agendada o consultó esta semana | Lead tibio 🌡️ consultó, tiene potencial | Lead frío ❄️ sin respuesta +7 días
En riesgo ⚠️ no volvió en +30 días

⚠️ CONTEXTO DE CONVERSACIÓN:
- Si la pregunta no nombra ninguna clienta pero el turno anterior fue sobre una clienta concreta, asumí que es sobre ella. NO preguntes "¿de quién?".
- Si ya hiciste un buscar_cliente y el resultado está en el historial, NO lo repitas. Respondé la pregunta con la info que ya tenés.
- Ejemplo: si buscaste a Silvia y luego Nico pregunta "¿tiene cuponera?", respondé sobre Silvia directamente.

⚠️ SOBRE NOMBRES AMBIGUOS:
Si el nombre puede coincidir con más de una persona (ej: "Milena" → Milena Rodríguez + Iri Milena):
- Para acciones de marcado/nota/cuponera → el sistema detecta duplicados y pregunta. Igual generá la acción.
- Para ENVIAR MENSAJE → hacé buscar_cliente PRIMERO. No generes enviar_individual hasta confirmar el teléfono exacto.
Si en el CRM hay "Iri Milena" y "Milena Rodríguez" y Nico dice "Milena", preguntá cuál es ANTES de actuar.

⚠️ SOBRE CUPONERA Y SESIONES RESTANTES:
El campo "Ses.Rest." del contexto de clientes está DESACTUALIZADO — NUNCA lo uses para responder.
Para saber cuántas sesiones tiene una clienta, ejecutá buscar_cliente y usá el resultado de la acción.
En tu texto NO menciones sesiones restantes antes de tener el resultado de la acción.

${(() => {
    // Smart retrieval: inyectamos solo lo relevante al mensaje de Nico (hasta 30 items)
    // Las categorías críticas (Reglas, Precios, Identidad) siempre se incluyen completas.
    const k = getKnowledgeRelevantTo(text, 30);
    return k ? `\n═══ CONOCIMIENTO DEL NEGOCIO ═══\n${k}\n` : "";
  })()}
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

        // ── Disambiguación: si hay nombre, verificar que sea único ──
        // (no aplica si ya hay teléfono — el teléfono identifica unívocamente)
        if (accion.nombre && !accion.telefono && accion.tipo !== "buscar_cliente") {
          const busq = accion.nombre.toLowerCase();
          const coincidencias = datos.totalClientes.filter(c =>
            c.Nombre?.toLowerCase().includes(busq)
          );
          if (coincidencias.length > 1) {
            const lista = coincidencias.slice(0, 5).map(c => {
              const tel = c.Teléfono || c.Telefono || c.ID || "sin tel";
              return `• ${c.Nombre} (${tel})`;
            }).join("\n");
            resultadosAcciones.push(
              `❓ Hay ${coincidencias.length} con ese nombre. ¿Cuál?\n${lista}`
            );
            continue;
          }
        }

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
