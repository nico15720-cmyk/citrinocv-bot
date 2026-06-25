// Script para obtener un Page Access Token con pages_messaging
// Levanta un servidor local, abre el OAuth de Facebook, captura el token
// Ejecutar: node _oauth_server.js

const http = require('http');
const https = require('https');
const { exec } = require('child_process');

const APP_ID = '950737627331478';
const PAGE_ID = '109950823921393';
const PORT = 3000;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
const SCOPES = 'pages_messaging,pages_manage_metadata,pages_read_engagement,instagram_manage_messages';

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/') {
    // Página de intercambio — el token viene en el hash, necesitamos JS para leerlo
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!DOCTYPE html>
<html>
<head><title>Citrino — Capturando token</title></head>
<body>
<h2>Capturando token...</h2>
<script>
  // El token viene en el hash después del redirect de Facebook
  const hash = window.location.hash.substring(1);
  const params = new URLSearchParams(hash);
  const token = params.get('access_token');
  if (token) {
    fetch('/got-token?token=' + encodeURIComponent(token))
      .then(r => r.text())
      .then(t => document.body.innerHTML = t);
  } else {
    document.body.innerHTML = '<p>No se encontró token en la URL. Intentá de nuevo.</p>';
  }
</script>
</body>
</html>`);
    return;
  }

  if (url.pathname === '/got-token') {
    const userToken = url.searchParams.get('token');
    if (!userToken) {
      res.writeHead(400);
      res.end('Token no recibido');
      return;
    }

    try {
      // Intercambiar por page token
      const accountsUrl = `https://graph.facebook.com/v19.0/me/accounts?access_token=${userToken}`;
      const accounts = await httpsGet(accountsUrl);

      if (accounts.error) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<h2>❌ Error</h2><pre>${JSON.stringify(accounts.error, null, 2)}</pre>`);
        return;
      }

      const page = (accounts.data || []).find(p => p.id === PAGE_ID);

      if (!page) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<h2>⚠️ Página no encontrada</h2><pre>${JSON.stringify(accounts.data, null, 2)}</pre>`);
        return;
      }

      const pageToken = page.access_token;

      // Verificar permisos del page token
      const permsUrl = `https://graph.facebook.com/v19.0/me/permissions?access_token=${pageToken}`;
      const perms = await httpsGet(permsUrl);
      const grantedPerms = (perms.data || []).filter(p => p.status === 'granted').map(p => p.permission);

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!DOCTYPE html>
<html><head><title>¡Token obtenido!</title></head>
<body style="font-family:monospace;padding:20px">
<h2>✅ PAGE ACCESS TOKEN para Citrino</h2>
<p><strong>Página:</strong> ${page.name} (ID: ${page.id})</p>
<p><strong>Permisos:</strong> ${grantedPerms.join(', ')}</p>
<h3>TOKEN (copialo):</h3>
<textarea style="width:100%;height:120px;font-size:12px">${pageToken}</textarea>
<br><br>
<p><strong>⚠️ Este token dura ~1 hora si el user token era de corta vida.</strong></p>
<p>Ya podés cerrar esta ventana y pegar el token en Railway → Variables → INSTAGRAM_ACCESS_TOKEN</p>
</body></html>`);

      console.log('\n========================================');
      console.log('✅ PAGE ACCESS TOKEN para Citrino:');
      console.log('========================================');
      console.log(pageToken);
      console.log('\nPermisos:', grantedPerms.join(', '));
      console.log('\n→ Pegá este token en Railway: Variables → INSTAGRAM_ACCESS_TOKEN');
      console.log('========================================\n');

      setTimeout(() => { server.close(); process.exit(0); }, 5000);

    } catch (err) {
      res.writeHead(500);
      res.end('Error: ' + err.message);
    }
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  const oauthUrl = `https://www.facebook.com/dialog/oauth?client_id=${APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${SCOPES}&response_type=token`;

  console.log(`\n🚀 Servidor corriendo en http://localhost:${PORT}`);
  console.log('\n📋 Abriendo Facebook OAuth en el navegador...');
  console.log('   (Si no abre automáticamente, copiá esta URL en Chrome:)');
  console.log('\n' + oauthUrl + '\n');

  // Abrir en el navegador predeterminado
  exec(`start "" "${oauthUrl}"`);
});
