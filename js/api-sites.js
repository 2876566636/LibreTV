/**
 * 内置视频源配置
 *
 * 每项只需三个字段：
 * - name  显示名称
 * - url   苹果 CMS V10 接口地址
 * - adult 是否为成人内容（可选，默认 false）
 *
 * 该结构与设置页「视频源」导入的 JSON 完全一致，
 * 可直接把数组内容复制到设置页做批量导入。
 */
let BUILTIN_API_SITES = [
    { name: '红牛资源', url: 'https://www.hongniuzy2.com/api.php/provide/vod' },
    { name: '速播资源', url: 'https://subocj.com/api.php/provide/vod' },
    { name: '猫眼资源', url: 'https://api.maoyanapi.top/api.php/provide/vod' },
    { name: '电影天堂资源', url: 'http://caiji.dyttzyapi.com/api.php/provide/vod' },
    { name: '如意资源', url: 'https://cj.rycjapi.com/api.php/provide/vod' },
    { name: '暴风资源', url: 'https://bfzyapi.com/api.php/provide/vod' },
    { name: '天涯资源', url: 'https://tyyszyapi.com/api.php/provide/vod' },
    { name: '非凡影视', url: 'http://ffzy5.tv/api.php/provide/vod' },
    { name: '360资源', url: 'https://360zy.com/api.php/provide/vod' },
    { name: '卧龙资源', url: 'https://wolongzyw.com/api.php/provide/vod' },
    { name: '极速资源', url: 'https://jszyapi.com/api.php/provide/vod' },
    { name: '豆瓣资源', url: 'https://dbzy.tv/api.php/provide/vod' },
    { name: '魔都资源', url: 'https://www.mdzyapi.com/api.php/provide/vod' },
    { name: '最大资源', url: 'https://api.zuidapi.com/api.php/provide/vod' },
    { name: '樱花资源', url: 'https://m3u8.apiyhzy.com/api.php/provide/vod' },
    { name: '百度云资源', url: 'https://api.apibdzy.com/api.php/provide/vod' },
    { name: '无尽资源', url: 'https://api.wujinapi.me/api.php/provide/vod' },
    { name: '旺旺短剧', url: 'https://wwzy.tv/api.php/provide/vod' },
    { name: 'iKun资源', url: 'https://ikunzyapi.com/api.php/provide/vod' },
    { name: '量子资源站', url: 'https://cj.lziapi.com/api.php/provide/vod/' },
    { name: 'CK资源', url: 'https://www.ckzy1.com', adult: true },
    { name: 'jkun资源', url: 'https://jkunzyapi.com', adult: true },
    { name: '百万资源', url: 'https://api.bwzym3u8.com', adult: true },
    { name: 'souav资源', url: 'https://api.souavzy.vip', adult: true },
    { name: '155资源', url: 'https://155api.com', adult: true },
    { name: 'lsb资源', url: 'https://apilsbzy1.com', adult: true },
    { name: '黄色仓库', url: 'https://hsckzy.vip', adult: true },
    { name: '玉兔资源', url: 'https://yutuzy10.com', adult: true }
];

window.BUILTIN_API_SITES = BUILTIN_API_SITES;
