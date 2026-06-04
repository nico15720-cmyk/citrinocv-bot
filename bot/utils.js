// ============================================================
// CITRINO BOT — Utils: retry, circuit breaker, alertas
// ============================================================

const { enviarMensaje } = require("./sender");
const OWNER = process.env.OWNER_WHATSAPP;

// ============================================================
// RETRY CON BACKOFF EXPONENCIAL
// Reintenta automáticamente en caso de error transitorio
// ============================================================
async function conRetry(fn, opciones = {}) {
  const {
    intentos = 3,
    delayBase = 1000,   // ms
    nombre = "operación",
    silencioso = false,
  } = opciones;

  let ultimoError;
  for (let i = 1; i <= intentos; i++) {
    try {
      return await fn();
    } catch (err) {
      ultimoError = err;
      const esUltimoIntento = i === intentos;

      // No reintentar errores que no son transitorios
      const esErrorPermanente =
        err.status === 400 ||
        err.status === 401 ||
        err.status === 403 ||
        err.status === 404 ||
        (err.code && ["INVALID_ARGUMENT", "PERMISSION_DENIED", "NOT_FOUND"].includes(err.code));

      if (esErrorPermanente || esUltimoIntento) {
        if (!silencioso) {
          console.error(`❌ ${nombre} falló después de ${i} intento(s):`, err.message);
        }
        break;
      }

      const delay = delayBase * Math.pow(2, i - 1); // 1s, 2s, 4s
      console.warn(`⚠️ ${nombre} falló (intento ${i}/${intentos}), reintentando en ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw ultimoError;
}

// ============================================================
// WRAPPER SEGURO — nunca tira, devuelve fallback si falla
// ============================================================
async function seguro(fn, fallback = null, nombre = "operación") {
  try {
    return await conRetry(fn, { nombre, intentos: 2, silencioso: true });
  } catch (err) {
    console.error(`⚠️ ${nombre} no disponible, usando fallback:`, err.message);
    return fallback;
  }
}

// ============================================================
// CIRCUIT BREAKER — deja de intentar si falla mucho
// Evita que un servicio caído sature el bot
// ============================================================
const circuitBreakers = {};

function getCircuit(nombre) {
  if (!circuitBreakers[nombre]) {
    circuitBreakers[nombre] = {
      fallos: 0,
      ultimoFallo: null,
      abierto: false,
    };
  }
  return circuitBreakers[nombre];
}

async function conCircuit(nombre, fn, fallback = null) {
  const circuit = getCircuit(nombre);
  const UMBRAL_FALLOS = 5;
  const TIEMPO_ESPERA = 5 * 60 * 1000; // 5 minutos

  // Si el circuito está abierto, ver si es momento de reintentar
  if (circuit.abierto) {
    const tiempoTranscurrido = Date.now() - circuit.ultimoFallo;
    if (tiempoTranscurrido < TIEMPO_ESPERA) {
      return fallback;
    }
    // Semi-abierto: dejar pasar un intento
    circuit.abierto = false;
    console.log(`🔄 Circuit breaker [${nombre}]: reintentando...`);
  }

  try {
    const resultado = await fn();
    // Éxito: resetear fallos
    if (circuit.fallos > 0) {
      console.log(`✅ Circuit breaker [${nombre}]: servicio restaurado`);
      circuit.fallos = 0;
    }
    return resultado;
  } catch (err) {
    circuit.fallos++;
    circuit.ultimoFallo = Date.now();

    if (circuit.fallos >= UMBRAL_FALLOS) {
      circuit.abierto = true;
      console.error(`🔴 Circuit breaker [${nombre}] ABIERTO después de ${circuit.fallos} fallos`);
      // Notificar a Nico
      notificarError(nombre, err.message).catch(() => {});
    }

    return fallback;
  }
}

// ============================================================
// NOTIFICAR ERROR A NICO
// ============================================================
const erroresNotificados = new Set();

async function notificarError(servicio, mensaje) {
  if (!OWNER) return;

  // No spamear el mismo error
  const key = `${servicio}:${mensaje.slice(0, 50)}`;
  if (erroresNotificados.has(key)) return;
  erroresNotificados.add(key);
  setTimeout(() => erroresNotificados.delete(key), 60 * 60 * 1000); // olvidar en 1 hora

  const texto =
    `⚠️ *Alerta del bot*\n\n` +
    `Servicio: *${servicio}*\n` +
    `Error: ${mensaje}\n\n` +
    `El bot sigue funcionando pero puede haber funcionalidades limitadas.`;

  await enviarMensaje(OWNER, texto, "whatsapp").catch(() => {});
}

// ============================================================
// MONITOR DE SALUD — verifica servicios periódicamente
// ============================================================
async function verificarSalud() {
  const problemas = [];

  // Verificar Google Sheets
  try {
    const { leerTodosLosClientes } = require("./crm");
    await leerTodosLosClientes();
  } catch (err) {
    problemas.push(`Google Sheets: ${err.message}`);
  }

  // Verificar Google Calendar
  try {
    const { getDisponibilidad } = require("./calendar");
    await getDisponibilidad();
  } catch (err) {
    problemas.push(`Google Calendar: ${err.message}`);
  }

  if (problemas.length > 0) {
    console.error("🔴 Problemas detectados en verificación de salud:", problemas);
    if (OWNER) {
      const texto =
        `🔴 *Verificación de salud — problemas detectados*\n\n` +
        problemas.map(p => `• ${p}`).join("\n") +
        `\n\nRevisá los logs en Railway para más detalles.`;
      await enviarMensaje(OWNER, texto, "whatsapp").catch(() => {});
    }
  } else {
    console.log("✅ Verificación de salud: todos los servicios OK");
  }
}

module.exports = { conRetry, seguro, conCircuit, notificarError, verificarSalud };
