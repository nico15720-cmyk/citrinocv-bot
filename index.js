// ============================================================
//  CITRINO MARKETING PLATFORM – index.js
//  Servidor Express: WhatsApp webhook + Marketing Platform API
// ============================================================

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const cron = require('node-cron');
const fetch = require('node-fetch');
const { google } = require('googleapis');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middlewares ──────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Health check (Railway) ───────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', ts: Date.now() }));

// ── Multer (uploads en memoria para luego subir a Drive) ─────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 } // 100 MB
});

// ── Rutas de datos ───────────────────────────────────────────
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function readJSON(file, def = {}) {
  const p = path.join(DATA_DIR, file);
  if (!fs.existsSync(p)) { fs.writeFileSync(p, JSON.stringify(def, null, 2)); return def; }
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return def; }
}
function writeJSON(file, data) {
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2));
}

// ── Google Drive client ──────────────────────────────────────
function getDriveClient() {
  try {
    const sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}');
    const auth = new google.auth.GoogleAuth({
      credentials: sa,
      scopes: ['https://www.googleapis.com/auth/drive']
    });
    return google.drive({ version: 'v3', auth });
  } catch (e) {
    console.warn('Drive client error:', e.message);
    return null;
  }
}

// Encuentra o crea carpeta en Drive
async function ensureDriveFolder(drive, name, parentId = null) {
  const q = `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false` +
    (parentId ? ` and '${parentId}' in parents` : '');
  const res = await drive.files.list({ q, fields: 'files(id,name)', spaces: 'drive' });
  if (res.data.files.length > 0) return res.data.files[0].id;
  const meta = { name, mimeType: 'application/vnd.google-apps.folder' };
  if (parentId) meta.parents = [parentId];
  const created = await drive.files.create({ requestBody: meta, fields: 'id' });
  return created.data.id;
}

// ── WhatsApp notify ──────────────────────────────────────────
async function notifyWhatsApp(to, message) {
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.META_PAGE_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN;
  if (!phoneId || !token) return;
  try {
    await fetch(`https://graph.facebook.com/v18.0/${phoneId}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: to.replace(/\D/g, ''),
        type: 'text',
        text: { body: message }
      })
    });
  } catch (e) { console.warn('WhatsApp notify error:', e.message); }
}

// ────────────────────────────────────────────────────────────
//  META ADS + INSTAGRAM DATA REFRESH
// ────────────────────────────────────────────────────────────
async function refreshMetaData() {
  const token = process.env.META_ACCESS_TOKEN;
  const adAccountId = process.env.META_AD_ACCOUNT_ID || 'act_2070126230586031';
  const igBusinessId = process.env.META_IG_BUSINESS_ID || process.env.INSTAGRAM_PAGE_ID || '17841442372105492';
  const fbPageId = process.env.FACEBOOK_PAGE_ID || '109950823921393';
  const igToken = process.env.INSTAGRAM_ACCESS_TOKEN || process.env.META_PAGE_ACCESS_TOKEN;

  const mktData = readJSON('mkt-data.json', { weeks: [], currentWeek: {}, updatedAt: null });

  if (!token) { console.warn('[MKT] META_ACCESS_TOKEN no configurado'); return; }

  // Helper: extrae leads/conversaciones de cualquier tipo de campaña Meta
  function extractLeads(actions) {
    if (!actions) return 0;
    // Cubre: leads form, pixel, WhatsApp/Messenger conversations, clicks a mensaje
    const leadTypes = [
      'lead',
      'offsite_conversion.fb_pixel_lead',
      'onsite_conversion.messaging_conversation_started_7d',
      'onsite_conversion.messaging_first_reply',
      'onsite_conversion.total_messaging_connection',
      'contact',
      'omni_initiated_checkout',
      'whatsapp_api_connection'
    ];
    let total = 0;
    for (const a of actions) {
      if (leadTypes.includes(a.action_type)) total += parseInt(a.value || 0);
    }
    return total;
  }

  try {
    // ── Meta Ads: campañas activas ───
    const since = new Date(); since.setDate(since.getDate() - 7);
    const sinceStr = since.toISOString().split('T')[0];
    const today = new Date().toISOString().split('T')[0];

    const adsRes = await fetch(
      `https://graph.facebook.com/v18.0/${adAccountId}/campaigns?` +
      `fields=name,status,objective,insights.date_preset(last_7d){spend,impressions,reach,actions,cost_per_action_type}&` +
      `access_token=${token}&limit=20`
    );
    const adsData = await adsRes.json();

    let totalSpend = 0, totalLeads = 0, totalReach = 0, totalImpressions = 0;
    const campaigns = [];

    if (adsData.data) {
      for (const c of adsData.data) {
        let spend = 0, leads = 0, reach = 0, impressions = 0, cpl = 0;
        if (c.insights && c.insights.data && c.insights.data[0]) {
          const ins = c.insights.data[0];
          spend = parseFloat(ins.spend || 0);
          reach = parseInt(ins.reach || 0);
          impressions = parseInt(ins.impressions || 0);
          leads = extractLeads(ins.actions);
          cpl = leads > 0 ? parseFloat((spend / leads).toFixed(2)) : 0;
        }
        totalSpend += spend;
        totalLeads += leads;
        totalReach += reach;
        totalImpressions += impressions;
        campaigns.push({ name: c.name, status: c.status, spend, leads, cpl, reach, impressions });
      }
    }

    // ── Instagram organic ───
    let igFollowers = 0, igReach = 0, igImpressions = 0, igMediaCount = 0;
    try {
      const igRes = await fetch(
        `https://graph.facebook.com/v18.0/${igBusinessId}?` +
        `fields=followers_count,media_count,website&access_token=${igToken}`
      );
      const igData = await igRes.json();
      igFollowers = igData.followers_count || 0;
      igMediaCount = igData.media_count || 0;

      const igInsRes = await fetch(
        `https://graph.facebook.com/v18.0/${igBusinessId}/insights?` +
        `metric=reach,impressions,profile_views&period=week&access_token=${igToken}`
      );
      const igIns = await igInsRes.json();
      if (igIns.data) {
        const rData = igIns.data.find(d => d.name === 'reach');
        const iData = igIns.data.find(d => d.name === 'impressions');
        if (rData && rData.values) igReach = rData.values.reduce((s, v) => s + v.value, 0);
        if (iData && iData.values) igImpressions = iData.values.reduce((s, v) => s + v.value, 0);
      }
    } catch (e) { console.warn('[MKT] IG error:', e.message); }

    // ── Facebook page ───
    let fbFans = 0, fbReach = 0, fbImpressions = 0;
    try {
      const fbRes = await fetch(
        `https://graph.facebook.com/v18.0/${fbPageId}?` +
        `fields=fan_count,followers_count&access_token=${igToken}`
      );
      const fbData = await fbRes.json();
      fbFans = fbData.fan_count || fbData.followers_count || 0;

      const fbInsRes = await fetch(
        `https://graph.facebook.com/v18.0/${fbPageId}/insights/page_impressions,page_reach?` +
        `period=week&access_token=${igToken}`
      );
      const fbIns = await fbInsRes.json();
      if (fbIns.data) {
        const fbR = fbIns.data.find(d => d.name === 'page_reach');
        const fbI = fbIns.data.find(d => d.name === 'page_impressions');
        if (fbR && fbR.values) fbReach = fbR.values.reduce((s, v) => s + v.value, 0);
        if (fbI && fbI.values) fbImpressions = fbI.values.reduce((s, v) => s + v.value, 0);
      }
    } catch (e) { console.warn('[MKT] FB error:', e.message); }

    const weekData = {
      weekOf: sinceStr,
      updatedAt: new Date().toISOString(),
      meta: { spend: totalSpend, leads: totalLeads, cpl: totalLeads > 0 ? parseFloat((totalSpend / totalLeads).toFixed(2)) : 0, reach: totalReach, impressions: totalImpressions },
      campaigns,
      instagram: { followers: igFollowers, reach: igReach, impressions: igImpressions, mediaCount: igMediaCount },
      facebook: { fans: fbFans, reach: fbReach, impressions: fbImpressions }
    };

    // Guardar semana en histórico (por mes)
    const monthKey = sinceStr.substring(0, 7); // YYYY-MM
    if (!mktData.byMonth) mktData.byMonth = {};
    if (!mktData.byMonth[monthKey]) mktData.byMonth[monthKey] = { weeks: [] };

    const existIdx = mktData.byMonth[monthKey].weeks.findIndex(w => w.weekOf === sinceStr);
    if (existIdx >= 0) mktData.byMonth[monthKey].weeks[existIdx] = weekData;
    else mktData.byMonth[monthKey].weeks.push(weekData);

    mktData.currentWeek = weekData;
    mktData.updatedAt = weekData.updatedAt;

    writeJSON('mkt-data.json', mktData);
    console.log('[MKT] Datos actualizados:', new Date().toISOString());
  } catch (e) { console.error('[MKT] Error refresh:', e.message); }
}

// ── AI Insights con Claude ────────────────────────────────────
async function generateAIInsights() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { console.warn('[AI] ANTHROPIC_API_KEY no configurado'); return null; }

  const mktData = readJSON('mkt-data.json', {});
  const reviews = readJSON('mkt-reviews.json', { reviews: [], summary: {} });
  const actions = readJSON('mkt-actions.json', []).slice(0, 5);
  const w = mktData.currentWeek || {};
  const m = w.meta || {};
  const ig = w.instagram || {};
  const fb = w.facebook || {};

  // Calcular tendencia CPL (últimas 4 semanas)
  const allWeeks = [];
  Object.values(mktData.byMonth || {}).forEach(mo => allWeeks.push(...(mo.weeks || [])));
  allWeeks.sort((a, b) => a.weekOf > b.weekOf ? 1 : -1);
  const last4 = allWeeks.slice(-4).map(w => ({ weekOf: w.weekOf, cpl: w.meta?.cpl || 0, leads: w.meta?.leads || 0, spend: w.meta?.spend || 0 }));

  // Usar prompt editable si existe
  const customPromptData = readJSON('mkt-ai-prompt.json', { prompt: null });
  const basePrompt = customPromptData.prompt || `Sos el analista de marketing de Citrino Centro Integral de Bienestar, un centro de masajes terapéuticos en Montevideo, Uruguay.

Respondé en español con este formato JSON exacto (sin markdown, solo JSON):
{
  "estado": "bien|atencion|critico",
  "resumen": "Una oración de estado general (máx 20 palabras)",
  "insights": ["Insight 1 (máx 15 palabras)", "Insight 2", "Insight 3"],
  "acciones": ["Acción concreta 1 (máx 12 palabras)", "Acción 2"],
  "alerta": "Una alerta si existe, null si todo bien"
}`;

  const prompt = `${basePrompt}

DATOS DE ESTA SEMANA:
- CPL (costo por contacto): $U ${m.cpl || 'sin datos'}
- Contactos generados: ${m.leads || 0}
- Inversión: USD ${m.spend || 0} (~$U ${Math.round((m.spend || 0) * 56)})
- Alcance Meta Ads: ${m.reach || 0} personas
- Seguidores IG: ${ig.followers || 0}
- Fans FB: ${fb.fans || 0}
- Reseñas totales: ${reviews.summary?.total || 0} (promedio ${reviews.summary?.avg || '–'})

TENDENCIA ÚLTIMAS 4 SEMANAS:
${last4.map(w => `  ${w.weekOf}: ${w.leads} contactos, CPL $U ${w.cpl}`).join('\n') || '  Sin datos históricos aún'}

OBJETIVO: CPL ≤ $U 47 para mediados de agosto 2026
ACCIONES RECIENTES: ${actions.slice(0,3).map(a => a.title || a.description).join(', ') || 'Ninguna registrada'}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await response.json();
    if (data.error) { console.warn('[AI] Error API:', data.error.message); return null; }
    const text = data.content?.[0]?.text || '';
    const insights = JSON.parse(text.trim());
    insights.generatedAt = new Date().toISOString();
    writeJSON('ai-insights.json', insights);
    console.log('[AI] Insights generados:', insights.estado);
    return insights;
  } catch(e) {
    console.error('[AI] Error:', e.message);
    return null;
  }
}

// ── Google Sheets export ──────────────────────────────────────
async function exportToSheets() {
  const sheetsId = process.env.GOOGLE_SHEETS_ID;
  if (!sheetsId) return;
  try {
    const sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}');
    const auth = new google.auth.GoogleAuth({ credentials: sa, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
    const sheets = google.sheets({ version: 'v4', auth });
    const mktData = readJSON('mkt-data.json', {});
    const allWeeks = [];
    Object.values(mktData.byMonth || {}).forEach(mo => allWeeks.push(...(mo.weeks || [])));
    allWeeks.sort((a, b) => a.weekOf > b.weekOf ? 1 : -1);
    const rows = [
      ['Semana', 'Contactos', 'CPL ($U)', 'Inversión (USD)', 'Alcance', 'Impresiones', 'Seguidores IG', 'Fans FB'],
      ...allWeeks.map(w => [
        w.weekOf, w.meta?.leads || 0, w.meta?.cpl || 0, w.meta?.spend || 0,
        w.meta?.reach || 0, w.meta?.impressions || 0,
        w.instagram?.followers || 0, w.facebook?.fans || 0
      ])
    ];
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetsId,
      range: 'Métricas!A1',
      valueInputOption: 'RAW',
      requestBody: { values: rows }
    });
    console.log('[Sheets] Datos exportados:', allWeeks.length, 'semanas');
  } catch(e) { console.warn('[Sheets] Error export:', e.message); }
}

// ── PageSpeed + historial 30 días ────────────────────────────
async function refreshPageSpeed() {
  const url = 'https://citrinobienestar.uy';
  function parsePS(psData, strategy) {
    const cats = psData.lighthouseResult?.categories || {};
    const audits = psData.lighthouseResult?.audits || {};
    return {
      strategy,
      scores: {
        performance: Math.round((cats.performance?.score || 0) * 100),
        seo:         Math.round((cats.seo?.score || 0) * 100),
        accessibility: Math.round((cats.accessibility?.score || 0) * 100),
        bestPractices: Math.round((cats['best-practices']?.score || 0) * 100)
      },
      opportunities: Object.values(audits)
        .filter(a => a.score !== null && a.score < 0.9 && a.details?.type === 'opportunity' && a.title)
        .slice(0, 5)
        .map(a => ({ title: a.title, impact: a.displayValue || '' }))
    };
  }
  try {
    const [mobRes, deskRes] = await Promise.all([
      fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=mobile`),
      fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=desktop`)
    ]);
    const [mob, desk] = await Promise.all([mobRes.json(), deskRes.json()]);
    const saved = readJSON('mkt-pagespeed.json', { current: null, history: [] });
    const entry = {
      date: new Date().toISOString().split('T')[0],
      updatedAt: new Date().toISOString(),
      mobile: parsePS(mob, 'mobile'),
      desktop: parsePS(desk, 'desktop')
    };
    saved.current = entry;
    saved.history = (saved.history || []).filter(h => h.date !== entry.date);
    saved.history.push(entry);
    if (saved.history.length > 30) saved.history = saved.history.slice(-30);
    writeJSON('mkt-pagespeed.json', saved);
    console.log('[PageSpeed] Mobile:', entry.mobile.scores.performance, '| Desktop:', entry.desktop.scores.performance);
  } catch(e) { console.warn('[PageSpeed] Error:', e.message); }
}

// ── Reviews: Google Places API (necesita GOOGLE_PLACE_ID + GOOGLE_API_KEY) ──
async function refreshReviews() {
  const placeId = process.env.GOOGLE_PLACE_ID;
  const apiKey  = process.env.GOOGLE_API_KEY;
  if (!placeId || !apiKey) {
    console.log('[Reviews] GOOGLE_PLACE_ID o GOOGLE_API_KEY no configurados, saltando');
    return;
  }
  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/place/details/json?` +
      `place_id=${placeId}&fields=name,rating,user_ratings_total,reviews&language=es&key=${apiKey}`
    );
    const data = await res.json();
    if (data.status !== 'OK') { console.warn('[Reviews] API status:', data.status); return; }
    const place = data.result;
    const existing = readJSON('mkt-reviews.json', { reviews: [], summary: {} });
    const newReviews = (place.reviews || []).map(r => ({
      id: `gpl_${r.author_name}_${r.time}`,
      source: 'Google',
      author: r.author_name,
      rating: r.rating,
      text: r.text,
      date: new Date(r.time * 1000).toISOString(),
      relative: r.relative_time_description
    }));
    const existingIds = new Set(existing.reviews.map(r => r.id));
    const merged = [...newReviews.filter(r => !existingIds.has(r.id)), ...existing.reviews];
    const total = merged.length;
    const avg = total > 0 ? parseFloat((merged.reduce((s, r) => s + (r.rating || 0), 0) / total).toFixed(1)) : 0;
    writeJSON('mkt-reviews.json', {
      reviews: merged,
      summary: { total, avg, googleRating: place.rating, googleTotal: place.user_ratings_total, lastSync: new Date().toISOString() }
    });
    console.log('[Reviews] Total:', merged.length, '| Rating Google:', place.rating);
  } catch(e) { console.warn('[Reviews] Error:', e.message); }
}

// ── Cron: todos los días a las 7am Montevideo ─────────────────
cron.schedule('0 7 * * *', async () => {
  console.log('[CRON] Actualización diaria iniciada...');
  await refreshMetaData();
  await refreshPageSpeed();
  await refreshReviews();
  await generateAIInsights();
  await exportToSheets();
  console.log('[CRON] Actualización diaria completa.');
}, { timezone: 'America/Montevideo' });

// ────────────────────────────────────────────────────────────
//  RUTAS ESTÁTICAS
// ────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  const mktPath = path.join(__dirname, 'public', 'metricasmkt.html');
  if (fs.existsSync(mktPath)) return res.sendFile(mktPath);
  res.redirect('/mkt');
});
app.get('/mkt', (req, res) => res.sendFile(path.join(__dirname, 'public', 'metricasmkt.html')));
app.get('/metricasmkt', (req, res) => res.sendFile(path.join(__dirname, 'public', 'metricasmkt.html')));

// ────────────────────────────────────────────────────────────
//  API: AUTH (Google Sign-In + whitelist)
// ────────────────────────────────────────────────────────────
const ADMIN_EMAIL = 'nicolas.nirodriguez@gmail.com';

app.get('/api/mkt/auth/config', (req, res) => {
  res.json({ clientId: process.env.GOOGLE_CLIENT_ID || null });
});

app.post('/api/mkt/auth', async (req, res) => {
  const { credential } = req.body;
  if (!credential) return res.status(400).json({ ok: false, error: 'No credential' });
  try {
    // verify with Google tokeninfo API
    const vr = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${credential}`);
    const info = await vr.json();
    if (info.error || !info.email_verified) return res.json({ ok: false, error: 'Token invalid' });
    // verificar que el token es para esta app
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (clientId && info.aud !== clientId) return res.json({ ok: false, error: 'Invalid audience' });
    const email = info.email.toLowerCase();
    // check whitelist
    const wl = readJSON('mkt-auth.json', { whitelist: [{ email: ADMIN_EMAIL, role: 'admin', name: 'Nico' }] });
    const found = wl.whitelist.find(u => u.email.toLowerCase() === email);
    if (!found) return res.json({ ok: false, error: 'Email not whitelisted' });
    res.json({ ok: true, user: { email: found.email, role: found.role, name: found.name || info.name || email.split('@')[0] } });
  } catch(e) {
    res.json({ ok: false, error: e.message });
  }
});

app.get('/api/mkt/auth/whitelist', (req, res) => {
  const wl = readJSON('mkt-auth.json', { whitelist: [{ email: ADMIN_EMAIL, role: 'admin', name: 'Nico' }] });
  res.json(wl);
});

app.post('/api/mkt/auth/whitelist', (req, res) => {
  const { email, role, name } = req.body;
  if (!email) return res.status(400).json({ ok: false, error: 'Email required' });
  const wl = readJSON('mkt-auth.json', { whitelist: [{ email: ADMIN_EMAIL, role: 'admin', name: 'Nico' }] });
  const exists = wl.whitelist.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (exists) return res.json({ ok: false, error: 'Email already in whitelist' });
  wl.whitelist.push({ email: email.toLowerCase(), role: role || 'marketing', name: name || email.split('@')[0] });
  writeJSON('mkt-auth.json', wl);
  res.json({ ok: true });
});

app.delete('/api/mkt/auth/whitelist/:email', (req, res) => {
  const email = decodeURIComponent(req.params.email).toLowerCase();
  if (email === ADMIN_EMAIL) return res.json({ ok: false, error: 'Cannot remove admin' });
  const wl = readJSON('mkt-auth.json', { whitelist: [] });
  wl.whitelist = wl.whitelist.filter(u => u.email.toLowerCase() !== email);
  writeJSON('mkt-auth.json', wl);
  res.json({ ok: true });
});

// ────────────────────────────────────────────────────────────
//  API: ADMIN (prompt IA editable)
// ────────────────────────────────────────────────────────────
app.get('/api/mkt/admin/prompt', (req, res) => {
  res.json(readJSON('mkt-ai-prompt.json', { prompt: null, updatedAt: null }));
});

app.post('/api/mkt/admin/prompt', (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ ok: false });
  writeJSON('mkt-ai-prompt.json', { prompt, updatedAt: new Date().toISOString() });
  res.json({ ok: true });
});

// ────────────────────────────────────────────────────────────
//  API: MÉTRICAS PRINCIPALES
// ────────────────────────────────────────────────────────────
app.get('/api/mkt/data', (req, res) => {
  res.json(readJSON('mkt-data.json', { currentWeek: {}, byMonth: {}, updatedAt: null }));
});

app.post('/api/mkt/refresh', async (req, res) => {
  await refreshMetaData();
  res.json({ ok: true, data: readJSON('mkt-data.json') });
});

// ── AI Insights ──────────────────────────────────────────────
app.get('/api/mkt/ai-insights', (req, res) => {
  res.json(readJSON('ai-insights.json', { estado: null, resumen: null, insights: [], acciones: [], generatedAt: null }));
});

app.post('/api/mkt/ai-insights', async (req, res) => {
  const insights = await generateAIInsights();
  if (insights) res.json({ ok: true, insights });
  else res.json({ ok: false, error: 'No se pudo generar análisis. Verificá ANTHROPIC_API_KEY en Railway.' });
});

// ── Sheets Export ────────────────────────────────────────────
app.post('/api/mkt/sheets-export', async (req, res) => {
  try {
    await exportToSheets();
    const mktData = readJSON('mkt-data.json', {});
    const weeks = Object.values(mktData.byMonth || {}).reduce((acc, mo) => acc + (mo.weeks?.length || 0), 0);
    res.json({ ok: true, weeks, sheetsId: process.env.GOOGLE_SHEETS_ID, message: `${weeks} semanas exportadas a Google Sheets` });
  } catch(e) {
    res.json({ ok: false, error: e.message });
  }
});

// ── Carga histórica: desde una fecha hasta hoy, semana a semana ──────────────
app.post('/api/mkt/refresh-historical', async (req, res) => {
  const token = process.env.META_ACCESS_TOKEN;
  const adAccountId = process.env.META_AD_ACCOUNT_ID || 'act_2070126230586031';
  const igBusinessId = process.env.META_IG_BUSINESS_ID || process.env.INSTAGRAM_PAGE_ID || '17841442372105492';
  const fbPageId = process.env.FACEBOOK_PAGE_ID || '109950823921393';
  const igToken = process.env.INSTAGRAM_ACCESS_TOKEN || process.env.META_PAGE_ACCESS_TOKEN;

  if (!token) return res.status(500).json({ error: 'META_ACCESS_TOKEN no configurado' });

  const since = req.body.since || '2026-01-01';
  const until = new Date().toISOString().split('T')[0];

  function extractLeads(actions) {
    if (!actions) return 0;
    const leadTypes = [
      'lead','offsite_conversion.fb_pixel_lead',
      'onsite_conversion.messaging_conversation_started_7d',
      'onsite_conversion.messaging_first_reply',
      'onsite_conversion.total_messaging_connection',
      'contact','omni_initiated_checkout','whatsapp_api_connection'
    ];
    let total = 0;
    for (const a of actions) { if (leadTypes.includes(a.action_type)) total += parseInt(a.value || 0); }
    return total;
  }

  try {
    res.setHeader('Content-Type', 'application/json');

    // Obtener todos los insights de Meta Ads por semana (una sola llamada API)
    const timeRange = JSON.stringify({ since, until });
    const insightsUrl = `https://graph.facebook.com/v18.0/${adAccountId}/insights?` +
      `fields=campaign_name,spend,impressions,reach,actions,cost_per_action_type,date_start,date_stop&` +
      `time_range=${encodeURIComponent(timeRange)}&time_increment=7&level=campaign&` +
      `access_token=${token}&limit=500`;

    const insRes = await fetch(insightsUrl);
    const insData = await insRes.json();

    if (insData.error) {
      return res.json({ ok: false, error: insData.error.message, raw: insData });
    }

    const mktData = readJSON('mkt-data.json', { currentWeek: {}, byMonth: {}, updatedAt: null });
    if (!mktData.byMonth) mktData.byMonth = {};

    // Agrupar por semana (date_start)
    const byWeek = {};
    for (const row of (insData.data || [])) {
      const weekKey = row.date_start;
      if (!byWeek[weekKey]) byWeek[weekKey] = { spend: 0, leads: 0, reach: 0, impressions: 0, campaigns: [] };
      const spend = parseFloat(row.spend || 0);
      const leads = extractLeads(row.actions);
      const reach = parseInt(row.reach || 0);
      const impressions = parseInt(row.impressions || 0);
      byWeek[weekKey].spend += spend;
      byWeek[weekKey].leads += leads;
      byWeek[weekKey].reach += reach;
      byWeek[weekKey].impressions += impressions;
      byWeek[weekKey].campaigns.push({
        name: row.campaign_name, spend, leads, reach, impressions,
        cpl: leads > 0 ? parseFloat((spend / leads).toFixed(2)) : 0
      });
    }

    // Obtener Instagram insights histórico (max 90 días que permite la API)
    let igFollowers = 0, igMediaCount = 0;
    try {
      const igBasic = await fetch(`https://graph.facebook.com/v18.0/${igBusinessId}?fields=followers_count,media_count&access_token=${igToken}`);
      const igD = await igBasic.json();
      igFollowers = igD.followers_count || 0;
      igMediaCount = igD.media_count || 0;
    } catch(e) { console.warn('[HIST] IG básico error:', e.message); }

    // Obtener FB fans actuales
    let fbFans = 0;
    try {
      const fbBasic = await fetch(`https://graph.facebook.com/v18.0/${fbPageId}?fields=fan_count&access_token=${igToken}`);
      const fbD = await fbBasic.json();
      fbFans = fbD.fan_count || 0;
    } catch(e) { console.warn('[HIST] FB básico error:', e.message); }

    // Guardar cada semana en byMonth
    let weeksStored = 0;
    for (const [weekOf, wData] of Object.entries(byWeek)) {
      const monthKey = weekOf.substring(0, 7);
      if (!mktData.byMonth[monthKey]) mktData.byMonth[monthKey] = { weeks: [] };
      const weekRecord = {
        weekOf,
        updatedAt: new Date().toISOString(),
        meta: {
          spend: wData.spend,
          leads: wData.leads,
          cpl: wData.leads > 0 ? parseFloat((wData.spend / wData.leads).toFixed(2)) : 0,
          reach: wData.reach,
          impressions: wData.impressions
        },
        campaigns: wData.campaigns,
        instagram: { followers: igFollowers, reach: 0, impressions: 0, mediaCount: igMediaCount },
        facebook: { fans: fbFans, reach: 0, impressions: 0 }
      };
      const existIdx = mktData.byMonth[monthKey].weeks.findIndex(w => w.weekOf === weekOf);
      if (existIdx >= 0) mktData.byMonth[monthKey].weeks[existIdx] = weekRecord;
      else mktData.byMonth[monthKey].weeks.push(weekRecord);
      weeksStored++;
    }

    mktData.updatedAt = new Date().toISOString();
    writeJSON('mkt-data.json', mktData);

    // Calcular totales del período
    let totalSpend = 0, totalLeads = 0;
    for (const w of Object.values(byWeek)) { totalSpend += w.spend; totalLeads += w.leads; }

    console.log(`[HIST] Datos históricos cargados: ${weeksStored} semanas, ${since} → ${until}`);
    res.json({
      ok: true,
      weeksStored,
      period: { since, until },
      totals: {
        spend: parseFloat(totalSpend.toFixed(2)),
        leads: totalLeads,
        cpl: totalLeads > 0 ? parseFloat((totalSpend / totalLeads).toFixed(2)) : 0
      },
      message: `Cargadas ${weeksStored} semanas desde ${since} hasta ${until}`
    });
  } catch (e) {
    console.error('[HIST] Error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ────────────────────────────────────────────────────────────
//  API: NOTAS
// ────────────────────────────────────────────────────────────
app.get('/api/mkt/notes', (req, res) => {
  res.json(readJSON('mkt-notes.json', []));
});

app.post('/api/mkt/notes', (req, res) => {
  const notes = readJSON('mkt-notes.json', []);
  const note = {
    id: Date.now().toString(),
    ...req.body,
    createdAt: new Date().toISOString()
  };
  notes.unshift(note);
  writeJSON('mkt-notes.json', notes);
  res.json(note);
});

app.patch('/api/mkt/notes/:id', (req, res) => {
  const notes = readJSON('mkt-notes.json', []);
  const idx = notes.findIndex(n => n.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'Not found' });
  notes[idx] = { ...notes[idx], ...req.body, updatedAt: new Date().toISOString() };
  writeJSON('mkt-notes.json', notes);
  res.json(notes[idx]);
});

app.post('/api/mkt/notes/:id/comment', (req, res) => {
  const notes = readJSON('mkt-notes.json', []);
  const idx = notes.findIndex(n => n.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'Not found' });
  if (!notes[idx].comments) notes[idx].comments = [];
  notes[idx].comments.push({ text: req.body.text, author: req.body.author || 'Equipo', at: new Date().toISOString() });
  notes[idx].updatedAt = new Date().toISOString();
  writeJSON('mkt-notes.json', notes);
  res.json(notes[idx]);
});

app.delete('/api/mkt/notes/:id', (req, res) => {
  let notes = readJSON('mkt-notes.json', []);
  notes = notes.filter(n => n.id !== req.params.id);
  writeJSON('mkt-notes.json', notes);
  res.json({ ok: true });
});

// ────────────────────────────────────────────────────────────
//  API: TAREAS
// ────────────────────────────────────────────────────────────
app.get('/api/mkt/tasks', (req, res) => {
  res.json(readJSON('mkt-tasks.json', []));
});

app.post('/api/mkt/tasks', (req, res) => {
  const tasks = readJSON('mkt-tasks.json', []);
  const task = {
    id: Date.now().toString(),
    text: req.body.text,
    priority: req.body.priority || 'normal',
    assignTo: req.body.assignTo || 'nico',
    category: req.body.category || 'otro',
    createdBy: req.body.createdBy || 'equipo',
    done: false,
    createdAt: new Date().toISOString()
  };
  tasks.unshift(task);
  writeJSON('mkt-tasks.json', tasks);
  res.json(task);
});

app.patch('/api/mkt/tasks/:id', (req, res) => {
  const tasks = readJSON('mkt-tasks.json', []);
  const idx = tasks.findIndex(t => t.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'Not found' });
  if (req.body.toggle) {
    tasks[idx].done = !tasks[idx].done;
    tasks[idx].doneAt = tasks[idx].done ? new Date().toISOString() : null;
  } else {
    tasks[idx] = { ...tasks[idx], ...req.body, updatedAt: new Date().toISOString() };
  }
  writeJSON('mkt-tasks.json', tasks);
  res.json(tasks[idx]);
});

app.delete('/api/mkt/tasks/:id', (req, res) => {
  let tasks = readJSON('mkt-tasks.json', []);
  tasks = tasks.filter(t => t.id !== req.params.id);
  writeJSON('mkt-tasks.json', tasks);
  res.json({ ok: true });
});

// ── API: reporte externo (recibe JSON del análisis semanal de Cowork) ──
app.post('/api/mkt/weekly-report', (req, res) => {
  const report = { ...req.body, receivedAt: new Date().toISOString() };
  writeJSON('weekly-report.json', report);
  res.json({ ok: true });
});

app.get('/api/mkt/weekly-report', (req, res) => {
  res.json(readJSON('weekly-report.json', { content: null, receivedAt: null }));
});

// ────────────────────────────────────────────────────────────
//  API: ACCIONES DE MARKETING (con trazabilidad)
// ────────────────────────────────────────────────────────────
app.get('/api/mkt/actions', (req, res) => {
  res.json(readJSON('mkt-actions.json', []));
});

app.post('/api/mkt/actions', (req, res) => {
  const actions = readJSON('mkt-actions.json', []);
  const mktData = readJSON('mkt-data.json', {});
  const action = {
    id: Date.now().toString(),
    ...req.body,
    status: 'pending',
    snapshotAtCreation: mktData.currentWeek || {},
    createdAt: new Date().toISOString(),
    rating: null,
    ratingComment: null,
    evaluatedAt: null
  };
  actions.unshift(action);
  writeJSON('mkt-actions.json', actions);
  res.json(action);
});

app.patch('/api/mkt/actions/:id', (req, res) => {
  const actions = readJSON('mkt-actions.json', []);
  const idx = actions.findIndex(a => a.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'Not found' });
  actions[idx] = { ...actions[idx], ...req.body };
  if (req.body.rating !== undefined) {
    actions[idx].status = 'evaluated';
    actions[idx].evaluatedAt = new Date().toISOString();
    const mktData = readJSON('mkt-data.json', {});
    actions[idx].snapshotAtEvaluation = mktData.currentWeek || {};
  }
  writeJSON('mkt-actions.json', actions);
  res.json(actions[idx]);
});

app.delete('/api/mkt/actions/:id', (req, res) => {
  let actions = readJSON('mkt-actions.json', []);
  actions = actions.filter(a => a.id !== req.params.id);
  writeJSON('mkt-actions.json', actions);
  res.json({ ok: true });
});

// ────────────────────────────────────────────────────────────
//  API: TICKETS
// ────────────────────────────────────────────────────────────
app.get('/api/mkt/tickets', (req, res) => {
  res.json(readJSON('mkt-tickets.json', []));
});

app.post('/api/mkt/tickets', async (req, res) => {
  const tickets = readJSON('mkt-tickets.json', []);
  const ticket = {
    id: Date.now().toString(),
    ...req.body,
    status: 'open',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: []
  };
  tickets.unshift(ticket);
  writeJSON('mkt-tickets.json', tickets);

  // Notificar a Nico por WhatsApp
  const ownerPhone = process.env.OWNER_WHATSAPP || '59891998151';
  const msg = `🎫 *Nuevo ticket en Citrino MKT*\n\n*${ticket.title || 'Sin título'}*\n${ticket.description || ''}\n\nPrioridad: ${ticket.priority || 'normal'}\nCreado por: ${ticket.author || 'equipo'}\n\nID: #${ticket.id.slice(-6)}`;
  await notifyWhatsApp(ownerPhone, msg);

  res.json(ticket);
});

app.patch('/api/mkt/tickets/:id', (req, res) => {
  const tickets = readJSON('mkt-tickets.json', []);
  const idx = tickets.findIndex(t => t.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'Not found' });
  tickets[idx] = { ...tickets[idx], ...req.body, updatedAt: new Date().toISOString() };
  writeJSON('mkt-tickets.json', tickets);
  res.json(tickets[idx]);
});

app.post('/api/mkt/tickets/:id/message', (req, res) => {
  const tickets = readJSON('mkt-tickets.json', []);
  const idx = tickets.findIndex(t => t.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'Not found' });
  const msg = { text: req.body.text, author: req.body.author, at: new Date().toISOString() };
  if (!tickets[idx].messages) tickets[idx].messages = [];
  tickets[idx].messages.push(msg);
  tickets[idx].updatedAt = new Date().toISOString();
  writeJSON('mkt-tickets.json', tickets);
  res.json(tickets[idx]);
});

// ────────────────────────────────────────────────────────────
//  API: RESEÑAS
// ────────────────────────────────────────────────────────────
app.get('/api/mkt/reviews', (req, res) => {
  res.json(readJSON('mkt-reviews.json', { reviews: [], summary: { total: 0, avg: 0 } }));
});

app.post('/api/mkt/reviews', (req, res) => {
  const data = readJSON('mkt-reviews.json', { reviews: [], summary: { total: 0, avg: 0 } });
  const review = { id: Date.now().toString(), ...req.body, createdAt: new Date().toISOString() };
  data.reviews.unshift(review);
  const total = data.reviews.length;
  const avg = total > 0 ? (data.reviews.reduce((s, r) => s + (r.rating || 0), 0) / total) : 0;
  data.summary = { total, avg: parseFloat(avg.toFixed(2)) };
  writeJSON('mkt-reviews.json', data);
  res.json(data);
});

app.delete('/api/mkt/reviews/:id', (req, res) => {
  const data = readJSON('mkt-reviews.json', { reviews: [], summary: {} });
  data.reviews = data.reviews.filter(r => r.id !== req.params.id);
  const total = data.reviews.length;
  const avg = total > 0 ? (data.reviews.reduce((s, r) => s + (r.rating || 0), 0) / total) : 0;
  data.summary = { total, avg: parseFloat(avg.toFixed(2)) };
  writeJSON('mkt-reviews.json', data);
  res.json(data);
});

// ────────────────────────────────────────────────────────────
//  API: COMPETIDORES
// ────────────────────────────────────────────────────────────
app.get('/api/mkt/competitors', (req, res) => {
  res.json(readJSON('mkt-competitors.json', []));
});

app.post('/api/mkt/competitors', (req, res) => {
  const items = readJSON('mkt-competitors.json', []);
  const item = { id: Date.now().toString(), ...req.body, createdAt: new Date().toISOString(), updates: [] };
  items.push(item);
  writeJSON('mkt-competitors.json', items);
  res.json(item);
});

app.patch('/api/mkt/competitors/:id', (req, res) => {
  const items = readJSON('mkt-competitors.json', []);
  const idx = items.findIndex(c => c.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'Not found' });
  if (req.body.update) {
    if (!items[idx].updates) items[idx].updates = [];
    items[idx].updates.unshift({ text: req.body.update, at: new Date().toISOString() });
    delete req.body.update;
  }
  items[idx] = { ...items[idx], ...req.body, updatedAt: new Date().toISOString() };
  writeJSON('mkt-competitors.json', items);
  res.json(items[idx]);
});

app.delete('/api/mkt/competitors/:id', (req, res) => {
  let items = readJSON('mkt-competitors.json', []);
  items = items.filter(c => c.id !== req.params.id);
  writeJSON('mkt-competitors.json', items);
  res.json({ ok: true });
});

// Analizar web de un competidor (PageSpeed)
app.post('/api/mkt/competitors/:id/analyze-web', async (req, res) => {
  const items = readJSON('mkt-competitors.json', []);
  const comp = items.find(c => c.id === req.params.id);
  if (!comp || !comp.url) return res.json({ ok: false, error: 'No URL configurada para este competidor' });

  try {
    const url = comp.url.startsWith('http') ? comp.url : 'https://' + comp.url;
    const r = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=mobile`);
    const d = await r.json();
    if (d.error) return res.json({ ok: false, error: d.error.message });
    const cats = d.lighthouseResult?.categories || {};
    comp.webScores = {
      performance: Math.round((cats.performance?.score || 0) * 100),
      seo:         Math.round((cats.seo?.score || 0) * 100),
      accessibility: Math.round((cats.accessibility?.score || 0) * 100),
      analyzedAt: new Date().toISOString()
    };
    writeJSON('mkt-competitors.json', items);
    res.json({ ok: true, scores: comp.webScores });
  } catch(e) { res.json({ ok: false, error: e.message }); }
});

// Análisis competitivo completo con IA
app.post('/api/mkt/competitors/analyze-ai', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.json({ ok: false, error: 'ANTHROPIC_API_KEY no configurada' });

  const competitors = readJSON('mkt-competitors.json', []);
  const ps = readJSON('mkt-pagespeed.json', {});
  const reviews = readJSON('mkt-reviews.json', { summary: {} });

  if (!competitors.length) return res.json({ ok: false, error: 'No hay competidores cargados' });

  const citrino = {
    name: 'Citrino',
    seoScore: ps.current?.mobile?.scores?.seo || '?',
    performance: ps.current?.mobile?.scores?.performance || '?',
    reviews: reviews.summary?.googleRating || reviews.summary?.avg || '?',
    totalReviews: reviews.summary?.googleTotal || reviews.summary?.total || 0
  };

  const compList = competitors.map(c =>
    `- ${c.name}: ${c.igFollowers || 0} seg IG, ${c.googleRating || '?'}⭐ Google, web SEO: ${c.webScores?.seo || '?'}, velocidad: ${c.webScores?.performance || '?'}`
  ).join('\n');

  const prompt = `Sos el analista de marketing de Citrino Centro Integral de Bienestar (masajes terapéuticos, Montevideo).
Analizá la posición competitiva vs los competidores.

CITRINO:
- SEO web: ${citrino.seoScore}/100 | Velocidad: ${citrino.performance}/100
- Google: ${citrino.reviews}⭐ (${citrino.totalReviews} reseñas)

COMPETIDORES:
${compList}

Respondé en JSON sin markdown:
{
  "posicion": "lider|competitivo|desventaja",
  "fortalezas": ["fortaleza 1 (máx 12 palabras)", "fortaleza 2"],
  "amenazas": ["amenaza 1", "amenaza 2"],
  "acciones": ["acción concreta 1", "acción 2", "acción 3"],
  "resumen": "Una frase de posicionamiento (máx 20 palabras)"
}`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 500, messages: [{ role: 'user', content: prompt }] })
    });
    const data = await r.json();
    if (data.error) return res.json({ ok: false, error: data.error.message });
    const analysis = JSON.parse(data.content[0].text.trim());
    analysis.generatedAt = new Date().toISOString();
    writeJSON('mkt-comp-analysis.json', analysis);
    res.json({ ok: true, analysis });
  } catch(e) { res.json({ ok: false, error: e.message }); }
});

app.get('/api/mkt/competitors/analysis', (req, res) => {
  res.json(readJSON('mkt-comp-analysis.json', null));
});

// ────────────────────────────────────────────────────────────
//  API: CONTENIDO (calendario)
// ────────────────────────────────────────────────────────────
app.get('/api/mkt/content', (req, res) => {
  res.json(readJSON('mkt-content.json', []));
});

app.post('/api/mkt/content', (req, res) => {
  const items = readJSON('mkt-content.json', []);
  const item = { id: Date.now().toString(), ...req.body, createdAt: new Date().toISOString() };
  items.unshift(item);
  writeJSON('mkt-content.json', items);
  res.json(item);
});

app.patch('/api/mkt/content/:id', (req, res) => {
  const items = readJSON('mkt-content.json', []);
  const idx = items.findIndex(c => c.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'Not found' });
  items[idx] = { ...items[idx], ...req.body, updatedAt: new Date().toISOString() };
  writeJSON('mkt-content.json', items);
  res.json(items[idx]);
});

app.delete('/api/mkt/content/:id', (req, res) => {
  let items = readJSON('mkt-content.json', []);
  items = items.filter(c => c.id !== req.params.id);
  writeJSON('mkt-content.json', items);
  res.json({ ok: true });
});

// ────────────────────────────────────────────────────────────
//  API: SUBIDA A GOOGLE DRIVE
// ────────────────────────────────────────────────────────────
app.post('/api/mkt/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });

  const drive = getDriveClient();
  if (!drive) return res.status(500).json({ error: 'Google Drive no configurado' });

  try {
    const now = new Date();
    const year = now.getFullYear().toString();
    const month = now.toLocaleString('es-ES', { month: 'long', timeZone: 'America/Montevideo' });
    month[0] = month[0].toUpperCase();

    // Estructura: Citrino Marketing / 2026 / Junio / tipo
    const rootId = await ensureDriveFolder(drive, 'Citrino Marketing');
    const yearId = await ensureDriveFolder(drive, year, rootId);
    const monthId = await ensureDriveFolder(drive, month.charAt(0).toUpperCase() + month.slice(1), yearId);

    // Subcarpeta por tipo
    const tipo = req.body.tipo || 'General';
    const tipoMap = { imagen: 'Imágenes', video: 'Videos', documento: 'Documentos', reel: 'Reels' };
    const tipoFolder = tipoMap[tipo.toLowerCase()] || tipo;
    const tipoId = await ensureDriveFolder(drive, tipoFolder, monthId);

    // Subir archivo
    const { Readable } = require('stream');
    const stream = Readable.from(req.file.buffer);
    const uploaded = await drive.files.create({
      requestBody: {
        name: req.body.nombre || req.file.originalname,
        parents: [tipoId],
        description: req.body.descripcion || ''
      },
      media: { mimeType: req.file.mimetype, body: stream },
      fields: 'id,name,webViewLink,webContentLink'
    });

    // Hacer público (solo lectura)
    await drive.permissions.create({
      fileId: uploaded.data.id,
      requestBody: { role: 'reader', type: 'anyone' }
    });

    // Guardar en contenido
    const contentItems = readJSON('mkt-content.json', []);
    const contentItem = {
      id: Date.now().toString(),
      nombre: uploaded.data.name,
      tipo: tipo.toLowerCase(),
      driveId: uploaded.data.id,
      driveUrl: uploaded.data.webViewLink,
      fecha: now.toISOString().split('T')[0],
      descripcion: req.body.descripcion || '',
      autor: req.body.autor || 'Lucía',
      red: req.body.red || 'instagram',
      status: 'subido',
      createdAt: now.toISOString()
    };
    contentItems.unshift(contentItem);
    writeJSON('mkt-content.json', contentItems);

    res.json({ ok: true, file: uploaded.data, contentItem });
  } catch (e) {
    console.error('[Drive] Error upload:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ────────────────────────────────────────────────────────────
//  API: REPORTES
// ────────────────────────────────────────────────────────────
app.get('/api/mkt/reports/weekly', (req, res) => {
  const mktData = readJSON('mkt-data.json', { currentWeek: {}, byMonth: {} });
  res.json({ report: 'weekly', data: mktData.currentWeek, generatedAt: new Date().toISOString() });
});

app.get('/api/mkt/reports/monthly', (req, res) => {
  const { month } = req.query; // YYYY-MM
  const mktData = readJSON('mkt-data.json', { byMonth: {} });
  const key = month || new Date().toISOString().substring(0, 7);
  const monthData = mktData.byMonth?.[key] || { weeks: [] };

  // Agregar semanas del mes
  let totalSpend = 0, totalLeads = 0, totalReach = 0;
  let igFollowers = 0, fbFans = 0;
  for (const w of monthData.weeks) {
    totalSpend += w.meta?.spend || 0;
    totalLeads += w.meta?.leads || 0;
    totalReach += w.meta?.reach || 0;
    if (w.instagram?.followers > igFollowers) igFollowers = w.instagram.followers;
    if (w.facebook?.fans > fbFans) fbFans = w.facebook.fans;
  }

  const notes = readJSON('mkt-notes.json', []).filter(n => n.createdAt?.startsWith(key));
  const actions = readJSON('mkt-actions.json', []).filter(a => a.createdAt?.startsWith(key));
  const tickets = readJSON('mkt-tickets.json', []).filter(t => t.createdAt?.startsWith(key));

  res.json({
    report: 'monthly', month: key,
    meta: { spend: totalSpend, leads: totalLeads, cpl: totalLeads > 0 ? parseFloat((totalSpend / totalLeads).toFixed(2)) : 0, reach: totalReach },
    instagram: { followers: igFollowers },
    facebook: { fans: fbFans },
    weeks: monthData.weeks,
    notes: notes.length,
    actions: actions.length,
    actionEvaluated: actions.filter(a => a.rating).length,
    tickets: tickets.length,
    ticketsResolved: tickets.filter(t => t.status === 'closed').length,
    generatedAt: new Date().toISOString()
  });
});

app.get('/api/mkt/reports/quarterly', (req, res) => {
  const { q, year } = req.query; // q = 1|2|3|4, year = 2026
  const y = parseInt(year || new Date().getFullYear());
  const quarter = parseInt(q || Math.ceil((new Date().getMonth() + 1) / 3));
  const months = { 1: ['01','02','03'], 2: ['04','05','06'], 3: ['07','08','09'], 4: ['10','11','12'] };
  const keys = (months[quarter] || []).map(m => `${y}-${m}`);

  const mktData = readJSON('mkt-data.json', { byMonth: {} });
  let totalSpend = 0, totalLeads = 0, byMonth = {};
  for (const key of keys) {
    const md = mktData.byMonth?.[key] || { weeks: [] };
    let ms = 0, ml = 0;
    for (const w of md.weeks) { ms += w.meta?.spend || 0; ml += w.meta?.leads || 0; }
    byMonth[key] = { spend: ms, leads: ml, cpl: ml > 0 ? parseFloat((ms/ml).toFixed(2)) : 0 };
    totalSpend += ms; totalLeads += ml;
  }

  res.json({
    report: 'quarterly', quarter: `Q${quarter}`, year: y, months: keys,
    total: { spend: totalSpend, leads: totalLeads, cpl: totalLeads > 0 ? parseFloat((totalSpend/totalLeads).toFixed(2)) : 0 },
    byMonth, generatedAt: new Date().toISOString()
  });
});

// ────────────────────────────────────────────────────────────
//  API: SOCIAL LISTENING (Instagram Hashtag Search)
// ────────────────────────────────────────────────────────────
app.get('/api/mkt/social-listening', async (req, res) => {
  const igToken = process.env.INSTAGRAM_ACCESS_TOKEN || process.env.META_PAGE_ACCESS_TOKEN;
  const igBusinessId = process.env.META_IG_BUSINESS_ID || process.env.INSTAGRAM_PAGE_ID || '17841442372105492';
  const HASHTAGS = ['CitrinoBienestar', 'masajesMontevideo', 'masajesUruguay', 'bienestarUruguay', 'masajes'];

  if (!igToken) return res.json({ error: 'Token de Instagram no configurado', hashtags: [] });

  try {
    const results = [];
    for (const tag of HASHTAGS) {
      try {
        // 1. Buscar ID del hashtag
        const searchRes = await fetch(
          `https://graph.facebook.com/v18.0/ig_hashtag_search?` +
          `user_id=${igBusinessId}&q=${encodeURIComponent(tag)}&access_token=${igToken}`
        );
        const searchData = await searchRes.json();
        if (searchData.error || !searchData.data?.[0]?.id) {
          results.push({ tag, posts: 0, id: null });
          continue;
        }
        const hashtagId = searchData.data[0].id;
        // 2. Contar posts recientes (top_media)
        const mediaRes = await fetch(
          `https://graph.facebook.com/v18.0/${hashtagId}/top_media?` +
          `user_id=${igBusinessId}&fields=id,media_type,timestamp&access_token=${igToken}&limit=50`
        );
        const mediaData = await mediaRes.json();
        const postCount = mediaData.data?.length || 0;
        results.push({ tag, posts: postCount, id: hashtagId });
      } catch(e) {
        results.push({ tag, posts: 0, error: e.message });
      }
      // Rate limit: esperar 200ms entre llamadas
      await new Promise(r => setTimeout(r, 200));
    }
    res.json({ ok: true, hashtags: results, updatedAt: new Date().toISOString() });
  } catch(e) {
    res.json({ ok: false, error: e.message, hashtags: [] });
  }
});

// ── Refresh all manual ───────────────────────────────────────
app.post('/api/mkt/refresh/all', async (req, res) => {
  res.json({ ok: true, message: 'Actualización iniciada en segundo plano' });
  // corre async sin bloquear la respuesta
  (async () => {
    await refreshMetaData();
    await refreshPageSpeed();
    await refreshReviews();
    await generateAIInsights();
    await exportToSheets();
    console.log('[REFRESH/ALL] Completado');
  })().catch(e => console.error('[REFRESH/ALL] Error:', e.message));
});

// ── PageSpeed cached ─────────────────────────────────────────
app.get('/api/mkt/pagespeed/data', (req, res) => {
  res.json(readJSON('mkt-pagespeed.json', { current: null, history: [] }));
});

app.post('/api/mkt/pagespeed/refresh', async (req, res) => {
  await refreshPageSpeed();
  res.json({ ok: true, data: readJSON('mkt-pagespeed.json') });
});

// ────────────────────────────────────────────────────────────
//  API: PAGESPEED (Google PageSpeed Insights - sin auth)
// ────────────────────────────────────────────────────────────
app.get('/api/mkt/pagespeed', async (req, res) => {
  const url = req.query.url || 'https://citrinobienestar.uy';
  const strategy = req.query.strategy || 'mobile';
  try {
    const psRes = await fetch(
      `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?` +
      `url=${encodeURIComponent(url)}&strategy=${strategy}`
    );
    const psData = await psRes.json();
    if (psData.error) return res.json({ error: psData.error.message });
    const cats = psData.lighthouseResult?.categories || {};
    const categories = {};
    if (cats.performance) categories['Velocidad'] = Math.round((cats.performance.score || 0) * 100);
    if (cats.seo) categories['SEO'] = Math.round((cats.seo.score || 0) * 100);
    if (cats.accessibility) categories['Accesibilidad'] = Math.round((cats.accessibility.score || 0) * 100);
    if (cats['best-practices']) categories['Buenas prácticas'] = Math.round((cats['best-practices'].score || 0) * 100);
    // Top oportunidades
    const audits = psData.lighthouseResult?.audits || {};
    const opportunities = Object.values(audits)
      .filter(a => a.score !== null && a.score < 0.9 && a.details?.type === 'opportunity' && a.title)
      .slice(0, 4)
      .map(a => a.title);
    res.json({ ok: true, url, strategy, categories, opportunities, analyzedAt: new Date().toISOString() });
  } catch(e) {
    res.json({ ok: false, error: e.message });
  }
});

// ────────────────────────────────────────────────────────────
//  API: REVIEWS SYNC (Google My Business — placeholder hasta configurar)
// ────────────────────────────────────────────────────────────
app.post('/api/mkt/reviews/sync-google', async (req, res) => {
  const placeId = process.env.GOOGLE_PLACE_ID;
  const apiKey  = process.env.GOOGLE_API_KEY;
  if (!placeId || !apiKey) {
    return res.json({
      ok: false,
      error: 'Configurá GOOGLE_PLACE_ID y GOOGLE_API_KEY en Railway → Variables para activar la sincronización automática de reseñas.',
      setupInstructions: [
        '1. En Google Cloud Console, activá la API "Places API"',
        '2. Creá una API Key y copiala',
        '3. Buscá tu Place ID en: https://developers.google.com/maps/documentation/places/web-service/place-id',
        '4. Agregá en Railway → Variables: GOOGLE_PLACE_ID=ChIJ... y GOOGLE_API_KEY=AIza...'
      ]
    });
  }
  try {
    await refreshReviews();
    const data = readJSON('mkt-reviews.json', { reviews: [], summary: {} });
    res.json({ ok: true, summary: data.summary, count: data.reviews?.length || 0 });
  } catch(e) {
    res.json({ ok: false, error: e.message });
  }
});

// ────────────────────────────────────────────────────────────
//  REDIRECTS — secciones indexadas por Google como URLs separadas
// ────────────────────────────────────────────────────────────
app.get('/contacto',  (req, res) => res.redirect(301, '/#contacto'));
app.get('/servicios', (req, res) => res.redirect(301, '/#servicios'));
app.get('/nosotros',  (req, res) => res.redirect(301, '/#nosotros'));
app.get('/equipo',    (req, res) => res.redirect(301, '/#equipo'));
app.get('/metodo',    (req, res) => res.redirect(301, '/#metodo'));
app.get('/faq',       (req, res) => res.redirect(301, '/#faq'));
app.get('/empresas',  (req, res) => res.redirect(301, '/empresas.html'));

// ────────────────────────────────────────────────────────────
//  WHATSAPP WEBHOOK (existente del bot)
// ────────────────────────────────────────────────────────────
app.get('/webhook', (req, res) => {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'citrino2026';
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === VERIFY_TOKEN) {
    res.status(200).send(req.query['hub.challenge']);
  } else {
    res.sendStatus(403);
  }
});

app.post('/webhook', (req, res) => {
  // El bot principal maneja los mensajes aquí
  // Este archivo puede extenderse con la lógica completa del bot
  res.sendStatus(200);
});

// ────────────────────────────────────────────────────────────
//  CATCH-ALL — cualquier URL desconocida vuelve al index
// ────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ────────────────────────────────────────────────────────────
//  INICIO
// ────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[CITRINO] Servidor corriendo en puerto ${PORT}`);
  console.log(`[CITRINO] Dashboard MKT: /mkt`);
});

module.exports = app;
