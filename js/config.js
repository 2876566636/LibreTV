// 全局常量配置
const PROXY_URL = '/proxy/';    // 适用于 Cloudflare, Netlify (带重写), Vercel (带重写)
// const HOPLAYER_URL = 'https://hoplayer.com/index.html';
const SEARCH_HISTORY_KEY = 'videoSearchHistory';
const DEFAULT_MAX_HISTORY_ITEMS = 10;
const MAX_HISTORY_ITEMS = DEFAULT_MAX_HISTORY_ITEMS;
const SEARCH_HISTORY_LIMIT_KEY = 'searchHistoryLimit';

// 搜索历史条数可由用户在设置页配置，范围 1-50
function getMaxHistoryItems() {
    const value = Number.parseInt(localStorage.getItem(SEARCH_HISTORY_LIMIT_KEY), 10);
    if (Number.isFinite(value) && value >= 1 && value <= 50) {
        return value;
    }
    return DEFAULT_MAX_HISTORY_ITEMS;
}

// 首页豆瓣推荐每次加载的条目数，范围 1-50，默认 16
const DOUBAN_PAGE_SIZE_KEY = 'doubanPageSize';
const DEFAULT_DOUBAN_PAGE_SIZE = 16;

function getDoubanPageSize() {
    const value = Number.parseInt(localStorage.getItem(DOUBAN_PAGE_SIZE_KEY), 10);
    if (Number.isFinite(value) && value >= 1 && value <= 50) {
        return value;
    }
    return DEFAULT_DOUBAN_PAGE_SIZE;
}

// 密码保护配置
// 注意：PASSWORD 环境变量是必需的，所有部署都必须设置密码以确保安全
const PASSWORD_CONFIG = {
    localStorageKey: 'passwordVerified',  // 存储验证状态的键名
    verificationTTL: 90 * 24 * 60 * 60 * 1000  // 验证有效期（90天，约3个月）
};

// 网站信息配置
const SITE_CONFIG = {
    name: 'LibreTV',
    url: 'https://libretv.is-an.org',
    description: '免费在线视频搜索与观看平台',
    logo: 'image/logo.png',
    version: '1.0.3'
};

// API站点配置来自 js/api-sites.js（数组格式：name / url / adult）
const API_SITES = (window.BUILTIN_API_SITES || []).slice();

// 按 url 取视频源（selectedAPIs 中保存的就是 url）
function getAPISite(id) {
    if (!id) return null;
    return API_SITES.find(function (site) { return site.url === id; }) || null;
}

function getAPISiteId(site) {
    return site ? site.url : '';
}

// 旧版本按 key（maoyan / bfzy ...）保存的记录无法再匹配，清理掉，由初始化选择默认前 5 条
(function clearLegacySiteSelection() {
    ['selectedAPIs', 'apiSourceOrder'].forEach(function (storageKey) {
        let raw = null;
        try {
            raw = JSON.parse(localStorage.getItem(storageKey));
        } catch (e) {
            return;
        }
        if (!Array.isArray(raw) || raw.length === 0) return;

        const valid = raw.filter(function (item) {
            if (typeof item !== 'string') return false;
            if (item.indexOf('custom_') === 0) return true;
            return API_SITES.some(function (site) { return site.url === item; });
        });

        if (valid.length !== raw.length) {
            localStorage.setItem(storageKey, JSON.stringify(valid));
        }
    });
})();

// 定义合并方法（追加或覆盖视频源）
function extendAPISites(newSites) {
    (Array.isArray(newSites) ? newSites : []).forEach(function (site) {
        if (!site || !site.url) return;
        const index = API_SITES.findIndex(function (item) { return item.url === site.url; });
        if (index !== -1) {
            API_SITES[index] = Object.assign({}, API_SITES[index], site);
        } else {
            API_SITES.push(site);
        }
    });
}

// 暴露到全局
window.API_SITES = API_SITES;
window.getAPISite = getAPISite;
window.getAPISiteId = getAPISiteId;
window.extendAPISites = extendAPISites;

// 添加聚合搜索的配置选项
const AGGREGATED_SEARCH_CONFIG = {
    enabled: true,             // 是否启用聚合搜索
    timeout: 8000,            // 单个源超时时间（毫秒）
    maxResults: 10000,          // 最大结果数量
    parallelRequests: true,   // 是否并行请求所有源
    showSourceBadges: true    // 是否显示来源徽章
};

// 抽象API请求配置
const API_CONFIG = {
    search: {
        // 只拼接参数部分，不再包含 /api.php/provide/vod/
        path: '?ac=videolist&wd=',
        pagePath: '?ac=videolist&wd={query}&pg={page}',
        maxPages: 3, // 最大获取页数（采集站的 pagecount 多为全站总数，取太多会混入大量无关结果）
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept': 'application/json'
        }
    },
    detail: {
        // 只拼接参数部分
        path: '?ac=videolist&ids=',
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept': 'application/json'
        }
    }
};

// 优化后的正则表达式模式
const M3U8_PATTERN = /\$https?:\/\/[^"'\s]+?\.m3u8/g;

// 添加自定义播放器URL
const CUSTOM_PLAYER_URL = 'player.html'; // 使用相对路径引用本地player.html

// 增加视频播放相关配置
const PLAYER_CONFIG = {
    autoplay: true,
    allowFullscreen: true,
    width: '100%',
    height: '600',
    timeout: 15000,  // 播放器加载超时时间
    filterAds: true,  // 是否启用广告过滤
    autoPlayNext: true,  // 默认启用自动连播功能
    adFilteringEnabled: true, // 默认开启分片广告过滤
    adFilteringStorage: 'adFilteringEnabled' // 存储广告过滤设置的键名
};

// 增加错误信息本地化
const ERROR_MESSAGES = {
    NETWORK_ERROR: '网络连接错误，请检查网络设置',
    TIMEOUT_ERROR: '请求超时，服务器响应时间过长',
    API_ERROR: 'API接口返回错误，请尝试更换数据源',
    PLAYER_ERROR: '播放器加载失败，请尝试其他视频源',
    UNKNOWN_ERROR: '发生未知错误，请刷新页面重试'
};

// 添加进一步安全设置
const SECURITY_CONFIG = {
    enableXSSProtection: true,  // 是否启用XSS保护
    sanitizeUrls: true,         // 是否清理URL
    maxQueryLength: 100,        // 最大搜索长度
    // allowedApiDomains 不再需要，因为所有请求都通过内部代理
};

// 添加多个自定义API源的配置
const CUSTOM_API_CONFIG = {
    separator: ',',           // 分隔符
    maxSources: 5,            // 最大允许的自定义源数量
    testTimeout: 5000,        // 测试超时时间(毫秒)
    namePrefix: 'Custom-',    // 自定义源名称前缀
    validateUrl: true,        // 验证URL格式
    cacheResults: true,       // 缓存测试结果
    cacheExpiry: 5184000000,  // 缓存过期时间(2个月)
    adultPropName: 'isAdult' // 用于标记成人内容的属性名
};

// 隐藏内置黄色采集站API的变量
const HIDE_BUILTIN_ADULT_APIS = false;
