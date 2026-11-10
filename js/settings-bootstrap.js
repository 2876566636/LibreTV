/**
 * 设置相关的全局默认值初始化（首屏必须执行）
 *
 * settings.js 改为按需加载后，默认选中的视频源与首屏开关不能再等用户打开
 * 设置面板才初始化，否则新用户第一次搜索时 selectedAPIs 为空。这段逻辑与
 * 面板 UI 无关，单独前置到首屏；settings.js 里的 ensureDefaults() 会委托到这里。
 */
(function () {
    'use strict';

    window.ensureDefaultAPIs = function () {
        // app.js 未执行时 selectedAPIs 尚不存在，直接跳过（页面随后不会再用到）
        if (typeof selectedAPIs === 'undefined') return;

        var sites = (typeof API_SITES !== 'undefined' && API_SITES) || [];
        var siteList = Array.isArray(sites) ? sites : [];
        var defaults = siteList.slice(0, 5).map(function (site) { return site.url; });

        var initialized = localStorage.getItem('hasInitializedDefaults') === 'true';
        var hasValidSelection = Array.isArray(selectedAPIs) && selectedAPIs.some(function (id) {
            return (typeof id === 'string' && id.indexOf('custom_') === 0)
                || (typeof getAPISite === 'function' && !!getAPISite(id));
        });
        if (initialized && hasValidSelection) return;

        selectedAPIs = defaults;
        localStorage.setItem('selectedAPIs', JSON.stringify(defaults));

        if (!initialized) {
            var adKey = (typeof PLAYER_CONFIG !== 'undefined' && PLAYER_CONFIG.adFilteringStorage)
                || 'adFilteringEnabled';
            localStorage.setItem('yellowFilterEnabled', 'true');
            localStorage.setItem(adKey, 'true');
            localStorage.setItem('doubanEnabled', 'true');
            localStorage.setItem('hasInitializedDefaults', 'true');
        }
    };

    window.ensureDefaultAPIs();
})();
