import path from 'path';
import express from 'express';
import axios from 'axios';
import cors from 'cors';
import { fileURLToPath } from 'url';
import fs from 'fs';
import crypto from 'crypto';
import os from 'os';
import dns from 'dns';
import http from 'http';
import https from 'https';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const config = {
  port: process.env.PORT || 8080,
  password: process.env.PASSWORD || '',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  // 采集站响应普遍 2-10s，5s 太紧会把正常但偏慢的源判成超时
  timeout: parseInt(process.env.REQUEST_TIMEOUT || '12000'),
  maxRetries: parseInt(process.env.MAX_RETRIES || '2'),
  cacheMaxAge: process.env.CACHE_MAX_AGE || '1d',
  userAgent: process.env.USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  debug: process.env.DEBUG === 'true'
};

const log = (...args) => {
  if (config.debug) {
    console.log('[DEBUG]', ...args);
  }
};

/* ------------------------- DNS 兜底解析 -------------------------
 * 部分采集站域名被运营商/公共 DNS 投毒或拉黑，系统解析会返回 0.0.0.0 / :: 或直接 ENOENT
 * （浏览器因为默认开启「安全 DNS」所以打得开，Node 走系统 DNS 就失败），
 * 代理层表现为 500 / 请求失败。这里在系统解析不可用时回落到 DoH 再解析一次。
 */
const DOH_ENDPOINT = process.env.DOH_ENDPOINT || 'https://doh.pub/dns-query';
const DOH_CACHE_TTL = parseInt(process.env.DOH_CACHE_TTL || '300', 10) * 1000;
const dohCache = new Map(); // hostname -> { ips, expires }

function isUsableAddress(address) {
  return !!address && address !== '0.0.0.0' && address !== '::' && address !== '::1';
}

async function resolveViaDoh(hostname) {
  const now = Date.now();
  const cached = dohCache.get(hostname);
  if (cached && cached.expires > now) return cached.ips;

  const url = `${DOH_ENDPOINT}?name=${encodeURIComponent(hostname)}&type=A`;
  const response = await fetch(url, { headers: { accept: 'application/dns-json' } });
  if (!response.ok) throw new Error(`DoH 请求失败: ${response.status}`);

  const data = await response.json();
  const ips = (data.Answer || [])
    .filter((item) => item && item.type === 1 && isUsableAddress(item.data))
    .map((item) => item.data);

  if (ips.length) dohCache.set(hostname, { ips, expires: now + DOH_CACHE_TTL });
  return ips;
}

const systemLookup = dns.lookup;

function dohLookup(hostname, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }

  // Node 20+ 默认开启 autoSelectFamily，会以 all:true 调用 lookup，
  // 此时必须回数组；否则 net 层会报 “Invalid IP address: undefined”。
  const wantAll = !!(options && options.all);
  const wantFamily = options && (options.family === 4 || options.family === 6) ? options.family : 0;

  const finish = (error, list) => {
    if (error) return callback(error);
    const filtered = wantFamily ? list.filter((item) => item.family === wantFamily) : list;
    if (!filtered.length) return callback(new Error(`DNS 解析失败: ${hostname}`));
    if (wantAll) return callback(null, filtered);
    callback(null, filtered[0].address, filtered[0].family);
  };

  systemLookup(hostname, { all: true, family: 0 }, (err, addresses) => {
    const usable = (addresses || []).filter((item) => isUsableAddress(item.address));
    if (usable.length) return finish(null, usable);

    resolveViaDoh(hostname).then((ips) => {
      if (ips.length) return finish(null, ips.map((ip) => ({ address: ip, family: 4 })));
      finish(err || new Error(`DNS 解析失败: ${hostname}`));
    }).catch((dohError) => {
      log(`DoH 解析失败 ${hostname}: ${dohError.message}`);
      finish(err || dohError);
    });
  });
}

// 不复用连接：上游是 Cloudflare 背后的采集站，空闲连接常被对端 RST，
// 复用到坏连接会一直挂到超时（表现为偶发 12s 超时）。
const proxyHttpAgent = new http.Agent({ lookup: dohLookup });
const proxyHttpsAgent = new https.Agent({ lookup: dohLookup });

const app = express();

app.use(cors({
  origin: config.corsOrigin,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

function sha256Hash(input) {
  return new Promise((resolve) => {
    const hash = crypto.createHash('sha256');
    hash.update(input);
    resolve(hash.digest('hex'));
  });
}

async function renderPage(filePath, password) {
  let content = fs.readFileSync(filePath, 'utf8');
  if (password !== '') {
    const sha256 = await sha256Hash(password);
    content = content.replace('{{PASSWORD}}', sha256);
  } else {
    content = content.replace('{{PASSWORD}}', '');
  }
  return content;
}

app.get(['/', '/index.html', '/player.html'], async (req, res) => {
  try {
    let filePath;
    switch (req.path) {
      case '/player.html':
        filePath = path.join(__dirname, 'player.html');
        break;
      default: // '/' 和 '/index.html'
        filePath = path.join(__dirname, 'index.html');
        break;
    }
    
    const content = await renderPage(filePath, config.password);
    res.send(content);
  } catch (error) {
    console.error('页面渲染错误:', error);
    res.status(500).send('读取静态页面失败');
  }
});

app.get('/s=:keyword', async (req, res) => {
  try {
    const filePath = path.join(__dirname, 'index.html');
    const content = await renderPage(filePath, config.password);
    res.send(content);
  } catch (error) {
    console.error('搜索页面渲染错误:', error);
    res.status(500).send('读取静态页面失败');
  }
});

function isValidUrl(urlString) {
  try {
    const parsed = new URL(urlString);
    const allowedProtocols = ['http:', 'https:'];
    
    // 从环境变量获取阻止的主机名列表
    const blockedHostnames = (process.env.BLOCKED_HOSTS || 'localhost,127.0.0.1,0.0.0.0,::1').split(',');
    
    // 从环境变量获取阻止的 IP 前缀
    const blockedPrefixes = (process.env.BLOCKED_IP_PREFIXES || '192.168.,10.,172.').split(',');
    
    if (!allowedProtocols.includes(parsed.protocol)) return false;
    if (blockedHostnames.includes(parsed.hostname)) return false;
    
    for (const prefix of blockedPrefixes) {
      if (parsed.hostname.startsWith(prefix)) return false;
    }
    
    return true;
  } catch {
    return false;
  }
}

// 验证代理请求的鉴权
function validateProxyAuth(req) {
  const authHash = req.query.auth;
  const timestamp = req.query.t;
  
  // 获取服务器端密码哈希
  const serverPassword = config.password;
  if (!serverPassword) {
    console.error('服务器未设置 PASSWORD 环境变量，代理访问被拒绝');
    return false;
  }
  
  // 使用 crypto 模块计算 SHA-256 哈希
  const serverPasswordHash = crypto.createHash('sha256').update(serverPassword).digest('hex');
  
  if (!authHash || authHash !== serverPasswordHash) {
    console.warn('代理请求鉴权失败：密码哈希不匹配');
    console.warn(`期望: ${serverPasswordHash}, 收到: ${authHash}`);
    return false;
  }
  
  // 验证时间戳（10分钟有效期）
  if (timestamp) {
    const now = Date.now();
    const maxAge = 10 * 60 * 1000; // 10分钟
    if (now - parseInt(timestamp) > maxAge) {
      console.warn('代理请求鉴权失败：时间戳过期');
      return false;
    }
  }
  
  return true;
}

app.get('/proxy/:encodedUrl', async (req, res) => {
  try {
    // 验证鉴权
    if (!validateProxyAuth(req)) {
      return res.status(401).json({
        success: false,
        error: '代理访问未授权：请检查密码配置或鉴权参数'
      });
    }

    const encodedUrl = req.params.encodedUrl;
    // Express 可能已对路由参数解码一次；只在仍是 %3A 形式时再解码，避免把中文等二次解码
    const targetUrl = /^https?%3A/i.test(encodedUrl) ? decodeURIComponent(encodedUrl) : encodedUrl;

    // 安全验证
    if (!isValidUrl(targetUrl)) {
      return res.status(400).send('无效的 URL');
    }

    log(`代理请求: ${targetUrl}`);

    // 添加请求超时和重试逻辑
    const maxRetries = config.maxRetries;
    let retries = 0;
    
    const makeRequest = async () => {
      try {
        const target = new URL(targetUrl);
        const requestHeaders = {
          'User-Agent': config.userAgent
        };

        // 豆瓣接口与图片 CDN 都会校验 Referer，代理默认不带会被 403/418
        const isDouban = target.hostname === 'douban.com'
          || target.hostname.endsWith('.douban.com')
          || target.hostname === 'doubanio.com'
          || target.hostname.endsWith('.doubanio.com');
        if (isDouban) {
          requestHeaders['Referer'] = 'https://movie.douban.com/';
          requestHeaders['Accept'] = 'application/json, text/plain, */*';
        }

        return await axios({
          method: 'get',
          url: targetUrl,
          responseType: 'stream',
          timeout: config.timeout,
          headers: requestHeaders,
          // 系统 DNS 解析不出来时用 DoH 兜底（见 dohLookup）
          httpAgent: proxyHttpAgent,
          httpsAgent: proxyHttpsAgent,
          // 代理服务自身直连目标；避免系统 HTTP_PROXY（如本地代理软件）把 HTTPS 请求发错端口
          proxy: false
        });
      } catch (error) {
        // 超时重试没有意义：一次 12s 已经逼近前端 15s 的等待上限，
        // 再重试一次只会让前端先 abort，反而把所有慢源都判成超时。
        const isTimeout = error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT';
        if (!isTimeout && retries < maxRetries) {
          retries++;
          log(`重试请求 (${retries}/${maxRetries}): ${targetUrl}`);
          return makeRequest();
        }
        throw error;
      }
    };

    const response = await makeRequest();

    // 转发响应头（过滤敏感头）
    const headers = { ...response.headers };
    const sensitiveHeaders = (
      process.env.FILTERED_HEADERS || 
      'content-security-policy,cookie,set-cookie,x-frame-options,access-control-allow-origin'
    ).split(',');
    
    sensitiveHeaders.forEach(header => delete headers[header]);
    // axios 会自动解压 gzip/br，源站的 content-length 是压缩后的长度。若原样透传，
    // 客户端会按错误长度提前结束读取（表现为 HTML/JSON 被截断一半，分享页里的
    // `const url` 就拿不到了）。删掉这几个头，改由 Express 以 chunked 重新计算。
    ['content-length', 'content-encoding', 'transfer-encoding'].forEach(function (header) {
      delete headers[header];
    });
    res.set(headers);

    // 管道传输响应流
    response.data.pipe(res);
  } catch (error) {
    console.error('代理请求错误:', error.message);
    if (error.response) {
      res.status(error.response.status || 500);
      error.response.data.pipe(res);
    } else {
      res.status(500).send(`请求失败: ${error.message}`);
    }
  }
});

// 生产环境使用长效静态缓存；本地开发禁用缓存，避免改了 css/js 后浏览器仍加载旧文件
const staticMaxAge = process.env.NODE_ENV === 'production' ? config.cacheMaxAge : 0;

app.use(express.static(path.join(__dirname), {
  maxAge: staticMaxAge
}));

app.use((err, req, res, next) => {
  console.error('服务器错误:', err);
  res.status(500).send('服务器内部错误');
});

app.use((req, res) => {
  res.status(404).send('页面未找到');
});

// 获取本机局域网 IPv4 地址（用于手机等设备访问）
function getLocalIPv4Addresses() {
  const addresses = [];
  const interfaces = os.networkInterfaces();
  Object.keys(interfaces).forEach(name => {
    (interfaces[name] || []).forEach(net => {
      if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('169.254.')) {
        addresses.push(net.address);
      }
    });
  });
  return addresses;
}

// 启动服务器
app.listen(config.port, () => {
  console.log(`服务器运行在 http://localhost:${config.port}`);

  const lanAddresses = getLocalIPv4Addresses();
  if (lanAddresses.length > 0) {
    lanAddresses.forEach(address => {
      console.log(`局域网访问: http://${address}:${config.port}`);
    });
    console.log(`手机与电脑连同一网络后，用上面的地址访问；打不开请放行防火墙 ${config.port} 端口`);
  } else {
    console.log('未检测到局域网 IPv4 地址，手机访问请先检查网络连接');
  }

  if (config.password !== '') {
    console.log('用户登录密码已设置');
  } else {
    console.log('警告: 未设置 PASSWORD 环境变量，用户将被要求设置密码');
  }
  if (config.debug) {
    console.log('调试模式已启用');
    console.log('配置:', { ...config, password: config.password ? '******' : '' });
  }
});
