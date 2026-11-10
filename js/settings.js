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
        const sites = (typeof API_SITES !== 'undefined' && API_SITES) || window.API_SITES || {};
        return Object.keys(sites).map(function (key) {
            const api = sites[key] || {};
            return {
                id: key,
                type: 'builtin',
                name: api.name || key,
                url: api.api || '',
                detail: api.detail || '',
                adult: !!api.adult
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

    function openSourceForm(index) {
        const editor = document.getElementById('sourceEditor');
        if (!editor) return;

        const title = document.getElementById('sourceEditorTitle');
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
            if (title) title.textContent = '添加视频源';
            nameInput.value = '';
            urlInput.value = '';
            if (detailInput) detailInput.value = '';
            if (adultInput) adultInput.checked = false;
        }

        editor.classList.remove('hidden');
        editor.scrollIntoView({ block: 'nearest' });
        nameInput.focus();
    }

    function closeSourceForm() {
        const editor = document.getElementById('sourceEditor');
        if (editor) editor.classList.add('hidden');
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
        if (localStorage.getItem('hasInitializedDefaults')) return;

        const sites = (typeof API_SITES !== 'undefined' && API_SITES) || {};
        const defaults = ['tyyszy', 'bfzy', 'dyttzy', 'ruyi'].filter(function (id) { return !!sites[id]; });

        selectedAPIs = defaults;
        localStorage.setItem('selectedAPIs', JSON.stringify(defaults));
        localStorage.setItem('yellowFilterEnabled', 'true');
        localStorage.setItem(adFilterKey(), 'true');
        localStorage.setItem('doubanEnabled', 'true');
        localStorage.setItem('hasInitializedDefaults', 'true');
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
            document.body.classList.toggle('settings-open', panel.classList.contains('show'));
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

        // 部分移动浏览器不支持 overscroll-behavior，用 touchmove 兜底阻止面板下拉刷新
        let touchStartY = 0;
        document.addEventListener('touchstart', function (event) {
            if (event.touches.length === 1) touchStartY = event.touches[0].clientY;
        }, { passive: true });

        document.addEventListener('touchmove', function (event) {
            const settingsOpen = document.body.classList.contains('settings-open');
            const historyPanelEl = document.getElementById('historyPanel');
            const historyOpen = !!(historyPanelEl && historyPanelEl.classList.contains('show'));
            if (!settingsOpen && !historyOpen) return;
            if (event.touches.length !== 1) return;

            const deltaY = event.touches[0].clientY - touchStartY;
            if (deltaY === 0) return;

            const target = event.target;
            const scroller = target && target.closest ? target.closest('.settings-body, .history-panel') : null;
            if (!scroller) {
                event.preventDefault();
                return;
            }

            // 到顶继续下拉、到底继续上滑时阻止滚动链，避免带动首页
            const atTop = scroller.scrollTop <= 0;
            const atBottom = Math.ceil(scroller.scrollTop + scroller.clientHeight) >= scroller.scrollHeight - 1;
            if ((deltaY > 0 && atTop) || (deltaY < 0 && atBottom)) {
                event.preventDefault();
            }
        }, { passive: false });

        ensureDefaults();
        bindSourceListEvents();
        initGeneralSettings();
        initPlaybackSettings();
        renderSourceList();
        switchSettingsTab(localStorage.getItem(ACTIVE_TAB_KEY) || 'sources');
        enforceAdultRule();
    }

    // 暴露给 HTML 内联事件与 app.js
    window.switchSettingsTab = switchSettingsTab;
    window.renderSourceList = renderSourceList;
    window.openSourceForm = openSourceForm;
    window.closeSourceForm = closeSourceForm;
    window.saveSourceForm = saveSourceForm;
    window.testAllSources = testAllSources;
    window.toggleAllSources = toggleAllSources;
    window.sortSourcesByLatency = sortSourcesByLatency;
    window.initSettingsPanel = initSettingsPanel;

    // 供 player.js 复用的缓冲档位表
    window.PLAYBACK_BUFFER_PROFILES = BUFFER_PROFILES;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initSettingsPanel);
    } else {
        initSettingsPanel();
    }
})();
