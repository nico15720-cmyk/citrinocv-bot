// fix-analisis-theme.js — converts Analisis.jsx from dark to warm palette
const fs = require('fs')
const path = require('path')

const file = path.join(__dirname, '../../Desktop/citrino-agent/src/screens/Analisis.jsx')
let c = fs.readFileSync(file, 'utf8')

const reps = [
  // ── Outer container ──────────────────────────────────────────────
  ['<div className="flex flex-col h-full">', '<div className="flex flex-col h-full bg-[#FFF8F3]">'],

  // ── Header ───────────────────────────────────────────────────────
  ['fixed top-0 left-0 right-0 bg-gray-900 border-b border-gray-700 z-40 flex items-center px-4 h-14 gap-3',
   'fixed top-0 left-0 right-0 bg-white border-b border-orange-100 z-40 flex items-center px-4 h-14 gap-3 shadow-sm'],
  ['className="text-gray-400 active:text-white p-1">', 'className="text-stone-400 active:text-orange-600 p-1">'],
  ['<h1 className="text-white font-semibold text-lg flex-1">Análisis Financiero</h1>',
   '<h1 className="text-stone-800 font-semibold text-lg flex-1">Análisis Financiero</h1>'],

  // ── Tab bar ──────────────────────────────────────────────────────
  ['fixed top-14 left-0 right-0 z-30 bg-gray-900 border-b border-gray-700 flex overflow-x-auto scrollbar-none',
   'fixed top-14 left-0 right-0 z-30 bg-white border-b border-orange-100 flex overflow-x-auto scrollbar-none'],
  [': \'text-gray-500\'',
   ': \'text-stone-400\''],

  // ── Navigator ────────────────────────────────────────────────────
  ['fixed top-[96px] left-0 right-0 z-20 bg-gray-900/95 border-b border-gray-800 px-4 py-2',
   'fixed top-[96px] left-0 right-0 z-20 bg-white/98 border-b border-orange-100 px-4 py-2'],
  ['className="w-8 h-8 flex items-center justify-center text-gray-400 active:text-white disabled:opacity-20 rounded-full"',
   'className="w-8 h-8 flex items-center justify-center text-stone-400 active:text-orange-600 disabled:opacity-20 rounded-full"'],
  ["'bg-gray-700 text-gray-400'", "'bg-stone-100 text-stone-500'"],
  ["'bg-purple-600 text-white' : 'bg-gray-800 text-gray-500 active:text-gray-300'",
   "'bg-purple-600 text-white' : 'bg-stone-100 text-stone-500 active:text-stone-700'"],
  ['<span className="text-gray-700 text-[10px] self-center ml-1">Ene-Mar · Abr-Jun · Jul-Sep · Oct-Dic</span>',
   '<span className="text-stone-300 text-[10px] self-center ml-1">Ene-Mar · Abr-Jun · Jul-Sep · Oct-Dic</span>'],
  ['<span className="text-white text-sm font-bold">',
   '<span className="text-stone-800 text-sm font-bold">'],

  // ── FinancieroHero ───────────────────────────────────────────────
  ['className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl p-4 border border-gray-700/40 relative"',
   'className="rounded-2xl p-4 border border-red-900/20 relative overflow-hidden" style={{background:\'linear-gradient(135deg,#991B1B 0%,#C2410C 55%,#D97706 100%)\'}}'],
  ['className="absolute top-3 right-3 w-6 h-6 rounded-full bg-gray-700 flex items-center justify-center text-gray-400 active:bg-gray-600 text-xs font-bold"',
   'className="absolute top-3 right-3 w-6 h-6 rounded-full bg-white/20 flex items-center justify-center text-white active:bg-white/30 text-xs font-bold"'],
  ['<p className="text-gray-500 text-[10px] font-bold uppercase tracking-widest mb-3 pr-8">',
   '<p className="text-white/60 text-[10px] font-bold uppercase tracking-widest mb-3 pr-8">'],
  ['className="flex items-center gap-3 mb-4 bg-gray-700/40 rounded-xl px-3 py-3"',
   'className="flex items-center gap-3 mb-4 bg-black/20 rounded-xl px-3 py-3"'],
  ['<p className="text-gray-500 text-[10px] font-semibold uppercase tracking-wide mb-0.5">Margen del negocio</p>',
   '<p className="text-white/60 text-[10px] font-semibold uppercase tracking-wide mb-0.5">Margen del negocio</p>'],
  ['<span className="text-gray-500 text-[10px] w-20 shrink-0 text-right">',
   '<span className="text-white/60 text-[10px] w-20 shrink-0 text-right">'],
  ['<div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">',
   '<div className="flex-1 h-1.5 bg-white/20 rounded-full overflow-hidden">'],
  // info modal inside hero — keep dark (modal overlay, dark is fine)

  // ── KPICard ──────────────────────────────────────────────────────
  ['className="bg-gray-800 rounded-xl p-3 flex flex-col gap-1 text-left active:bg-gray-700 transition-colors w-full"',
   'className="bg-white rounded-xl border border-stone-100 p-3 flex flex-col gap-1 text-left active:bg-stone-50 transition-colors w-full"'],
  ['{hint && <span className="text-gray-700 text-[10px]">ℹ</span>}',
   '{hint && <span className="text-stone-300 text-[10px]">ℹ</span>}'],
  ['<span className="text-gray-500 text-[10px] font-medium leading-tight">',
   '<span className="text-stone-400 text-[10px] font-medium leading-tight">'],
  ['? <p className="text-gray-400 text-[10px] leading-tight italic">',
   '? <p className="text-stone-400 text-[10px] leading-tight italic">'],
  [': sub && <p className="text-gray-600 text-[10px] leading-tight">',
   ': sub && <p className="text-stone-400 text-[10px] leading-tight">'],

  // ── SectionLabel ─────────────────────────────────────────────────
  ['<p className="text-gray-400 text-xs font-bold uppercase tracking-wider mb-2 flex items-center gap-1.5">',
   '<p className="text-stone-500 text-xs font-bold uppercase tracking-wider mb-2 flex items-center gap-1.5">'],

  // ── SegmentoCard ─────────────────────────────────────────────────
  ['<span className={`text-xs font-bold px-2 py-0.5 rounded-full bg-gray-700 ${labelColor}`}>',
   '<span className={`text-xs font-bold px-2 py-0.5 rounded-full bg-stone-100 ${labelColor}`}>'],
  ['<div className="border-t border-gray-700/40">', '<div className="border-t border-stone-100">'],
  ['<p className="text-gray-600 text-xs text-center py-3">',
   '<p className="text-stone-400 text-xs text-center py-3">'],
  ['className="flex items-center justify-between px-4 py-2.5 border-b border-gray-700/30 last:border-0"',
   'className="flex items-center justify-between px-4 py-2.5 border-b border-stone-100 last:border-0"'],
  ['<p className="text-gray-200 text-sm font-medium truncate">',
   '<p className="text-stone-700 text-sm font-medium truncate">'],
  ['{c.Telefono && <p className="text-gray-600 text-xs">',
   '{c.Telefono && <p className="text-stone-400 text-xs">'],
  ['<span className="text-gray-700 text-xs ml-3">sin tel.</span>',
   '<span className="text-stone-300 text-xs ml-3">sin tel.</span>'],
  ['<p className="text-gray-500 text-xs">{desc}</p>',
   '<p className="text-stone-400 text-xs">{desc}</p>'],
  ['stroke="#6B7280"', 'stroke="#A8A29E"'],

  // ── BarraComparativa ─────────────────────────────────────────────
  ['<span className="text-gray-400">{label}</span>',
   '<span className="text-stone-400">{label}</span>'],
  ['<span className="text-white font-medium">{$$(valor)}</span>',
   '<span className="text-stone-700 font-medium">{$$(valor)}</span>'],
  ['<div className="h-2 bg-gray-700 rounded-full overflow-hidden">',
   '<div className="h-2 bg-stone-100 rounded-full overflow-hidden">'],

  // ── Metrica ──────────────────────────────────────────────────────
  ['<div className="bg-gray-800 rounded-xl p-3 flex flex-col gap-1">',
   '<div className="bg-white rounded-xl border border-stone-100 p-3 flex flex-col gap-1">'],
  ['<span className="text-gray-400 text-xs">{label}</span>',
   '<span className="text-stone-400 text-xs">{label}</span>'],
  ['{sub && <p className="text-gray-500 text-xs">',
   '{sub && <p className="text-stone-400 text-xs">'],

  // ── Card backgrounds (body) ──────────────────────────────────────
  // gradient cards
  ['"bg-gradient-to-br from-emerald-900/25 to-gray-800 rounded-2xl p-4 border border-emerald-500/20"',
   '"bg-emerald-50 rounded-2xl p-4 border border-emerald-200"'],
  ['"bg-gradient-to-br from-amber-900/20 to-gray-800 border border-amber-500/20 rounded-2xl p-4"',
   '"bg-amber-50 border border-amber-200 rounded-2xl p-4"'],
  // bg-gray-800 cards — replace all occurrences
  ['bg-gray-800 rounded-2xl p-4"', 'bg-white rounded-2xl border border-stone-100 p-4"'],
  ['bg-gray-800 rounded-xl p-4"', 'bg-white rounded-xl border border-stone-100 p-4"'],
  ['bg-gray-800 rounded-xl overflow-hidden"', 'bg-white rounded-xl border border-stone-100 overflow-hidden"'],
  ['bg-gray-800 rounded-xl px-4 py-3"', 'bg-white rounded-xl border border-stone-100 px-4 py-3"'],
  ['bg-gray-800 rounded-xl p-4 mt-2"', 'bg-white rounded-xl border border-stone-100 p-4 mt-2"'],
  ['bg-gray-800 rounded-xl p-4 grid cols-4"', 'bg-white rounded-xl border border-stone-100 p-4 grid cols-4"'],
  ['bg-gray-800 rounded-xl p-4 grid grid-cols-4', 'bg-white rounded-xl border border-stone-100 p-4 grid grid-cols-4'],

  // ── Inner elements ───────────────────────────────────────────────
  // equity section colors
  ['"text-emerald-400">{$$(financialKPIs.patrimonioAcumulado)}<', '"text-emerald-600">{$$(financialKPIs.patrimonioAcumulado)}<'],
  ['"font-bold text-base leading-tight text-red-400">{$$(financialKPIs.loQueDebo)}<',
   '"font-bold text-base leading-tight text-red-500">{$$(financialKPIs.loQueDebo)}<'],
  ['${financialKPIs.cashLibre >= 0 ? \'text-white\' : \'text-red-400\'}',
   '${financialKPIs.cashLibre >= 0 ? \'text-stone-800\' : \'text-red-500\'}'],
  ['<p className="text-emerald-400 text-[10px] font-bold uppercase tracking-widest mb-3">',
   '<p className="text-emerald-700 text-[10px] font-bold uppercase tracking-widest mb-3">'],
  ['<p className="text-amber-400 text-[10px] font-bold uppercase tracking-widest mb-3">',
   '<p className="text-amber-700 text-[10px] font-bold uppercase tracking-widest mb-3">'],
  ['<p className="text-amber-300 text-2xl font-bold leading-none">',
   '<p className="text-amber-700 text-2xl font-bold leading-none">'],
  ['<p className="text-blue-400 text-2xl font-bold leading-none">',
   '<p className="text-blue-600 text-2xl font-bold leading-none">'],

  // gray-700/40 inner elements → stone-50
  ['className="flex items-center justify-between bg-gray-700/40 rounded-xl px-3 py-2 mb-2"',
   'className="flex items-center justify-between bg-stone-50 rounded-xl px-3 py-2 mb-2"'],
  ['className="flex items-center justify-between bg-gray-700/40 rounded-xl px-3 py-2"',
   'className="flex items-center justify-between bg-stone-50 rounded-xl px-3 py-2"'],
  ['className="bg-gray-700/50 rounded-xl px-3 py-2"',
   'className="bg-stone-50 rounded-xl px-3 py-2"'],
  ['className="bg-gray-700/30 rounded-xl px-3 py-2.5 space-y-1"',
   'className="bg-stone-50 rounded-xl px-3 py-2.5 space-y-1"'],

  // progress bar tracks
  ['<div className="h-3 bg-gray-700 rounded-full overflow-hidden">',
   '<div className="h-3 bg-stone-100 rounded-full overflow-hidden">'],
  ['<div className="h-1.5 bg-gray-700 rounded-full mt-1 overflow-hidden">',
   '<div className="h-1.5 bg-stone-100 rounded-full mt-1 overflow-hidden">'],
  [' bg-gray-700 rounded-full overflow-hidden">',
   ' bg-stone-100 rounded-full overflow-hidden">'],

  // borders
  ['border-b border-gray-700"', 'border-b border-stone-100"'],
  ['border-b border-gray-700/50"', 'border-b border-stone-100"'],
  ['border-b border-gray-700/40"', 'border-b border-stone-100"'],
  ['border-b border-gray-700/30"', 'border-b border-stone-100"'],
  ['border-x border-gray-700/40"', 'border-x border-stone-100"'],
  ['border-b border-gray-700/60', 'border-b border-stone-100'],
  ['border-b border-gray-700/50 last:border-0', 'border-b border-stone-100 last:border-0'],
  ['border-b border-gray-700/40 last:border-0', 'border-b border-stone-100 last:border-0'],
  ['border-b border-gray-700/50 last:border-0"', 'border-b border-stone-100 last:border-0"'],
  ['pb-3 border-b border-gray-700/40 last:border-0 last:pb-0',
   'pb-3 border-b border-stone-100 last:border-0 last:pb-0'],

  // body text that becomes invisible on white
  ['<p className="text-white text-sm">{label}</p>',
   '<p className="text-stone-800 text-sm">{label}</p>'],
  ['<p className="text-white font-medium">{label}</p>',
   '<p className="text-stone-800 font-medium">{label}</p>'],
  ['<p className="text-white text-sm font-medium">{label}</p>',
   '<p className="text-stone-800 text-sm font-medium">{label}</p>'],
  ['<p className="text-gray-200 text-sm leading-relaxed">{c}</p>',
   '<p className="text-stone-700 text-sm leading-relaxed">{c}</p>'],
  ['<p className="text-white text-sm font-semibold">📣 Meta Ads',
   '<p className="text-stone-800 text-sm font-semibold">Meta Ads'],
  ['<span className="text-gray-600 text-[10px]">guardado local</span>',
   '<span className="text-stone-400 text-[10px]">guardado local</span>'],

  // table / tendencias
  ['<td className="p-2.5 text-gray-300">', '<td className="p-2.5 text-stone-600">'],
  ['<th className="text-gray-500 font-medium p-2.5 text-left">', '<th className="text-stone-400 font-medium p-2.5 text-left">'],
  ['<th className="text-gray-500 font-medium p-2.5 text-right">', '<th className="text-stone-400 font-medium p-2.5 text-right">'],
  ['<p className="text-gray-400 text-xs mb-4">Ingresos vs Gastos</p>',
   '<p className="text-stone-400 text-xs mb-4">Ingresos vs Gastos</p>'],
  ['<p className="text-gray-600 text-[9px] text-center leading-tight mt-1">',
   '<p className="text-stone-400 text-[9px] text-center leading-tight mt-1">'],
  ['<span className="text-gray-500 text-xs">Ingresos</span>', '<span className="text-stone-400 text-xs">Ingresos</span>'],
  ['<span className="text-gray-500 text-xs">Gastos</span>', '<span className="text-stone-400 text-xs">Gastos</span>'],
  ['<p className="text-gray-400 text-xs mb-3 font-medium uppercase tracking-wide">Totales generales</p>',
   '<p className="text-stone-400 text-xs mb-3 font-medium uppercase tracking-wide">Totales generales</p>'],
  ['<p className="text-white font-bold">{val}</p>', '<p className="text-stone-800 font-bold">{val}</p>'],
  ['<p className="text-gray-500 text-xs">{label}</p>', '<p className="text-stone-400 text-xs">{label}</p>'],
  ['"<p className="text-gray-500 text-sm p-4 text-center">No hay datos de sesiones</p>"',
   '<p className="text-stone-400 text-sm p-4 text-center">No hay datos de sesiones</p>'],
  ['<p className="text-gray-500 text-sm p-4 text-center">No hay datos de sesiones</p>',
   '<p className="text-stone-400 text-sm p-4 text-center">No hay datos de sesiones</p>'],
  ['<p className="text-white text-sm">{c.nombre}</p>', '<p className="text-stone-800 text-sm">{c.nombre}</p>'],
  ['<p className="text-gray-400 text-xs font-medium uppercase tracking-wide mb-2">Ranking por sesiones</p>',
   '<p className="text-stone-400 text-xs font-medium uppercase tracking-wide mb-2">Ranking por sesiones</p>'],
  ['<p className="text-gray-400 text-xs font-medium uppercase tracking-wide mb-2">Gastos por categoría (histórico)</p>',
   '<p className="text-stone-400 text-xs font-medium uppercase tracking-wide mb-2">Gastos por categoría (histórico)</p>'],
  ['<p className="text-gray-400 text-xs">Meses 2026</p>',
   '<p className="text-stone-400 text-xs">Meses 2026</p>'],
  ['<p className="text-gray-400 text-xs font-medium uppercase tracking-wide">Meses 2026</p>',
   '<p className="text-stone-400 text-xs font-medium uppercase tracking-wide">Meses 2026</p>'],

  // Input styling
  ['className="w-full bg-gray-700 text-white rounded-xl py-2.5 pl-7 pr-3 text-sm font-bold border border-gray-600 focus:border-orange-400 focus:outline-none"',
   'className="w-full bg-stone-50 text-stone-800 rounded-xl py-2.5 pl-7 pr-3 text-sm font-bold border border-stone-200 focus:border-orange-400 focus:outline-none"'],
  ['className="w-full bg-gray-700 text-white rounded-xl py-2.5 px-3 text-sm font-bold border border-gray-600 focus:border-orange-400 focus:outline-none"',
   'className="w-full bg-stone-50 text-stone-800 rounded-xl py-2.5 px-3 text-sm font-bold border border-stone-200 focus:border-orange-400 focus:outline-none"'],
  ['<span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-bold">$</span>',
   '<span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-sm font-bold">$</span>'],
  ['<label className="text-gray-500 text-[10px] font-medium uppercase tracking-wide">Gasto del mes</label>',
   '<label className="text-stone-400 text-[10px] font-medium uppercase tracking-wide">Gasto del mes</label>'],
  ['<label className="text-gray-500 text-[10px] font-medium uppercase tracking-wide">Convs. iniciadas</label>',
   '<label className="text-stone-400 text-[10px] font-medium uppercase tracking-wide">Convs. iniciadas</label>'],
  ['<span className="text-orange-400 font-bold text-sm">{marketingKPIs.nuevosEstesMes.length}</span>',
   '<span className="text-orange-600 font-bold text-sm">{marketingKPIs.nuevosEstesMes.length}</span>'],
  ['<span className="text-gray-400 text-xs">Clientes nuevos en {isAcumulado',
   '<span className="text-stone-400 text-xs">Clientes nuevos en {isAcumulado'],

  // Marketing table
  ['className={`grid grid-cols-5 gap-1 px-3 py-2 border-b border-gray-700/50 last:border-0 w-full transition-colors ${',
   'className={`grid grid-cols-5 gap-1 px-3 py-2 border-b border-stone-100 last:border-0 w-full transition-colors ${'],
  ["esSelected ? 'bg-orange-500/10' : 'active:bg-gray-700'",
   "esSelected ? 'bg-orange-50' : 'active:bg-stone-50'"],
  ["esSelected ? 'text-orange-400' : 'text-gray-300'",
   "esSelected ? 'text-orange-600' : 'text-stone-600'"],
  ['<span className="text-xs text-gray-400 text-center">{g > 0',
   '<span className="text-xs text-stone-500 text-center">{g > 0'],
  ['<span className="text-xs text-gray-400 text-center">{c || \'—\'}</span>',
   '<span className="text-xs text-stone-500 text-center">{c || \'—\'}</span>'],
  ["'text-gray-6'", "'text-stone-300'"],
  ['text-gray-600`}>', 'text-stone-300`}>'],
  ['<p className="text-gray-700 text-[10px] mt-1 text-center">Tocá una fila para ver el detalle de ese mes</p>',
   '<p className="text-stone-400 text-[10px] mt-1 text-center">Tocá una fila para ver el detalle de ese mes</p>'],
  ['className="grid grid-cols-5 gap-1 px-3 py-2 border-b border-gray-700"',
   'className="grid grid-cols-5 gap-1 px-3 py-2 border-b border-stone-100 bg-stone-50"'],
  ['<span key={h} className="text-gray-600 text-[10px] font-bold uppercase text-center">',
   '<span key={h} className="text-stone-400 text-[10px] font-bold uppercase text-center">'],

  // vs anterior section
  ['<span className="text-gray-400 text-sm">{label}</span>',
   '<span className="text-stone-500 text-sm">{label}</span>'],
  ['<span className="text-white text-sm font-medium">{raw ? curr : $$(curr)}</span>',
   '<span className="text-stone-800 text-sm font-medium">{raw ? curr : $$(curr)}</span>'],

  // breakeven labels
  ['<p className="text-gray-600 text-[10px]">necesarias</p>', '<p className="text-stone-400 text-[10px]">necesarias</p>'],
  ['<p className="text-gray-600 text-[10px]">realizadas</p>', '<p className="text-stone-400 text-[10px]">realizadas</p>'],
  ['<p className="text-gray-600 text-[10px]">superado</p>', '<p className="text-stone-400 text-[10px]">superado</p>'],
  ['<p className="text-gray-600 text-[10px]">{breakEven.faltan === 0 ? \'superado\' : \'faltan\'}</p>',
   '<p className="text-stone-400 text-[10px]">{breakEven.faltan === 0 ? \'superado\' : \'faltan\'}</p>'],
  ['<span className="text-gray-400 text-xs">Progreso ({actual.sesiones}/{breakEven.sesionesNecesarias} ses.)</span>',
   '<span className="text-stone-400 text-xs">Progreso ({actual.sesiones}/{breakEven.sesionesNecesarias} ses.)</span>'],

  // KPI section labels
  ['<p className="text-gray-400 text-[10px] font-bold uppercase tracking-widest mb-3">',
   '<p className="text-stone-500 text-[10px] font-bold uppercase tracking-widest mb-3">'],
  ['<p className="text-gray-400 text-xs mb-3 font-medium uppercase tracking-wide">',
   '<p className="text-stone-400 text-xs mb-3 font-medium uppercase tracking-wide">'],
  ['<p className="text-gray-500 text-xs mb-1">Ganancia acum.</p>',
   '<p className="text-stone-400 text-xs mb-1">Ganancia acum.</p>'],
  ['<p className="text-gray-500 text-xs mb-1">Reservar</p>',
   '<p className="text-stone-400 text-xs mb-1">Reservar</p>'],
  ['<p className="text-gray-500 text-xs mb-1">Cash libre</p>',
   '<p className="text-stone-400 text-xs mb-1">Cash libre</p>'],
  ['<p className="text-gray-600 text-[9px] mt-0.5">acum. 2026</p>',
   '<p className="text-stone-400 text-[9px] mt-0.5">acum. 2026</p>'],
  ['<p className="text-gray-600 text-[9px] mt-0.5">{financialKPIs.sesionesPendientesTotal} ses. × $500</p>',
   '<p className="text-stone-400 text-[9px] mt-0.5">{financialKPIs.sesionesPendientesTotal} ses. × $500</p>'],
  ['<p className="text-gray-600 text-[9px] mt-0.5">después reserva</p>',
   '<p className="text-stone-400 text-[9px] mt-0.5">después reserva</p>'],
  ['<p className="text-gray-500 text-[10px] mb-1">Gastos + Terapeutas</p>',
   '<p className="text-stone-400 text-[10px] mb-1">Gastos + Terapeutas</p>'],
  ['<p className="text-gray-500 text-[10px] mb-1">Comisiones</p>',
   '<p className="text-stone-400 text-[10px] mb-1">Comisiones</p>'],
  ['<p className="text-gray-500 text-[10px] mb-1">Margen bruto</p>',
   '<p className="text-stone-400 text-[10px] mb-1">Margen bruto</p>'],
  ['<p className="text-gray-600 text-[10px]">{actual.ingresos > 0 ? `${(((actual.gastos + actual.terapeutas) / actual.ingresos) * 100).toFixed(0)}% de ingresos` : \'—\'}</p>',
   '<p className="text-stone-400 text-[10px]">{actual.ingresos > 0 ? `${(((actual.gastos + actual.terapeutas) / actual.ingresos) * 100).toFixed(0)}% de ingresos` : \'—\'}</p>'],
  ['<p className="text-gray-600 text-[10px]">Neto {$$(actual.ingresosNetos)}</p>',
   '<p className="text-stone-400 text-[10px]">Neto {$$(actual.ingresosNetos)}</p>'],
  ['<p className="text-gray-600 text-[10px]">{financialKPIs.margenBrutoRatio.toFixed(0)}% antes de gastos fijos</p>',
   '<p className="text-stone-400 text-[10px]">{financialKPIs.margenBrutoRatio.toFixed(0)}% antes de gastos fijos</p>'],

  // renovaciones
  ['<p className="text-gray-500 text-xs mt-1">Clientes nuevos</p>', '<p className="text-stone-400 text-xs mt-1">Clientes nuevos</p>'],
  ['<p className="text-gray-500 text-xs mt-1">Renovaciones</p>', '<p className="text-stone-400 text-xs mt-1">Renovaciones</p>'],
  ['<span className="text-gray-400 text-xs">Tasa de renovación</span>', '<span className="text-stone-400 text-xs">Tasa de renovación</span>'],
  ['<span className="text-gray-400 text-xs">Acumulado 2026 — Nuevos / Renovaciones</span>',
   '<span className="text-stone-400 text-xs">Acumulado 2026 — Nuevos / Renovaciones</span>'],
  ['<span className="text-white font-bold text-xs">{renovaciones.nuevosAnio} / {renovaciones.renAnio}</span>',
   '<span className="text-stone-800 font-bold text-xs">{renovaciones.nuevosAnio} / {renovaciones.renAnio}</span>'],

  // deuda warning
  ['<p className="text-gray-400 text-xs">', '<p className="text-stone-500 text-xs">'],
  ['<p className="text-amber-400/80 text-xs">', '<p className="text-amber-600 text-xs">'],
  ['<p className="text-gray-500 text-[10px] mt-1">sesiones vendidas<br/>sin dar aún</p>',
   '<p className="text-stone-400 text-[10px] mt-1">sesiones vendidas<br/>sin dar aún</p>'],
  ['<p className="text-gray-500 text-[10px] mt-1">reservar para<br/>terapeutas</p>',
   '<p className="text-stone-400 text-[10px] mt-1">reservar para<br/>terapeutas</p>'],
  ['<p className="text-gray-500 text-[10px] mt-1">clientes con<br/>saldo disponible</p>',
   '<p className="text-stone-400 text-[10px] mt-1">clientes con<br/>saldo disponible</p>'],

  // desglose sesión
  ['<span className="text-gray-500 text-[10px] w-36 shrink-0">', '<span className="text-stone-400 text-[10px] w-36 shrink-0">'],

  // conclusiones tab
  ['<p className="text-white font-medium">Análisis automático</p>',
   '<p className="text-stone-800 font-medium">Análisis automático</p>'],
  ['<p className="text-gray-400 text-xs">Generado con tus datos actuales</p>',
   '<p className="text-stone-400 text-xs">Generado con tus datos actuales</p>'],
  ['<p className="text-white text-sm">{label}</p>\n                    <p className={`text-xs ${color}`}>{msg}</p>',
   '<p className="text-stone-800 text-sm">{label}</p>\n                    <p className={`text-xs ${color}`}>{msg}</p>'],
  ['<p className="text-white text-sm font-medium">{label}</p>',
   '<p className="text-stone-800 text-sm font-medium">{label}</p>'],
  ['<p className="text-gray-500 text-xs">{hint}</p>', '<p className="text-stone-400 text-xs">{hint}</p>'],

  // canales
  ['<span className="text-gray-300 font-medium">{origen}</span>',
   '<span className="text-stone-600 font-medium">{origen}</span>'],
  ['<span className="text-white">', '<span className="text-stone-800">'],
  ['<span className="text-green-400 ml-1">+{nuevos} este mes</span>',
   '<span className="text-emerald-600 ml-1">+{nuevos} este mes</span>'],
  ['bg-gray-700 rounded-full overflow-hidden">', 'bg-stone-100 rounded-full overflow-hidden">'],

  // red alert in equity section
  ['<p className="text-red-400 text-xs">⚠️', '<p className="text-red-500 text-xs">⚠️'],
]

let count = 0
reps.forEach(([from, to]) => {
  const prev = c
  c = c.split(from).join(to)
  if (c !== prev) count++
})

fs.writeFileSync(file, c)
console.log(`Done — applied ${count}/${reps.length} replacements`)
