require('dotenv').config();
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const path = require('path');

const massiveClient = require('./src/massive-client');
const calendarService = require('./src/calendar-service');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

let cachedNews = [];
let cachedFedMacro = null;
let lastKnownNewsIds = new Set();

const fs = require('fs');

function logCrash(type, info) {
  const line = `[${new Date().toISOString()}] ${type}: ${info}\n`;
  try {
    fs.appendFileSync(path.join(__dirname, 'server.log'), line);
  } catch (e) {}
  console.error(line);
}

process.on('uncaughtException', (err) => {
  logCrash('uncaughtException', err.stack || err.message);
});
process.on('unhandledRejection', (reason) => {
  logCrash('unhandledRejection', reason instanceof Error ? reason.stack : String(reason));
});
process.on('exit', (code) => {
  logCrash('exit', `Process exiting with code: ${code}`);
});
process.on('SIGINT', () => logCrash('signal', 'SIGINT'));
process.on('SIGTERM', () => logCrash('signal', 'SIGTERM'));

server.on('error', (err) => {
  logCrash('server.error', err.stack || err.message);
});

wss.on('error', (err) => {
  logCrash('wss.error', err.stack || err.message);
});

function broadcast(payload) {
  try {
    const message = JSON.stringify(payload);
    wss.clients.forEach(client => {
      if (client.readyState === 1) { // OPEN
        client.send(message, () => {});
      }
    });
  } catch (err) {
    console.warn('[Broadcast error]', err.message);
  }
}

// Background sync routines
async function updateCalendar() {
  await calendarService.fetchCalendar();
  const nextEvent = calendarService.getNextHighImpactEvent();
  broadcast({
    type: 'calendar_update',
    calendar: calendarService.events,
    nextEvent
  });
}

async function updateMassiveNews() {
  if (!massiveClient.hasValidKey()) return;
  const result = await massiveClient.getNews(15);
  if (result.news && result.news.length > 0) {
    const freshArticles = [];
    result.news.forEach(item => {
      if (!lastKnownNewsIds.has(item.id)) {
        lastKnownNewsIds.add(item.id);
        freshArticles.push(item);
      }
    });

    cachedNews = result.news;

    if (freshArticles.length > 0) {
      broadcast({
        type: 'news_update',
        allNews: cachedNews,
        newArticles: freshArticles,
        latencyMs: result.latencyMs
      });
    }
  }
}

async function updateFedMacro() {
  if (!massiveClient.hasValidKey()) return;
  const data = await massiveClient.getFedMacro();
  if (data) {
    cachedFedMacro = data;
    broadcast({
      type: 'fed_macro_update',
      fedMacro: cachedFedMacro
    });
  }
}

// WebSocket connection lifecycle
wss.on('connection', async (ws) => {
  ws.on('error', (err) => {
    // Silently ignore client socket reset / aborts
  });

  const nextEvent = calendarService.getNextHighImpactEvent();
  
  // Send initial payload immediately
  ws.send(JSON.stringify({
    type: 'init',
    serverTime: Date.now(),
    massiveConnected: massiveClient.hasValidKey(),
    calendar: calendarService.events,
    nextEvent,
    news: cachedNews,
    fedMacro: cachedFedMacro
  }));

  ws.on('message', async (raw) => {
    try {
      const data = JSON.parse(raw);
      if (data.action === 'ping') {
        ws.send(JSON.stringify({
          type: 'pong',
          clientTime: data.clientTime,
          serverTime: Date.now()
        }));
      } else if (data.action === 'simulate') {
        const simEvent = calendarService.simulateRelease(data.eventType || 'NFP_BEAT');
        broadcast({
          type: 'flash_release',
          event: simEvent
        });
      } else if (data.action === 'refresh') {
        await updateCalendar();
        await updateMassiveNews();
      }
    } catch (e) {
      console.error('[WS Message Error]', e.message);
    }
  });
});

// REST Health Check & Diagnostics
app.get('/api/status', (req, res) => {
  res.json({
    status: 'online',
    massiveConnected: massiveClient.hasValidKey(),
    lastCalendarFetch: calendarService.lastFetched,
    totalEvents: calendarService.events.length,
    newsCached: cachedNews.length
  });
});

// Initialize on boot
async function init() {
  console.log('----------------------------------------------------');
  console.log('⚡ USD FLASH TERMINAL - High Reliability & Low Latency');
  console.log('⚡ Massive API Key detected:', massiveClient.hasValidKey() ? 'YES' : 'NO');
  console.log('----------------------------------------------------');

  await updateCalendar();
  if (massiveClient.hasValidKey()) {
    await updateMassiveNews();
    await updateFedMacro();
  }

  // Periodic polling loops with error boundaries
  setInterval(async () => {
    try { await updateCalendar(); } catch (e) { console.warn('[Calendar loop err]', e.message); }
  }, 20000);

  setInterval(async () => {
    try { await updateMassiveNews(); } catch (e) { console.warn('[News loop err]', e.message); }
  }, 18000);

  setInterval(async () => {
    try { await updateFedMacro(); } catch (e) { console.warn('[FedMacro loop err]', e.message); }
  }, 300000);

  server.listen(port, () => {
    console.log(`🚀 Terminal running on http://localhost:${port}`);
  });
}

init();
