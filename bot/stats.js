// ============================================================
// CITRINO BOT — Módulo de Estadísticas Avanzadas
// LTV por cliente, Float financiero, Ranking
// ============================================================

const { leerTodosLosClientes } = require("./crm");
const { leerTransacciones } = require("./finanzas");

// Precio promedio de sesión (para cálculo de float cuando no hay dato exacto)
const PRECIO_SESION_PROMEDIO = 1400; // UYU
const COSTO_SESION_TERAPEUTA = 500;  // UYU — costo al dar la sesión

// ============================================================
// LTV DE UN CLIENTE
// Suma todos los ingresos de Finanzas asociados al clienteId
// ============================================================
async function getLTVCliente(userId) {
  try {
    const todas = await leerTransacciones();
    const tel = (userId || "").replace(/\D/g, "");
    const pagos = todas.filter(t => {
      if (t.tipo !== "ingreso") return false;
      const tTel = (t.clienteId || "").replace(/\D/g, "");
      return tTel && tel && tTel.includes(tel.slice(-8));
    });
    return pagos.reduce((s, p) => s + Math.abs(parseFloat(p.monto) || 0), 0);
  } catch { return 0; }
}

// ============================================================
// RANKING DE CLIENTES POR LTV
// ============================================================
async function getRankingClientes(limit = 30) {
  const [clientes, todasTrans] = await Promise.all([
    leerTodosLosClientes(),
    leerTransacciones(),
  ]);

  return clientes
    .map(c => {
      const tel = (c.ID || "").replace(/\D/g, "");
      const pagosCliente = todasTrans.filter(t => {
        if (t.tipo !== "ingreso") return false;
        const tTel = (t.clienteId || "").replace(/\D/g, "");
        return tTel && tel && tTel.includes(tel.slice(-8));
      });
      const ltv = pagosCliente.reduce((s, p) => s + Math.abs(parseFloat(p.monto) || 0), 0);
      const sesionesUsadas = pagosCliente.filter(p => p.categoria === "Servicio").length;
      const sesionesCompradas = sesionesUsadas + (parseInt(c["Ses.Rest."]) || 0);

      const diasInactivo = c.UltimoContacto
        ? Math.floor((Date.now() - new Date(c.UltimoContacto)) / 86400000)
        : 999;

      return {
        id: c.ID,
        nombre: c.Nombre || c.ID,
        ltv,
        sesionesCompradas,
        sesionesUsadas,
        saldo: parseInt(c["Ses.Rest."]) || 0,
        estado: c.Estado,
        cuponera: c.Cuponera,
        diasInactivo,
        canal: c.Canal,
      };
    })
    .sort((a, b) => b.ltv - a.ltv)
    .slice(0, limit);
}

// ============================================================
// FLOAT FINANCIERO
// Sesiones vendidas (pagas) pero aún no dadas
// = plata cobrada que hay que "devolver en servicio"
// ============================================================
async function getFloat() {
  const clientes = await leerTodosLosClientes();
  const conSaldo = clientes.filter(c =>
    c.Cuponera === "si" && parseInt(c["Ses.Rest."]) > 0
  );

  const totalPendientes = conSaldo.reduce((s, c) => s + (parseInt(c["Ses.Rest."]) || 0), 0);
  const cobradoPendiente = totalPendientes * PRECIO_SESION_PROMEDIO;
  const costoFuturo = totalPendientes * COSTO_SESION_TERAPEUTA;

  return {
    clientesConSaldo: conSaldo.length,
    sesionesPendientes: totalPendientes,
    cobradoPendiente,
    costoFuturo,
    capitalFlotanteNeto: cobradoPendiente - costoFuturo,
    detalle: conSaldo
      .sort((a, b) => (parseInt(b["Ses.Rest."]) || 0) - (parseInt(a["Ses.Rest."]) || 0))
      .map(c => ({
        nombre: c.Nombre || c.ID,
        id: c.ID,
        sesRest: parseInt(c["Ses.Rest."]) || 0,
        valor: (parseInt(c["Ses.Rest."]) || 0) * PRECIO_SESION_PROMEDIO,
      })),
  };
}

// ============================================================
// STATS COMPLETOS DEL MES (para dashboard mejorado)
// ============================================================
async function getStatsCompletos(mes) {
  const mesStr = mes || new Date().toISOString().slice(0, 7);
  const [clientes, transacciones] = await Promise.all([
    leerTodosLosClientes(),
    leerTransacciones(),
  ]);

  const delMes = transacciones.filter(t => (t.fecha || "").startsWith(mesStr));
  const ingresosMes = delMes.filter(t => t.tipo === "ingreso").reduce((s, t) => s + Math.abs(parseFloat(t.monto) || 0), 0);
  const gastosMes = delMes.filter(t => t.tipo === "gasto").reduce((s, t) => s + Math.abs(parseFloat(t.monto) || 0), 0);

  // Comisiones del mes (si hay medioPago)
  const comisionesTotales = delMes
    .filter(t => t.tipo === "ingreso" && t.medioPago)
    .reduce((s, t) => {
      const tasa = TASAS_COMISION[t.medioPago] || 0;
      return s + (Math.abs(parseFloat(t.monto) || 0) * tasa / 100);
    }, 0);

  // Sesiones del mes
  const sesionesDelMes = delMes.filter(t => t.tipo === "ingreso" && t.categoria === "Servicio").length;
  const ticketPromedio = sesionesDelMes > 0 ? ingresosMes / sesionesDelMes : 0;

  // Clientes activos este mes
  const inicioMes = new Date(mesStr + "-01");
  const finMes = new Date(new Date(inicioMes).setMonth(inicioMes.getMonth() + 1) - 1);
  const clientesActivos = clientes.filter(c => {
    if (!c.UltimoContacto) return false;
    const f = new Date(c.UltimoContacto);
    return f >= inicioMes && f <= finMes;
  }).length;

  return {
    mes: mesStr,
    ingresosBrutos: ingresosMes,
    comisiones: Math.round(comisionesTotales),
    ingresosNetos: Math.round(ingresosMes - comisionesTotales),
    gastos: gastosMes,
    gananciaNeta: Math.round(ingresosMes - comisionesTotales - gastosMes),
    sesiones: sesionesDelMes,
    ticketPromedio: Math.round(ticketPromedio),
    clientesActivos,
    margen: ingresosMes > 0 ? Math.round(((ingresosMes - comisionesTotales - gastosMes) / ingresosMes) * 100) : 0,
  };
}

// Tasas de comisión por medio de pago
const TASAS_COMISION = {
  efectivo:      0,
  transferencia: 0,
  debito:        2.75,
  credito:       3,
  "credito3":    10,
  mercadopago:   8,
};

module.exports = {
  getLTVCliente,
  getRankingClientes,
  getFloat,
  getStatsCompletos,
  TASAS_COMISION,
  PRECIO_SESION_PROMEDIO,
  COSTO_SESION_TERAPEUTA,
};
