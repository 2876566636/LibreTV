/**
 * 视频详情视图组件（逻辑层）
 *
 * 与 modal-shell.js 配套：壳负责 #modal 容器，本文件负责往 #modalContent
 * 里渲染详情信息、选集网格与排序。
 *
 * 边界：
 * - 播放联动（playVideo / showVideoPlayer / closeVideoPlayer / 上一集下一集）
 *   仍在 js/app.js，因为它要操作首页的 #resultsArea、#doubanArea 与 iframe。
 * - currentEpisodes / currentEpisodeIndex / currentVideoTitle / episodesReversed
 *   仍由 app.js 声明为全局 let，这里只读写，不另建一份状态。
 * - 内联 onclick 依赖全局函数名，因此保持 window.showDetails 等同名导出。
 * - 本文件首屏同步加载、不做懒加载：只有 ~10 KB，收益远小于 settings.js，
 *   却能避免首次点搜索结果卡片时才加载脚本的延迟与时序问题。
 */
(function () {
    'use strict';

    async function showDetails(id, vod_name, sourceCode) {
        // 密码保护校验
        if (window.isPasswordProtected && window.isPasswordVerified) {
            if (window.isPasswordProtected() && !window.isPasswordVerified()) {
                showPasswordModal && showPasswordModal();
                return;
            }
        }
        if (!id) {
            showToast('视频ID无效', 'error');
            return;
        }

        showLoading();
        try {
            // 构建API参数
            let apiParams = '';

            // 处理自定义API源
            if (sourceCode.startsWith('custom_')) {
                const customIndex = sourceCode.replace('custom_', '');
                const customApi = getCustomApiInfo(customIndex);
                if (!customApi) {
                    showToast('自定义API配置无效', 'error');
                    hideLoading();
                    return;
                }
                // 传递 detail 字段
                if (customApi.detail) {
                    apiParams = '&customApi=' + encodeURIComponent(customApi.url) + '&customDetail=' + encodeURIComponent(customApi.detail) + '&source=custom';
                } else {
                    apiParams = '&customApi=' + encodeURIComponent(customApi.url) + '&source=custom';
                }
            } else {
                // 内置API
                apiParams = '&source=' + sourceCode;
            }

            // Add a timestamp to prevent caching
            const timestamp = new Date().getTime();
            const cacheBuster = `&_t=${timestamp}`;
            const response = await fetch(`/api/detail?id=${encodeURIComponent(id)}${apiParams}${cacheBuster}`);

            const data = await response.json();

            const modal = document.getElementById('modal');
            const modalTitle = document.getElementById('modalTitle');
            const modalContent = document.getElementById('modalContent');

            // 显示来源信息
            const sourceName = data.videoInfo && data.videoInfo.source_name ?
                ` <span class="text-sm font-normal text-gray-400">(${data.videoInfo.source_name})</span>` : '';

            // 不对标题进行截断处理，允许完整显示
            modalTitle.innerHTML = `<span class="break-words">${vod_name || '未知视频'}</span>${sourceName}`;
            currentVideoTitle = vod_name || '未知视频';

            if (data.episodes && data.episodes.length > 0) {
                // 构建详情信息HTML
                let detailInfoHtml = '';
                if (data.videoInfo) {
                    // Prepare description text, strip HTML and trim whitespace
                    const descriptionText = data.videoInfo.desc ? data.videoInfo.desc.replace(/<[^>]+>/g, '').trim() : '';

                    // Check if there's any actual grid content
                    const hasGridContent = data.videoInfo.type || data.videoInfo.year || data.videoInfo.area || data.videoInfo.director || data.videoInfo.actor || data.videoInfo.remarks;

                    if (hasGridContent || descriptionText) { // Only build if there's something to show
                        detailInfoHtml = `
                <div class="modal-detail-info">
                    ${hasGridContent ? `
                    <div class="detail-grid">
                        ${data.videoInfo.type ? `<div class="detail-item"><span class="detail-label">类型:</span> <span class="detail-value">${data.videoInfo.type}</span></div>` : ''}
                        ${data.videoInfo.year ? `<div class="detail-item"><span class="detail-label">年份:</span> <span class="detail-value">${data.videoInfo.year}</span></div>` : ''}
                        ${data.videoInfo.area ? `<div class="detail-item"><span class="detail-label">地区:</span> <span class="detail-value">${data.videoInfo.area}</span></div>` : ''}
                        ${data.videoInfo.director ? `<div class="detail-item"><span class="detail-label">导演:</span> <span class="detail-value">${data.videoInfo.director}</span></div>` : ''}
                        ${data.videoInfo.actor ? `<div class="detail-item"><span class="detail-label">主演:</span> <span class="detail-value">${data.videoInfo.actor}</span></div>` : ''}
                        ${data.videoInfo.remarks ? `<div class="detail-item"><span class="detail-label">备注:</span> <span class="detail-value">${data.videoInfo.remarks}</span></div>` : ''}
                    </div>` : ''}
                    ${descriptionText ? `
                    <div class="detail-desc">
                        <p class="detail-label">简介:</p>
                        <p class="detail-desc-content">${descriptionText}</p>
                    </div>` : ''}
                </div>
                `;
                    }
                }

                currentEpisodes = data.episodes;
                currentEpisodeIndex = 0;

                modalContent.innerHTML = `
                ${detailInfoHtml}
                <div class="flex flex-wrap items-center justify-between mb-4 gap-2">
                    <div class="flex items-center gap-2">
                        <button onclick="toggleEpisodeOrder('${sourceCode}', '${id}')" 
                                class="px-3 py-1.5 bg-[#333] hover:bg-[#444] border border-[#444] rounded text-sm transition-colors flex items-center gap-1">
                            <svg class="w-4 h-4 transform ${episodesReversed ? 'rotate-180' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 14l-7 7m0 0l-7-7m7 7V3"></path>
                            </svg>
                            <span>${episodesReversed ? '正序排列' : '倒序排列'}</span>
                        </button>
                        <span class="text-gray-400 text-sm">共 ${data.episodes.length} 集</span>
                    </div>
                </div>
                <div id="episodesGrid" class="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
                    ${renderEpisodes(vod_name, sourceCode, id)}
                </div>
            `;
            } else {
                modalContent.innerHTML = `
                <div class="text-center py-8">
                    <div class="text-red-400 mb-2">❌ 未找到播放资源</div>
                    <div class="text-gray-500 text-sm">该视频可能暂时无法播放，请尝试其他视频</div>
                </div>
            `;
            }

            modal.classList.remove('hidden');
        } catch (error) {
            console.error('获取详情错误:', error);
            showToast('获取详情失败，请稍后重试', 'error');
        } finally {
            hideLoading();
        }
    }

    // 辅助函数用于渲染剧集按钮（使用当前的排序状态）
    function renderEpisodes(vodName, sourceCode, vodId) {
        const episodes = episodesReversed ? [...currentEpisodes].reverse() : currentEpisodes;
        return episodes.map((episode, index) => {
            // 根据倒序状态计算真实的剧集索引
            const realIndex = episodesReversed ? currentEpisodes.length - 1 - index : index;
            return `
            <button id="episode-${realIndex}" onclick="playVideo('${episode}','${vodName.replace(/"/g, '&quot;')}', '${sourceCode}', ${realIndex}, '${vodId}')" 
                    class="px-4 py-2 bg-[#222] hover:bg-[#333] border border-[#333] rounded-lg transition-colors text-center episode-btn">
                ${realIndex + 1}
            </button>
        `;
        }).join('');
    }

    // 切换排序状态的函数
    function toggleEpisodeOrder(sourceCode, vodId) {
        episodesReversed = !episodesReversed;
        // 重新渲染剧集区域，使用 currentVideoTitle 作为视频标题
        const episodesGrid = document.getElementById('episodesGrid');
        if (episodesGrid) {
            episodesGrid.innerHTML = renderEpisodes(currentVideoTitle, sourceCode, vodId);
        }

        // 更新按钮文本和箭头方向
        const toggleBtn = document.querySelector(`button[onclick="toggleEpisodeOrder('${sourceCode}', '${vodId}')"]`);
        if (toggleBtn) {
            toggleBtn.querySelector('span').textContent = episodesReversed ? '正序排列' : '倒序排列';
            const arrowIcon = toggleBtn.querySelector('svg');
            if (arrowIcon) {
                arrowIcon.style.transform = episodesReversed ? 'rotate(180deg)' : 'rotate(0deg)';
            }
        }
    }

    // 内联 onclick 依赖全局函数名，保持同名导出
    window.showDetails = showDetails;
    window.renderEpisodes = renderEpisodes;
    window.toggleEpisodeOrder = toggleEpisodeOrder;
    window.VideoDetail = {
        showDetails: showDetails,
        renderEpisodes: renderEpisodes,
        toggleEpisodeOrder: toggleEpisodeOrder
    };
})();
