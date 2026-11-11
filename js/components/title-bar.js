/**
 * 全局 titlebar 组件
 *
 * 两页共用一份组件，按 body 上的 data-titlebar-variant 渲染：
 * - home   : 历史记录 icon | 首页 icon | 搜索框 | 设置 icon
 * - player : 首页 icon                  | 搜索框 | 返回 icon
 *
 * 首页大 logo 只留在 index.html 的内容区，播放页等其它页面不再重复放 logo，
 * 统一靠顶栏的首页 icon 做品牌与回首页入口。
 *
 * 首页搜索框保留原有 id（searchInput / clearSearchInput / recentSearches），
 * 因此 app.js / ui.js / index-page.js 的事件与搜索流程完全不用改。
 * 播放页搜索框 id 为 titlebarSearchInput，同样带 #recentSearches 浮层；
 * 回车或点搜索跳回首页 /?s=关键词，由 index-page.js 自动执行搜索，
 * 浮层的绑定与渲染在 ui.js 里对两个输入框都做了兼容。
 */
(function () {
    'use strict';

    var isPlayer = document.body && document.body.dataset.titlebarVariant === 'player';

    var clockIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';
    var gearIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>';
    var homeIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10.5 12 3l9 7.5"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5.5 9.6V19a1.5 1.5 0 0 0 1.5 1.5h3.25V15h3.5v5.5H17A1.5 1.5 0 0 0 18.5 19V9.6"></path></svg>';
    var backIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path></svg>';
    var searchIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-4.35-4.35M17 10.5a6.5 6.5 0 11-13 0 6.5 6.5 0 0113 0z"></path></svg>';
    var clearIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>';

    var homeTemplate = `
<header id="globalTitleBar" class="global-titlebar" data-variant="home">
    <button type="button" class="titlebar-icon-btn" onclick="toggleHistory(event)" aria-label="观看历史" title="观看历史">` + clockIcon + `</button>
    <button type="button" id="titlebarHome" class="titlebar-icon-btn" onclick="titlebarGoHome(event)" aria-label="返回首页" title="返回首页">` + homeIcon + `</button>
    <div class="titlebar-search-wrap">
        <div class="search-bar">
            <input type="text" id="searchInput" class="search-bar-input" placeholder="搜索你喜欢的视频..." autocomplete="off" aria-label="视频搜索框" oninput="toggleClearButton()">
            <button type="button" id="clearSearchInput" class="search-bar-clear hidden" onclick="clearSearchInput()" aria-label="清空搜索框" title="清空搜索框">` + clearIcon + `</button>
            <button type="button" class="search-bar-btn search-bar-btn-search" onclick="search()" aria-label="搜索" title="搜索">` + searchIcon + `</button>
        </div>
        <div id="recentSearches" class="search-history-popover hidden" aria-label="最近搜索记录"></div>
    </div>
    <button type="button" class="titlebar-icon-btn" onclick="toggleSettings(event)" aria-label="打开设置" title="打开设置">` + gearIcon + `</button>
</header>`;

    var playerTemplate = `
<header id="globalTitleBar" class="global-titlebar" data-variant="player">
    <button id="homeButton" type="button" class="titlebar-icon-btn" aria-label="返回首页" title="返回首页">` + homeIcon + `</button>
    <div class="titlebar-search-wrap">
        <div class="search-bar">
            <input type="text" id="titlebarSearchInput" class="search-bar-input" placeholder="搜索视频，回车回首页搜索" autocomplete="off" aria-label="视频搜索框" onkeydown="if(event.key==='Enter') titlebarSearch()">
            <button type="button" class="search-bar-btn search-bar-btn-search" onclick="titlebarSearch()" aria-label="搜索" title="搜索">` + searchIcon + `</button>
        </div>
        <div id="recentSearches" class="search-history-popover hidden" aria-label="最近搜索记录"></div>
    </div>
    <a href="#" id="goBack" onclick="goBack(event)" class="titlebar-icon-btn" aria-label="返回上一页" title="返回上一页">` + backIcon + `</a>
</header>`;

    window.Components.define('title-bar', {
        template: isPlayer ? playerTemplate : homeTemplate,
        mountPoint: '#titlebar-root'
    });

    // 播放页的搜索框跳回首页并带上 ?s=，由 index-page.js 自动执行搜索
    window.titlebarSearch = function () {
        var input = document.getElementById('titlebarSearchInput');
        var query = input ? input.value.trim() : '';
        if (!query) return;
        window.location.href = '/?s=' + encodeURIComponent(query);
    };

    // 首页顶栏的首页 icon：清空搜索结果回到首页初始状态（已在首页时等价于重置）
    window.titlebarGoHome = function (event) {
        if (event && typeof event.preventDefault === 'function') event.preventDefault();
        if (typeof window.resetToHome === 'function') {
            window.resetToHome();
            window.scrollTo({ top: 0, behavior: 'smooth' });
            return;
        }
        window.location.href = '/';
    };
})();
