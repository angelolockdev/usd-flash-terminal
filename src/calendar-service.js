const https = require('https');

class CalendarService {
  constructor() {
    this.events = this.generateDefaultUSDCalendar();
    this.lastFetched = null;
    this.simulatedRelease = null;
    this.cooldownUntil = 0;
  }

  generateDefaultUSDCalendar() {
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth();

    // Standard major USD macro releases
    const scheduleTemplates = [
      { title: 'US Non-Farm Payrolls (NFP)', impact: 'High', dayOffset: 3, time: '14:30:00', forecast: '185K', previous: '223K', unit: 'K' },
      { title: 'US Unemployment Rate', impact: 'High', dayOffset: 3, time: '14:30:00', forecast: '4.1%', previous: '4.1%', unit: '%' },
      { title: 'US Average Hourly Earnings m/m', impact: 'Medium', dayOffset: 3, time: '14:30:00', forecast: '0.3%', previous: '0.4%', unit: '%' },
      { title: 'US ISM Manufacturing PMI', impact: 'High', dayOffset: 1, time: '16:00:00', forecast: '49.2', previous: '47.2', unit: '' },
      { title: 'US JOLTS Job Openings', impact: 'High', dayOffset: 2, time: '16:00:00', forecast: '7.65M', previous: '7.74M', unit: 'M' },
      { title: 'US ADP Non-Farm Employment', impact: 'Medium', dayOffset: 2, time: '14:15:00', forecast: '142K', previous: '143K', unit: 'K' },
      { title: 'US Initial Jobless Claims', impact: 'High', dayOffset: 2, time: '14:30:00', forecast: '218K', previous: '221K', unit: 'K' },
      { title: 'US Consumer Price Index (CPI m/m)', impact: 'High', dayOffset: 5, time: '14:30:00', forecast: '0.2%', previous: '0.2%', unit: '%' },
      { title: 'US Core CPI m/m', impact: 'High', dayOffset: 5, time: '14:30:00', forecast: '0.3%', previous: '0.3%', unit: '%' },
      { title: 'US Retail Sales m/m', impact: 'High', dayOffset: 7, time: '14:30:00', forecast: '0.4%', previous: '0.1%', unit: '%' },
      { title: 'US FOMC Rate Decision & Statement', impact: 'High', dayOffset: 8, time: '20:00:00', forecast: '4.75%', previous: '5.00%', unit: '%' }
    ];

    return scheduleTemplates.map((t, idx) => {
      const evtDate = new Date(today);
      evtDate.setDate(today.getDate() + t.dayOffset);
      const [hours, minutes, seconds] = t.time.split(':').map(Number);
      evtDate.setHours(hours, minutes, seconds, 0);

      return {
        id: `usd-sched-${idx}-${t.title.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
        title: t.title,
        country: 'USD',
        date: evtDate.toISOString(),
        timestamp: evtDate.getTime(),
        impact: t.impact,
        forecast: t.forecast,
        previous: t.previous,
        actual: '',
        isPassed: evtDate < today,
        deviation: null,
        polarity: 'NEUTRAL',
        surpriseText: 'En attente'
      };
    }).sort((a, b) => a.timestamp - b.timestamp);
  }

  async fetchCalendar() {
    if (Date.now() < this.cooldownUntil) {
      return this.events;
    }

    return new Promise((resolve) => {
      const url = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
      const req = https.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)',
          'Accept': 'application/json, text/plain, */*'
        },
        timeout: 4000
      }, (res) => {
        if (res.statusCode === 429) {
          this.cooldownUntil = Date.now() + 120000; // 2 min cooldown on 429
          resolve(this.events);
          return;
        }

        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const list = JSON.parse(data);
            const parsed = this.processEvents(list);
            if (parsed && parsed.length > 0) {
              this.events = parsed;
              this.lastFetched = new Date().toISOString();
            }
            resolve(this.events);
          } catch (e) {
            resolve(this.events);
          }
        });
      });

      req.on('error', () => resolve(this.events));
      req.on('timeout', () => {
        req.destroy();
        resolve(this.events);
      });
    });
  }

  processEvents(rawList) {
    const now = new Date();
    return rawList
      .filter(item => item.country === 'USD')
      .map((item, index) => {
        const eventDate = new Date(item.date);
        const isPassed = eventDate < now;
        const analysis = this.analyzeDeviation(item.title, item.forecast, item.actual);

        return {
          id: `evt-${index}-${item.date}-${item.title.replace(/\s+/g, '-').toLowerCase()}`,
          title: item.title,
          country: item.country,
          date: item.date,
          timestamp: eventDate.getTime(),
          impact: item.impact || 'Low',
          forecast: item.forecast || '-',
          previous: item.previous || '-',
          actual: item.actual || '',
          isPassed,
          deviation: analysis.deviation,
          polarity: analysis.polarity,
          surpriseText: analysis.surpriseText
        };
      })
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  analyzeDeviation(title, forecastStr, actualStr) {
    if (!actualStr || !forecastStr) {
      return { deviation: null, polarity: 'NEUTRAL', surpriseText: '' };
    }

    const parseNum = (str) => {
      if (!str) return null;
      let clean = str.trim().replace(/,/g, '');
      let multiplier = 1;
      if (clean.endsWith('K') || clean.endsWith('k')) {
        multiplier = 1000;
        clean = clean.slice(0, -1);
      } else if (clean.endsWith('M') || clean.endsWith('m')) {
        multiplier = 1000000;
        clean = clean.slice(0, -1);
      } else if (clean.endsWith('B') || clean.endsWith('b')) {
        multiplier = 1000000000;
        clean = clean.slice(0, -1);
      } else if (clean.endsWith('%')) {
        clean = clean.slice(0, -1);
      }
      const val = parseFloat(clean);
      return isNaN(val) ? null : val * multiplier;
    };

    const actualVal = parseNum(actualStr);
    const forecastVal = parseNum(forecastStr);

    if (actualVal === null || forecastVal === null) {
      return { deviation: null, polarity: 'NEUTRAL', surpriseText: '' };
    }

    const diff = actualVal - forecastVal;
    const lowerTitle = title.toLowerCase();
    const isInverted = lowerTitle.includes('unemployment') || lowerTitle.includes('claims');

    let polarity = 'NEUTRAL';
    if (diff > 0) {
      polarity = isInverted ? 'BEARISH' : 'BULLISH';
    } else if (diff < 0) {
      polarity = isInverted ? 'BULLISH' : 'BEARISH';
    }

    const diffFormatted = diff > 0 ? `+${diff.toLocaleString()}` : `${diff.toLocaleString()}`;
    const surpriseText = `${polarity === 'BULLISH' ? '🟢 BEAT / BULLISH USD' : polarity === 'BEARISH' ? '🔴 MISS / BEARISH USD' : '⚪ IN LINE'} (${diffFormatted})`;

    return { deviation: diff, polarity, surpriseText };
  }

  getNextHighImpactEvent() {
    const now = Date.now();
    if (this.simulatedRelease && (now - this.simulatedRelease.timestamp < 120000)) {
      return this.simulatedRelease;
    }

    const upcomingHigh = this.events.find(e => e.impact === 'High' && e.timestamp > now);
    if (upcomingHigh) return upcomingHigh;

    const upcomingAny = this.events.find(e => e.timestamp > now);
    if (upcomingAny) return upcomingAny;

    return this.events[0];
  }

  simulateRelease(type = 'NFP_BEAT') {
    const now = Date.now();
    let event = {
      id: `sim-${now}`,
      country: 'USD',
      impact: 'High',
      date: new Date(now).toISOString(),
      timestamp: now,
      isPassed: true
    };

    if (type === 'NFP_BEAT') {
      event.title = 'US Non-Farm Payrolls (NFP)';
      event.forecast = '180K';
      event.previous = '210K';
      event.actual = '255K';
      event.deviation = 75000;
      event.polarity = 'BULLISH';
      event.surpriseText = '🟢 BEAT / BULLISH USD (+75,000)';
      event.speechText = 'Flash Non Farm Payrolls actual 255K versus 180K forecast. Massive beat. Bullish Dollar.';
    } else if (type === 'NFP_MISS') {
      event.title = 'US Non-Farm Payrolls (NFP)';
      event.forecast = '185K';
      event.previous = '220K';
      event.actual = '120K';
      event.deviation = -65000;
      event.polarity = 'BEARISH';
      event.surpriseText = '🔴 MISS / BEARISH USD (-65,000)';
      event.speechText = 'Flash Non Farm Payrolls actual 120K versus 185K forecast. Massive miss. Bearish Dollar.';
    } else if (type === 'CPI_HOT') {
      event.title = 'US Consumer Price Index (CPI m/m)';
      event.forecast = '0.2%';
      event.previous = '0.2%';
      event.actual = '0.5%';
      event.deviation = 0.3;
      event.polarity = 'BULLISH';
      event.surpriseText = '🟢 HOT CPI / HAWKISH FED (+0.3%)';
      event.speechText = 'Flash CPI month over month 0.5% versus 0.2% expected. Inflation hot. Bullish Dollar.';
    } else {
      event.title = 'US CPI Inflation Rate (y/y)';
      event.forecast = '2.7%';
      event.previous = '2.8%';
      event.actual = '2.4%';
      event.deviation = -0.3;
      event.polarity = 'BEARISH';
      event.surpriseText = '🔴 COOL CPI / DOVISH FED (-0.3%)';
      event.speechText = 'Flash CPI year over year 2.4% versus 2.7% expected. Cool inflation. Bearish Dollar.';
    }

    this.simulatedRelease = event;
    return event;
  }
}

module.exports = new CalendarService();
