/**
 * EdgeOne Makers 边缘函数版代理
 *
 * 路由（由目录结构生成）：/proxy/<encodeURIComponent(目标URL)>
 * 例如：/proxy/https%3A%2F%2Fexample.com%2Fplaylist.m3u8
 *
 * 与 Cloudflare 版的差异：
 * - 没有 KV 命名空间，改用 EdgeOne 注入的 caches（标准 Cache API）
 * - 没有 context.next，因此不做 HTML 改写，密码哈希由 /api/env.js 提供
 * - 上游 body 一律流式透传，只有文本才读取并重写 M3U8
 */

const CACHE_TTL = 86400; // 秒
const MAX_RECURSION = 5;
const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

export default async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders() });
    }

    const targetUrl = getTargetUrl(url);
    if (!targetUrl) {
        return jsonResponse({ success: false, error: '无效的代理请求。路径应为 /proxy/<经过编码的URL>' }, 400);
    }

    const password = env && env.PASSWORD;
    if (!password) {
        return jsonResponse({ success: false, error: '服务器未设置 PASSWORD 环境变量，代理访问被拒绝' }, 401);
    }

    const authHash = url.searchParams.get('auth');
    if (!authHash || authHash !== (await sha256Hex(password))) {
        return jsonResponse({ success: false, error: '代理访问未授权：请检查密码配置或鉴权参数' }, 401);
    }

    try {
        // 只对文本做缓存：媒体分片体积大且会破坏流式透传
        const cacheKey = buildCacheKey(url.origin, targetUrl);
        const cached = await cacheGet(cacheKey);
        if (cached) {
            const ct = cached.headers.get('content-type') || '';
            if (isTextLikeContent(ct, targetUrl)) {
                const text = await cached.text();
                return respondWithPlaylistOrText(targetUrl, text, ct);
            }
        }

        const { response: upstream, contentType } = await fetchTarget(targetUrl, request);

        if (!isTextLikeContent(contentType, targetUrl)) {
            return passthrough(upstream, contentType);
        }

        const text = await upstream.text();
        const result = await buildTextResponse(targetUrl, text, contentType);

        const cacheable = new Response(result.body, { status: 200, headers: result.headers });
        cacheable.headers.set('Cache-Control', `public, max-age=${CACHE_TTL}`);
        await cachePut(cacheKey, cacheable);

        return result;
    } catch (error) {
        return jsonResponse({ success: false, error: `代理处理错误: ${error.message}` }, 500);
    }
}

/* ------------------------------ 响应构造 ------------------------------ */

function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Max-Age': '86400'
    };
}

function jsonResponse(payload, status) {
    return new Response(JSON.stringify(payload), {
        status: status,
        headers: Object.assign({ 'Content-Type': 'application/json' }, corsHeaders())
    });
}

function passthrough(upstream, contentType) {
    const headers = new Headers(corsHeaders());
    if (contentType) headers.set('Content-Type', contentType);

    const cacheControl = upstream.headers.get('Cache-Control');
    headers.set('Cache-Control', cacheControl && cacheControl.trim() ? cacheControl : `public, max-age=${CACHE_TTL}`);

    // 不复制 content-length / content-encoding：body 已被运行时解压，原头会不匹配
    ['ETag', 'Last-Modified', 'Content-Language'].forEach(function (name) {
        const value = upstream.headers.get(name);
        if (value) headers.set(name, value);
    });

    return new Response(upstream.body, { status: 200, headers: headers });
}

/**
 * 文本内容统一出口：M3U8 重写，其它文本原样返回
 */
async function buildTextResponse(targetUrl, text, contentType) {
    if (isM3u8Content(text, contentType)) {
        const processed = await processM3u8(targetUrl, text, 0);
        return new Response(processed, {
            status: 200,
            headers: Object.assign({
                'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
                'Cache-Control': `public, max-age=${CACHE_TTL}`
            }, corsHeaders())
        });
    }

    return new Response(text, {
        status: 200,
        headers: Object.assign({ 'Cache-Control': `public, max-age=${CACHE_TTL}` }, corsHeaders())
    });
}

async function respondWithPlaylistOrText(targetUrl, text, contentType) {
    return buildTextResponse(targetUrl, text, contentType);
}

/* ------------------------------ 缓存 ------------------------------ */

function buildCacheKey(origin, targetUrl) {
    return `${origin}/__proxy_cache__/${encodeURIComponent(targetUrl)}`;
}

async function cacheGet(key) {
    try {
        if (typeof caches === 'undefined' || !caches.default) return null;
        return await caches.default.match(new Request(key));
    } catch (e) {
        return null;
    }
}

async function cachePut(key, response) {
    try {
        if (typeof caches === 'undefined' || !caches.default) return;
        await caches.default.put(new Request(key), response.clone());
    } catch (e) {
        // 缓存写入失败不影响响应
    }
}

/* ------------------------------ 工具 ------------------------------ */

async function sha256Hex(input) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
    return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
}

function getTargetUrl(url) {
    const marker = '/proxy/';
    const idx = url.pathname.indexOf(marker);

    if (idx === -1) {
        // 兼容 /proxy?url=<encoded>
        const direct = url.searchParams.get('url');
        return direct && /^https?:\/\//i.test(direct) ? direct : null;
    }

    const raw = url.pathname.slice(idx + marker.length);
    let decoded = raw;
    try { decoded = decodeURIComponent(raw); } catch (e) { /* 保留原值 */ }

    if (/^https?:\/\//i.test(decoded)) return decoded;
    if (/^https?:\/\//i.test(raw)) return raw;
    return null;
}

function isTextLikeContent(contentType, targetUrl) {
    const type = String(contentType || '').toLowerCase();
    if (!type) return /\.(m3u8|json|xml|txt)(\?|$)/i.test(targetUrl);
    if (/^image\//.test(type) || /^video\//.test(type) || /^audio\//.test(type)) return false;
    if (type.indexOf('mpegurl') !== -1 || type.indexOf('m3u') !== -1) return true;
    return /^text\//.test(type) || type.indexOf('json') !== -1 ||
        type.indexOf('xml') !== -1 || type.indexOf('javascript') !== -1;
}

function isM3u8Content(content, contentType) {
    if (contentType && (contentType.includes('mpegurl') || contentType.includes('m3u8'))) return true;
    return typeof content === 'string' && content.trim().startsWith('#EXTM3U');
}

function getRefererFor(targetUrl) {
    try {
        const host = new URL(targetUrl).hostname;
        if (/(^|\.)doubanio\.com$/i.test(host) || /(^|\.)douban\.com$/i.test(host)) {
            return 'https://movie.douban.com/';
        }
        return new URL(targetUrl).origin + '/';
    } catch (e) {
        return '*';
    }
}

async function fetchTarget(targetUrl, request) {
    const headers = new Headers({
        'User-Agent': DEFAULT_UA,
        'Accept': '*/*',
        'Accept-Language': (request.headers.get('Accept-Language') || 'zh-CN,zh;q=0.9,en;q=0.8'),
        'Referer': getRefererFor(targetUrl)
    });

    const response = await fetch(targetUrl, {
        method: request.method === 'HEAD' ? 'HEAD' : 'GET',
        headers: headers,
        redirect: 'follow'
    });

    if (!response.ok) {
        const body = await response.text().catch(function () { return ''; });
        throw new Error(`HTTP ${response.status} ${response.statusText} - ${targetUrl} ${body.slice(0, 120)}`);
    }

    return { response: response, contentType: response.headers.get('Content-Type') || '' };
}

/* ------------------------------ M3U8 重写 ------------------------------ */

function getBaseUrl(urlStr) {
    try {
        const parsed = new URL(urlStr);
        if (!parsed.pathname || parsed.pathname === '/') return parsed.origin + '/';
        const parts = parsed.pathname.split('/');
        parts.pop();
        return parsed.origin + parts.join('/') + '/';
    } catch (e) {
        const lastSlash = urlStr.lastIndexOf('/');
        return lastSlash > urlStr.indexOf('://') + 2 ? urlStr.substring(0, lastSlash + 1) : urlStr + '/';
    }
}

function resolveUrl(baseUrl, relativeUrl) {
    if (/^https?:\/\//i.test(relativeUrl)) return relativeUrl;
    try {
        return new URL(relativeUrl, baseUrl).toString();
    } catch (e) {
        if (relativeUrl.startsWith('/')) {
            try { return new URL(baseUrl).origin + relativeUrl; } catch (e2) { return relativeUrl; }
        }
        return baseUrl.replace(/\/[^/]*$/, '/') + relativeUrl;
    }
}

function rewriteUrlToProxy(targetUrl) {
    return '/proxy/' + encodeURIComponent(targetUrl);
}

function rewriteUriAttr(line, baseUrl) {
    return line.replace(/URI="([^"]+)"/, function (match, uri) {
        return 'URI="' + rewriteUrlToProxy(resolveUrl(baseUrl, uri)) + '"';
    });
}

async function processM3u8(targetUrl, content, depth) {
    if (content.includes('#EXT-X-STREAM-INF') || content.includes('#EXT-X-MEDIA:')) {
        return processMasterPlaylist(targetUrl, content, depth);
    }
    return processMediaPlaylist(targetUrl, content);
}

function processMediaPlaylist(url, content) {
    const baseUrl = getBaseUrl(url);
    const lines = content.split('\n');
    const output = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        if (!line) {
            if (i === lines.length - 1) output.push('');
            continue;
        }
        if (line.startsWith('#EXT-X-KEY') || line.startsWith('#EXT-X-MAP')) {
            output.push(rewriteUriAttr(line, baseUrl));
            continue;
        }
        if (!line.startsWith('#')) {
            output.push(rewriteUrlToProxy(resolveUrl(baseUrl, line)));
            continue;
        }
        output.push(line);
    }

    return output.join('\n');
}

async function processMasterPlaylist(url, content, depth) {
    if (depth > MAX_RECURSION) {
        throw new Error(`处理主列表时递归层数过多 (${MAX_RECURSION}): ${url}`);
    }

    const baseUrl = getBaseUrl(url);
    const lines = content.split('\n');
    let highestBandwidth = -1;
    let bestVariantUrl = '';

    for (let i = 0; i < lines.length; i++) {
        if (!lines[i].startsWith('#EXT-X-STREAM-INF')) continue;

        const bandwidthMatch = lines[i].match(/BANDWIDTH=(\d+)/);
        const bandwidth = bandwidthMatch ? parseInt(bandwidthMatch[1], 10) : 0;

        let variantUri = '';
        for (let j = i + 1; j < lines.length; j++) {
            const line = lines[j].trim();
            if (line && !line.startsWith('#')) {
                variantUri = line;
                i = j;
                break;
            }
        }

        if (variantUri && bandwidth >= highestBandwidth) {
            highestBandwidth = bandwidth;
            bestVariantUrl = resolveUrl(baseUrl, variantUri);
        }
    }

    if (!bestVariantUrl) {
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line && !line.startsWith('#') && line.includes('.m3u8')) {
                bestVariantUrl = resolveUrl(baseUrl, line);
                break;
            }
        }
    }

    if (!bestVariantUrl) return processMediaPlaylist(url, content);

    const { response: variantResponse, contentType } = await fetchTarget(bestVariantUrl, { headers: new Headers(), method: 'GET' });
    const variantContent = await variantResponse.text();

    if (!isM3u8Content(variantContent, contentType)) {
        return processMediaPlaylist(bestVariantUrl, variantContent);
    }

    return processM3u8(bestVariantUrl, variantContent, depth + 1);
}
