/**
 * 通用模态框外壳组件
 *
 * index.html（视频详情 / 选集）与 player.html（切换资源）原来各写了一份
 * 几乎相同的 #modal DOM，这里合并成一份，通过 body 上的
 * data-modal-variant="detail | switch" 区分背景遮罩与 z-index。
 *
 * 关闭逻辑仍在 js/ui.js 的 closeModal()，两页共用，不搬动。
 */
(function () {
    'use strict';

    var variant = (document.body && document.body.getAttribute('data-modal-variant')) || 'detail';
    var isSwitch = variant === 'switch';
    var backdrop = isSwitch ? 'bg-black/60' : 'bg-black/95';
    var zIndex = isSwitch ? 'z-[10000]' : 'z-40';

    var template = `
<div id="modal" class="fixed inset-0 ${backdrop} hidden flex items-center justify-center transition-opacity duration-300 ${zIndex}" data-modal-variant="${variant}">
    <div class="modal-panel bg-[#111] p-8 rounded-lg w-11/12 max-w-4xl border border-[#333] max-h-[90vh] flex flex-col">
        <div class="modal-head flex justify-between items-center mb-6 flex-none">
            <h2 id="modalTitle" class="text-2xl font-bold gradient-text break-words pr-4 max-w-[80%]"></h2>
            <button onclick="closeModal()" class="text-gray-400 hover:text-white text-2xl transition-colors flex-shrink-0">&times;</button>
        </div>
        <div id="modalContent" class="overflow-auto flex-1 min-h-0">
            <div class="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
            </div>
        </div>
    </div>
</div>`;

    window.Components.define('modal-shell', {
        template: template,
        mountPoint: '#modal-root'
    });
})();
