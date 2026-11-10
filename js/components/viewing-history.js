/**
 * 观看历史面板组件（DOM 模板）
 *
 * 交互逻辑仍由 js/ui.js 提供：toggleHistory / loadViewingHistory /
 * clearViewingHistory / formatTimestamp / playFromHistory 等函数被 index.html
 * 与 player.html 共用，保留在 ui.js 可避免同一份逻辑出现两份实现。
 */
(function () {
    'use strict';

    var template = `
<div id="historyPanel" class="history-panel fixed left-0 top-0 h-full bg-[#111] border-r border-[#333] p-6 z-40 transform -translate-x-full transition-transform duration-300" aria-label="观看历史" aria-hidden="true">
    <div class="flex justify-between items-center mb-6">
        <button onclick="toggleHistory()" class="close-btn">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
        </button>
        <h3 class="text-xl font-bold gradient-text mx-auto">观看历史</h3>
        <div class="w-4"></div>
    </div>
    <div id="historyList" class="pb-4">
        <div class="text-center text-gray-500 py-8">暂无观看记录</div>
    </div>
    <div class="mt-4 text-center sticky bottom-0 pb-2 pt-2 bg-[#111]">
        <button onclick="clearViewingHistory()" class="px-4 py-2 w-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 hover:from-indigo-600 hover:via-purple-600 hover:to-pink-600 text-white rounded-lg text-sm transition-all duration-300 shadow-md hover:shadow-lg">
            清空历史记录
        </button>
    </div>
</div>`;

    window.Components.define('viewing-history', { template: template });
})();
