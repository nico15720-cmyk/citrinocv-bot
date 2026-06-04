// ============================================================
// TEST LOCAL — Probá el bot desde la terminal sin WhatsApp real
// Uso: node test-local.js
// ============================================================

require("dotenv").config();
const readline = require("readline");

// Parchar sender ANTES de cargar conversation
const senderModule = require("./bot/sender");
senderModule.enviarMensaje = async (userId, texto, canal) => {
  console.log("\n─────────────────────────────────────");
  console.log(`🤖 CITI [${canal.toUpperCase()}]:`);
  console.log(texto);
  console.log("─────────────────────────────────────\n");
};
senderModule.marcarLeidoYEscribiendo = async () => {};
require.cache[require.resolve("./bot/sender")].exports = senderModule;

// Parchear Google Sheets para que no falle si no está configurado
try {
  const crmModule = require("./bot/crm");
  const cache = require.cache[require.resolve("./bot/crm")];
  if (cache) {
    const originalRegistrar = cache.exports.registrarCliente;
    cache.exports.registrarCliente = async (args) => {
      // Intentar, pero si falla (no hay Sheets) continuar igual
      try { return await originalRegistrar(args); } catch { return {}; }
    };
    cache.exports.buscarCliente = async () => null;
    cache.exports.actualizarEstado = async () => {};
    cache.exports.registrarTurno = async () => {};
    cache.exports.registrarCancelacion = async () => {};
  }
} catch {}

// Parchear Google Calendar
try {
  const calendarCache = require.cache[require.resolve("./bot/calendar")];
  if (calendarCache) {
    calendarCache.exports.getDisponibilidad = async () => [
      { fecha: "2026-06-09", fechaLabel: "lunes 9 de junio", horaInicio: "09:00", horaFin: "10:30", label: "lunes 9 de junio a las 09:00", inicioISO: "2026-06-09T09:00:00-03:00", finISO: "2026-06-09T10:30:00-03:00" },
      { fecha: "2026-06-09", fechaLabel: "lunes 9 de junio", horaInicio: "11:00", horaFin: "12:30", label: "lunes 9 de junio a las 11:00", inicioISO: "2026-06-09T11:00:00-03:00", finISO: "2026-06-09T12:30:00-03:00" },
      { fecha: "2026-06-10", fechaLabel: "martes 10 de junio", horaInicio: "09:00", horaFin: "10:30", label: "martes 10 de junio a las 09:00", inicioISO: "2026-06-10T09:00:00-03:00", finISO: "2026-06-10T10:30:00-03:00" },
      { fecha: "2026-06-13", fechaLabel: "viernes 13 de junio", horaInicio: "14:00", horaFin: "15:30", label: "viernes 13 de junio a las 14:00", inicioISO: "2026-06-13T14:00:00-03:00", finISO: "2026-06-13T15:30:00-03:00" },
    ];
    calendarCache.exports.crearTurno = async (args) => {
      console.log(`\n📅 [SIMULADO] Turno creado: ${args.servicio} para ${args.nombre} el ${args.slot?.label}`);
      return { id: "evt_simulado_001" };
    };
    calendarCache.exports.cancelarTurno = async () => console.log("\n🗑️ [SIMULADO] Turno cancelado");
    calendarCache.exports.buscarTurnoCliente = async () => ({ id: "evt_simulado_001", summary: "Turno de prueba" });
    calendarCache.exports.resolverSlot = async (dia, hora) => {
      return { fecha: "2026-06-09", fechaLabel: "lunes 9 de junio", horaInicio: hora || "09:00", horaFin: "10:30", label: `lunes 9 de junio a las ${hora || "09:00"}`, inicioISO: "2026-06-09T09:00:00-03:00", finISO: "2026-06-09T10:30:00-03:00" };
    };
  }
} catch {}

const { handleIncomingMessage } = require("./bot/conversation");
const { handleAdminMessage } = require("./bot/admin");

// ============================================================
// REPL interactivo
// ============================================================
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const USER_ID = "test_local_user";
const CANAL = "whatsapp";

console.log("═══════════════════════════════════════");
console.log("  🌿 CITRINO BOT — Modo prueba local");
console.log("═══════════════════════════════════════");
console.log("  Escribí como cliente, o empezá con 'ADMIN:' para modo dueño.");
console.log("  Escribe 'salir' para terminar.\n");

function pregunta() {
  rl.question("Vos: ", async (input) => {
    const texto = input.trim();
    if (!texto) return pregunta();
    if (texto.toLowerCase() === "salir") {
      console.log("\n👋 Hasta luego!\n");
      process.exit(0);
    }

    try {
      if (texto.toUpperCase().startsWith("ADMIN:")) {
        const mensajeAdmin = texto.slice(6).trim();
        await handleAdminMessage({ text: mensajeAdmin, platform: CANAL });
      } else {
        await handleIncomingMessage({
          userId: USER_ID,
          text: texto,
          platform: CANAL,
          messageId: null,
        });
      }
    } catch (err) {
      console.error("❌ Error:", err.message);
    }

    pregunta();
  });
}

pregunta();
