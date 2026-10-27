// USD Flash Terminal — client (vanilla JS, zero dependencies)
// Hybrid: WebSocket (local Node server) or standalone static mode (GitHub Pages / Vercel).
'use strict';

/* ------------------------------------------------------------------ state */
const state = {
  socket: null,
  standalone: false,
  nextEvent: null,
  pinnedId: null,
  calendar: [],
  news: [],
  seenNewsIds: new Set(),
  newsPrimed: false,
  soundEnabled: true,
  voice: null,
  filter: 'all',
  apiKey: localStorage.getItem('massive_api_key') || '',
  lastTension: null,
};

const $ = (id) => document.getElementById(id);
const pad2 = (n) => String(n).padStart(2, '0');
const pad3 = (n) => String(n).padStart(3, '0');

// All remote strings go through this before reaching innerHTML.
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '#');
// Server texts may carry emoji status markers; the UI uses SVG/colour instead.
const stripEmoji = (s) => String(s || '').replace(/^[\u{1F300}-\u{1FAFF}\u2600-\u27BF]\uFE0F?\s*/u, '');
const PARIS = 'Europe/Paris';
// Intl formatters are expensive to build (~0.2 ms each): create once, reuse on every render.
const FMT = {
  time: new Intl.DateTimeFormat('fr-FR', { timeZone: PARIS, hour: '2-digit', minute: '2-digit' }),
  day: new Intl.DateTimeFormat('fr-FR', { timeZone: PARIS, weekday: 'short', day: '2-digit' }),
  dayLong: new Intl.DateTimeFormat('fr-FR', { timeZone: PARIS, weekday: 'short', day: '2-digit', month: 'short' }),
  ny: new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }),
};
const dash = (v) => (v && v !== '-' ? v : '--');
const polarityKey = (p) => (p === 'BULLISH' ? 'bull' : p === 'BEARISH' ? 'bear' : 'none');

function setChip(el, stateName, text) {
  if (!el) return;
  el.dataset.state = stateName;
  el.innerHTML = `<span class="chip-dot"></span><span>${esc(text)}</span>`;
}

/* ------------------------------------------------------------- squawk (C) */
const squawk = {
  speak(text) {
    if (!state.soundEnabled || !('speechSynthesis' in window)) return;
    try {
      const synth = window.speechSynthesis;
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.08;
      u.lang = 'en-US';
      const voice = state.voice || synth.getVoices().find((v) => v.lang === 'en-US') || synth.getVoices().find((v) => v.lang.startsWith('en'));
      if (voice) u.voice = voice;
      u.onstart = () => setSpeaking(true);
      u.onend = u.onerror = () => setSpeaking(synth.speaking && !synth.pending ? true : false);
      setSpeaking(true); // immediate feedback, before the engine warms up
      synth.speak(u);
    } catch (e) {
      setSpeaking(false);
      console.warn('[Squawk]', e);
    }
  },
  test() { this.speak('Squawk engine online. U S D news monitoring active.'); },
};

function setSpeaking(on) {
  $('btn-toggle-sound').dataset.speaking = on ? 'true' : 'false';
}

function setSound(on) {
  state.soundEnabled = on;
  const btn = $('btn-toggle-sound');
  btn.dataset.enabled = String(on);
  btn.setAttribute('aria-pressed', String(on));
  $('sound-label').textContent = on ? 'SQUAWK ON' : 'SQUAWK OFF';
  if (!on && 'speechSynthesis' in window) { window.speechSynthesis.cancel(); setSpeaking(false); }
}

/* ------------------------------------------------------------- transport */
function initConnection() {
  const isHttp = location.protocol.startsWith('http');
  const isNodeHost = location.port === '3000' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (isHttp && isNodeHost) connectWebSocket();
  else enableStandaloneMode();
}

let retryDelay = 1000;
let pingTimer = null;

function connectWebSocket() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${proto}//${location.host}/ws`);
  state.socket = ws;

  ws.onopen = () => {
    state.standalone = false;
    retryDelay = 1000;
    setChip($('ws-badge'), 'ok', 'WS REALTIME');
    setChip($('live-stream-badge'), 'ok', 'LIVE STREAM');
    $('live-stream-badge').firstElementChild.classList.add('live-dot');
    clearInterval(pingTimer);
    const ping = () => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ action: 'ping', clientTime: performance.now() }));
    ping();
    pingTimer = setInterval(ping, 3000);
  };

  ws.onmessage = (e) => {
    let data;
    try { data = JSON.parse(e.data); } catch (err) { console.error('[WS parse]', err); return; }
    handleServerMessage(data);
  };

  ws.onclose = () => {
    clearInterval(pingTimer);
    if (state.standalone) return;
    setChip($('ws-badge'), 'warn', 'WS RETRY…');
    setChip($('live-stream-badge'), 'warn', 'STREAM PAUSED');
    setTimeout(connectWebSocket, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 15000);
  };
}

function handleServerMessage(data) {
  switch (data.type) {
    case 'pong': {
      $('latency-val').textContent = Math.max(0, Math.round(performance.now() - data.clientTime));
      break;
    }
    case 'init':
      setChip($('massive-badge'), data.massiveConnected ? 'info' : 'warn', data.massiveConnected ? 'MASSIVE ONLINE' : 'MASSIVE: CLÉ ABSENTE');
      if (data.calendar) { state.calendar = data.calendar; renderCalendar(); }
      if (data.nextEvent) setHeroEvent(data.nextEvent);
      if (data.news) setNews(data.news);
      if (data.fedMacro) renderFedMacro(data.fedMacro);
      break;
    case 'calendar_update':
      if (data.calendar) { state.calendar = data.calendar; renderCalendar(); }
      if (data.nextEvent) setHeroEvent(data.nextEvent);
      break;
    case 'news_update':
      if (data.allNews) setNews(data.allNews);
      if (data.newArticles?.length) {
        const top = data.newArticles[0];
        if (top.isUSDRelevant) squawk.speak(`Breaking: ${String(top.title).slice(0, 90)}`);
      }
      break;
    case 'fed_macro_update':
      if (data.fedMacro) renderFedMacro(data.fedMacro);
      break;
    case 'flash_release':
      triggerFlashRelease(data.event);
      break;
  }
}

/* --------------------------------------------------------- standalone mode */
let directTimer = null;
function enableStandaloneMode() {
  if (state.standalone) return;
  state.standalone = true;
  setChip($('ws-badge'), 'info', 'CLIENT DIRECT');
  $('latency-val').textContent = '--';
  loadStaticCalendar();
  fetchDirectNews();
  clearInterval(directTimer);
  directTimer = setInterval(fetchDirectNews, 25000);
}

function loadStaticCalendar() {
  const tpl = [
    ['US Initial Jobless Claims', 'High', 2, '14:30', '218K', '221K'],
    ['US Non-Farm Payrolls (NFP)', 'High', 3, '14:30', '185K', '223K'],
    ['US Unemployment Rate', 'High', 3, '14:30', '4.1%', '4.1%'],
    ['US Average Hourly Earnings m/m', 'Medium', 3, '14:30', '0.3%', '0.4%'],
    ['US Consumer Price Index (CPI m/m)', 'High', 5, '14:30', '0.2%', '0.2%'],
    ['US Core CPI m/m', 'High', 5, '14:30', '0.3%', '0.3%'],
    ['US Retail Sales m/m', 'High', 6, '14:30', '0.4%', '0.1%'],
    ['US FOMC Rate Decision', 'High', 8, '20:00', '4.75%', '5.00%'],
  ];
  const now = new Date();
  state.calendar = tpl.map(([title, impact, off, time, forecast, previous], i) => {
    const d = new Date(now);
    d.setDate(now.getDate() + off);
    const [h, m] = time.split(':').map(Number);
    d.setHours(h, m, 0, 0);
    return { id: `evt-${i}`, title, impact, country: 'USD', date: d.toISOString(), timestamp: d.getTime(), forecast, previous, actual: '', polarity: 'NEUTRAL', surpriseText: '' };
  }).sort((a, b) => a.timestamp - b.timestamp);
  renderCalendar();
  setHeroEvent(state.calendar.find((e) => e.impact === 'High' && e.timestamp > Date.now()) || state.calendar[0]);
}

async function fetchDirectNews() {
  if (!state.apiKey) { setChip($('massive-badge'), 'warn', 'CLÉ MASSIVE REQUISE'); setChip($('live-stream-badge'), 'warn', 'STREAM OFF'); renderNews(); return; }
  try {
    const t0 = performance.now();
    const res = await fetch(`https://api.massive.com/v2/reference/news?order=desc&limit=15&apiKey=${encodeURIComponent(state.apiKey)}`);
    $('latency-val').textContent = Math.round(performance.now() - t0);
    if (!res.ok) { setChip($('massive-badge'), 'err', `MASSIVE HTTP ${res.status}`); return; }
    setChip($('massive-badge'), 'info', 'MASSIVE CONNECTÉ');
    setChip($('live-stream-badge'), 'ok', 'LIVE STREAM');
    const json = await res.json();
    setNews((json.results || []).map((it) => ({
      id: it.id, title: it.title, publishedUtc: it.published_utc, publisher: it.publisher?.name || 'Wire',
      articleUrl: it.article_url, tickers: it.tickers || [], keywords: it.keywords || [], isUSDRelevant: true,
    })));
  } catch (err) {
    setChip($('massive-badge'), 'err', 'MASSIVE INJOIGNABLE');
    console.warn('[Direct news]', err);
  }
}

/* --------------------------------------------------------------- hero (A) */
function setHeroEvent(evt, { force = false } = {}) {
  if (!evt) return;
  // A user-pinned row wins over the server's "next event" until unpinned.
  if (state.pinnedId && !force) {
    const pinned = state.calendar.find((e) => e.id === state.pinnedId);
    if (pinned) evt = pinned;
  }
  state.nextEvent = evt;
  state.lastTension = null;
  $('sim-badge').dataset.on = String(String(evt.id || '').startsWith('sim-'));

  $('hero-title').textContent = evt.title;
  $('hero-title').title = evt.title;
  $('hero-forecast').textContent = dash(evt.forecast);
    $('hero-previous').textContent = dash(evt.previous);

  const d = new Date(evt.timestamp || evt.date);
  $('hero-date').textContent =
    `${FMT.dayLong.format(d)} · ${FMT.time.format(d)} Paris · ${FMT.ny.format(d)} NY` +
    (state.pinnedId ? ' · ÉPINGLÉ' : '');

  renderHeroResult(evt);
}

function renderHeroResult(evt) {
  const box = $('hero-actual-container');
  const pol = polarityKey(evt.polarity);
  const hasActual = Boolean(evt.actual);
  box.dataset.polarity = hasActual ? pol : 'none';
  $('hero-actual').textContent = hasActual ? evt.actual : '--';
  $('hero-actual').classList.toggle('text-ink-mute', !hasActual || pol === 'none');
  setChip($('hero-actual-badge'), hasActual ? (pol === 'bull' ? 'ok' : pol === 'bear' ? 'err' : 'info') : 'info', hasActual ? 'PUBLIÉ' : 'EN ATTENTE');

  const s = $('hero-surprise');
  if (hasActual) {
    const arrow = pol === 'bull'
      ? '<svg class="h-4 w-4 flex-none" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 2 15 13H1z"/></svg>'
      : pol === 'bear'
        ? '<svg class="h-4 w-4 flex-none" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 14 1 3h14z"/></svg>'
        : '';
    s.innerHTML = `${arrow}<span>${esc(stripEmoji(evt.surpriseText) || 'Publié')}</span>`;
    s.style.color = pol === 'bull' ? 'var(--color-bull)' : pol === 'bear' ? 'var(--color-bear)' : '';
    $('hero-signal-desc').textContent = pol === 'bull' ? 'Dollar haussier — écart favorable vs consensus' : pol === 'bear' ? 'Dollar baissier — écart défavorable vs consensus' : 'Conforme au consensus';
  } else {
    s.textContent = 'En attente de publication';
    s.style.color = '';
    $('hero-signal-desc').textContent = "Calcul d'écart automatique vs consensus";
  }
}

let flashTimer = null;
function restartAnimation(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth; // restart keyframes on back-to-back releases
  el.classList.add(cls);
}

function triggerFlashRelease(evt) {
  if (!evt) return;
  state.pinnedId = null;
  setHeroEvent(evt, { force: true });

  const pol = polarityKey(evt.polarity);
  const flash = $('screen-flash');
  const box = $('hero-actual-container');
  const hero = $('hero-event-card');

  if (pol !== 'none') {
    flash.dataset.polarity = pol;
    restartAnimation(flash, 'is-flashing');
    hero.dataset.polarity = pol;
  }
  restartAnimation(box, 'is-popping');
  $('hero-actual-time').textContent = `Reçu ${new Date().toISOString().slice(11, 23)}Z`;

  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    flash.classList.remove('is-flashing');
    hero.dataset.polarity = 'none';
  }, 3500);

  $('sr-live').textContent = `${evt.title} : actual ${evt.actual}, prévision ${evt.forecast}. ${pol === 'bull' ? 'Dollar haussier' : pol === 'bear' ? 'Dollar baissier' : ''}`;

  squawk.speak(evt.speechText || `Flash: ${evt.title}. Actual ${evt.actual} versus ${evt.forecast} forecast. ${pol === 'bull' ? 'Bullish Dollar' : 'Bearish Dollar'}.`);

  // Mirror into calendar if the event exists there
  const row = state.calendar.find((e) => e.title === evt.title && !e.actual);
  if (row) { Object.assign(row, { actual: evt.actual, polarity: evt.polarity, surpriseText: evt.surpriseText }); renderCalendar(); }
}

window.triggerSimulation = function (type) {
  if (state.socket && state.socket.readyState === WebSocket.OPEN) {
    state.socket.send(JSON.stringify({ action: 'simulate', eventType: type }));
    return;
  }
  const presets = {
    NFP_BEAT: ['US Non-Farm Payrolls (NFP)', '180K', '210K', '255K', 'BULLISH', 'BEAT / BULLISH USD (+75,000)', 'Flash Non Farm Payrolls actual 255K versus 180K forecast. Massive beat. Bullish Dollar.'],
    NFP_MISS: ['US Non-Farm Payrolls (NFP)', '185K', '220K', '120K', 'BEARISH', 'MISS / BEARISH USD (-65,000)', 'Flash Non Farm Payrolls actual 120K versus 185K forecast. Massive miss. Bearish Dollar.'],
    CPI_HOT: ['US Consumer Price Index (CPI m/m)', '0.2%', '0.2%', '0.5%', 'BULLISH', 'HOT CPI / HAWKISH FED (+0.3%)', 'Flash CPI month over month 0.5% versus 0.2% expected. Inflation hot. Bullish Dollar.'],
    CPI_COOL: ['US CPI Inflation Rate (y/y)', '2.7%', '2.8%', '2.4%', 'BEARISH', 'COOL CPI / DOVISH FED (-0.3%)', 'Flash CPI year over year 2.4% versus 2.7% expected. Cool inflation. Bearish Dollar.'],
  };
  const [title, forecast, previous, actual, polarity, surpriseText, speechText] = presets[type] || presets.NFP_BEAT;
  const now = Date.now();
  triggerFlashRelease({ id: `sim-${now}`, title, forecast, previous, actual, polarity, surpriseText, speechText, timestamp: now, date: new Date(now).toISOString(), impact: 'High' });
};

/* ---------------------------------------------------------- countdown (B) */
// rAF-driven, writes only when the text or tension tier changes.
let lastCountdownText = '';
function countdownFrame() {
  const evt = state.nextEvent;
  const el = $('hero-countdown');
  const wrap = $('countdown-wrap');
  if (evt) {
    const diff = (evt.timestamp || Date.parse(evt.date)) - Date.now();
    let text, tension;
    if (diff <= 0) {
      if (evt.actual) {
        const s = Math.min(Math.floor(-diff / 1000), 359999);
        text = `T+${pad2(Math.floor(s / 3600))}:${pad2(Math.floor((s % 3600) / 60))}:${pad2(s % 60)}`;
        tension = 'released';
      } else { text = '00:00:00.000'; tension = 'live'; }
    } else {
      const totalSec = Math.floor(diff / 1000);
      const h = Math.floor(totalSec / 3600);
      text = `${pad2(Math.min(h, 99))}:${pad2(Math.floor((totalSec % 3600) / 60))}:${pad2(totalSec % 60)}.${pad3(diff % 1000)}`;
      tension = diff < 10_000 ? 'critical' : diff < 60_000 ? 'warn' : 'idle';
    }
    if (text !== lastCountdownText) { el.textContent = text; lastCountdownText = text; }
    if (tension !== state.lastTension) {
      state.lastTension = tension;
      wrap.dataset.tension = tension;
      $('countdown-label').textContent = tension === 'released' ? 'Publié depuis' : 'Compte à rebours';
      const badge = $('release-badge');
      badge.dataset.on = String(tension === 'live');
      badge.setAttribute('aria-hidden', String(tension !== 'live'));
      if (tension === 'live') $('sr-live').textContent = `Publication en cours : ${evt.title}`;
    }
  }
  requestAnimationFrame(countdownFrame);
}

/* ------------------------------------------------------------------ clocks */
function runClocks() {
  const fmt = (tz) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const ny = fmt('America/New_York'), paris = fmt('Europe/Paris');
  const tick = () => {
    const now = new Date();
    $('clock-utc').textContent = now.toISOString().slice(11, 19);
    $('clock-ny').textContent = ny.format(now);
    $('clock-paris').textContent = paris.format(now);
    setTimeout(tick, 1000 - (Date.now() % 1000) + 5); // align on the second boundary
  };
  tick();
}

/* ---------------------------------------------------------- calendar (E) */
const impactBadge = (impact) => {
  if (impact === 'High') {
    return `<span class="inline-flex items-center gap-1.5 text-[10.5px] font-extrabold text-bear" title="Impact élevé">
      <svg class="h-2.5 w-2.5 overflow-visible" viewBox="0 0 10 10" aria-hidden="true"><circle class="impact-ring" cx="5" cy="5" r="3.2" fill="none" stroke="currentColor" stroke-width="1"/><circle cx="5" cy="5" r="3.2" fill="currentColor"/></svg>HIGH</span>`;
  }
  if (impact === 'Medium') {
    return `<span class="inline-flex items-center gap-1.5 text-[10.5px] font-bold text-warn" title="Impact moyen">
      <svg class="h-2.5 w-2.5" viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="3.2" fill="currentColor"/></svg>MED</span>`;
  }
  return `<span class="inline-flex items-center gap-1.5 text-[10.5px] font-semibold text-ink-mute" title="Impact faible">
    <svg class="h-2.5 w-2.5" viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="3" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>LOW</span>`;
};

function renderCalendar() {
  const tbody = $('calendar-tbody');
  const list = state.filter === 'high' ? state.calendar.filter((e) => e.impact === 'High') : state.calendar;
  $('calendar-count').textContent = `${list.length} évén.`;

  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="py-10 text-center text-ink-mute">Aucun événement pour ce filtre.</td></tr>';
    return;
  }
  const now = Date.now();
  const nextId = state.nextEvent?.id;
  tbody.innerHTML = list.map((e) => {
    const d = new Date(e.timestamp || e.date);
    const passed = (e.timestamp || d.getTime()) < now;
    const pol = polarityKey(e.polarity);
    const surprise = stripEmoji(e.surpriseText);
    return `<tr class="cal-row group cursor-pointer border-b border-line/60 transition-colors duration-100 hover:bg-slate-800/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-400"
        tabindex="0" data-id="${esc(e.id)}" data-polarity="${pol}" data-passed="${passed && !e.actual}" data-pinned="${e.id === nextId}"
        aria-label="${esc(e.title)}, ${esc(e.impact)} impact. Entrée pour afficher dans le panneau principal.">
      <td class="whitespace-nowrap px-2.5 py-1.5"><span class="num font-bold text-ink">${FMT.time.format(d)}</span>
        <span class="ml-1.5 text-[10.5px] text-ink-mute">${esc(FMT.day.format(d))}</span></td>
      <td class="whitespace-nowrap px-2 py-1.5">${impactBadge(e.impact)}</td>
      <td class="max-w-0 w-full px-2.5 py-1.5 font-sans text-[12.5px] font-medium text-ink">
        <div class="truncate" title="${esc(e.title)}">${esc(e.title)}</div>
        ${surprise ? `<div class="cal-actual truncate font-mono text-[10.5px] font-bold">${esc(surprise)}</div>` : ''}</td>
      <td class="cal-actual num whitespace-nowrap px-2.5 py-1.5 text-right font-extrabold ${e.actual ? '' : 'text-ink-mute'}">${esc(e.actual || '--')}</td>
      <td class="num whitespace-nowrap px-2.5 py-1.5 text-right text-ink-dim">${esc(dash(e.forecast))}</td>
      <td class="num whitespace-nowrap px-2.5 py-1.5 text-right text-ink-mute">${esc(dash(e.previous))}</td>
    </tr>`;
  }).join('');
}

function pinCalendarRow(id) {
  const evt = state.calendar.find((e) => e.id === id);
  if (!evt) return;
  state.pinnedId = state.pinnedId === id ? null : id; // second activation unpins
  setHeroEvent(state.pinnedId ? evt : (state.calendar.find((e) => e.impact === 'High' && e.timestamp > Date.now()) || evt), { force: true });
  renderCalendar();
}

/* --------------------------------------------------------------- wire (D) */
function setNews(items) {
  state.news = items || [];
  renderNews();
}

function renderNews() {
  const container = $('news-container');
  const q = ($('news-search').value || '').toLowerCase().trim();
  const list = q
    ? state.news.filter((it) => String(it.title).toLowerCase().includes(q)
        || (it.keywords || []).some((k) => String(k).toLowerCase().includes(q))
        || (it.tickers || []).some((t) => String(t).toLowerCase().includes(q)))
    : state.news;

  $('news-count').textContent = state.news.length;

  if (!list.length) {
    container.innerHTML = `<li class="py-10 text-center text-[12px] text-ink-mute">${q ? 'Aucune dépêche pour ce filtre.' : state.standalone && !state.apiKey ? 'Ajoutez une clé Massive dans les paramètres.' : 'En attente de dépêches…'}</li>`;
    return;
  }

  const primed = state.newsPrimed;
  container.innerHTML = list.map((it, i) => {
    const isNew = primed && !state.seenNewsIds.has(it.id);
    const t = it.publishedUtc ? new Date(it.publishedUtc).toISOString().slice(11, 19) : '--:--:--';
    const tickers = (it.tickers || []).slice(0, 4).map((tk) => `<span class="rounded bg-raise px-1 font-mono text-[10px] font-bold text-info">${esc(tk)}</span>`).join('');
    return `<li class="${isNew ? 'news-enter' : ''} relative overflow-hidden rounded-md border border-line bg-void transition-colors duration-150 hover:border-info/40" style="${isNew ? `animation-delay:${Math.min(i, 5) * 40}ms` : ''}">
      ${isNew ? '<span class="news-rail absolute inset-y-0 left-0 w-0.5 bg-info" aria-hidden="true"></span>' : ''}
      <a href="${esc(safeUrl(it.articleUrl))}" target="_blank" rel="noopener noreferrer" class="block cursor-pointer px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-400">
        <div class="mb-0.5 flex items-center justify-between gap-2 font-mono text-[10.5px]">
          <span class="truncate font-bold uppercase tracking-wider text-ink-dim">${esc(it.publisher)}</span>
          <span class="num flex-none text-ink-mute">${t} UTC</span>
        </div>
        <p class="line-clamp-2 text-[12.5px] font-semibold leading-snug text-ink">${esc(it.title)}</p>
        ${(it.isUSDRelevant || tickers) ? `<div class="mt-1.5 flex flex-wrap items-center gap-1">${it.isUSDRelevant ? '<span class="rounded border border-bull/30 bg-bull/10 px-1 font-mono text-[9.5px] font-bold text-bull">USD/MACRO</span>' : ''}${tickers}</div>` : ''}
      </a>
    </li>`;
  }).join('');

  state.news.forEach((it) => state.seenNewsIds.add(it.id));
  state.newsPrimed = true;
}

/* ------------------------------------------------------------------- fed */
function renderFedMacro(m) {
  if (!m) return;
  if (m.labor) {
    $('macro-unemployment').textContent = `${m.labor.unemployment_rate}%`;
    $('macro-participation').textContent = `${m.labor.labor_force_participation_rate}%`;
    $('macro-labor-date').textContent = `Référence Fed : ${m.labor.date}`;
  }
  if (m.inflation) {
    $('macro-cpi').textContent = `${m.inflation.cpi}`;
    $('macro-cpi-date').textContent = `Indice des prix : ${m.inflation.date}`;
  }
  if (m.yields) {
    $('macro-yield-1y').textContent = `${m.yields.yield_1_year}%`;
    $('macro-yield-5y').textContent = `${m.yields.yield_5_year}%`;
    $('macro-yield-10y').textContent = `${m.yields.yield_10_year}%`;
  }
}

/* ---------------------------------------------------------------- voices */
function populateVoiceList() {
  const select = $('select-squawk-voice');
  const voices = window.speechSynthesis.getVoices();
  const saved = localStorage.getItem('squawk_voice');
  select.innerHTML = '<option value="default">Voix par défaut du système</option>' +
    voices.map((v, i) => `<option value="${i}">${esc(v.name)} (${esc(v.lang)})</option>`).join('');
  if (saved) {
    const idx = voices.findIndex((v) => v.name === saved);
    if (idx >= 0) { select.value = String(idx); state.voice = voices[idx]; }
  }
}

/* ----------------------------------------------------------------- wiring */
function setTab(which) {
  const isNews = which === 'news';
  $('tab-btn-news').setAttribute('aria-selected', String(isNews));
  $('tab-btn-macro').setAttribute('aria-selected', String(!isNews));
  $('tab-content-news').hidden = !isNews;
  $('tab-content-macro').hidden = isNews;
}

function setFilter(f) {
  state.filter = f;
  $('filter-all').setAttribute('aria-pressed', String(f === 'all'));
  $('filter-high').setAttribute('aria-pressed', String(f === 'high'));
  renderCalendar();
}

document.addEventListener('DOMContentLoaded', () => {
  initConnection();
  requestAnimationFrame(countdownFrame);
  runClocks();

  if ('speechSynthesis' in window) {
    populateVoiceList();
    window.speechSynthesis.onvoiceschanged = populateVoiceList;
  }

  $('btn-toggle-sound').addEventListener('click', () => setSound(!state.soundEnabled));
  $('btn-test-audio').addEventListener('click', () => squawk.test());

  document.querySelectorAll('[data-sim]').forEach((b) => b.addEventListener('click', () => window.triggerSimulation(b.dataset.sim)));

  $('filter-all').addEventListener('click', () => setFilter('all'));
  $('filter-high').addEventListener('click', () => setFilter('high'));

  const tbody = $('calendar-tbody');
  tbody.addEventListener('click', (e) => { const r = e.target.closest('tr[data-id]'); if (r) pinCalendarRow(r.dataset.id); });
  tbody.addEventListener('keydown', (e) => {
    const r = e.target.closest('tr[data-id]');
    if (!r) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pinCalendarRow(r.dataset.id); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      (e.key === 'ArrowDown' ? r.nextElementSibling : r.previousElementSibling)?.focus();
    }
  });

  $('tab-btn-news').addEventListener('click', () => setTab('news'));
  $('tab-btn-macro').addEventListener('click', () => setTab('macro'));
  document.querySelector('[role="tablist"]').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const toMacro = $('tab-btn-news').getAttribute('aria-selected') === 'true';
      setTab(toMacro ? 'macro' : 'news');
      $(toMacro ? 'tab-btn-macro' : 'tab-btn-news').focus();
    }
  });

  let searchRaf = 0;
  $('news-search').addEventListener('input', () => { cancelAnimationFrame(searchRaf); searchRaf = requestAnimationFrame(renderNews); });

  // Settings dialog
  const modal = $('settings-modal');
  const inputKey = $('input-massive-key');
  if (state.apiKey) inputKey.value = state.apiKey;
  $('btn-open-settings').addEventListener('click', () => modal.showModal());
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.close('cancel'); });
  modal.addEventListener('close', () => {
    if (modal.returnValue !== 'save') { inputKey.value = state.apiKey; return; }
    const key = inputKey.value.trim();
    if (key) { localStorage.setItem('massive_api_key', key); state.apiKey = key; }
    const sel = $('select-squawk-voice');
    if ('speechSynthesis' in window && sel.value !== 'default') {
      state.voice = window.speechSynthesis.getVoices()[Number(sel.value)] || null;
      if (state.voice) localStorage.setItem('squawk_voice', state.voice.name);
    } else { state.voice = null; localStorage.removeItem('squawk_voice'); }
    if (state.standalone) fetchDirectNews();
  });

  // Keyboard shortcuts (ignored while typing)
  const sims = ['NFP_BEAT', 'NFP_MISS', 'CPI_HOT', 'CPI_COOL'];
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, select, textarea, dialog') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === '/') { e.preventDefault(); setTab('news'); $('news-search').focus(); }
    else if (e.key === 'm' || e.key === 'M') setSound(!state.soundEnabled);
    else if (/^[1-4]$/.test(e.key)) window.triggerSimulation(sims[Number(e.key) - 1]);
  });
});
