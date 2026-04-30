import { mount, webjsx } from 'anentrypoint-design'
const h = webjsx.createElement

window.__debug = window.__debug || {}
window.__debug.dashboard = () => ({ booted: true, ts: Date.now(), framework: 'anentrypoint-design+webjsx', route: location.hash || '#/global' })

const j = async (u) => { try { const r = await fetch(u); if (!r.ok) throw new Error(r.status + ''); return await r.json() } catch (e) { return { __error: String(e) } } }

const ROUTES = [
  { path: '#/global', label: 'Global',  icon: '◉' },
  { path: '#/haiku',  label: 'Haiku',   icon: '◇' },
  { path: '#/sonnet', label: 'Sonnet',  icon: '◆' },
  { path: '#/opus',   label: 'Opus',    icon: '★' },
]
window.__debug.routes = () => ROUTES.map(r => r.path)

const State = { hash: location.hash || '#/global', body: null, ts: new Date().toLocaleTimeString(), data: null }
window.__debug.state = () => State

const fmt = (n) => Number(n || 0).toLocaleString()
const pct = (a, b) => b === 0 ? '0%' : ((a / b) * 100).toFixed(1) + '%'

function Panel(title, body) { return h('section', { class: 'panel' }, h('h3', {}, title), body) }
function pre(o) { return h('pre', { style: 'background:#0d0d0d;color:#ddd;padding:0.5rem;margin:0;font-size:12px;overflow:auto' }, typeof o === 'string' ? o : JSON.stringify(o, null, 2)) }
function kpi(items) {
  return h('div', { class: 'kpi' }, ...items.map(([n, l]) =>
    h('div', { class: 'kpi-card' }, h('div', { class: 'num' }, String(n)), h('div', { class: 'lbl' }, l))))
}
function table(headers, rows) {
  if (!rows || rows.length === 0) return h('p', { class: 'empty' }, 'no rows')
  return h('table', {},
    h('thead', {}, h('tr', {}, ...headers.map(c => h('th', {}, c)))),
    h('tbody', {}, ...rows.map(row => h('tr', {}, ...row.map(c => h('td', {}, c == null ? '' : String(c)))))))
}
function barRow(label, frac, valStr) {
  return h('div', { class: 'bar-row' },
    h('span', { class: 'lbl' }, label),
    h('div', { class: 'bar-bg' }, h('div', { class: 'bar-fill', style: 'width:' + Math.max(0, Math.min(1, frac)) * 100 + '%' })),
    h('span', { class: 'val' }, valStr))
}
function sparkline(vals, w = 320, hgt = 40) {
  if (!vals || vals.length < 2) return h('p', { class: 'empty' }, 'not enough data')
  const min = Math.min(...vals), max = Math.max(...vals), range = max - min || 1
  const stepX = w / (vals.length - 1)
  const pts = vals.map((v, i) => `${(i * stepX).toFixed(1)},${(hgt - ((v - min) / range) * (hgt - 4) - 2).toFixed(1)}`).join(' ')
  return h('svg', { class: 'spark', width: String(w), height: String(hgt), viewBox: `0 0 ${w} ${hgt}` },
    h('polyline', { fill: 'none', stroke: '#FFD700', 'stroke-width': '1.5', points: pts }))
}

async function pageGlobal() {
  const g = await j('/api/global')
  if (g.__error) return Panel('Error', h('p', { class: 'err' }, g.__error))
  const dailyVals = (g.daily || []).map(d => d.n)
  return h('div', { class: 'panels' },
    kpi([[fmt(g.total), 'Total responses'], [fmt(g.totalTok), 'Out tokens'], [(g.daily || []).length, 'Days']]),
    Panel('Daily activity (' + (g.daily || []).length + 'd)', sparkline(dailyVals, 600, 60)),
    Panel('Daily counts', table(['day', 'requests'], (g.daily || []).slice(-30).map(d => [d.day, fmt(d.n)]))))
}

async function pageFamily(fam) {
  const d = await j('/api/family/' + fam)
  if (d.__error) return Panel('Error', h('p', { class: 'err' }, d.__error))
  const typeMap = Object.fromEntries((d.typeCounts || []).map(t => [t.type, t.n]))
  const span = d.firstTs && d.lastTs ? ((d.lastTs - d.firstTs) / 86400000).toFixed(1) + 'd' : '?'

  const tokensPanel = Panel('Tokens', h('div', {},
    h('div', { class: 'kpi' },
      h('div', { class: 'kpi-card' }, h('div', { class: 'num' }, fmt(d.totalOut)), h('div', { class: 'lbl' }, 'out total')),
      h('div', { class: 'kpi-card' }, h('div', { class: 'num' }, (d.avgOut || 0).toFixed(0)), h('div', { class: 'lbl' }, 'avg out')),
      h('div', { class: 'kpi-card' }, h('div', { class: 'num' }, fmt(d.maxOut)), h('div', { class: 'lbl' }, 'max out')),
      h('div', { class: 'kpi-card' }, h('div', { class: 'num' }, fmt(d.totalIn)), h('div', { class: 'lbl' }, 'in total')),
      h('div', { class: 'kpi-card' }, h('div', { class: 'num' }, fmt(d.totalCR)), h('div', { class: 'lbl' }, 'cache read')),
      h('div', { class: 'kpi-card' }, h('div', { class: 'num' }, fmt(d.totalCC)), h('div', { class: 'lbl' }, 'cache create'))),
    h('div', { style: 'margin-top:0.6rem' }, barRow('cache hit', d.cacheHitRate || 0, ((d.cacheHitRate || 0) * 100).toFixed(1) + '%')),
    h('p', { style: 'color:#888;font-family:ui-monospace,monospace;font-size:0.78rem;margin:0.5rem 0 0' }, `${span} span · ${d.firstTs ? new Date(d.firstTs).toLocaleDateString() : '?'} → ${d.lastTs ? new Date(d.lastTs).toLocaleDateString() : '?'}`)))

  const stopPanel = Panel('Stop reasons', (d.stopReasons || []).length === 0
    ? h('p', { class: 'empty' }, 'none')
    : h('div', {}, ...(d.stopReasons || []).map(s =>
        barRow(s.reason || 'null', s.n / Math.max(d.total, 1), `${fmt(s.n)} (${pct(s.n, d.total)})`))))

  const modelsPanel = Panel('Model versions', table(
    ['model', 'reqs', 'avg out', 'first seen', 'last seen', 'active'],
    (d.models || []).map(m => [m.model, fmt(m.n), (m.avgOut || 0).toFixed(0), new Date(m.firstSeen).toLocaleDateString(), new Date(m.lastSeen).toLocaleDateString(), m.lastSeen === d.lastTs ? '●' : ''])))

  const dailyPanel = (d.daily || []).length >= 3
    ? Panel('Daily activity (' + d.daily.length + 'd)', h('div', {},
        h('div', { style: 'margin-bottom:0.4rem;color:#aaa;font-family:ui-monospace,monospace;font-size:0.78rem' }, 'requests'),
        sparkline(d.daily.map(x => x.n), 600, 50),
        h('div', { style: 'margin:0.6rem 0 0.4rem;color:#aaa;font-family:ui-monospace,monospace;font-size:0.78rem' }, 'tokens'),
        sparkline(d.daily.map(x => x.tokens), 600, 50)))
    : null

  function clusterPanel(label, cl, hist) {
    if (!cl) return Panel(label, h('p', { class: 'empty' }, 'no data yet'))
    const pkEntries = Object.entries(cl.pk || {}).sort(([a], [b]) => Number(a) - Number(b))
    return Panel(`${label} — k=${cl.k}  [${new Date(cl.updatedAt).toLocaleTimeString()}]`, h('div', {},
      h('div', { style: 'margin-bottom:0.5rem' },
        ...pkEntries.map(([k, v]) => h('span', { class: 'tag' + (v >= 0.5 ? ' active' : '') }, `P(k=${k})=${(v * 100).toFixed(0)}%`))),
      ...((cl.weights || []).map((w, i) => barRow('V' + (i + 1), w, (w * 100).toFixed(1) + '%'))),
      hist && hist.length > 1 ? h('p', { style: 'color:#888;font-family:ui-monospace,monospace;font-size:0.75rem;margin:0.6rem 0 0' }, 'k history: ' + hist.map(x => x.k).join(' → ')) : null))
  }

  return h('div', { class: 'panels' },
    kpi([
      [fmt(d.total), 'Responses'],
      [fmt(d.usable), 'Clusterable'],
      [fmt(typeMap.text || 0), 'Text'],
      [fmt(typeMap.tool_use || 0), 'Tool use'],
      [fmt(typeMap.mixed || 0), 'Mixed'],
    ]),
    tokensPanel,
    stopPanel,
    modelsPanel,
    dailyPanel,
    clusterPanel('Text clusters', d.cluster, d.kHistory),
    clusterPanel('Tool clusters', d.clusterTool, d.kHistoryTool))
}

const PAGES = {
  '#/global': pageGlobal,
  '#/haiku':  () => pageFamily('haiku'),
  '#/sonnet': () => pageFamily('sonnet'),
  '#/opus':   () => pageFamily('opus'),
}

function NavLink(item, active) {
  return h('a', { class: 'nav-link' + (active ? ' active' : ''), href: item.path },
    h('span', { class: 'nav-icon' }, item.icon),
    h('span', {}, item.label))
}

function render(state) {
  const route = ROUTES.find(r => r.path === state.hash) || ROUTES[0]
  return h('div', { class: 'shell' },
    h('aside', { class: 'sidebar' },
      h('h1', {}, '◈ AUDIT-CC'),
      ...ROUTES.map(r => NavLink(r, r.path === state.hash)),
      h('div', { class: 'sidebar-footer' }, 'webjsx · ' + ROUTES.length + ' routes')),
    h('div', { class: 'main-col' },
      h('div', { class: 'main' },
        h('div', { class: 'topbar' },
          h('h2', {}, route.label),
          h('span', { class: 'crumb' }, 'audit-cc-tail/' + route.path.replace('#/', ''))),
        state.body || h('p', { class: 'empty' }, 'loading…')),
      h('div', { class: 'statusbar' },
        h('span', {}, 'audit-cc-tail · ' + state.hash),
        h('span', {}, state.ts))))
}

let _mount

async function go() {
  State.hash = location.hash || '#/global'
  State.ts = new Date().toLocaleTimeString()
  State.body = h('p', { class: 'empty' }, 'loading…')
  if (_mount) _mount()
  const page = PAGES[State.hash] || PAGES['#/global']
  State.body = await page()
  State.ts = new Date().toLocaleTimeString()
  if (_mount) _mount()
  window.__debug.lastRoute = State.hash
}

function rerender() { State.ts = new Date().toLocaleTimeString(); if (_mount) _mount() }

window.addEventListener('hashchange', go)
_mount = mount(document.getElementById('app'), () => render(State))
go()
setInterval(go, 5000)

window.__debug.go = go
