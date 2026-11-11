/**
 * EdgeOne Makers 边缘函数：把服务端 PASSWORD 的 SHA-256 哈希下发给前端
 *
 * 路由：/api/env.js（由 edge-functions/api/env.js 生成）
 *
 * 为什么用 .js 而不是 JSON 接口：
 * Cloudflare / Netlify 用中间件改写 HTML 注入哈希，EdgeOne 的边缘函数
 * 无法拦截静态资源，所以改成页面里以 defer 加载这段脚本，在
 * DOMContentLoaded 之前把 window.__ENV__.PASSWORD 覆盖成真实哈希。
 */

export default async function onRequest(context) {
    const env = (context && context.env) || {};
    const password = env.PASSWORD || '';

    let hash = '';
    if (password) {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
        hash = Array.from(new Uint8Array(buf))
            .map(function (b) { return b.toString(16).padStart(2, '0'); })
            .join('');
    }

    const body = [
        'window.__ENV__ = window.__ENV__ || {};',
        'window.__ENV__.PASSWORD = ' + JSON.stringify(hash) + ';'
    ].join('\n');

    return new Response(body, {
        headers: {
            'Content-Type': 'application/javascript; charset=utf-8',
            'Cache-Control': 'no-store',
            'Access-Control-Allow-Origin': '*'
        }
    });
}
