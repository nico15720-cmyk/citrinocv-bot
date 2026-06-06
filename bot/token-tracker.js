// ============================================================
// CITRINO BOT — Token Tracker (costo de Anthropic en tiempo real)
// ============================================================

// Precios Claude Haiku (USD por millón de tokens)
const PRECIOS = {
  input:  0.80 / 1_000_000,
  output: 4.00 / 1_000_000,
};

// Acumulador en memoria (se resetea al reiniciar el servidor)
const acumulador = {
  mesActual: new Date().toISOString().slice(0, 7), // "2026-06"
  inputTokens:  0,
  outputTokens: 0,
  llamadas: 0,
  costoUSD: 0,
};

// ============================================================
// REGISTRAR USO
// Llamar después de cada request a Claude
// ============================================================
function registrarUso(usage, tipo = "chat") {
  if (!usage) return;

  const input  = usage.input_tokens  || 0;
  const output = usage.output_tokens || 0;
  const costo  = input * PRECIOS.input + output * PRECIOS.output;

  // Resetear si cambió el mes
  const mesHoy = new Date().toISOString().slice(0, 7);
  if (acumulador.mesActual !== mesHoy) {
    acumulador.mesActual  = mesHoy;
    acumulador.inputTokens  = 0;
    acumulador.outputTokens = 0;
    acumulador.llamadas     = 0;
    acumulador.costoUSD     = 0;
  }

  acumulador.inputTokens  += input;
  acumulador.outputTokens += output;
  acumulador.llamadas     += 1;
  acumulador.costoUSD     += costo;

  // Log cada 50 llamadas para no spamear la consola
  if (acumulador.llamadas % 50 === 0) {
    console.log(`💰 Tokens mes ${acumulador.mesActual}: ${acumulador.inputTokens.toLocaleString()} in / ${acumulador.outputTokens.toLocaleString()} out — $${acumulador.costoUSD.toFixed(4)} USD`);
  }
}

// ============================================================
// OBTENER RESUMEN DEL MES
// ============================================================
function getResumenTokens() {
  return {
    mes: acumulador.mesActual,
    inputTokens:  acumulador.inputTokens,
    outputTokens: acumulador.outputTokens,
    totalTokens:  acumulador.inputTokens + acumulador.outputTokens,
    llamadas:     acumulador.llamadas,
    costoUSD:     parseFloat(acumulador.costoUSD.toFixed(4)),
    costoEstimadoMensual: (() => {
      // Proyectar al mes completo según los días transcurridos
      const hoy = new Date();
      const diaDelMes = hoy.getDate();
      const diasEnMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate();
      const factor = diasEnMes / diaDelMes;
      return parseFloat((acumulador.costoUSD * factor).toFixed(2));
    })(),
  };
}

module.exports = { registrarUso, getResumenTokens };
