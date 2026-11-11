/**
 * 应用版本号展示
 *
 * 版本号是本地常量，不读文件、不请求远端、不和上游比对，`checkForUpdates` 已移除。
 * 发版时只改下面的 APP_VERSION；页面里放 <span data-app-version></span> 即可被填充，
 * 没有占位元素时插在页脚版权行下方。
 */
(function () {
    'use strict';

    // 版本号唯一来源
    var APP_VERSION = '2026.11.11';

    window.APP_VERSION = APP_VERSION;

    function render() {
        var text = '版本 ' + APP_VERSION;
        var slots = document.querySelectorAll('[data-app-version]');
        if (slots.length) {
            Array.prototype.forEach.call(slots, function (el) {
                el.textContent = text;
            });
            return;
        }

        // 兜底：没有占位元素时，插到页脚版权行下面
        var copyright = document.querySelector('.footer p.text-gray-500.text-sm');
        if (!copyright) return;
        var p = document.createElement('p');
        p.className = 'text-gray-500 text-sm mt-1 text-center md:text-left';
        p.textContent = text;
        copyright.insertAdjacentElement('afterend', p);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', render);
    } else {
        render();
    }
})();
