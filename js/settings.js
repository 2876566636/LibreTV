/**
 * 设置面板：多 Tab 切换 + 视频源管理 + 播放设置
 *
 * 依赖全局（由 app.js / config.js / ui.js 提供）：
 * - API_SITES、customAPIs、selectedAPIs、PROXY_URL、PLAYER_CONFIG、ProxyAuth、showToast
 *
 * 存储键：
 * - apiSourceOrder            视频源展示顺序
 * - selectedAPIs              启用的视频源 id（内置为 key，自定义为 custom_N）
 * - mobileGestureEnabled      移动端手势开关
 * - longPressSpeedRate        长按倍速倍率
 * - playbackBufferLevel       播放缓冲档位 low | normal | high
 */
(function () {
    'use strict';

    const ORDER_KEY = 'apiSourceOrder';
    const ACTIVE_TAB_KEY = 'settingsActiveTab';
    const GESTURE_KEY = 'mobileGestureEnabled';
    const LONG_PRESS_KEY = 'longPressSpeedRate';
    const BUFFER_KEY = 'playbackBufferLevel';
    const DEFAULT_LONG_PRESS_RATE = 3;

    const BUFFER_PROFILES = {
        low: {
            label: '低',
            desc: '低：起播更快、更省流量；弱网下更容易卡顿',
            maxBufferLength: 10,
            maxMaxBufferLength: 20,
            maxBufferSize: 10 * 1000 * 1000,
            backBufferLength: 30
        },
        normal: {
            label: '均衡',
            desc: '均衡：默认缓冲，兼顾起播速度与流畅度',
            maxBufferLength: 30,
            maxMaxBufferLength: 60,
            maxBufferSize: 30 * 1000 * 1000,
            backBufferLength: 90
        },
        high: {
            label: '高',
            desc: '高：预加载更多内容，弱网更抗卡顿；占用更多内存',
            maxBufferLength: 60,
            maxMaxBufferLength: 120,
            maxBufferSize: 60 * 1000 * 1000,
            backBufferLength: 120
        }
    };

    const sourceHealth = new Map();
    let testing = false;
    let editingCustomIndex = null;
    let dialogMode = 'manual';
    let initialized = false;

    // ---------------- 工具 ----------------

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function toast(message, type) {
        if (typeof window.showToast === 'function') {
            window.showToast(message, type || 'info');
        }
    }

    function readJson(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch (error) {
            return fallback;
        }
    }

    function adFilterKey() {
        return (typeof PLAYER_CONFIG !== 'undefined' && PLAYER_CONFIG.adFilteringStorage) || 'adFilteringEnabled';
    }

    // ---------------- 视频源数据 ----------------

    function builtinSources() {
        const sites = (typeof API_SITES !== 'undefined' && API_SITES) || window.API_SITES || [];
        return (Array.isArray(sites) ? sites : []).map(function (site) {
            return {
                id: site.url,
                type: 'builtin',
                name: site.name || site.url,
                url: site.url || '',
                detail: site.detail || '',
                adult: !!site.adult
            };
        }).filter(function (source) {
            return !!source.url;
        });
    }

    function customSources() {
        const list = typeof customAPIs !== 'undefined' ? customAPIs : [];
        return (Array.isArray(list) ? list : []).map(function (api, index) {
            return {
                id: 'custom_' + index,
                type: 'custom',
                index: index,
                name: api.name || ('自定义源 ' + (index + 1)),
                url: api.url || '',
                detail: api.detail || '',
                adult: !!api.isAdult
            };
        });
    }

    function defaultOrder() {
        return builtinSources().map(function (source) { return source.id; })
            .concat(customSources().map(function (source) { return source.id; }));
    }

    function getOrder() {
        const defaults = defaultOrder();
        const known = new Set(defaults);
        const stored = readJson(ORDER_KEY, null);
        const order = [];

        if (Array.isArray(stored)) {
            stored.forEach(function (id) {
                if (known.has(id) && order.indexOf(id) === -1) order.push(id);
            });
        }
        defaults.forEach(function (id) {
            if (order.indexOf(id) === -1) order.push(id);
        });
        return order;
    }

    function persistOrder(order) {
        const enabled = new Set(getEnabledIds());
        const nextEnabled = order.filter(function (id) { return enabled.has(id); });
        enabled.forEach(function (id) {
            if (order.indexOf(id) === -1) nextEnabled.push(id);
        });

        localStorage.setItem(ORDER_KEY, JSON.stringify(order));
        selectedAPIs = nextEnabled;
        localStorage.setItem('selectedAPIs', JSON.stringify(selectedAPIs));
    }

    function getEnabledIds() {
        return Array.isArray(selectedAPIs) ? selectedAPIs.slice() : [];
    }

    function isEnabled(id) {
        return getEnabledIds().indexOf(id) !== -1;
    }

    function allSources() {
        const byId = new Map();
        builtinSources().forEach(function (source) { byId.set(source.id, source); });
        customSources().forEach(function (source) { byId.set(source.id, source); });

        const result = [];
        getOrder().forEach(function (id) {
            if (byId.has(id)) {
                result.push(byId.get(id));
                byId.delete(id);
            }
        });
        byId.forEach(function (source) { result.push(source); });
        return result;
    }

    function isYellowFilterOn() {
        return localStorage.getItem('yellowFilterEnabled') !== 'false';
    }

    function visibleSources() {
        const hideAdult = isYellowFilterOn();
        return allSources().filter(function (source) {
            return !(hideAdult && source.type === 'builtin' && source.adult);
        });
    }

    // ---------------- 渲染 ----------------

    function healthBadge(sourceId) {
        const health = sourceHealth.get(sourceId);
        if (!health) {
            return '<span class="source-health" data-health-for="' + escapeHtml(sourceId) + '"></span>';
        }
        return healthBadgeHtml(sourceId, health);
    }

    function healthBadgeHtml(sourceId, health) {
        let cls = 'bad';
        let text = '失败';
        if (health.status === 'online') {
            cls = 'good';
            text = health.latency + 'ms';
        } else if (health.status === 'slow') {
            cls = 'warn';
            text = health.latency + 'ms';
        } else if (health.status === 'timeout') {
            cls = 'bad';
            text = '超时';
        }
        return '<span class="source-health ' + cls + '" data-health-for="' + escapeHtml(sourceId) + '">' + text + '</span>';
    }

    function sourceRowHtml(source) {
        const enabled = isEnabled(source.id);
        const badges = [];
        if (source.type === 'builtin') badges.push('<span class="source-badge">内置</span>');
        if (source.adult) badges.push('<span class="source-badge adult">18+</span>');

        const actions = [
            '<button type="button" data-action="up" title="上移" aria-label="上移">↑</button>',
            '<button type="button" data-action="down" title="下移" aria-label="下移">↓</button>'
        ];
        if (source.type === 'custom') {
            actions.push('<button type="button" data-action="edit" title="编辑" aria-label="编辑">✎</button>');
            actions.push('<button type="button" data-action="delete" title="删除" aria-label="删除">✕</button>');
        }

        return '<div class="source-row' + (enabled ? '' : ' is-disabled') + '" data-id="' + escapeHtml(source.id) + '" draggable="true">'
            + '<label class="settings-switch small">'
            + '<input type="checkbox" data-action="toggle" ' + (enabled ? 'checked' : '') + ' aria-label="启用 ' + escapeHtml(source.name) + '">'
            + '<span class="settings-switch-track"></span>'
            + '</label>'
            + '<div class="source-main">'
            + '<div class="source-title">'
            + '<span class="source-name" title="' + escapeHtml(source.name) + '">' + escapeHtml(source.name) + '</span>'
            + badges.join('')
            + healthBadge(source.id)
            + '</div>'
            + '<div class="source-url" title="' + escapeHtml(source.url) + '">' + escapeHtml(source.url) + '</div>'
            + '</div>'
            + '<div class="source-actions">' + actions.join('') + '</div>'
            + '</div>';
    }

    function renderSourceList() {
        const container = document.getElementById('sourceList');
        if (!container) return;

        const input = document.getElementById('sourceFilterInput');
        const keyword = (input && input.value ? input.value : '').trim().toLowerCase();
        const sources = visibleSources().filter(function (source) {
            if (!keyword) return true;
            return source.name.toLowerCase().indexOf(keyword) !== -1
                || source.url.toLowerCase().indexOf(keyword) !== -1;
        });

        if (!sources.length) {
            container.innerHTML = '<div class="settings-empty">' + (keyword ? '没有匹配的视频源' : '暂无视频源，点击「+ 添加」新增') + '</div>';
        } else {
            container.innerHTML = sources.map(sourceRowHtml).join('');
        }

        updateCounts();
    }

    function updateCounts() {
        const enabledEl = document.getElementById('enabledSourceCount');
        const totalEl = document.getElementById('totalSourceCount');
        const toggleBtn = document.getElementById('toggleAllSourcesBtn');
        const sources = allSources();
        const enabledCount = sources.filter(function (source) { return isEnabled(source.id); }).length;

        if (enabledEl) enabledEl.textContent = String(enabledCount);
        if (totalEl) totalEl.textContent = String(sources.length);

        if (toggleBtn) {
            const visible = visibleSources();
            const allEnabled = visible.length > 0 && visible.every(function (source) { return isEnabled(source.id); });
            toggleBtn.textContent = allEnabled ? '全部停用' : '全部启用';
        }
    }

    function updateHealthBadge(sourceId) {
        const el = document.querySelector('[data-health-for="' + sourceId + '"]');
        if (!el) return;
        const health = sourceHealth.get(sourceId);
        if (!health) {
            el.className = 'source-health';
            el.textContent = '';
            return;
        }
        const temp = document.createElement('div');
        temp.innerHTML = healthBadgeHtml(sourceId, health);
        const next = temp.firstChild;
        el.className = next.className;
        el.textContent = next.textContent;
    }

    // ---------------- 启用与排序 ----------------

    function persistEnabled() {
        localStorage.setItem('selectedAPIs', JSON.stringify(selectedAPIs));
    }

    function setSourceEnabled(id, enabled) {
        if (enabled) {
            if (!isEnabled(id)) selectedAPIs.push(id);
        } else {
            selectedAPIs = getEnabledIds().filter(function (item) { return item !== id; });
        }
        persistEnabled();

        const row = document.querySelector('.source-row[data-id="' + id + '"]');
        if (row) row.classList.toggle('is-disabled', !enabled);

        updateCounts();
        if (enabled) enforceAdultRule();
    }

    function moveSource(id, direction) {
        const order = getOrder();
        const index = order.indexOf(id);
        const target = index + direction;
        if (index === -1 || target < 0 || target >= order.length) return;

        order[index] = order[target];
        order[target] = id;
        persistOrder(order);
        renderSourceList();
    }

    function reorderBefore(draggedId, targetId) {
        if (draggedId === targetId) return;
        const order = getOrder();
        const from = order.indexOf(draggedId);
        if (from === -1) return;
        order.splice(from, 1);

        const to = order.indexOf(targetId);
        if (to === -1) order.push(draggedId);
        else order.splice(to, 0, draggedId);

        persistOrder(order);
        renderSourceList();
    }

    function toggleAllSources() {
        const visible = visibleSources();
        const allEnabled = visible.length > 0 && visible.every(function (source) { return isEnabled(source.id); });

        selectedAPIs = allEnabled ? [] : visible.map(function (source) { return source.id; });
        persistEnabled();
        renderSourceList();
        enforceAdultRule();
    }

    function sortSourcesByLatency() {
        const rank = function (id) {
            const health = sourceHealth.get(id);
            if (!health) return 3;
            if (health.status === 'online') return 0;
            if (health.status === 'slow') return 1;
            return 2;
        };

        const order = getOrder().slice().sort(function (a, b) {
            const diff = rank(a) - rank(b);
            if (diff !== 0) return diff;
            const la = sourceHealth.get(a);
            const lb = sourceHealth.get(b);
            const va = la && la.latency != null ? la.latency : Number.MAX_SAFE_INTEGER;
            const vb = lb && lb.latency != null ? lb.latency : Number.MAX_SAFE_INTEGER;
            return va - vb;
        });

        persistOrder(order);
        renderSourceList();
        toast('已按延迟排序', 'success');
    }

    // ---------------- 添加 / 编辑 / 删除 ----------------

    function showDialogSection(mode) {
        [
            ['sourceDialogManual', 'manual'],
            ['sourceDialogUrl', 'url'],
            ['sourceDialogText', 'text']
        ].forEach(function (pair) {
            const section = document.getElementById(pair[0]);
            if (section) section.classList.toggle('hidden', mode !== pair[1]);
        });
    }

    function openSourceDialog() {
        const dialog = document.getElementById('sourceDialog');
        if (!dialog) return;
        dialog.classList.remove('hidden');
        document.body.classList.add('settings-dialog-open');
    }

    function openSourceForm(index) {
        const dialog = document.getElementById('sourceDialog');
        if (!dialog) return;
        dialogMode = 'manual';
        closeAddSourceMenu();
        showDialogSection('manual');

        const title = document.getElementById('sourceEditorTitle');
        const confirm = document.getElementById('sourceDialogConfirm');
        const nameInput = document.getElementById('sourceEditorName');
        const urlInput = document.getElementById('sourceEditorUrl');
        const detailInput = document.getElementById('sourceEditorDetail');
        const adultInput = document.getElementById('sourceEditorAdult');
        if (!nameInput || !urlInput) return;

        if (typeof index === 'number' && index >= 0 && customAPIs[index]) {
            const api = customAPIs[index];
            editingCustomIndex = index;
            if (title) title.textContent = '编辑视频源';
            nameInput.value = api.name || '';
            urlInput.value = api.url || '';
            if (detailInput) detailInput.value = api.detail || '';
            if (adultInput) adultInput.checked = !!api.isAdult;
        } else {
            editingCustomIndex = null;
            if (title) title.textContent = '手动添加视频源';
            nameInput.value = '';
            urlInput.value = '';
            if (detailInput) detailInput.value = '';
            if (adultInput) adultInput.checked = false;
        }
        if (confirm) confirm.textContent = '保存';

        openSourceDialog();
        nameInput.focus();
    }

    function openUrlImportDialog() {
        closeAddSourceMenu();
        dialogMode = 'url';
        showDialogSection('url');

        const title = document.getElementById('sourceEditorTitle');
        const confirm = document.getElementById('sourceDialogConfirm');
        const urlInput = document.getElementById('dialogSourceUrl');
        if (title) title.textContent = '从 URL 导入视频源';
        if (confirm) confirm.textContent = '拉取并导入';
        if (urlInput) urlInput.value = '';

        openSourceDialog();
        if (urlInput) urlInput.focus();
    }

    function confirmSourceDialog() {
        if (dialogMode === 'url') {
            const urlInput = document.getElementById('dialogSourceUrl');
            importSourcesFromUrl(urlInput ? urlInput.value : '');
            return;
        }
        if (dialogMode === 'text') {
            importSourcesFromText();
            return;
        }
        saveSourceForm();
    }

    function closeSourceForm() {
        const dialog = document.getElementById('sourceDialog');
        if (dialog) dialog.classList.add('hidden');
        document.body.classList.remove('settings-dialog-open');
        editingCustomIndex = null;
    }

    function saveSourceForm() {
        const nameInput = document.getElementById('sourceEditorName');
        const urlInput = document.getElementById('sourceEditorUrl');
        const detailInput = document.getElementById('sourceEditorDetail');
        const adultInput = document.getElementById('sourceEditorAdult');
        if (!nameInput || !urlInput) return;

        const name = nameInput.value.trim();
        let url = urlInput.value.trim();
        const detail = detailInput ? detailInput.value.trim() : '';
        const isAdult = adultInput ? adultInput.checked : false;

        if (!name || !url) {
            toast('请输入名称和接口地址', 'warning');
            return;
        }
        if (!/^https?:\/\/.+/i.test(url)) {
            toast('接口地址需以 http:// 或 https:// 开头', 'warning');
            return;
        }
        if (url.charAt(url.length - 1) === '/') url = url.slice(0, -1);

        if (editingCustomIndex !== null) {
            const current = customAPIs[editingCustomIndex] || {};
            customAPIs[editingCustomIndex] = Object.assign({}, current, { name: name, url: url, detail: detail, isAdult: isAdult });
            toast('已更新视频源：' + name, 'success');
        } else {
            customAPIs.push({ name: name, url: url, detail: detail, isAdult: isAdult });
            const newId = 'custom_' + (customAPIs.length - 1);
            if (!isEnabled(newId)) selectedAPIs.push(newId);

            const order = getOrder();
            if (order.indexOf(newId) === -1) order.push(newId);
            persistOrder(order);
            toast('已添加视频源：' + name, 'success');
        }

        localStorage.setItem('customAPIs', JSON.stringify(customAPIs));
        persistEnabled();
        closeSourceForm();
        renderSourceList();
        enforceAdultRule();
    }

    function deleteCustomSource(index) {
        if (!customAPIs[index]) return;
        const api = customAPIs[index];
        if (!window.confirm('确定删除「' + api.name + '」吗？')) return;

        const removedId = 'custom_' + index;
        customAPIs.splice(index, 1);
        localStorage.setItem('customAPIs', JSON.stringify(customAPIs));

        const remap = function (id) {
            if (typeof id !== 'string' || id.indexOf('custom_') !== 0) return id;
            const current = parseInt(id.slice(7), 10);
            if (current === index) return null;
            if (current > index) return 'custom_' + (current - 1);
            return id;
        };

        selectedAPIs = getEnabledIds().map(remap).filter(Boolean);
        const order = getOrder().map(remap).filter(Boolean);
        persistOrder(order);
        persistEnabled();

        renderSourceList();
        enforceAdultRule();
        toast('已删除视频源：' + api.name, 'info');
    }

    // ---------------- 导入 / 导出 ----------------

    const URL_FIELD_KEYS = ['url', 'api', 'apiUrl', 'api_url', 'baseUrl', 'address'];
    const NAME_FIELD_KEYS = ['name', 'title', 'label'];
    const DETAIL_FIELD_KEYS = ['detail', 'detailUrl', 'detail_url'];

    function pickField(raw, keys) {
        for (let i = 0; i < keys.length; i++) {
            const value = raw[keys[i]];
            if (typeof value === 'string' && value.trim()) return value.trim();
        }
        return '';
    }

    function toBool(value) {
        return value === true || value === 1 || value === 'true' || value === '1';
    }

    function normalizeUrl(url) {
        return String(url == null ? '' : url).trim().replace(/\/+$/, '');
    }

    function urlKey(url) {
        return normalizeUrl(url).toLowerCase();
    }

    // 把各种来源的单条数据统一成 { name, url, detail, adult }
    function normalizeSource(raw) {
        let item = raw;
        if (typeof item === 'string') item = { url: item };
        if (!item || typeof item !== 'object') return null;

        const url = normalizeUrl(pickField(item, URL_FIELD_KEYS));
        if (!/^https?:\/\/[^\s]+$/i.test(url)) return null;

        let name = pickField(item, NAME_FIELD_KEYS);
        if (!name) {
            try {
                name = new URL(url).hostname;
            } catch (error) {
                name = url;
            }
        }

        return {
            name: name,
            url: url,
            detail: normalizeUrl(pickField(item, DETAIL_FIELD_KEYS)),
            adult: toBool(item.adult) || toBool(item.isAdult)
        };
    }

    function extractSourceArray(data) {
        if (Array.isArray(data)) return data;
        if (!data || typeof data !== 'object') return null;
        const keys = ['sources', 'sites', 'api_sites', 'videoAPIs', 'apis', 'data'];
        for (let i = 0; i < keys.length; i++) {
            if (Array.isArray(data[keys[i]])) return data[keys[i]];
        }
        return null;
    }

    function parseSourcePayload(text) {
        const content = String(text == null ? '' : text).trim();
        if (!content) return { error: '内容为空，请粘贴 JSON 或选择文件' };

        let data;
        try {
            data = JSON.parse(content);
        } catch (error) {
            return { error: 'JSON 解析失败：' + error.message };
        }

        const list = extractSourceArray(data);
        if (!list) return { error: '格式不正确：需要一个视频源数组' };

        const items = [];
        let invalid = 0;
        list.forEach(function (raw) {
            const source = normalizeSource(raw);
            if (source) items.push(source);
            else invalid++;
        });

        if (!items.length) return { error: '没有可导入的视频源，请检查 name / url 字段' };
        return { items: items, invalid: invalid };
    }

    function existingUrlKeys() {
        const keys = new Set();
        allSources().forEach(function (source) { keys.add(urlKey(source.url)); });
        return keys;
    }

    function importSourceItems(items) {
        const existing = existingUrlKeys();
        const added = [];
        let duplicated = 0;

        items.forEach(function (item) {
            const key = urlKey(item.url);
            if (!key || existing.has(key)) {
                duplicated++;
                return;
            }
            existing.add(key);
            customAPIs.push({
                name: item.name,
                url: item.url,
                detail: item.detail || '',
                isAdult: !!item.adult
            });
            added.push('custom_' + (customAPIs.length - 1));
        });

        if (!added.length) {
            toast(duplicated ? '没有新增视频源，' + duplicated + ' 个地址已存在' : '没有可导入的视频源', 'info');
            return { added: 0, duplicated: duplicated };
        }

        localStorage.setItem('customAPIs', JSON.stringify(customAPIs));

        added.forEach(function (id) {
            if (!isEnabled(id)) selectedAPIs.push(id);
        });

        const order = getOrder();
        added.forEach(function (id) {
            if (order.indexOf(id) === -1) order.push(id);
        });
        persistOrder(order);
        persistEnabled();
        renderSourceList();
        enforceAdultRule();
        return { added: added.length, duplicated: duplicated };
    }

    function reportImport(applied, invalid) {
        if (!applied.added) return;
        const skipped = applied.duplicated + (invalid || 0);
        toast('已导入 ' + applied.added + ' 个视频源' + (skipped ? '，跳过 ' + skipped + ' 个' : ''), 'success');
    }

    function openTextImportDialog(prefill) {
        closeAddSourceMenu();
        dialogMode = 'text';
        showDialogSection('text');

        const title = document.getElementById('sourceEditorTitle');
        const confirm = document.getElementById('sourceDialogConfirm');
        const textarea = document.getElementById('dialogSourceText');
        if (title) title.textContent = '从文本导入视频源';
        if (confirm) confirm.textContent = '导入';
        if (textarea) textarea.value = typeof prefill === 'string' ? prefill : '';

        openSourceDialog();
        if (textarea) textarea.focus();
    }

    function importSourcesFromText() {
        const textarea = document.getElementById('dialogSourceText');
        const result = parseSourcePayload(textarea ? textarea.value : '');
        if (result.error) {
            toast(result.error, 'warning');
            return;
        }
        const applied = importSourceItems(result.items);
        reportImport(applied, result.invalid);
        if (applied.added) closeSourceForm();
    }

    function triggerImportFile() {
        const file = document.getElementById('sourceImportFile');
        if (file) file.click();
    }

    function handleImportFile(event) {
        const input = event && event.target;
        const file = input && input.files && input.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function () {
            const content = String(reader.result || '');
            openTextImportDialog(content);
            if (input) input.value = '';
        };
        reader.onerror = function () {
            toast('读取文件失败', 'error');
            if (input) input.value = '';
        };
        reader.readAsText(file);
    }

    async function importSourcesFromUrl(rawUrl) {
        const button = document.getElementById('sourceDialogConfirm');
        const raw = String(rawUrl == null ? '' : rawUrl).trim();

        if (!/^https?:\/\//i.test(raw)) {
            toast('请填写以 http:// 或 https:// 开头的地址', 'warning');
            return;
        }

        // 已经存在同名地址视为覆盖，先清掉输入框的旧值无意义，这里直接拉取
        if (button) {
            button.disabled = true;
            button.textContent = '拉取中…';
        }

        try {
            let target = PROXY_URL + encodeURIComponent(raw);
            if (window.ProxyAuth && typeof window.ProxyAuth.addAuthToProxyUrl === 'function') {
                target = await window.ProxyAuth.addAuthToProxyUrl(target);
            }

            const response = await fetch(target, {
                headers: { 'Accept': 'application/json, text/plain, */*' }
            });
            if (!response.ok) throw new Error('HTTP ' + response.status);

            const content = await response.text();
            const result = parseSourcePayload(content);
            if (result.error) {
                toast(result.error, 'warning');
                return;
            }

            const applied = importSourceItems(result.items);
            reportImport(applied, result.invalid);
            if (applied.added) closeSourceForm();
        } catch (error) {
            toast('从 URL 导入失败：' + (error && error.message ? error.message : error), 'error');
        } finally {
            if (button) {
                button.disabled = false;
                button.textContent = '拉取并导入';
            }
        }
    }

    // 导出为内置源同构的 { name, url, adult }，自定义源的 detail 有值时才带上
    function exportPayload() {
        return allSources().map(function (source) {
            const item = { name: source.name, url: source.url, adult: !!source.adult };
            if (source.type === 'custom' && source.detail) item.detail = source.detail;
            return item;
        });
    }

    function exportFileName() {
        const now = new Date();
        const pad = function (value) { return (value < 10 ? '0' : '') + value; };
        return 'libretv-sources-' + now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) + '.json';
    }

    function exportSourcesToFile() {
        closeAddSourceMenu();
        const items = exportPayload();
        try {
            const blob = new Blob([JSON.stringify(items, null, 2)], { type: 'application/json;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = exportFileName();
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
            toast('已导出 ' + items.length + ' 个视频源', 'success');
        } catch (error) {
            toast('导出失败：' + (error && error.message ? error.message : error), 'error');
        }
    }

    function legacyCopy(text) {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.top = '-1000px';
        document.body.appendChild(textarea);
        textarea.select();
        let ok = false;
        try {
            ok = document.execCommand('copy');
        } catch (error) {
            ok = false;
        }
        document.body.removeChild(textarea);
        return ok;
    }

    async function exportSourcesToClipboard() {
        closeAddSourceMenu();
        const items = exportPayload();
        const data = JSON.stringify(items, null, 2);

        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(data);
                toast('已复制 ' + items.length + ' 个视频源的 JSON', 'success');
                return;
            }
        } catch (error) {
            // 非安全上下文或权限被拒绝时走 execCommand 兜底
        }

        if (legacyCopy(data)) {
            toast('已复制 ' + items.length + ' 个视频源的 JSON', 'success');
        } else {
            toast('复制失败，请改用「导出为文件」', 'error');
        }
    }

    // ---------------- 添加源浮窗菜单 ----------------

    function toggleAddSourceMenu(event) {
        if (event) event.stopPropagation();
        const menu = document.getElementById('addSourceMenu');
        const button = document.getElementById('addSourceMenuBtn');
        if (!menu) return;
        const willOpen = menu.classList.contains('hidden');
        menu.classList.toggle('hidden', !willOpen);
        if (button) button.setAttribute('aria-expanded', String(willOpen));
        if (willOpen) closeSourceSubmenu();
    }

    function closeAddSourceMenu() {
        const menu = document.getElementById('addSourceMenu');
        const button = document.getElementById('addSourceMenuBtn');
        if (menu) menu.classList.add('hidden');
        if (button) button.setAttribute('aria-expanded', 'false');
        closeSourceSubmenu();
    }

    // 二级浮窗弹出后会超出设置面板时，改用菜单内钻取，避免被裁切
    function submenuOverflowsPanel(submenu) {
        const settingsPanel = document.getElementById('settingsPanel');
        if (!submenu || !settingsPanel) return false;
        const subRect = submenu.getBoundingClientRect();
        const panelRect = settingsPanel.getBoundingClientRect();
        return subRect.width > 0 && (subRect.right > panelRect.right - 4 || subRect.left < panelRect.left + 4);
    }

    function toggleSourceSubmenu(name, event) {
        if (event) event.stopPropagation();
        const panel = document.getElementById(name === 'import' ? 'sourceSubmenuImport' : 'sourceSubmenuExport');
        const trigger = document.getElementById(name === 'import' ? 'sourceSubmenuImportBtn' : 'sourceSubmenuExportBtn');
        if (!panel) return;
        const willOpen = panel.classList.contains('hidden');

        closeSourceSubmenu();
        if (!willOpen) return;

        panel.classList.remove('hidden');
        if (trigger) trigger.setAttribute('aria-expanded', 'true');

        // 放得下就并排浮窗，放不下才在菜单里切换成二级页面
        const menu = document.getElementById('addSourceMenu');
        const group = trigger && trigger.closest ? trigger.closest('.settings-menu-group') : null;
        if (menu && group && submenuOverflowsPanel(panel)) {
            menu.classList.add('is-drilling');
            group.classList.add('is-active');
        }
    }

    function closeSourceSubmenu() {
        [
            ['sourceSubmenuImport', 'sourceSubmenuImportBtn'],
            ['sourceSubmenuExport', 'sourceSubmenuExportBtn']
        ].forEach(function (pair) {
            const panel = document.getElementById(pair[0]);
            const trigger = document.getElementById(pair[1]);
            if (panel) panel.classList.add('hidden');
            if (trigger) trigger.setAttribute('aria-expanded', 'false');
        });

        const menu = document.getElementById('addSourceMenu');
        if (menu) menu.classList.remove('is-drilling');
        document.querySelectorAll('#addSourceMenu .settings-menu-group.is-active').forEach(function (group) {
            group.classList.remove('is-active');
        });
    }

    function startManualAdd() {
        closeAddSourceMenu();
        openSourceForm();
    }

    function startImportFile() {
        closeAddSourceMenu();
        triggerImportFile();
    }

    function startImportUrl() {
        openUrlImportDialog();
    }

    function startImportText() {
        openTextImportDialog();
    }

    // ---------------- 健康检查 ----------------

    function buildProbeUrl(baseUrl) {
        if (!baseUrl) return '';
        const separator = baseUrl.indexOf('?') !== -1 ? '&' : '?';
        return baseUrl + separator + 'ac=videolist&ids=1';
    }

    async function probeSource(source) {
        const started = performance.now();
        const controller = new AbortController();
        const timer = setTimeout(function () { controller.abort(); }, 6000);

        try {
            let target = PROXY_URL + encodeURIComponent(buildProbeUrl(source.url));
            if (window.ProxyAuth && typeof window.ProxyAuth.addAuthToProxyUrl === 'function') {
                target = await window.ProxyAuth.addAuthToProxyUrl(target);
            }
            const response = await fetch(target, {
                signal: controller.signal,
                headers: { 'Accept': 'application/json' }
            });
            const latency = Math.round(performance.now() - started);
            if (!response.ok) return { status: 'offline', latency: null };
            return { status: latency > 3000 ? 'slow' : 'online', latency: latency };
        } catch (error) {
            return {
                status: error && error.name === 'AbortError' ? 'timeout' : 'offline',
                latency: null
            };
        } finally {
            clearTimeout(timer);
        }
    }

    async function runPool(items, limit, worker) {
        let cursor = 0;
        const size = Math.max(1, Math.min(limit, items.length));
        const runners = [];
        for (let i = 0; i < size; i++) {
            runners.push((async function () {
                while (cursor < items.length) {
                    const index = cursor++;
                    await worker(items[index]);
                }
            })());
        }
        await Promise.all(runners);
    }

    async function testAllSources() {
        if (testing) return;

        const targets = visibleSources().filter(function (source) { return isEnabled(source.id); });
        if (!targets.length) {
            toast('请先启用至少一个视频源', 'warning');
            return;
        }

        testing = true;
        const button = document.getElementById('testSourcesBtn');
        const progress = document.getElementById('sourceTestProgress');
        const sortButton = document.getElementById('sortByLatencyBtn');
        if (button) {
            button.disabled = true;
            button.textContent = '测速中';
        }
        if (sortButton) sortButton.classList.add('hidden');

        targets.forEach(function (source) { sourceHealth.delete(source.id); });
        renderSourceList();

        let done = 0;
        if (progress) progress.textContent = '0/' + targets.length;

        await runPool(targets, 4, async function (source) {
            const result = await probeSource(source);
            sourceHealth.set(source.id, result);
            done += 1;
            if (progress) progress.textContent = done + '/' + targets.length;
            updateHealthBadge(source.id);
        });

        if (button) {
            button.disabled = false;
            button.textContent = '测速';
        }
        if (sortButton) sortButton.classList.remove('hidden');
        testing = false;
        toast('测速完成，共 ' + targets.length + ' 个源', 'success');
    }

    // ---------------- 内容过滤 ----------------

    function hasEnabledAdultSource() {
        return allSources().some(function (source) {
            return source.adult && isEnabled(source.id);
        });
    }

    function enforceAdultRule() {
        const toggle = document.getElementById('yellowFilterToggle');
        const desc = document.getElementById('yellowFilterDesc');
        const locked = hasEnabledAdultSource();

        if (!toggle) return;

        if (locked) {
            const wasOn = isYellowFilterOn();
            toggle.checked = false;
            toggle.disabled = true;
            localStorage.setItem('yellowFilterEnabled', 'false');
            if (desc) desc.textContent = '已启用 18+ 源，过滤自动关闭；停用这些源后可重新开启';
            // 过滤刚被关闭时，让被隐藏的内置 18+ 源立即出现在列表里
            if (wasOn) renderSourceList();
        } else {
            toggle.disabled = false;
            if (desc) desc.textContent = '过滤"伦理片"等内容；启用 18+ 源时自动关闭';
        }
    }

    // ---------------- 播放设置 ----------------

    function getLongPressRate() {
        const value = parseFloat(localStorage.getItem(LONG_PRESS_KEY));
        return Number.isFinite(value) && value >= 1 && value <= 5 ? value : DEFAULT_LONG_PRESS_RATE;
    }

    function getBufferLevel() {
        const value = localStorage.getItem(BUFFER_KEY);
        return BUFFER_PROFILES[value] ? value : 'normal';
    }

    function paintPlaybackSettings() {
        const rate = getLongPressRate();
        document.querySelectorAll('#longPressRateSegment button').forEach(function (button) {
            button.classList.toggle('active', Math.abs(parseFloat(button.dataset.rate) - rate) < 0.01);
        });

        const level = getBufferLevel();
        document.querySelectorAll('#bufferLevelSegment button').forEach(function (button) {
            button.classList.toggle('active', button.dataset.level === level);
        });

        const desc = document.getElementById('bufferLevelDesc');
        if (desc) {
            const profile = BUFFER_PROFILES[level];
            desc.textContent = profile.desc;
        }
    }

    function initPlaybackSettings() {
        const gestureToggle = document.getElementById('mobileGestureToggle');
        if (gestureToggle) {
            gestureToggle.checked = localStorage.getItem(GESTURE_KEY) !== 'false';
            gestureToggle.addEventListener('change', function (event) {
                localStorage.setItem(GESTURE_KEY, String(event.target.checked));
                toast(event.target.checked ? '已开启移动端手势操作' : '已关闭移动端手势操作', 'success');
            });
        }

        const rateSegment = document.getElementById('longPressRateSegment');
        if (rateSegment) {
            rateSegment.addEventListener('click', function (event) {
                const button = event.target.closest('button[data-rate]');
                if (!button) return;
                localStorage.setItem(LONG_PRESS_KEY, button.dataset.rate);
                paintPlaybackSettings();
            });
        }

        const bufferSegment = document.getElementById('bufferLevelSegment');
        if (bufferSegment) {
            bufferSegment.addEventListener('click', function (event) {
                const button = event.target.closest('button[data-level]');
                if (!button) return;
                localStorage.setItem(BUFFER_KEY, button.dataset.level);
                paintPlaybackSettings();
            });
        }

        paintPlaybackSettings();
    }

    // ---------------- 通用设置 ----------------

    function initGeneralSettings() {
        const yellowToggle = document.getElementById('yellowFilterToggle');
        if (yellowToggle) {
            yellowToggle.checked = isYellowFilterOn();
            yellowToggle.addEventListener('change', function (event) {
                localStorage.setItem('yellowFilterEnabled', String(event.target.checked));
                renderSourceList();
                enforceAdultRule();
            });
        }

        const adToggle = document.getElementById('adFilterToggle');
        if (adToggle) {
            adToggle.checked = localStorage.getItem(adFilterKey()) !== 'false';
            adToggle.addEventListener('change', function (event) {
                localStorage.setItem(adFilterKey(), String(event.target.checked));
            });
        }

        // 豆瓣开关的 change 事件由 douban.js 自己绑定，这里只同步初始状态
        const doubanToggle = document.getElementById('doubanToggle');
        if (doubanToggle) {
            doubanToggle.checked = localStorage.getItem('doubanEnabled') === 'true';
        }

        // 搜索历史条数（可手动输入，范围 1-50）
        const historyLimitInput = document.getElementById('searchHistoryLimitInput');
        if (historyLimitInput) {
            historyLimitInput.value = String(getMaxHistoryItems());
            historyLimitInput.addEventListener('change', function () {
                const parsed = Number.parseInt(historyLimitInput.value, 10);
                const limit = Math.min(50, Math.max(1, Number.isFinite(parsed) ? parsed : getMaxHistoryItems()));

                localStorage.setItem('searchHistoryLimit', String(limit));
                historyLimitInput.value = String(limit);

                // 立即按新上限截断已有搜索历史
                if (typeof getSearchHistory === 'function') {
                    const items = getSearchHistory().slice(0, limit);
                    localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(items));
                }
                if (typeof renderSearchHistory === 'function') {
                    renderSearchHistory();
                }
                toast('搜索历史最多保留 ' + limit + ' 条', 'success');
            });
        }
    }

    // ---------------- Tab ----------------

    const TABS = {
        sources: { panel: 'settingsTabSources', button: 'settingsTabBtnSources' },
        playback: { panel: 'settingsTabPlayback', button: 'settingsTabBtnPlayback' },
        general: { panel: 'settingsTabGeneral', button: 'settingsTabBtnGeneral' }
    };

    function switchSettingsTab(name) {
        if (!TABS[name]) return;

        Object.keys(TABS).forEach(function (key) {
            const button = document.getElementById(TABS[key].button);
            const panel = document.getElementById(TABS[key].panel);
            const active = key === name;
            if (button) {
                button.classList.toggle('active', active);
                button.setAttribute('aria-selected', active ? 'true' : 'false');
            }
            if (panel) panel.classList.toggle('hidden', !active);
        });

        localStorage.setItem(ACTIVE_TAB_KEY, name);

        const body = document.getElementById('settingsBody');
        if (body) body.scrollTop = 0;
        if (name === 'sources') updateCounts();
    }

    // ---------------- 初始化 ----------------

    function ensureDefaults() {
        const sites = (typeof API_SITES !== 'undefined' && API_SITES) || [];
        const siteList = Array.isArray(sites) ? sites : [];

        // 默认选中前 5 条视频源
        const defaults = siteList.slice(0, 5).map(function (site) { return site.url; });

        const initialized = localStorage.getItem('hasInitializedDefaults') === 'true';
        const hasValidSelection = Array.isArray(selectedAPIs) && selectedAPIs.some(function (id) {
            return (typeof id === 'string' && id.indexOf('custom_') === 0) || !!getAPISite(id);
        });
        if (initialized && hasValidSelection) return;

        selectedAPIs = defaults;
        localStorage.setItem('selectedAPIs', JSON.stringify(defaults));

        if (!initialized) {
            localStorage.setItem('yellowFilterEnabled', 'true');
            localStorage.setItem(adFilterKey(), 'true');
            localStorage.setItem('doubanEnabled', 'true');
            localStorage.setItem('hasInitializedDefaults', 'true');
        }
    }

    function bindSourceListEvents() {
        const list = document.getElementById('sourceList');
        if (!list) return;

        list.addEventListener('click', function (event) {
            const button = event.target.closest('button[data-action]');
            if (!button) return;
            const row = button.closest('.source-row');
            if (!row) return;

            const id = row.dataset.id;
            const action = button.dataset.action;
            event.stopPropagation();

            if (action === 'up') moveSource(id, -1);
            else if (action === 'down') moveSource(id, 1);
            else if (action === 'edit') openSourceForm(parseInt(id.slice(7), 10));
            else if (action === 'delete') deleteCustomSource(parseInt(id.slice(7), 10));
        });

        list.addEventListener('change', function (event) {
            const input = event.target.closest('input[data-action="toggle"]');
            if (!input) return;
            const row = input.closest('.source-row');
            if (!row) return;
            setSourceEnabled(row.dataset.id, input.checked);
        });

        let draggingId = null;

        list.addEventListener('dragstart', function (event) {
            const row = event.target.closest('.source-row');
            if (!row) return;
            draggingId = row.dataset.id;
            row.classList.add('is-dragging');
            if (event.dataTransfer) {
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', draggingId);
            }
        });

        list.addEventListener('dragend', function () {
            list.querySelectorAll('.is-dragging, .is-drag-over').forEach(function (el) {
                el.classList.remove('is-dragging', 'is-drag-over');
            });
            draggingId = null;
        });

        list.addEventListener('dragover', function (event) {
            const row = event.target.closest('.source-row');
            if (!row || !draggingId || row.dataset.id === draggingId) return;
            event.preventDefault();
            list.querySelectorAll('.is-drag-over').forEach(function (el) { el.classList.remove('is-drag-over'); });
            row.classList.add('is-drag-over');
        });

        list.addEventListener('drop', function (event) {
            const row = event.target.closest('.source-row');
            if (!row || !draggingId) return;
            event.preventDefault();
            const dragged = draggingId;
            list.querySelectorAll('.is-dragging, .is-drag-over').forEach(function (el) {
                el.classList.remove('is-dragging', 'is-drag-over');
            });
            draggingId = null;
            reorderBefore(dragged, row.dataset.id);
        });
    }

    function initSettingsPanel() {
        if (initialized) return;
        if (!document.getElementById('settingsPanel')) return;
        initialized = true;

        // 面板打开时锁定页面滚动，关闭时恢复，避免移动端滑动穿透
        const panel = document.getElementById('settingsPanel');
        const syncBodyScrollLock = function () {
            const open = panel.classList.contains('show');
            document.body.classList.toggle('settings-open', open);
            // 抽屉关闭时一并收起浮窗菜单、弹窗与导入面板，避免残留在页面上
            if (!open) {
                closeAddSourceMenu();
                closeSourceForm();
            }
        };
        syncBodyScrollLock();
        new MutationObserver(syncBodyScrollLock).observe(panel, {
            attributes: true,
            attributeFilter: ['class']
        });

        // 观看历史面板打开时同样锁住页面滚动
        const historyPanel = document.getElementById('historyPanel');
        if (historyPanel) {
            const syncHistoryScrollLock = function () {
                document.body.classList.toggle('history-open', historyPanel.classList.contains('show'));
            };
            syncHistoryScrollLock();
            new MutationObserver(syncHistoryScrollLock).observe(historyPanel, {
                attributes: true,
                attributeFilter: ['class']
            });
        }

        // 面板/抽屉内的滚动边界拦截由 js/overlay-guard.js 统一处理，这里只负责 body 锁

        ensureDefaults();
        bindSourceListEvents();
        initGeneralSettings();
        initPlaybackSettings();
        renderSourceList();

        // 添加源浮窗：点击空白处或按 Esc 关闭
        document.addEventListener('click', function (event) {
            const menu = document.getElementById('addSourceMenu');
            if (!menu || menu.classList.contains('hidden')) return;
            if (event.target.closest('.settings-menu-wrap')) return;
            closeAddSourceMenu();
        });
        document.addEventListener('keydown', function (event) {
            if (event.key !== 'Escape') return;
            const dialog = document.getElementById('sourceDialog');
            if (dialog && !dialog.classList.contains('hidden')) {
                closeSourceForm();
                return;
            }
            closeAddSourceMenu();
        });

        switchSettingsTab(localStorage.getItem(ACTIVE_TAB_KEY) || 'sources');
        enforceAdultRule();
    }

    // 暴露给 HTML 内联事件与 app.js
    window.switchSettingsTab = switchSettingsTab;
    window.renderSourceList = renderSourceList;
    window.openSourceForm = openSourceForm;
    window.closeSourceForm = closeSourceForm;
    window.saveSourceForm = saveSourceForm;
    window.openUrlImportDialog = openUrlImportDialog;
    window.confirmSourceDialog = confirmSourceDialog;
    window.testAllSources = testAllSources;
    window.toggleAllSources = toggleAllSources;
    window.sortSourcesByLatency = sortSourcesByLatency;
    window.openTextImportDialog = openTextImportDialog;
    window.importSourcesFromText = importSourcesFromText;
    window.importSourcesFromUrl = importSourcesFromUrl;
    window.triggerImportFile = triggerImportFile;
    window.handleImportFile = handleImportFile;
    window.exportSourcesToFile = exportSourcesToFile;
    window.exportSourcesToClipboard = exportSourcesToClipboard;
    window.toggleAddSourceMenu = toggleAddSourceMenu;
    window.closeAddSourceMenu = closeAddSourceMenu;
    window.toggleSourceSubmenu = toggleSourceSubmenu;
    window.startManualAdd = startManualAdd;
    window.startImportFile = startImportFile;
    window.startImportUrl = startImportUrl;
    window.startImportText = startImportText;
    window.initSettingsPanel = initSettingsPanel;

    // 供 player.js 复用的缓冲档位表
    window.PLAYBACK_BUFFER_PROFILES = BUFFER_PROFILES;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initSettingsPanel);
    } else {
        initSettingsPanel();
    }
})();
