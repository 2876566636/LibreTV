/**
 * 静态资源打包脚本（供 EdgeOne Makers 等纯静态托管平台使用）
 *
 * 为什么需要它：
 * 项目根目录同时存在多种平台的适配文件（server.mjs、functions/、netlify/、
 * api/、edge-functions/ 等），如果把根目录直接当发布目录，node_modules 和这
 * 些服务端源码都会被当成静态资源一起上传，产物过大导致发布失败（表现为整站 404）。
 *
 * 这里用白名单只挑真正要对外的前端资源。
 */

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const outDir = path.join(root, 'dist');

// 只发布前端资源，顺序无关
const ENTRIES = [
    'index.html',
    'player.html',
    'about.html',
    'manifest.json',
    'robots.txt',
    'service-worker.js',
    'css',
    'js',
    'libs',
    'image'
];

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

let count = 0;
for (const entry of ENTRIES) {
    const src = path.join(root, entry);
    if (!fs.existsSync(src)) {
        console.warn(`[build-static] 跳过不存在的条目: ${entry}`);
        continue;
    }
    fs.cpSync(src, path.join(outDir, entry), { recursive: true });
    count += 1;
}

const hasIndex = fs.existsSync(path.join(outDir, 'index.html'));
console.log(`[build-static] 已输出 ${count} 个条目到 dist/，index.html: ${hasIndex ? '有' : '缺失'}`);

if (!hasIndex) {
    console.error('[build-static] 缺少 index.html，构建产物不可用');
    process.exit(1);
}
