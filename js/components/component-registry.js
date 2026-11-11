/**
 * LibreTV 运行时组件注册表
 *
 * 设计约束（无构建工具的纯静态项目，需兼容 Cloudflare Pages 静态托管）：
 * - 组件模板以字符串内联在组件 JS 中，页面加载时同步注入 DOM，不 fetch .html 片段
 * - 不使用服务端 include，不使用 Shadow DOM（全局 id / Tailwind / .settings-* 会失效）
 * - 体积大的逻辑脚本按需加载，DOM 先就位，保证全局 id 引用与事件绑定时序稳定
 */
(function () {
    'use strict';

    var registry = [];
    var scriptPromises = Object.create(null);

    // Tailwind Play CDN 依赖 MutationObserver 重新扫描动态 DOM；这里给 hidden 一个
    // 兜底，避免首帧样式未生成时弹窗/菜单直接展开。
    var BASE_STYLE = '#component-root .hidden, #modal-root .hidden, #titlebar-root .hidden { display: none; }';

    function find(name) {
        for (var i = 0; i < registry.length; i++) {
            if (registry[i].name === name) return registry[i];
        }
        return null;
    }

    function define(name, options) {
        if (!name || !options || find(name)) return;
        registry.push({
            name: name,
            template: options.template || '',
            script: options.script || '',
            style: options.style || '',
            mountPoint: options.mountPoint || '',
            init: typeof options.init === 'function' ? options.init : null,
            mounted: false,
            ready: !options.script
        });
    }

    function host(item) {
        if (item && item.mountPoint) {
            var target = document.querySelector(item.mountPoint);
            if (target) return target;
        }
        return document.getElementById('component-root') || document.body;
    }

    function mount(name) {
        var item = find(name);
        if (!item || item.mounted) return item;

        if (item.style) {
            var style = document.createElement('style');
            style.setAttribute('data-component', item.name);
            style.textContent = item.style;
            document.head.appendChild(style);
        }

        // insertAdjacentHTML 不会重新解析已有节点，避免破坏已绑定的事件
        host(item).insertAdjacentHTML('beforeend', item.template);
        item.mounted = true;

        if (item.init) item.init(host(item));
        return item;
    }

    function mountAll() {
        var base = document.createElement('style');
        base.setAttribute('data-component', 'base');
        base.textContent = BASE_STYLE;
        document.head.appendChild(base);

        registry.forEach(function (item) { mount(item.name); });
    }

    function load(name) {
        var item = find(name);
        if (!item || item.ready) return Promise.resolve(item);
        if (scriptPromises[name]) return scriptPromises[name];

        scriptPromises[name] = new Promise(function (resolve) {
            var script = document.createElement('script');
            script.src = item.script;
            script.async = true;
            script.onload = function () {
                item.ready = true;
                resolve(item);
            };
            script.onerror = function () {
                // 加载失败也放行，避免面板永远打不开（功能降级由页面自行处理）
                console.error('[Components] 逻辑脚本加载失败:', item.script);
                item.ready = true;
                resolve(item);
            };
            document.body.appendChild(script);
        });
        return scriptPromises[name];
    }

    function ensure(name) {
        mount(name);
        return load(name);
    }

    window.Components = {
        define: define,
        mount: mount,
        mountAll: mountAll,
        load: load,
        ensure: ensure,
        isReady: function (name) {
            var item = find(name);
            return !item || item.ready;
        },
        has: function (name) { return !!find(name); }
    };
})();
