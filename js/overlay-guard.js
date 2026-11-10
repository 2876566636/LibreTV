/**
 * 全局浮层滚动守卫
 *
 * 解决的问题：详情选集、换源、设置抽屉等浮层内部滚到顶/底后，继续滑动会把
 * 手势传给底层页面（滚动穿透），或在移动端触发浏览器下拉刷新。
 *
 * 做法：不依赖任何具体弹窗的 id，运行时按「position: fixed 且覆盖大半个视口」
 * 判定浮层，再按滚动边界拦截 touchmove / wheel。CSS 侧另有 overscroll-behavior
 * 作为原生兜底，两者互不冲突。
 */
(function () {
    'use strict';

    const EDGE = 1;                 // 边界容差（px）
    const MIN_MOVE = 3;             // 小于该位移不处理，交给浏览器
    const OVERLAY_HEIGHT_RATIO = 0.8;
    const OVERLAY_AREA_RATIO = 0.5;
    const WHEEL_CACHE_MS = 400;

    function isEditable(node) {
        if (!node || node.nodeType !== 1) return false;
        const tag = node.tagName;
        return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || node.isContentEditable === true;
    }

    function isVisible(style) {
        return style.display !== 'none'
            && style.visibility !== 'hidden'
            && parseFloat(style.opacity) !== 0;
    }

    // 竖长条（抽屉）或大面积（模态）都算浮层；固定在顶部的小工具条不算
    function isOverlayElement(node) {
        const style = getComputedStyle(node);
        if (style.position !== 'fixed' || !isVisible(style)) return false;

        const rect = node.getBoundingClientRect();
        if (rect.width < 120 || rect.height < 120) return false;

        const viewportWidth = window.innerWidth || 1;
        const viewportHeight = window.innerHeight || 1;
        if (rect.height >= viewportHeight * OVERLAY_HEIGHT_RATIO) return true;
        return rect.width * rect.height >= viewportWidth * viewportHeight * OVERLAY_AREA_RATIO;
    }

    function findOverlay(target) {
        let node = target;
        while (node && node !== document.body && node !== document.documentElement) {
            if (node.nodeType === 1 && isOverlayElement(node)) return node;
            node = node.parentElement;
        }
        return null;
    }

    function isScrollableY(node) {
        const style = getComputedStyle(node);
        const overflowY = style.overflowY;
        if (overflowY !== 'auto' && overflowY !== 'scroll' && overflowY !== 'overlay') return false;
        return node.scrollHeight - node.clientHeight > 2;
    }

    function findScroller(target, overlay) {
        let node = target;
        while (node && node !== document.body && node !== document.documentElement) {
            if (node.nodeType === 1 && isScrollableY(node)) return node;
            if (overlay && node === overlay) break;
            node = node.parentElement;
        }
        return null;
    }

    function atTop(element) {
        return element.scrollTop <= EDGE;
    }

    function atBottom(element) {
        return Math.ceil(element.scrollTop + element.clientHeight) >= element.scrollHeight - EDGE;
    }

    function buildGesture(target) {
        if (isEditable(target)) return null;
        const overlay = findOverlay(target);
        return {
            overlay: overlay,
            scroller: overlay ? findScroller(target, overlay) : null
        };
    }

    function blocksScroll(gesture, deltaY) {
        if (!gesture || !gesture.overlay) return false;
        if (!gesture.scroller) return true;                 // 浮层本身没有可滚内容
        if (deltaY > 0 && atTop(gesture.scroller)) return true;
        if (deltaY < 0 && atBottom(gesture.scroller)) return true;
        return false;
    }

    // ---------- 触摸 ----------

    let gesture = null;
    let startY = 0;

    document.addEventListener('touchstart', function (event) {
        if (event.touches.length !== 1) {
            gesture = null;
            return;
        }
        startY = event.touches[0].clientY;
        gesture = buildGesture(event.target);
    }, { passive: true, capture: true });

    document.addEventListener('touchmove', function (event) {
        if (!event.cancelable || event.touches.length !== 1) return;

        const deltaY = event.touches[0].clientY - startY;
        if (Math.abs(deltaY) < MIN_MOVE) return;

        if (gesture && gesture.overlay) {
            if (blocksScroll(gesture, deltaY)) event.preventDefault();
            return;
        }

        // 页面本身：已经在顶部还继续下拉，拦住浏览器下拉刷新
        const scroller = document.scrollingElement || document.documentElement;
        if (scroller && deltaY > 0 && scroller.scrollTop <= 0) event.preventDefault();
    }, { passive: false, capture: true });

    // ---------- 滚轮 ----------

    let wheelGesture = null;
    let wheelAt = 0;

    document.addEventListener('wheel', function (event) {
        if (!event.cancelable || event.ctrlKey) return;
        if (Math.abs(event.deltaY) < 1) return;

        const now = Date.now();
        if (!wheelGesture || now - wheelAt > WHEEL_CACHE_MS) {
            wheelGesture = buildGesture(event.target);
            wheelAt = now;
        }
        if (!wheelGesture || !wheelGesture.overlay) return;

        // 滚动位置每次都在变，边界需实时判断
        // wheel 的 deltaY 方向与手指位移相反：deltaY > 0 表示向下滚（内容上移）
        if (blocksScroll(wheelGesture, -event.deltaY)) event.preventDefault();
    }, { passive: false, capture: true });
})();
