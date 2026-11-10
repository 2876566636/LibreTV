/**
 * 设置面板组件（DOM 模板 + 逻辑脚本声明）
 *
 * 模板在首屏同步注入，保证 app.js 里的 #sourceDialog 外部点击判断、
 * overlay-guard 的浮层识别、douban.js 的开关状态同步都能拿到真实 DOM。
 * 53 KB 的 js/settings.js 改为首次打开设置面板时才加载。
 */
(function () {
    'use strict';

    var template = `
<div id="settingsPanel" class="settings-panel fixed right-0 top-0 h-full bg-[#111] border-l border-[#333] z-40" aria-label="设置面板" aria-hidden="true">
    <div class="settings-header">
        <div class="min-w-0">
            <h3 class="text-xl font-bold gradient-text">设置</h3>
            <p class="settings-subtitle">视频源、播放与通用配置</p>
        </div>
        <button onclick="toggleSettings()" class="close-btn" aria-label="关闭设置">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
        </button>
    </div>

    <!-- 设置分类 Tab -->
    <div class="settings-tabs" role="tablist" aria-label="设置分类">
        <button id="settingsTabBtnSources" class="settings-tab active" role="tab" aria-selected="true" aria-controls="settingsTabSources" onclick="switchSettingsTab('sources')">视频源</button>
        <button id="settingsTabBtnPlayback" class="settings-tab" role="tab" aria-selected="false" aria-controls="settingsTabPlayback" onclick="switchSettingsTab('playback')">播放</button>
        <button id="settingsTabBtnGeneral" class="settings-tab" role="tab" aria-selected="false" aria-controls="settingsTabGeneral" onclick="switchSettingsTab('general')">通用</button>
    </div>

    <div class="settings-body" id="settingsBody">
        <!-- 视频源管理 -->
        <section id="settingsTabSources" class="settings-tab-panel" role="tabpanel" aria-labelledby="settingsTabBtnSources">
            <div class="settings-toolbar">
                <div class="settings-toolbar-info">
                    已启用 <span id="enabledSourceCount" class="settings-strong">0</span><span class="settings-muted">/</span><span id="totalSourceCount">0</span>
                    <span id="sourceTestProgress" class="settings-muted"></span>
                    <span id="siteStatus" class="settings-muted"></span>
                </div>
                <div class="settings-toolbar-actions">
                    <div class="settings-menu-wrap">
                        <button id="addSourceMenuBtn" type="button" class="settings-chip primary" onclick="toggleAddSourceMenu(event)" aria-haspopup="true" aria-expanded="false">+ 添加</button>
                        <div id="addSourceMenu" class="settings-menu add-source-menu hidden" role="menu">
                            <button type="button" role="menuitem" onclick="startManualAdd()">手动添加</button>
                            <div class="settings-menu-group">
                                <button id="sourceSubmenuImportBtn" type="button" class="settings-menu-item has-sub" role="menuitem" aria-expanded="false" onclick="toggleSourceSubmenu('import', event)">
                                    <span>导入视频源</span>
                                    <svg class="settings-menu-arrow" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
                                    </svg>
                                </button>
                                <div id="sourceSubmenuImport" class="settings-submenu hidden" role="menu">
                                    <button type="button" role="menuitem" onclick="startImportFile()">从文件导入</button>
                                    <button type="button" role="menuitem" onclick="startImportUrl()">从 URL 导入</button>
                                    <button type="button" role="menuitem" onclick="startImportText()">从文本导入</button>
                                </div>
                            </div>
                            <div class="settings-menu-group">
                                <button id="sourceSubmenuExportBtn" type="button" class="settings-menu-item has-sub" role="menuitem" aria-expanded="false" onclick="toggleSourceSubmenu('export', event)">
                                    <span>导出视频源</span>
                                    <svg class="settings-menu-arrow" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
                                    </svg>
                                </button>
                                <div id="sourceSubmenuExport" class="settings-submenu hidden" role="menu">
                                    <button type="button" role="menuitem" onclick="exportSourcesToFile()">导出为文件</button>
                                    <button type="button" role="menuitem" onclick="exportSourcesToClipboard()">导出为文本</button>
                                </div>
                            </div>
                        </div>
                    </div>
                    <button id="testSourcesBtn" type="button" class="settings-chip" onclick="testAllSources()">测速</button>
                    <button id="sortByLatencyBtn" type="button" class="settings-chip hidden" onclick="sortSourcesByLatency()">按延迟</button>
                    <button id="toggleAllSourcesBtn" type="button" class="settings-chip" onclick="toggleAllSources()">全部启用</button>
                </div>
            </div>

            <div class="settings-search">
                <svg class="settings-search-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-4.35-4.35M17 10.5a6.5 6.5 0 11-13 0 6.5 6.5 0 0113 0z"></path>
                </svg>
                <input id="sourceFilterInput" type="text" placeholder="筛选名称或接口地址" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" oninput="renderSourceList()">
            </div>

            <input type="file" id="sourceImportFile" class="hidden" accept=".json,application/json,text/plain" onchange="handleImportFile(event)">

            <div id="sourceList" class="settings-source-list" aria-live="polite"></div>

            <p class="settings-hint">点击开关启用或停用源；↑ ↓ 调整搜索顺序；自定义源可编辑删除。测速结果仅在当前页面有效。</p>
        </section>

        <!-- 播放设置 -->
        <section id="settingsTabPlayback" class="settings-tab-panel hidden" role="tabpanel" aria-labelledby="settingsTabBtnPlayback">
            <div class="settings-section">
                <div class="settings-section-title">播放控制</div>

                <div class="settings-row">
                    <div class="settings-row-text">
                        <div class="settings-row-title">移动端手势操作</div>
                        <p class="settings-row-desc">左右滑动调节进度、上下滑动调节音量，双击全屏；关闭后仅保留点击暂停</p>
                    </div>
                    <label class="settings-switch">
                        <input type="checkbox" id="mobileGestureToggle">
                        <span class="settings-switch-track"></span>
                    </label>
                </div>

                <div class="settings-row settings-row-stack">
                    <div class="settings-row-text">
                        <div class="settings-row-title">长按倍速倍率</div>
                        <p class="settings-row-desc">长按播放器时临时加速，松手恢复原来的速度</p>
                    </div>
                    <div class="settings-segment" id="longPressRateSegment" role="group" aria-label="长按倍速倍率">
                        <button type="button" data-rate="1.5">1.5x</button>
                        <button type="button" data-rate="2">2.0x</button>
                        <button type="button" data-rate="3">3.0x</button>
                        <button type="button" data-rate="4">4.0x</button>
                    </div>
                </div>

                <div class="settings-row settings-row-stack">
                    <div class="settings-row-text">
                        <div class="settings-row-title">播放缓冲</div>
                        <p class="settings-row-desc" id="bufferLevelDesc">均衡：默认缓冲，兼顾起播速度与流畅度</p>
                    </div>
                    <div class="settings-segment" id="bufferLevelSegment" role="group" aria-label="播放缓冲">
                        <button type="button" data-level="low">低</button>
                        <button type="button" data-level="normal">均衡</button>
                        <button type="button" data-level="high">高</button>
                    </div>
                </div>
            </div>

            <p class="settings-hint">播放设置会在下次打开播放器时生效。</p>
        </section>

        <!-- 通用设置 -->
        <section id="settingsTabGeneral" class="settings-tab-panel hidden" role="tabpanel" aria-labelledby="settingsTabBtnGeneral">
            <div class="settings-section">
                <div class="settings-section-title">内容</div>

                <div class="settings-row">
                    <div class="settings-row-text">
                        <div class="settings-row-title">黄色内容过滤</div>
                        <p class="settings-row-desc" id="yellowFilterDesc">过滤"伦理片"等内容；启用 18+ 源时自动关闭</p>
                    </div>
                    <label class="settings-switch">
                        <input type="checkbox" id="yellowFilterToggle">
                        <span class="settings-switch-track"></span>
                    </label>
                </div>

                <div class="settings-row">
                    <div class="settings-row-text">
                        <div class="settings-row-title">分片广告过滤</div>
                        <p class="settings-row-desc">过滤 m3u8 分片中的插片广告；关闭可减少旧版浏览器卡顿</p>
                    </div>
                    <label class="settings-switch">
                        <input type="checkbox" id="adFilterToggle">
                        <span class="settings-switch-track"></span>
                    </label>
                </div>

                <div class="settings-row">
                    <div class="settings-row-text">
                        <div class="settings-row-title">豆瓣热门推荐</div>
                        <p class="settings-row-desc">首页显示豆瓣热门影视内容</p>
                    </div>
                    <label class="settings-switch">
                        <input type="checkbox" id="doubanToggle">
                        <span class="settings-switch-track"></span>
                    </label>
                </div>

                <div class="settings-row">
                    <div class="settings-row-text">
                        <div class="settings-row-title">搜索历史条数</div>
                        <p class="settings-row-desc">首页「最近搜索」最多保留的条数，范围 1–50</p>
                    </div>
                    <input id="searchHistoryLimitInput" class="settings-number-input" type="number" min="1" max="50" step="1" inputmode="numeric" aria-label="搜索历史条数">
                </div>
            </div>

            <div class="settings-section">
                <div class="settings-section-title">配置与数据</div>
                <div class="settings-button-group">
                    <button type="button" onclick="importConfig()" class="settings-button">导入配置</button>
                    <button type="button" onclick="exportConfig()" class="settings-button">导出配置</button>
                    <button type="button" onclick="clearLocalStorage()" class="settings-button danger">清除 Cookie 与本地数据</button>
                </div>
                <p class="settings-row-desc mt-2">导入 / 导出会包含视频源、播放设置与观看历史。</p>
            </div>
        </section>
    </div>
</div>

<!-- 视频源弹窗：手动添加 / 编辑 / 从 URL 导入 -->
<div id="sourceDialog" class="settings-dialog hidden" role="dialog" aria-modal="true" aria-labelledby="sourceEditorTitle">
    <div class="settings-dialog-backdrop" onclick="closeSourceForm()"></div>
    <div class="settings-dialog-panel">
        <div class="settings-dialog-header">
            <h3 class="settings-dialog-title" id="sourceEditorTitle">手动添加视频源</h3>
            <button type="button" class="settings-dialog-close" aria-label="关闭" onclick="closeSourceForm()">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                </svg>
            </button>
        </div>

        <div class="settings-dialog-body">
            <div id="sourceDialogManual" class="settings-dialog-section">
                <label class="settings-field">
                    <span class="settings-field-label">名称</span>
                    <input id="sourceEditorName" class="settings-input" type="text" placeholder="例如：我的资源站" autocomplete="off">
                </label>
                <label class="settings-field">
                    <span class="settings-field-label">接口地址</span>
                    <input id="sourceEditorUrl" class="settings-input" type="text" placeholder="https://example.com/api.php/provide/vod" autocomplete="off" autocapitalize="off" spellcheck="false">
                </label>
                <label class="settings-field">
                    <span class="settings-field-label">详情地址（可选）</span>
                    <input id="sourceEditorDetail" class="settings-input" type="text" placeholder="https://example.com" autocomplete="off">
                </label>
                <label class="settings-checkbox">
                    <input type="checkbox" id="sourceEditorAdult">
                    <span>成人内容（18+）</span>
                </label>
            </div>

            <div id="sourceDialogUrl" class="settings-dialog-section hidden">
                <label class="settings-field">
                    <span class="settings-field-label">JSON 地址</span>
                    <input id="dialogSourceUrl" class="settings-input" type="text" placeholder="https://example.com/sources.json" autocomplete="off" autocapitalize="off" spellcheck="false">
                </label>
                <p class="settings-editor-note">从远程地址拉取视频源列表，内容为 name、url、adult（可选）的 JSON 数组；重复地址会自动跳过。</p>
            </div>

            <div id="sourceDialogText" class="settings-dialog-section hidden">
                <p class="settings-editor-note">粘贴 JSON 数组，字段为 name、url、adult（可选），与内置源 api-sites.js 格式一致；重复的地址会自动跳过。</p>
                <textarea id="dialogSourceText" class="settings-textarea" rows="8" placeholder='[{"name":"红牛资源","url":"https://www.hongniuzy2.com/api.php/provide/vod","adult":false}]' autocomplete="off" spellcheck="false"></textarea>
                <button type="button" class="settings-chip" onclick="triggerImportFile()">选择文件…</button>
            </div>
        </div>

        <div class="settings-dialog-footer">
            <button type="button" class="settings-chip" onclick="closeSourceForm()">取消</button>
            <button type="button" class="settings-chip primary" id="sourceDialogConfirm" onclick="confirmSourceDialog()">保存</button>
        </div>
    </div>
</div>`;

    window.Components.define('settings', {
        template: template,
        script: 'js/settings.js?v=20261110-17'
    });
})();
