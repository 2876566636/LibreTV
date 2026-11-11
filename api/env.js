/**
 * Vercel 版环境变量注入
 *
 * 原本依赖根目录 middleware.js，但 EdgeOne 构建器会把 middleware.js 识别为
 * 全站中间件入口并强制接管所有路由（其 process.env / fetch(request) 在
 * EdgeOne 的 V8 运行时里直接报错，导致全站 545），所以改为统一走 /api/env。
 *
 * 路由：/api/env
 */

import crypto from 'node:crypto';

export default function handler(req, res) {
    const password = process.env.PASSWORD || '';
    const hash = password
        ? crypto.createHash('sha256').update(password).digest('hex')
        : '';

    const body = [
        'window.__ENV__ = window.__ENV__ || {};',
        'window.__ENV__.PASSWORD = ' + JSON.stringify(hash) + ';'
    ].join('\n');

    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).send(body);
}
