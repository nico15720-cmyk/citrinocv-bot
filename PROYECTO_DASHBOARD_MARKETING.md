# Proyecto: Dashboard de Marketing Citrino
**Para pasar a un desarrollador o ejecutar paso a paso**

---

## ¿Qué es esto?

Una pantalla nueva dentro del CRM de Citrino (que ya existe en citrinobienestar.uy/app/crm/) que una vez por semana te muestra:

- Cómo están funcionando Instagram y Facebook (alcance, interacciones, seguidores)
- Cómo está funcionando la página web (visitas, de dónde viene la gente)
- Recomendaciones automáticas generadas por IA ("este tipo de post funciona mejor", "tu web carga lento en mobile")
- Botones para ejecutar mejoras simples directamente desde el panel

---

## Dónde vive el código

El proyecto tiene DOS partes que ya existen:

```
C:\Users\Lenovo\Desktop\citrino-agent\     ← CRM React (frontend)
C:\Users\Lenovo\Claude\citrino-bot\        ← Bot Node.js (backend, en Railway)
```

La pantalla nueva va en el **CRM React** (`citrino-agent/`).
Las llamadas a las APIs de Meta van en el **backend del bot** (`citrino-bot/`) para no exponer tokens en el browser.

---

## Cómo se sube a internet

### El CRM React (citrinobienestar.uy/app/crm/)
1. Abrir terminal en `C:\Users\Lenovo\Desktop\citrino-agent\`
2. Correr `npm run build` → genera la carpeta `/dist`
3. Arrastrar la carpeta `/dist` a **netlify.com** (drag & drop en el panel del sitio)
4. En 30 segundos está live

### El Bot (Railway)
1. Abrir terminal en `C:\Users\Lenovo\Claude\citrino-bot\`
2. Correr `git add . && git commit -m "descripcion" && git push origin main`
3. Railway detecta el push y redeploya solo en ~2 minutos

---

## Qué APIs necesitamos conectar

### 1. Meta Graph API (Instagram + Facebook) — YA TENÉS LAS CREDENCIALES
El bot ya usa `META_PAGE_ACCESS_TOKEN` para mandar mensajes. El mismo token sirve para leer métricas.

**Datos que podemos obtener:**
- Instagram: seguidores, alcance de posts, impresiones, interacciones, posts con mejor performance
- Facebook: alcance de la página, likes, posts más vistos
- Sin costo extra — está incluido en la API que ya tenés

### 2. Google Analytics / Search Console — HAY QUE CONFIGURAR
Para saber cuánta gente entra a citrinobienestar.uy, desde dónde, qué páginas miran.

**Opción A (recomendada): Google Analytics 4**
- Crear cuenta gratuita en analytics.google.com
- Agregar un snippet de código de 2 líneas al index.html del CRM
- Desde el bot leer los datos via Google Analytics Data API

**Opción B (más simple): Cloudflare Analytics**
- Requiere mover el dominio a Cloudflare (1 hora de trabajo, gratis)
- Analytics sin cookies, más privado, más fácil de leer

---

## Estructura de archivos nuevos a crear

### En el CRM React (`citrino-agent/src/`)
```
src/
  screens/
    Marketing.jsx          ← NUEVA pantalla del dashboard
  components/
    MetricCard.jsx         ← Tarjeta de métrica (seguidores, alcance, etc.)
    RecomendacionCard.jsx  ← Tarjeta de recomendación con botón "Aplicar"
```

### En el Bot (`citrino-bot/bot/`)
```
bot/
  marketing.js             ← NUEVO módulo: lee datos de Meta API + GA
```

### En el servidor (`citrino-bot/index.js`)
Agregar 2 endpoints nuevos:
- `GET /api/marketing/meta` → devuelve métricas de IG y FB
- `GET /api/marketing/web` → devuelve métricas de la web
- `POST /api/marketing/mejorar` → ejecuta una mejora específica

---

## Qué muestra el dashboard

### Sección 1: Instagram
```
📸 Instagram — últimos 7 días
┌─────────────┬─────────────┬─────────────┬─────────────┐
│  Seguidores │   Alcance   │ Interaciones│   Posts     │
│    1.234    │   4.500     │    234      │      5      │
│   +12 ↑    │  +8% ↑      │   -3% ↓    │             │
└─────────────┴─────────────┴─────────────┴─────────────┘

🏆 Post con mejor alcance esta semana: [imagen] — 890 personas
```

### Sección 2: Facebook
```
📘 Facebook — últimos 7 días
┌─────────────┬─────────────┬─────────────┐
│    Likes    │   Alcance   │ Interaciones│
│     567     │   2.100     │     89      │
└─────────────┴─────────────┴─────────────┘
```

### Sección 3: Página web
```
🌐 citrinobienestar.uy — últimos 7 días
┌─────────────┬─────────────┬─────────────┐
│   Visitas   │  Visitantes │ Tiempo prom │
│    1.890    │     743     │   2m 14s    │
└─────────────┴─────────────┴─────────────┘

📍 De dónde viene la gente:
  Instagram → 42%
  Google → 31%
  WhatsApp (link directo) → 18%
  Otros → 9%
```

### Sección 4: Recomendaciones IA (se generan una vez por semana)
```
💡 Recomendaciones de esta semana:

1. Tu post del martes con foto del local tuvo 3x más alcance que
   los posts de texto. Publicá más contenido visual del espacio.
   [Aplicar: crear recordatorio para el próximo martes]

2. El 41% de tu tráfico web viene de Instagram pero solo 8% llega
   al formulario de contacto. Agregar un botón más visible.
   [Aplicar mejora en web → agrega botón destacado]

3. Horario pico de tus seguidores en Instagram: martes y jueves
   entre 19:00 y 21:00. Programá posts para ese horario.
   [Ver horarios recomendados]
```

---

## Cómo funcionan los botones "Aplicar mejora"

### Mejoras que SÍ se pueden automatizar (ejecutan solas):
- Agregar/cambiar meta tags de SEO en la web (description, keywords)
- Cambiar el texto del botón de WhatsApp en la página
- Crear un recordatorio en el calendario para publicar en cierto horario

### Mejoras que NO se pueden automatizar (te dicen qué hacer vos):
- Subir una foto a Instagram (Meta no permite publicación automatizada sin aprobación especial)
- Cambiar diseño visual de la web
- Configurar campañas pagas de Meta Ads

---

## Pasos para construirlo (en orden)

### Paso 1 — Activar Google Analytics (30 minutos)
1. Ir a analytics.google.com → crear cuenta → crear propiedad "citrinobienestar.uy"
2. Copiar el código GA4 que te dan (2 líneas de JavaScript)
3. Pegarlo en `citrino-agent/index.html` antes del `</head>`
4. Subir a Netlify (`npm run build` + drag & drop)
5. Verificar en GA4 que empieza a recibir datos (puede tardar 24-48hs en tener datos históricos)

### Paso 2 — Crear el módulo marketing.js en el bot (2 horas)
Archivo nuevo en `citrino-bot/bot/marketing.js` con funciones:
- `getMetricasInstagram()` — llama a graph.facebook.com con el token existente
- `getMetricasFacebook()` — ídem para la página de FB
- `getMetricasWeb()` — llama a Google Analytics Data API
- `generarRecomendaciones(metricas)` — llama a Claude Haiku con las métricas y pide recomendaciones

### Paso 3 — Agregar endpoints en index.js (30 minutos)
3 rutas nuevas protegidas con el mismo auth del CRM:
```js
app.get('/api/marketing/meta', requireAuth, async (req, res) => { ... })
app.get('/api/marketing/web', requireAuth, async (req, res) => { ... })
app.post('/api/marketing/mejorar', requireAuth, async (req, res) => { ... })
```

### Paso 4 — Crear la pantalla Marketing.jsx (3 horas)
Nueva pantalla en el CRM React que:
- Muestra las 4 secciones (IG, FB, Web, Recomendaciones)
- Tiene botones "Aplicar mejora" que llaman al endpoint del bot
- Se actualiza con un botón "Actualizar datos" (o automáticamente cada vez que abrís)
- Cachea los datos localmente para no hacer llamadas de API innecesarias

### Paso 5 — Conectar la pantalla al menú del CRM (15 minutos)
En `App.jsx` del CRM, agregar el botón "Marketing" en el menú de navegación (pantalla `Mas.jsx`).

### Paso 6 — Deploy y prueba (30 minutos)
1. `git push` en citrino-bot → Railway redeploya
2. `npm run build` + Netlify en citrino-agent → frontend live
3. Probar que los datos aparecen correctamente

---

## Variables de entorno nuevas necesarias en Railway

```
GA4_PROPERTY_ID=         # ID de tu propiedad Google Analytics 4 (ej: 123456789)
GA4_SERVICE_ACCOUNT_JSON= # Credenciales de servicio de Google para leer GA4
```

El `META_PAGE_ACCESS_TOKEN` ya existe — no hay que agregar nada para Meta.

---

## Costo estimado

| Servicio | Costo |
|----------|-------|
| Meta Graph API (métricas) | Gratis |
| Google Analytics 4 | Gratis |
| Claude Haiku (recomendaciones 1x/semana) | ~$0.01 por análisis |
| Railway (ya lo tenés) | Sin costo adicional |
| Netlify (ya lo tenés) | Sin costo adicional |
| **Total adicional** | **~$0 / mes** |

---

## Tiempo total estimado de desarrollo

| Paso | Tiempo |
|------|--------|
| Google Analytics setup | 30 min |
| marketing.js (bot) | 2 hs |
| Endpoints en index.js | 30 min |
| Marketing.jsx (pantalla) | 3 hs |
| Conectar menú + deploy | 45 min |
| **Total** | **~7 horas** |

---

## Preguntas frecuentes

**¿Por qué no hacemos todo en el frontend sin el bot?**
Porque los tokens de Meta no pueden estar en el código del browser (cualquiera los vería en el source). El bot actúa como intermediario seguro.

**¿Puedo publicar posts en Instagram automáticamente?**
Meta requiere una aprobación especial llamada "Content Publishing" para publicar automáticamente. Es posible obtenerla pero requiere un proceso de revisión. Por ahora el sistema recomienda qué publicar pero no publica solo.

**¿Los datos de Google Analytics son en tiempo real?**
Hay un delay de 24-48 horas para datos históricos. Para datos del día, GA4 tiene un endpoint de "realtime" que sí es instantáneo.

**¿Funciona aunque no tenga Google Analytics todavía?**
Sí — la sección de Meta (Instagram + Facebook) funciona desde el primer día con los tokens que ya tenés. La sección web queda pendiente hasta que instales GA4.

---

*Documento generado por Citrino AI — Junio 2026*
*Stack: React 18 + Vite + Tailwind (frontend) / Node.js + Express (backend) / Railway + Netlify (deploy)*
