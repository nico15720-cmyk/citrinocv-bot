/**
 * restore-backup.js
 * Carga un backup de Citrino (JSON) y lo sube al CRM via API.
 * Uso: node scripts/restore-backup.js <ruta-al-backup.json>
 *
 * Esto REEMPLAZA todo el contenido de Google Sheets con el backup.
 */

const fs   = require('fs')
const path = require('path')
const https = require('https')

const BASE_URL = 'https://citrinocv-bot-production.up.railway.app'
const ENDPOINT = '/api/crm/import'

// ─── Leer archivo ─────────────────────────────────────────────
const file = process.argv[2]
if (!file) {
  console.error('❌  Uso: node scripts/restore-backup.js <backup.json>')
  process.exit(1)
}

let backup
try {
  backup = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'))
} catch (e) {
  console.error('❌  No se pudo leer el archivo:', e.message)
  process.exit(1)
}

const { CLIENTES = [], SESIONES = [], VENTAS = [], GASTOS = [] } = backup

console.log('📦  Backup leído:')
console.log(`    Clientes : ${CLIENTES.length}`)
console.log(`    Sesiones : ${SESIONES.length}`)
console.log(`    Ventas   : ${VENTAS.length}`)
console.log(`    Gastos   : ${GASTOS.length}`)
console.log()
console.log('🚀  Enviando a Railway...  (puede tardar 30-60 segundos)')
console.log()

// ─── POST al endpoint ─────────────────────────────────────────
const body = JSON.stringify({ CLIENTES, SESIONES, VENTAS, GASTOS })
const url  = new URL(BASE_URL + ENDPOINT)

const options = {
  hostname: url.hostname,
  path    : url.pathname,
  method  : 'POST',
  headers : {
    'Content-Type'  : 'application/json',
    'Content-Length': Buffer.byteLength(body),
  },
}

const req = https.request(options, res => {
  let data = ''
  res.on('data', chunk => data += chunk)
  res.on('end', () => {
    if (res.statusCode === 200) {
      try {
        const json = JSON.parse(data)
        console.log('✅  Importación completada:')
        if (json.imported) {
          Object.entries(json.imported).forEach(([k, v]) =>
            console.log(`    ${k.padEnd(10)}: ${v} filas`)
          )
        }
        console.log()
        console.log('🎉  Listo — el CRM ahora refleja el backup.')
      } catch {
        console.log('✅  OK:', data)
      }
    } else {
      console.error(`❌  Error HTTP ${res.statusCode}:`, data)
    }
  })
})

req.on('error', e => console.error('❌  Error de red:', e.message))
req.on('timeout', () => {
  console.error('❌  Timeout — la request tardó demasiado')
  req.destroy()
})
req.setTimeout(120_000) // 2 minutos

req.write(body)
req.end()
