const https = require('https');
const { execSync } = require('child_process');

class MassiveClient {
  constructor() {
    this.apiKey = this.resolveApiKey();
    this.baseUrl = 'https://api.massive.com';
    this.lastNewsId = null;
    this.rateLimitedUntil = 0;
  }

  resolveApiKey() {
    if (process.env.MASSIVE_API_KEY) {
      return process.env.MASSIVE_API_KEY.trim();
    }
    try {
      const machineKey = execSync('powershell -NoProfile -Command "[System.Environment]::GetEnvironmentVariable(\'MASSIVE_API_KEY\', \'Machine\')"', { encoding: 'utf-8' }).trim();
      if (machineKey) return machineKey;
      const userKey = execSync('powershell -NoProfile -Command "[System.Environment]::GetEnvironmentVariable(\'MASSIVE_API_KEY\', \'User\')"', { encoding: 'utf-8' }).trim();
      if (userKey) return userKey;
    } catch (err) {
      console.warn('[MassiveClient] Could not read Windows env vars:', err.message);
    }
    return null;
  }

  hasValidKey() {
    return Boolean(this.apiKey && this.apiKey.length >= 10);
  }

  async request(path) {
    if (!this.hasValidKey()) {
      return { data: { results: [] }, latencyMs: 0, status: 401 };
    }

    if (Date.now() < this.rateLimitedUntil) {
      return { data: { results: [] }, latencyMs: 0, status: 429 };
    }

    const url = new URL(path, this.baseUrl);
    return new Promise((resolve) => {
      const startTime = Date.now();
      const req = https.request({
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'User-Agent': 'MassiveUSDTrader/1.0',
          'Accept': 'application/json'
        },
        timeout: 6000
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          const latencyMs = Date.now() - startTime;
          if (!body || body.trim().length === 0) {
            resolve({ data: { results: [] }, latencyMs, status: res.statusCode });
            return;
          }
          try {
            const data = JSON.parse(body);
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve({ data, latencyMs, status: res.statusCode });
            } else if (res.statusCode === 429) {
              this.rateLimitedUntil = Date.now() + 35000;
              resolve({ data: { results: [] }, latencyMs, status: 429 });
            } else {
              resolve({ data: { results: [] }, latencyMs, status: res.statusCode });
            }
          } catch (e) {
            resolve({ data: { results: [] }, latencyMs, status: res.statusCode });
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ data: { results: [] }, latencyMs: 6000, status: 408 });
      });

      req.on('error', () => {
        resolve({ data: { results: [] }, latencyMs: 0, status: 500 });
      });
      req.end();
    });
  }

  async getNews(limit = 15) {
    try {
      const res = await this.request(`/v2/reference/news?order=desc&limit=${limit}`);
      const rawResults = res.data.results || [];
      const formatted = rawResults.map(item => {
        const isUSDRelevant = this.checkUSDRelevance(item);
        return {
          id: item.id,
          title: item.title,
          publishedUtc: item.published_utc,
          publisher: item.publisher?.name || 'Wire',
          publisherLogo: item.publisher?.logo_url,
          articleUrl: item.article_url,
          tickers: item.tickers || [],
          keywords: item.keywords || [],
          description: item.description,
          isUSDRelevant
        };
      });
      return { news: formatted, latencyMs: res.latencyMs };
    } catch (err) {
      console.error('[MassiveClient] getNews error:', err.message);
      return { news: [], error: err.message };
    }
  }

  checkUSDRelevance(item) {
    const text = `${item.title} ${item.description || ''} ${(item.keywords || []).join(' ')}`.toLowerCase();
    const usdKeywords = [
      'usd', 'dollar', 'fed', 'federal reserve', 'powell', 'inflation', 'cpi', 'pci',
      'nfp', 'payroll', 'jobs', 'unemployment', 'treasury', 'yield', 'yields', 'rates',
      'rate hike', 'rate cut', 'fomc', 'macro', 'economy', 'gdp', 'retail sales', 'debt'
    ];
    return usdKeywords.some(kw => text.includes(kw));
  }

  async getFedMacro() {
    try {
      const inflationRes = await this.request('/fed/v1/inflation');
      await new Promise(r => setTimeout(r, 500));
      const laborRes = await this.request('/fed/v1/labor-market');
      await new Promise(r => setTimeout(r, 500));
      const yieldRes = await this.request('/fed/v1/treasury-yields');

      const inflationData = inflationRes.data?.results || [];
      const laborData = laborRes.data?.results || [];
      const yieldData = yieldRes.data?.results || [];

      const latestInflation = inflationData.length > 0 ? inflationData[inflationData.length - 1] : null;
      const latestLabor = laborData.length > 0 ? laborData[laborData.length - 1] : null;
      const latestYield = yieldData.length > 0 ? yieldData[yieldData.length - 1] : null;

      return {
        inflation: latestInflation,
        labor: latestLabor,
        yields: latestYield,
        fetchedAt: new Date().toISOString()
      };
    } catch (err) {
      console.warn('[MassiveClient] getFedMacro error:', err.message);
      return null;
    }
  }
}

module.exports = new MassiveClient();
