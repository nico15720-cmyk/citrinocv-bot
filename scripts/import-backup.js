// ============================================================
// CITRINO BOT — Script de importación del backup
// Importa CLIENTES + SESIONES + VENTAS al Google Sheets CRM
//
// Uso: node scripts/import-backup.js ruta/al/backup.json
// ============================================================

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { sheets: googleSheets } = require("@googleapis/sheets");
const { GoogleAuth } = require("google-auth-library");

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID;
const SHEET_CRM = "CRM";
const SHEET_SESIONES = "Sesiones";
const SHEET_VENTAS = "Ventas";

// ============================================================
// AUTH
// ============================================================
function getSheets() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return googleSheets({ version: "v4", auth });
}

// ============================================================
// NORMALIZAR TELÉFONO → formato Uruguay sin espacios
// "095 720 061" → "595720061" (como lo recibiría WhatsApp)
// ============================================================
function normalizarTelefono(tel) {
  if (!tel) return "";
  const limpio = tel.replace(/[\s\-\+]/g, "");
  // Si empieza con 598 → ya está bien
  if (limpio.startsWith("598")) return limpio;
  // Si empieza con 0 → quitar el 0 y agregar 598
  if (limpio.startsWith("0")) return "598" + limpio.slice(1);
  // Si no tiene prefijo → agregar 598
  return "598" + limpio;
}

// ============================================================
// PARSEAR FECHA del formato "DD/MM/YY" o "DD/MM/YY, HH:MM"
// ============================================================
function parsearFecha(fechaStr) {
  if (!fechaStr) return "";
  try {
    // Formato "27/12/25, 18:31" o "1/1/25"
    const partes = fechaStr.split(",")[0].trim().split("/");
    if (partes.length !== 3) return fechaStr;
    const [dia, mes, anio] = partes;
    const anioCompleto = parseInt(anio) < 100 ? 2000 + parseInt(anio) : parseInt(anio);
    return new Date(anioCompleto, parseInt(mes) - 1, parseInt(dia)).toISOString();
  } catch {
    return fechaStr;
  }
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  const backupPath = process.argv[2];
  if (!backupPath) {
    console.error("❌ Uso: node scripts/import-backup.js ruta/al/backup.json");
    process.exit(1);
  }

  console.log(`📂 Leyendo backup: ${backupPath}`);
  const backup = JSON.parse(fs.readFileSync(backupPath, "utf8"));

  const clientes = backup.CLIENTES || [];
  const sesiones = backup.SESIONES || [];
  const ventas = backup.VENTAS || [];

  console.log(`📊 Datos encontrados: ${clientes.length} clientes, ${sesiones.length} sesiones, ${ventas.length} ventas`);

  const sheets = getSheets();

  // ============================================================
  // 1. CONSTRUIR MAPA DE DATOS ENRIQUECIDOS POR CLIENTE
  // ============================================================
  const mapaClientes = {};

  // Indexar clientes
  for (const c of clientes) {
    const id = c.ID_Cliente;
    mapaClientes[id] = {
      nombre: c.Nombre || "",
      telefono: normalizarTelefono(c.Telefono),
      telefonoOriginal: c.Telefono || "",
      origen: c.Origen || "",
      fechaAlta: parsearFecha(c.Fecha_Alta),
      notas: c.NOTAS || "",
      sesionesHistorial: [],
      ventasHistorial: [],
      ultimaSesion: null,
      tratamientoFrecuente: "",
      cuponera: "no",
      sesionesRestantes: 0,
      ingresosTotal: 0,
    };
  }

  // Agregar sesiones a cada cliente
  for (const s of sesiones) {
    const id = s.ID_Cliente_Guardado || s.ID_Cliente_Guardado2;
    if (mapaClientes[id]) {
      mapaClientes[id].sesionesHistorial.push(s);
    }
  }

  // Agregar ventas a cada cliente
  for (const v of ventas) {
    const id = v.ID_Cliente_Guardado || v.ID_Cliente_Guardado2;
    if (mapaClientes[id]) {
      mapaClientes[id].ventasHistorial.push(v);
      mapaClientes[id].ingresosTotal += parseFloat(v.Ingreso_Real) || parseFloat(v.Monto) || 0;
    }
  }

  // Calcular datos derivados por cliente
  for (const [id, c] of Object.entries(mapaClientes)) {
    // Tratamiento más frecuente
    const tratamientos = {};
    for (const s of c.sesionesHistorial) {
      const t = s.Tratamiento || "";
      tratamientos[t] = (tratamientos[t] || 0) + 1;
    }
    c.tratamientoFrecuente = Object.entries(tratamientos).sort((a, b) => b[1] - a[1])[0]?.[0] || "";

    // Última sesión
    if (c.sesionesHistorial.length > 0) {
      const sorted = [...c.sesionesHistorial].sort((a, b) => {
        return new Date(parsearFecha(b.Fecha_Hora)) - new Date(parsearFecha(a.Fecha_Hora));
      });
      c.ultimaSesion = parsearFecha(sorted[0].Fecha_Hora);
    }

    // Cuponera: total sesiones compradas vs usadas
    let sesionesCompradas = 0;
    for (const v of c.ventasHistorial) {
      sesionesCompradas += parseInt(v.Cantidad_Calculada) || 0;
    }
    const sesionesUsadas = c.sesionesHistorial.length;
    if (sesionesCompradas > 0) {
      c.cuponera = "si";
      c.sesionesRestantes = Math.max(0, sesionesCompradas - sesionesUsadas);
    }
  }

  // ============================================================
  // 2. IMPORTAR AL SHEET CRM
  // ============================================================
  console.log("\n📝 Importando al Sheet CRM...");

  // Verificar/crear headers del CRM
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_CRM}!A1:O1`,
    valueInputOption: "RAW",
    resource: {
      values: [[
        "ID", "Nombre", "Teléfono", "Canal", "Servicio", "Estado",
        "Cuponera", "Ses. Rest.", "Fecha Alta", "Fecha Turno",
        "Event ID", "Notas", "Último Contacto", "Remarketing", "Perfil"
      ]],
    },
  });

  // Construir filas del CRM
  const filasCRM = Object.entries(mapaClientes).map(([id, c]) => {
    const telefono = c.telefono || c.telefonoOriginal;
    const notas = [
      c.notas,
      c.origen ? `Origen: ${c.origen}` : "",
      c.ingresosTotal > 0 ? `Ingresos históricos: $${c.ingresosTotal.toLocaleString("es-UY")} UYU` : "",
      c.sesionesHistorial.length > 0 ? `Sesiones registradas: ${c.sesionesHistorial.length}` : "",
    ].filter(Boolean).join(" | ");

    const perfil = JSON.stringify({
      servicios_preferidos: c.tratamientoFrecuente ? [c.tratamientoFrecuente] : [],
      origen: c.origen,
      sesiones_realizadas: c.sesionesHistorial.length,
      ingresos_historicos: c.ingresosTotal,
      importado_desde_app: true,
    });

    return [
      telefono,                           // A: ID
      c.nombre,                           // B: Nombre
      c.telefonoOriginal,                 // C: Teléfono original
      "whatsapp",                         // D: Canal (default)
      c.tratamientoFrecuente,             // E: Servicio
      c.ultimaSesion ? "vino" : "lead",  // F: Estado
      c.cuponera,                         // G: Cuponera
      String(c.sesionesRestantes),        // H: Ses. Rest.
      c.fechaAlta,                        // I: Fecha Alta
      "",                                 // J: Fecha Turno (vacío)
      "",                                 // K: Event ID (vacío)
      notas,                              // L: Notas
      c.ultimaSesion || c.fechaAlta,      // M: Último Contacto
      "",                                 // N: Remarketing
      perfil,                             // O: Perfil JSON
    ];
  });

  // Subir al sheet en bloques de 100 para no exceder límites de API
  const BLOQUE = 100;
  let importados = 0;
  for (let i = 0; i < filasCRM.length; i += BLOQUE) {
    const bloque = filasCRM.slice(i, i + BLOQUE);
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_CRM}!A:O`,
      valueInputOption: "RAW",
      resource: { values: bloque },
    });
    importados += bloque.length;
    console.log(`  ✅ ${importados}/${filasCRM.length} clientes importados...`);
    // Pausa para no saturar la API
    await new Promise(r => setTimeout(r, 500));
  }

  // ============================================================
  // 3. CREAR SHEET DE SESIONES HISTÓRICAS
  // ============================================================
  console.log("\n📝 Creando sheet de Sesiones históricas...");

  try {
    // Crear la hoja si no existe
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: {
        requests: [{
          addSheet: { properties: { title: SHEET_SESIONES } }
        }]
      }
    });
  } catch { /* La hoja ya existe */ }

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_SESIONES}!A1:H1`,
    valueInputOption: "RAW",
    resource: {
      values: [["ID_Sesion", "Fecha", "Cliente", "Tratamiento", "Terapeuta", "A_Pagar_Terapeuta", "ID_Cliente", "Importado"]]
    }
  });

  const filasSesiones = sesiones.map(s => [
    s.ID_Sesion || "",
    s.Fecha_Hora || "",
    s.Cliente || "",
    s.Tratamiento || "",
    s.Terapeuta || "",
    s.A_Pagar_Terapeuta || "",
    s.ID_Cliente_Guardado || "",
    "si",
  ]);

  for (let i = 0; i < filasSesiones.length; i += BLOQUE) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_SESIONES}!A:H`,
      valueInputOption: "RAW",
      resource: { values: filasSesiones.slice(i, i + BLOQUE) },
    });
    await new Promise(r => setTimeout(r, 300));
  }
  console.log(`  ✅ ${filasSesiones.length} sesiones importadas`);

  // ============================================================
  // 4. CREAR SHEET DE VENTAS HISTÓRICAS
  // ============================================================
  console.log("\n📝 Creando sheet de Ventas históricas...");

  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      resource: { requests: [{ addSheet: { properties: { title: SHEET_VENTAS } } }] }
    });
  } catch { /* Ya existe */ }

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_VENTAS}!A1:G1`,
    valueInputOption: "RAW",
    resource: {
      values: [["Fecha", "Cliente", "Producto", "Monto", "Forma_Pago", "ID_Cliente", "Notas"]]
    }
  });

  const filasVentas = ventas.map(v => [
    v.Fecha || "",
    v.Cliente || "",
    v.Producto || "",
    v.Monto || "",
    v.Forma_Pago || "",
    v.ID_Cliente_Guardado || "",
    v.Notas || "",
  ]);

  for (let i = 0; i < filasVentas.length; i += BLOQUE) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_VENTAS}!A:G`,
      valueInputOption: "RAW",
      resource: { values: filasVentas.slice(i, i + BLOQUE) },
    });
    await new Promise(r => setTimeout(r, 300));
  }
  console.log(`  ✅ ${filasVentas.length} ventas importadas`);

  // ============================================================
  // RESUMEN FINAL
  // ============================================================
  console.log("\n🎉 IMPORTACIÓN COMPLETA");
  console.log(`   Clientes: ${filasCRM.length}`);
  console.log(`   Sesiones: ${filasSesiones.length}`);
  console.log(`   Ventas:   ${filasVentas.length}`);
  console.log(`\n🔗 Sheet: https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}`);
}

main().catch(err => {
  console.error("❌ Error en importación:", err.message);
  process.exit(1);
});
