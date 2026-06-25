// Script para obtener el Page Access Token desde el User token actual
// Ejecutar: node _get_page_token.js

const https = require('https');

const USER_TOKEN = 'EAANgsNqNO5YBRz3FdmsfBHohSXzlSxEZAWZAlj3ZC9G3BxY1TPM45cVKm4JCMcybBgP7NupLm8R9cJMjkjgiSPiT4Wo9TnlElPIZCe5Mvart5vt9ZCclB3w0glUAUGrt5zLAuybzMZADoa2jHhq0X8DTyrEUZAa2T2TFefcg3ZBpfb38xXYfsvlBracNugu5gxaZCItaZCFRymb2XCSgZDZD';
const PAGE_ID = '109950823921393';

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

async function main() {
  console.log('🔍 Consultando /me/accounts con el token actual...\n');

  const url = `https://graph.facebook.com/v19.0/me/accounts?access_token=${USER_TOKEN}`;

  try {
    const result = await get(url);

    if (result.error) {
      console.error('❌ Error de la API:', JSON.stringify(result.error, null, 2));
      console.log('\n⚠️  El token actual es inválido o expiró. Necesitás generar uno nuevo en:');
      console.log('   https://developers.facebook.com/tools/explorer/?app_id=950737627331478');
      return;
    }

    const pages = result.data || [];
    console.log(`✅ Encontradas ${pages.length} páginas:\n`);

    for (const page of pages) {
      console.log(`📄 Página: ${page.name}`);
      console.log(`   ID: ${page.id}`);
      console.log(`   Token: ${page.access_token}`);
      console.log('');

      if (page.id === PAGE_ID) {
        console.log('🎯 ===== ESTE ES EL TOKEN QUE NECESITÁS =====');
        console.log(`\nPAGE ACCESS TOKEN para Citrino Bienestar:\n`);
        console.log(page.access_token);
        console.log('\n============================================');
        console.log('\n📋 Próximos pasos:');
        console.log('1. Copiá el token de arriba');
        console.log('2. Andá a Railway → Variables');
        console.log('3. Actualizá INSTAGRAM_ACCESS_TOKEN con ese valor');
        console.log('4. Railway va a reiniciar el bot automáticamente');
        console.log('\n⚠️  Este token dura ~1 hora. Para extenderlo a 60 días, pegalo en:');
        console.log('   https://developers.facebook.com/tools/debug/accesstoken/');
        console.log('   y hacé click en "Extender token de acceso"');
      }
    }

    if (!pages.find(p => p.id === PAGE_ID)) {
      console.log(`⚠️  No se encontró la página con ID ${PAGE_ID} en las cuentas del token.`);
      console.log('   Quizás el token no tiene permisos sobre esa página.');
    }

  } catch (err) {
    console.error('❌ Error de red:', err.message);
  }
}

main();
