// USD Flash Terminal — Ultra Low-Latency Client Application (Hybrid Server / Standalone)

let socket = null;
let currentNextEvent = null;
let allCalendarEvents = [];
let allNewsItems = [];
let soundEnabled = true;
let selectedVoice = null;
let activeCalendarFilter = 'all';

// Load stored API key or voice preference
let storedApiKey = localStorage.getItem('massive_api_key') || '';
let isStandaloneMode = false;

// Audio Squawk Engine
const squawkEngine = {
  speak(text) {
    if (!soundEnabled || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.05;
      utterance.pitch = 1.0;
      utterance.lang = 'en-US';
      
      if (selectedVoice) {
        utterance.voice = selectedVoice;
      } else {
        const voices = window.speechSynthesis.getVoices();
        const preferred = voices.find(v => v.lang === 'en-US' || v.lang.startsWith('en'));
        if (preferred) utterance.voice = preferred;
      }

      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.warn('[Audio Squawk Error]', e);
    }
  },

  test() {
    this.speak('Squawk engine online. Ultra low latency USD news monitoring activated.');
  }
};

// WebSocket Setup with Fallback to Standalone Mode
function initConnection() {
  // If we are served over http(s) on a custom server, attempt WebSocket
  const isHttp = window.location.protocol.startsWith('http');
  const isLocalOrNode = window.location.port === '3000' || window.location.hostname === 'localhost';

  if (isHttp && isLocalOrNode) {
    connectWebSocket();
  } else {
    // Standalone mode for GitHub Pages or static host
    enableStandaloneMode();
  }
}

function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;
  
  socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    isStandaloneMode = false;
    document.getElementById('ws-badge').innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> WS REALTIME';
    document.getElementById('ws-badge').className = 'px-2.5 py-0.5 rounded-full bg-emerald-950/60 text-emerald-400 border border-emerald-800/40 flex items-center gap-1.5 font-medium';
    startPingLoop();
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleServerMessage(data);
    } catch (e) {
      console.error('[WS Parse Error]', e);
    }
  };

  socket.onclose = () => {
    // If local WS dropped, try reconnecting or fallback
    document.getElementById('ws-badge').innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span> WS RETRY...';
    document.getElementById('ws-badge').className = 'px-2.5 py-0.5 rounded-full bg-amber-950/60 text-amber-400 border border-amber-800/40 flex items-center gap-1.5 font-medium';
    setTimeout(connectWebSocket, 3000);
  };

  socket.onerror = () => {
    enableStandaloneMode();
  };
}

let pingInterval = null;
function startPingLoop() {
  if (pingInterval) clearInterval(pingInterval);
  pingInterval = setInterval(() => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ action: 'ping', clientTime: Date.now() }));
    }
  }, 3000);
}

function handleServerMessage(data) {
  switch (data.type) {
    case 'pong': {
      const rtt = Date.now() - data.clientTime;
      const el = document.getElementById('latency-val');
      if (el) el.textContent = rtt;
      break;
    }

    case 'init': {
      if (data.massiveConnected) {
        document.getElementById('massive-badge').innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-cyan-400"></span> MASSIVE ONLINE';
      } else {
        document.getElementById('massive-badge').innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span> MASSIVE CLOUD';
      }

      if (data.nextEvent) updateHeroEvent(data.nextEvent);
      if (data.calendar) {
        allCalendarEvents = data.calendar;
        renderCalendar();
      }
      if (data.news) {
        allNewsItems = data.news;
        renderNews();
      }
      if (data.fedMacro) {
        renderFedMacro(data.fedMacro);
      }
      break;
    }

    case 'calendar_update': {
      if (data.nextEvent) updateHeroEvent(data.nextEvent);
      if (data.calendar) {
        allCalendarEvents = data.calendar;
        renderCalendar();
      }
      break;
    }

    case 'news_update': {
      if (data.allNews) {
        allNewsItems = data.allNews;
        renderNews();
      }
      if (data.newArticles && data.newArticles.length > 0) {
        const top = data.newArticles[0];
        if (top.isUSDRelevant) {
          squawkEngine.speak(`Breaking: ${top.title.slice(0, 90)}`);
        }
      }
      break;
    }

    case 'fed_macro_update': {
      if (data.fedMacro) renderFedMacro(data.fedMacro);
      break;
    }

    case 'flash_release': {
      triggerFlashRelease(data.event);
      break;
    }
  }
}

// Standalone Mode (For GitHub Pages / Vercel Static)
async function enableStandaloneMode() {
  if (isStandaloneMode) return;
  isStandaloneMode = true;
  document.getElementById('ws-badge').innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-cyan-400"></span> CLIENT DIRECT';
  document.getElementById('latency-val').textContent = 'Direct';

  loadStaticCalendar();
  fetchDirectNews();
  setInterval(fetchDirectNews, 25000);
}

function loadStaticCalendar() {
  const defaultSchedule = [
    { title: 'US Non-Farm Payrolls (NFP)', impact: 'High', dateOffset: 3, time: '14:30:00', forecast: '185K', previous: '223K' },
    { title: 'US Unemployment Rate', impact: 'High', dateOffset: 3, time: '14:30:00', forecast: '4.1%', previous: '4.1%' },
    { title: 'US Consumer Price Index (CPI m/m)', impact: 'High', dateOffset: 5, time: '14:30:00', forecast: '0.2%', previous: '0.2%' },
    { title: 'US Core CPI m/m', impact: 'High', dateOffset: 5, time: '14:30:00', forecast: '0.3%', previous: '0.3%' },
    { title: 'US FOMC Rate Decision', impact: 'High', dateOffset: 8, time: '20:00:00', forecast: '4.75%', previous: '5.00%' },
    { title: 'US Initial Jobless Claims', impact: 'High', dateOffset: 2, time: '14:30:00', forecast: '218K', previous: '221K' },
    { title: 'US Retail Sales m/m', impact: 'High', dateOffset: 6, time: '14:30:00', forecast: '0.4%', previous: '0.1%' }
  ];

  const now = new Date();
  allCalendarEvents = defaultSchedule.map((t, idx) => {
    const d = new Date(now);
    d.setDate(now.getDate() + t.dateOffset);
    const [h, m, s] = t.time.split(':').map(Number);
    d.setHours(h, m, s, 0);

    return {
      id: `evt-${idx}`,
      title: t.title,
      country: 'USD',
      date: d.toISOString(),
      timestamp: d.getTime(),
      impact: t.impact,
      forecast: t.forecast,
      previous: t.previous,
      actual: '',
      isPassed: false,
      surpriseText: 'En attente'
    };
  });

  if (allCalendarEvents.length > 0) {
    updateHeroEvent(allCalendarEvents[0]);
    renderCalendar();
  }
}

async function fetchDirectNews() {
  const key = storedApiKey || '';
  if (!key) {
    document.getElementById('massive-badge').innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span> CLE MASSIVE REQUISE';
    return;
  }

  try {
    const start = Date.now();
    const res = await fetch(`https://api.massive.com/v2/reference/news?order=desc&limit=12&apiKey=${key}`);
    const rtt = Date.now() - start;
    document.getElementById('latency-val').textContent = rtt;

    if (res.ok) {
      document.getElementById('massive-badge').innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-cyan-400"></span> MASSIVE CONNECTÉ';
      const json = await res.json();
      allNewsItems = (json.results || []).map(item => ({
        id: item.id,
        title: item.title,
        publishedUtc: item.published_utc,
        publisher: item.publisher?.name || 'Wire',
        articleUrl: item.article_url,
        tickers: item.tickers || [],
        keywords: item.keywords || [],
        isUSDRelevant: true
      }));
      renderNews();
    }
  } catch (err) {
    console.warn('[Direct News Fetch]', err);
  }
}

// Hero Flash Release Update & Animation
function updateHeroEvent(evt) {
  currentNextEvent = evt;
  document.getElementById('hero-title').textContent = evt.title;
  document.getElementById('hero-forecast').textContent = evt.forecast || '-';
  document.getElementById('hero-previous').textContent = evt.previous || '-';

  const dateObj = new Date(evt.timestamp || evt.date);
  document.getElementById('hero-date').textContent = `${dateObj.toLocaleDateString('fr-FR')} à ${dateObj.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} (Paris) / ${dateObj.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' })} (NY)`;

  const actualEl = document.getElementById('hero-actual');
  const surpriseEl = document.getElementById('hero-surprise');

  if (evt.actual) {
    actualEl.textContent = evt.actual;
    surpriseEl.textContent = evt.surpriseText || 'Publié';
  } else {
    actualEl.textContent = '--';
    actualEl.className = 'text-3xl font-black text-slate-400 font-mono mt-1 tracking-tight';
    surpriseEl.textContent = 'En attente de publication...';
    surpriseEl.className = 'text-sm font-bold text-slate-400 font-mono mt-1';
  }
}

function triggerFlashRelease(evt) {
  updateHeroEvent(evt);

  const heroCard = document.getElementById('hero-event-card');
  const actualContainer = document.getElementById('hero-actual-container');
  const actualEl = document.getElementById('hero-actual');
  const surpriseEl = document.getElementById('hero-surprise');
  const flashOverlay = document.getElementById('screen-flash');

  const isBullish = evt.polarity === 'BULLISH';
  const colorClass = isBullish ? 'text-[#00e676]' : 'text-[#ff1744]';
  const borderClass = isBullish ? 'glow-green' : 'glow-red';
  const screenFlashClass = isBullish ? 'screen-flash-green' : 'screen-flash-red';

  actualEl.className = `text-4xl font-black ${colorClass} font-mono mt-1 tracking-tight`;
  surpriseEl.className = `text-base font-black ${colorClass} font-mono mt-1`;

  // Flash border animations
  flashOverlay.className = `fixed inset-0 pointer-events-none z-50 border-0 ${screenFlashClass}`;
  heroCard.classList.add(borderClass);
  actualContainer.classList.add(borderClass);

  setTimeout(() => {
    flashOverlay.className = 'fixed inset-0 pointer-events-none z-50 border-0 transition-all duration-300';
    heroCard.classList.remove(borderClass);
    actualContainer.classList.remove(borderClass);
  }, 3500);

  // Audio Squawk
  const speech = evt.speechText || `Flash: ${evt.title}. Actual ${evt.actual} versus ${evt.forecast} forecast. ${isBullish ? 'Bullish Dollar' : 'Bearish Dollar'}.`;
  squawkEngine.speak(speech);
}

// Global Trigger for Testing Simulations
window.triggerSimulation = function(eventType) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ action: 'simulate', eventType }));
  } else {
    // Client-side simulation fallback
    const now = Date.now();
    let event = {
      title: 'US Non-Farm Payrolls (NFP)',
      date: new Date().toISOString(),
      timestamp: now,
      forecast: '180K',
      previous: '210K',
      actual: '255K',
      polarity: 'BULLISH',
      surpriseText: 'BEAT / BULLISH USD (+75,000)',
      speechText: 'Flash Non Farm Payrolls actual 255K versus 180K forecast. Massive beat. Bullish Dollar.'
    };

    if (eventType === 'NFP_MISS') {
      event.actual = '120K';
      event.polarity = 'BEARISH';
      event.surpriseText = 'MISS / BEARISH USD (-65,000)';
      event.speechText = 'Flash Non Farm Payrolls actual 120K versus 185K forecast. Massive miss. Bearish Dollar.';
    } else if (eventType === 'CPI_HOT') {
      event.title = 'US Consumer Price Index (CPI m/m)';
      event.forecast = '0.2%';
      event.actual = '0.5%';
      event.polarity = 'BULLISH';
      event.surpriseText = 'HOT CPI / HAWKISH FED (+0.3%)';
      event.speechText = 'Flash CPI month over month 0.5% versus 0.2% expected. Inflation hot. Bullish Dollar.';
    } else if (eventType === 'CPI_COOL') {
      event.title = 'US CPI Inflation Rate (y/y)';
      event.forecast = '2.7%';
      event.actual = '2.4%';
      event.polarity = 'BEARISH';
      event.surpriseText = 'COOL CPI / DOVISH FED (-0.3%)';
      event.speechText = 'Flash CPI year over year 2.4% versus 2.7% expected. Cool inflation. Bearish Dollar.';
    }

    triggerFlashRelease(event);
  }
};

// Countdown Timer Engine
function runCountdownLoop() {
  setInterval(() => {
    if (!currentNextEvent) return;
    const now = Date.now();
    const diff = currentNextEvent.timestamp - now;
    const countdownEl = document.getElementById('hero-countdown');

    if (diff <= 0) {
      if (!currentNextEvent.actual) {
        countdownEl.textContent = '00:00:00.00 [EN COURS]';
        countdownEl.className = 'text-xl sm:text-2xl font-black font-mono text-[#00e676] animate-pulse';
      } else {
        countdownEl.textContent = 'PUBLIÉ (00:00:00)';
        countdownEl.className = 'text-2xl font-black font-mono text-slate-400';
      }
      return;
    }

    const totalSeconds = Math.floor(diff / 1000);
    const ms = Math.floor((diff % 1000) / 10);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const pad = (n) => String(n).padStart(2, '0');
    countdownEl.textContent = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(ms)}`;
    countdownEl.className = 'text-2xl sm:text-3xl font-black font-mono text-[#00e5ff] tabular-nums tracking-wider';
  }, 60);
}

// World Clocks Loop
function runClocksLoop() {
  setInterval(() => {
    const now = new Date();
    const utcStr = now.toISOString().slice(11, 19);
    const nyStr = now.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false });

    document.getElementById('clock-utc').textContent = utcStr;
    document.getElementById('clock-ny').textContent = nyStr;
  }, 500);
}

// Calendar Rendering (With SVG Icons per UI/UX Pro Max rules)
function renderCalendar() {
  const tbody = document.getElementById('calendar-tbody');
  const countBadge = document.getElementById('calendar-count');
  if (!tbody) return;

  const filtered = activeCalendarFilter === 'high' 
    ? allCalendarEvents.filter(e => e.impact === 'High')
    : allCalendarEvents;

  countBadge.textContent = `${filtered.length} événements`;

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="py-8 text-center text-[#64748b]">Aucun événement correspondant.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(evt => {
    const dateObj = new Date(evt.timestamp || evt.date);
    const timeStr = dateObj.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    const dayStr = dateObj.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });

    let impactBadge = `
      <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-slate-800 text-slate-400 border border-slate-700">
        <span class="w-1.5 h-1.5 rounded-full bg-slate-400"></span> LOW
      </span>
    `;

    if (evt.impact === 'High') {
      impactBadge = `
        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-rose-950/70 text-rose-300 font-extrabold border border-rose-800/60">
          <span class="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse"></span> HIGH
        </span>
      `;
    } else if (evt.impact === 'Medium') {
      impactBadge = `
        <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-amber-950/70 text-amber-300 font-bold border border-amber-800/60">
          <span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span> MED
        </span>
      `;
    }

    let actualClass = 'text-slate-300 font-bold';
    if (evt.polarity === 'BULLISH') actualClass = 'text-[#00e676] font-black bg-emerald-950/60 px-1 rounded border border-emerald-800/40';
    else if (evt.polarity === 'BEARISH') actualClass = 'text-[#ff1744] font-black bg-rose-950/60 px-1 rounded border border-rose-800/40';

    return `
      <tr class="hover:bg-[#131924]/60 transition-colors">
        <td class="py-2.5 px-3 text-[#94a3b8] whitespace-nowrap">
          <div class="font-bold text-white">${timeStr}</div>
          <div class="text-[10px] text-[#64748b]">${dayStr}</div>
        </td>
        <td class="py-2.5 px-2 whitespace-nowrap">${impactBadge}</td>
        <td class="py-2.5 px-3 text-white font-medium">
          <div>${evt.title}</div>
          ${evt.surpriseText ? `<div class="text-[10px] text-[#00e5ff] font-bold mt-0.5">${evt.surpriseText}</div>` : ''}
        </td>
        <td class="py-2.5 px-3 text-right ${actualClass} whitespace-nowrap">${evt.actual || '--'}</td>
        <td class="py-2.5 px-3 text-right text-slate-300 whitespace-nowrap">${evt.forecast || '-'}</td>
        <td class="py-2.5 px-3 text-right text-slate-500 whitespace-nowrap">${evt.previous || '-'}</td>
      </tr>
    `;
  }).join('');
}

// News Rendering (With clean SVG indicators)
function renderNews() {
  const container = document.getElementById('news-container');
  const searchInput = document.getElementById('news-search');
  const filterVal = (searchInput?.value || '').toLowerCase().trim();

  let list = allNewsItems;
  if (filterVal) {
    list = list.filter(item => 
      item.title.toLowerCase().includes(filterVal) || 
      (item.keywords || []).some(k => k.toLowerCase().includes(filterVal)) ||
      (item.tickers || []).some(t => t.toLowerCase().includes(filterVal))
    );
  }

  if (list.length === 0) {
    container.innerHTML = '<div class="text-center py-8 text-xs text-[#64748b]">Aucune dépêche trouvée.</div>';
    return;
  }

  container.innerHTML = list.map(item => {
    const timeStr = item.publishedUtc ? new Date(item.publishedUtc).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--:--';
    const tickerBadges = (item.tickers || []).slice(0, 3).map(t => `<span class="bg-[#1b2333] text-cyan-300 px-1 rounded text-[10px] font-mono font-bold">${t}</span>`).join(' ');
    
    return `
      <div class="bg-[#070a0f] border border-[#1b2333] hover:border-[#00e5ff]/50 p-3 rounded-lg transition-all duration-200">
        <div class="flex items-center justify-between text-[10px] text-[#64748b] font-mono mb-1">
          <span class="text-slate-300 font-bold uppercase tracking-wider">${item.publisher}</span>
          <span>${timeStr} UTC</span>
        </div>
        <a href="${item.articleUrl || '#'}" target="_blank" rel="noopener noreferrer" class="cursor-pointer text-xs font-semibold text-slate-100 hover:text-[#00e5ff] line-clamp-2 transition-colors flex items-start gap-1">
          <span>${item.title}</span>
          <svg class="w-3 h-3 text-[#64748b] flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
            <polyline points="15 3 21 3 21 9"></polyline>
            <line x1="10" y1="14" x2="21" y2="3"></line>
          </svg>
        </a>
        <div class="flex items-center gap-1.5 mt-2 flex-wrap">
          ${item.isUSDRelevant ? '<span class="bg-emerald-950/80 text-emerald-300 border border-emerald-800 text-[9px] font-bold px-1.5 py-0.2 rounded font-mono">USD/MACRO</span>' : ''}
          ${tickerBadges}
        </div>
      </div>
    `;
  }).join('');
}

// Fed Macro Rendering
function renderFedMacro(macro) {
  if (!macro) return;
  if (macro.labor) {
    document.getElementById('macro-unemployment').textContent = `${macro.labor.unemployment_rate}%`;
    document.getElementById('macro-participation').textContent = `${macro.labor.labor_force_participation_rate}%`;
    document.getElementById('macro-labor-date').textContent = `Date de référence Fed: ${macro.labor.date}`;
  }
  if (macro.inflation) {
    document.getElementById('macro-cpi').textContent = `${macro.inflation.cpi}`;
    document.getElementById('macro-cpi-date').textContent = `Indice des prix à la consommation: ${macro.inflation.date}`;
  }
  if (macro.yields) {
    document.getElementById('macro-yield-1y').textContent = `${macro.yields.yield_1_year}%`;
    document.getElementById('macro-yield-5y').textContent = `${macro.yields.yield_5_year}%`;
    document.getElementById('macro-yield-10y').textContent = `${macro.yields.yield_10_year}%`;
  }
}

// Voices loader for Audio Squawk
function populateVoiceList() {
  if (!('speechSynthesis' in window)) return;
  const voices = window.speechSynthesis.getVoices();
  const select = document.getElementById('select-squawk-voice');
  if (!select) return;

  select.innerHTML = '<option value="default">Voix par défaut du système</option>';
  voices.forEach((voice, index) => {
    const opt = document.createElement('option');
    opt.value = index;
    opt.textContent = `${voice.name} (${voice.lang})`;
    select.appendChild(opt);
  });
}

// Event Listeners Setup
document.addEventListener('DOMContentLoaded', () => {
  initConnection();
  runCountdownLoop();
  runClocksLoop();

  if ('speechSynthesis' in window) {
    populateVoiceList();
    window.speechSynthesis.onvoiceschanged = populateVoiceList;
  }

  // Audio Toggle
  const toggleBtn = document.getElementById('btn-toggle-sound');
  const iconOn = document.getElementById('sound-icon-on');
  const iconOff = document.getElementById('sound-icon-off');
  const label = document.getElementById('sound-label');

  toggleBtn.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    if (soundEnabled) {
      iconOn.classList.remove('hidden');
      iconOff.classList.add('hidden');
      label.textContent = 'SQUAWK ON';
      toggleBtn.className = 'cursor-pointer flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-md bg-emerald-950/60 border border-emerald-800/60 text-emerald-400 hover:bg-emerald-900/60 transition-all duration-200 focus-visible:ring-2 focus-visible:ring-emerald-400 focus:outline-none';
    } else {
      iconOn.classList.add('hidden');
      iconOff.classList.remove('hidden');
      label.textContent = 'SQUAWK OFF';
      toggleBtn.className = 'cursor-pointer flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-md bg-slate-800/60 border border-slate-700 text-slate-400 hover:bg-slate-700/60 transition-all duration-200 focus-visible:ring-2 focus-visible:ring-slate-400 focus:outline-none';
    }
  });

  // Audio Test Button
  document.getElementById('btn-test-audio').addEventListener('click', () => {
    squawkEngine.test();
  });

  // Calendar Filter Buttons
  document.getElementById('filter-all').addEventListener('click', () => {
    activeCalendarFilter = 'all';
    document.getElementById('filter-all').className = 'cursor-pointer px-2.5 py-1 rounded bg-[#242f45] text-white font-bold transition-colors';
    document.getElementById('filter-high').className = 'cursor-pointer px-2.5 py-1 rounded bg-rose-950/40 border border-rose-800/40 text-rose-300 font-medium hover:bg-rose-900/60 transition-colors flex items-center gap-1';
    renderCalendar();
  });

  document.getElementById('filter-high').addEventListener('click', () => {
    activeCalendarFilter = 'high';
    document.getElementById('filter-high').className = 'cursor-pointer px-2.5 py-1 rounded bg-rose-800 text-white font-bold transition-colors flex items-center gap-1';
    document.getElementById('filter-all').className = 'cursor-pointer px-2.5 py-1 rounded bg-[#1b2333] text-[#94a3b8] font-medium hover:bg-[#242f45] transition-colors';
    renderCalendar();
  });

  // Tabs Switcher
  const btnNews = document.getElementById('tab-btn-news');
  const btnMacro = document.getElementById('tab-btn-macro');
  const contentNews = document.getElementById('tab-content-news');
  const contentMacro = document.getElementById('tab-content-macro');

  btnNews.addEventListener('click', () => {
    btnNews.className = 'cursor-pointer font-bold text-white border-b-2 border-[#00e5ff] pb-1 transition-colors flex items-center gap-1.5';
    btnMacro.className = 'cursor-pointer font-semibold text-[#94a3b8] hover:text-white pb-1 transition-colors flex items-center gap-1.5';
    contentNews.classList.remove('hidden');
    contentMacro.classList.add('hidden');
  });

  btnMacro.addEventListener('click', () => {
    btnMacro.className = 'cursor-pointer font-bold text-white border-b-2 border-[#00e5ff] pb-1 transition-colors flex items-center gap-1.5';
    btnNews.className = 'cursor-pointer font-semibold text-[#94a3b8] hover:text-white pb-1 transition-colors flex items-center gap-1.5';
    contentMacro.classList.remove('hidden');
    contentNews.classList.add('hidden');
  });

  // News Search
  document.getElementById('news-search').addEventListener('input', () => {
    renderNews();
  });

  // Settings Modal Controls
  const modal = document.getElementById('settings-modal');
  const inputKey = document.getElementById('input-massive-key');
  if (storedApiKey) inputKey.value = storedApiKey;

  document.getElementById('btn-open-settings').addEventListener('click', () => {
    modal.classList.remove('hidden');
  });

  document.getElementById('btn-close-settings').addEventListener('click', () => {
    modal.classList.add('hidden');
  });

  document.getElementById('btn-save-settings').addEventListener('click', () => {
    const key = inputKey.value.trim();
    if (key) {
      localStorage.setItem('massive_api_key', key);
      storedApiKey = key;
    }
    const voiceSelect = document.getElementById('select-squawk-voice');
    if (voiceSelect && voiceSelect.value !== 'default') {
      const voices = window.speechSynthesis.getVoices();
      selectedVoice = voices[Number(voiceSelect.value)] || null;
    }
    modal.classList.add('hidden');
    if (isStandaloneMode) fetchDirectNews();
  });
});
