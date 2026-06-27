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
          if (ins.actions) {
            const leadAction = ins.actions.find(a => a.action_type === 'lead' || a.action_type === 'offsite_conversion.fb_pixel_lead');
            if (leadAction) leads = parseInt(leadAction.value || 0);
          }
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

// ── Cron: lunes 9am Montevideo (UTC-3 → 12:00 UTC) ──────────
cron.schedule('0 12 * * 1', refreshMetaData, { timezone: 'America/Montevideo' });

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
//  API: MÉTRICAS PRINCIPALES
// ────────────────────────────────────────────────────────────
app.get('/api/mkt/data', (req, res) => {
  res.json(readJSON('mkt-data.json', { currentWeek: {}, byMonth: {}, updatedAt: null }));
});

app.post('/api/mkt/refresh', async (req, res) => {
  await refreshMetaData();
  res.json({ ok: true, data: readJSON('mkt-data.json') });
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
//  INICIO
// ────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[CITRINO] Servidor corriendo en puerto ${PORT}`);
  console.log(`[CITRINO] Dashboard MKT: /mkt`);
});

module.exports = app;
