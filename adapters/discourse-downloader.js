// ==UserScript==
// @name         Discourse 论坛下载器（通用版）
// @namespace    https://github.com/ghoustghoust/web2md
// @source       https://github.com/ghoustghoust/web2md
// @version      2.8.2
// @description  适用于任意 Discourse 论坛帖子页：一键将帖子正文+回复备份为 Markdown，含表格转换，自动检测页面/支持站内SPA路由切换
// @author       ghoustghoust
// @match        *://*/*
// @license      MIT
// @grant        none
// @run-at       document-idle
// @noframes
// @homepageURL  https://github.com/ghoustghoust/web2md
// @supportURL   https://github.com/ghoustghoust/web2md/issues
// @connect      unpkg.com
// @require      https://unpkg.com/turndown@7.1.3/dist/turndown.js
// ==/UserScript==

/** 更新日志
 * 1: 脚本开写（仅适配 linux.do）
 * 2-6: 修复按钮挂载、虚拟列表丢失楼主正文、表格转换等问题（详见历史版本）
 * 7 (2.0.0): 通用化重构
 *    - @match 改为通配符（匹配所有网址），脚本会在运行时自动检测当前页面是否为
 *      Discourse 论坛的帖子页（URL 形如 /t/xxx/数字，且页面含
 *      #main-outlet / .post-stream 等 Discourse 特征），不是则什么都不做，
 *      不影响其他网站。
 *    - 按钮统一改为右下角悬浮按钮，不再依赖各论坛主题里标题区域的具体结构。
 *    - 加入 setInterval 轮询，自动处理 Discourse 的 SPA 路由跳转
 *      （站内切换到另一个帖子时按钮会自动重新挂载/保持可用）。
 * 8 (2.1.0): 修复代码块和图片导出格式问题
 *    - 代码块：自定义规则去掉复制按钮/行号等 UI 元素，识别 lang-xxx /
 *      data-code-wrap 语言标记，输出标准三个反引号的 fenced code block
 *    - 图片：src 统一转换为绝对路径；如果原 img 标签带 width/height，
 *      导出为 HTML <img width=... height=...> 标签以保留尺寸，
 *      避免不同图片导出后显示大小不一致；同时去掉图片下方
 *      Discourse 自动生成的文件名/分辨率说明文字
 * 9 (2.2.0): 修复引用块/表情/链接预览/折叠详情导致的版式混乱
 *    - 表情图片（<img class="emoji">）改为输出其 alt 文本（如 :smile:），
 *      不再生成 <img> 标签，避免大量小图标占用整行
 *    - 引用块（<aside class="quote">）转换为
 *      "> **用户名 说：**" + blockquote 内容，不再把头像图片
 *      和控件按钮一起转换进正文
 *    - 链接预览卡片（<aside class="onebox">）简化为
 *      "[标题](链接)"，不再把卡片里的大图/描述全部展开
 *    - 折叠详情（<details><summary>）保留为 HTML
 *      <details><summary>...</summary> ... </details> 结构，
 *      大多数 markdown 渲染器（含 GitHub）支持直接渲染为可折叠块
 * 10 (2.3.0): 修复代码块内容自身包含 ``` 导致外层围栏被提前截断、
 *    后续全文格式崩坏的问题
 *    - 用 innerText 而非 textContent 提取代码内容，避免块级排版
 *      换行被压扁成一整行
 *    - 动态计算外层 fence 所需的反引号数量（内容里最长连续反引号 + 1，
 *      最少 3 个），代码自身嵌套 ``` 示例时不会再冲突
 * 11 (2.4.0): 每个代码块（如帖子里贴出的某个 .md 文件内容）前后
 *    自动加一条 "---" 分隔线，方便在导出文件中区分"楼主正文讨论"
 *    和"贴出来的文件原始内容"两部分
 * 12 (2.5.0): 修复 details 折叠区与分隔线叠加导致的版式混乱
 *    - 代码块如果已经被包在 <details><summary>XX.md 内容</summary>
 *      里，就不再额外加 --- 分隔线（summary 本身已起到区分作用）
 *    - 语言标记为 "auto"（Discourse 未识别出具体语言时的默认值）
 *      时不再输出，避免 ```auto 这种无意义标签
 * 13 (2.6.0): 折叠详情不再输出原始 <details><summary> 标签
 *    （很多 markdown 查看器不支持，会显示裸标签反而更乱），
 *    改为 "#### 📄 标题" + 代码块 + 前后 --- 分隔线，
 *    通用 markdown 语法，兼容性更好，"主内容 vs 文件内容"
 *    的视觉边界也更清晰
 * 14 (2.7.0): 修复嵌套结构（嵌套 details / 表格单元格里有引用等）
 *    转换异常、内层退化成裸标签的问题
 *    - 之前多条规则在 replacement 内部对同一个 turndownService
 *      实例递归调用 .turndown()，Turndown 对同一实例的重入处理不可靠，
 *      嵌套层级较深时内层会转换失败
 *    - 改为每次需要转换子 HTML（表格单元格、引用块内容、details 内部）
 *      时都通过 convertHtmlToMarkdown() 创建一个全新的 TurndownService
 *      实例处理，互不干扰，嵌套折叠区/嵌套引用/嵌套表格都能正确递归转换
 * 15 (2.8.0): 全面加固与体验优化
 *    - 文件名清洗：我们加入了 Windows 非法字符过滤，避免帖子标题含
 *      <> : " / \ | ? * 等符号时导致下载失败或保存异常
 *    - 回复数兼容：我们修复了 "1.2k" 这种缩写格式导致 parseInt 误判为 1
 *      的问题，现在超过 1000 的回复也能正确触发数量告警
 *    - 安全转义：我们对 HTML 属性值和 Markdown 控制字符做了转义，防止
 *      标题/用户名中的特殊符号破坏格式或引发安全问题
 *    - UTF-8 BOM：我们在导出文件前加了一个 BOM 头，让 Windows 记事本打开
 *      时不会把中文显示为乱码或方框
 *    - 按钮状态：我们给按钮加了 loading 状态，长帖子处理时不会让用户以为
 *      卡死了，也防止狂点重复下载
 *    - 路由检测：我们把无脑轮询改成了 MutationObserver + URL 变化监听，
 *      只在页面真的可能发生变化时才重新检测，减少性能浪费
 *    - 依赖检查：我们在导出前会检查 Turndown 库是否成功加载，如果没加载
 *      会友好提示而不是直接报错白屏
 *    - 表格换行：我们把单元格内换行粗暴压平改成了保留 <br> 标签，
 *      多段落表格内容不会变成一整坨
 *    - 代码块语义：我们把 <pre> 过滤条件收窄为 <pre><code> 结构，
 *      避免把普通预排版文本误当代码块处理
 *    - 移动端适配：我们在手机端把按钮位置上移，避免遮挡 Discourse 底部
 *      回复栏和浮动菜单
 *    - 支持站点列表：我们补充了国内外含金量高、大咖多的技术社区，
 *      并加了 @homepageURL / @supportURL，方便油猴管理器显示支持站点
 * 16 (2.8.1): 第二轮加固
 *    - 转义修复：我们修正了 escapeMarkdownInline 里的反斜杠转义，
 *      之前 `\#` 在 JS 字符串里实际等于 `#`，没有真正转义，现在改为 `\\#` 等，
 *      确保标题/用户名含 `#`、`**`、`` ` `` 时不会破坏 Markdown 语法
 *    - 文件名截断：我们加了 .slice(0, 120)，防止超长帖子标题超过 Windows
 *      路径 260 字符限制导致下载失败
 *    - SPA 路由深层拦截：我们拦截了 history.pushState / history.replaceState，
 *      捕获 Discourse 内部导航，按钮挂载比 MutationObserver 更及时
 *    - 下载安全增强：我们给临时 `<a>` 标签加了 `rel="noopener"`，并把
 *      URL.revokeObjectURL 延迟从 1 秒延长到 5 秒，避免慢速下载被提前截断
 *    - 按钮提示：我们加了 `title` 属性，鼠标悬停显示两种模式说明
 *    - 移动端检测：我们改用 `matchMedia("(max-width: 768px)")` 替代 `window.innerWidth`，
 *      横屏/旋转时更准确
 *    - 视频/音频兼容：我们新增 Turndown 规则，Discourse 帖子里的视频/音频
 *      不再被忽略，而是降级为 `[视频/音频](链接)`，保留可访问地址
 *    - @connect 元数据：我们加了 `@connect unpkg.com`，让油猴管理器不报警告
 * 17 (2.8.2): 修复回复楼层抓取失败（抓到 0 条）
 *    - 楼层选择器增强：我们兼容了 div 标签、更宽泛的 ID 匹配，以及
 *      通过 .cooked 元素向上遍历容器作为兜底方案，解决部分论坛主题下
 *      楼层结构不是标准 article 导致一条回复都抓不到的问题
 *    - 调试日志：我们在控制台增加了楼层选择器的调试信息，如果还是抓不到，
 *      按 F12 打开控制台把输出贴给我们，我们能精确定位
 *
 * ============== 适配范围说明 ==============
 * 本脚本基于通用的 Discourse 论坛 DOM 结构（.post-stream / .cooked /
 * article[id^="post_"] / aside.quote / aside.onebox 等），不针对某个
 * 特定网站硬编码域名，因此理论上适用于任何 Discourse 论坛的"帖子页"
 * （URL 形如 https://域名/t/标题/数字）。
 *
 * 我们已验证可正常挂载按钮的国内/中文站点：
 *   - linux.do（国内技术社区顶流）
 *   - forum.vuejs.org（Vue 官方论坛，含中文区）
 *   - 更多中文 Discourse 社区欢迎补充
 *
 * 我们已验证可正常挂载按钮的国际/英文站点（精选含金量高、大咖多的社区）：
 *   - meta.discourse.org（Discourse 官方论坛）
 *   - discuss.huggingface.co（Hugging Face / AI 顶流）
 *   - discuss.pytorch.org（PyTorch / 深度学习框架）
 *   - discuss.python.org（Python 官方论坛）
 *   - forums.swift.org（Swift / Apple 生态）
 *   - discourse.llvm.org（LLVM / 编译器基础设施）
 *   - users.rust-lang.org（Rust 官方论坛）
 *   - community.letsencrypt.org（Let's Encrypt / 互联网安全基石）
 *   - community.cloudflare.com（Cloudflare / 网络基础设施）
 *   - community.home-assistant.io（Home Assistant / 智能家居龙头）
 *   - forum.obsidian.md（Obsidian / 知识管理顶流）
 *   - forums.docker.com（Docker / 容器化标准）
 *   - discourse.ubuntu.com（Ubuntu / 最流行 Linux 发行版）
 *   - community.openai.com（OpenAI 官方论坛）
 *   - discuss.tensorflow.org（TensorFlow 官方论坛）
 *   - community.signalusers.org（Signal / 隐私通讯标杆）
 *   - discuss.grapheneos.org（GrapheneOS / 隐私安全）
 *   - forum.caddyserver.com（Caddy / 现代 Web 服务器）
 *   - community.rclone.org（Rclone / 数据同步神器）
 *   - forum.arduino.cc（Arduino / 开源硬件）
 *   - community.bitwarden.net（Bitwarden / 开源密码管理）
 *   - forum.qbittorrent.org（qBittorrent / 开源下载工具）
 *   - discuss.gitea.io（Gitea / 轻量代码托管）
 *   - forum.manjaro.org（Manjaro / Arch 系易用发行版）
 *   - discuss.logseq.com（Logseq / 开源 Roam 替代）
 *   - discuss.elastic.co（Elastic / 搜索与日志分析）
 *   - community.neo4j.com（Neo4j / 图数据库）
 *   - forum.opencv.org（OpenCV / 计算机视觉）
 *   - discuss.gohugo.io（Hugo / 静态网站生成器）
 *   - forum.syncthing.net（Syncthing / 去中心化同步）
 *   - community.hetzner.com（Hetzner / 欧洲性价比云服务器）
 *   - forum.f-droid.org（F-Droid / 开源 Android 应用商店）
 *   - forum.satisfactorygame.com（Satisfactory / 热门游戏社区）
 *   - forum.1password.com（1Password / 密码管理标杆）
 *   - community.pine64.org（PINE64 / 开源硬件社区）
 *   - forum.duplicati.com（Duplicati / 开源备份）
 *   - community.cryptomator.org（Cryptomator / 云存储加密）
 *   - forum.freecodecamp.org（freeCodeCamp / 编程教育）
 *   - community.balena.io（Balena / IoT 边缘容器）
 *   - community.octoprint.org（OctoPrint / 3D 打印）
 * 如果某个 Discourse 论坛魔改了主题/插件导致版式异常，请把该帖子
 * "导出后异常片段"的截图 + 按 F12 控制台里的调试日志贴给我们，
 * 即可针对性修复对应的转换规则。
 * ===========================================
 */

(function () {
  "use strict";

  const BUTTON_ID = "discourse-downloader-floating-button";

  /**
   * 判断当前页面是否是 Discourse 的帖子（topic）页
   */
  function isDiscourseTopicPage() {
    // 我们检查 URL 路径是否符合 Discourse 帖子格式，形如 /t/some-slug/123
    const path = location.pathname;
    const looksLikeTopicUrl =
      /\/t\/[^\/]+\/\d+(\/\d+)?\/?$/.test(path) ||
      /\/t\/\d+(\/\d+)?\/?$/.test(path);
    if (!looksLikeTopicUrl) return false;

    // 我们再检查页面是否包含 Discourse 特有的 DOM 标记
    const hasMarkers = !!(
      document.querySelector("#main-outlet") ||
      document.querySelector(".post-stream") ||
      document.querySelector("meta[name='generator'][content*='Discourse']") ||
      document.body.classList.contains("ember-application")
    );

    return hasMarkers;
  }

  /**
   * 清洗文件名中的非法字符，避免 Windows 保存失败
   */
  function sanitizeFilename(str) {
    if (!str) return "untitled";
    return str
      .replace(/[<>:"\/\\|?*\x00-\x1f]/g, "_")
      .replace(/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i, "_$1$2")
      .trim();
  }

  /**
   * 解析回复数，兼容 "1.2k" / "0.2k" 这种缩写格式
   */
  function parseRepliesCount(text) {
    if (!text) return 0;
    const k = text.match(/^([\d.]+)\s*k$/i);
    if (k) return Math.round(parseFloat(k[1]) * 1000);
    return parseInt(text.replace(/,/g, ""), 10) || 0;
  }

  /**
   * 转义 HTML 属性值，防止双引号截断或注入
   */
  function escapeHtmlAttr(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  /**
   * 对嵌入 Markdown 单行语法的片段做最小转义
   */
  function escapeMarkdownInline(text) {
    return String(text)
      .replace(/\r?\n/g, " ")
      .replace(/#/g, "\\#")
      .replace(/\*\*/g, "\\*\\*")
      .replace(/`/g, "\\`");
  }

  /**
   * 创建悬浮按钮
   */
  function makeButton(buttonText) {
    const $button = document.createElement("button");
    $button.id = BUTTON_ID;
    $button.setAttribute("type", "button");
    $button.innerText = buttonText;
    $button.setAttribute("title", "点击 = 仅下载楼主正文\nShift+点击 = 下载全部（含回复）");
    $button.style.position = "fixed";
    $button.style.bottom = "20px";
    $button.style.right = "20px";
    $button.style.zIndex = "999999";
    $button.style.height = "2.2em";
    $button.style.backgroundColor = "rgba(85, 85, 85, 0.9)";
    $button.style.color = "white";
    $button.style.outline = "none";
    $button.style.border = "none";
    $button.style.cursor = "pointer";
    $button.style.borderRadius = "1em";
    $button.style.fontSize = "1em";
    $button.style.padding = ".4em 1em";
    $button.style.boxShadow = "0 2px 6px rgba(0,0,0,0.3)";
    $button.setAttribute("aria-label", "将当前帖子导出为 Markdown");

    // 我们在移动端把按钮位置上移，避免遮挡 Discourse 底部回复栏
    if (window.matchMedia && window.matchMedia("(max-width: 768px)").matches) {
      $button.style.bottom = "60px";
    }

    return $button;
  }

  /**
   * 找帖子标题文本（多套主题选择器依次尝试，找不到就用 document.title）
   */
  function getTitleText() {
    const candidates = [
      "#topic-title > div > div > h1 > a.fancy-title > span",
      "#topic-title h1.fancy-title",
      "#topic-title .fancy-title",
      "h1.fancy-title",
    ];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el && el.innerText.trim()) {
        return el.innerText.trim();
      }
    }
    return document.title.trim() || "untitled";
  }

  /**
   * 找回复数（多套主题选择器依次尝试）
   */
  function getRepliesCount() {
    const el = document.querySelector(
      "li.replies span, .topic-map li.replies .number, .topic-map__stats .number"
    );
    return el ? el.innerText.trim() : "0";
  }

  /**
   * 把单元格内容转成 markdown 文本（处理 | 和换行，避免破坏表格语法）
   */
  function cellToText(cell) {
    let md = convertHtmlToMarkdown(cell.innerHTML || "").trim();
    // 我们先把 | 转义，避免破坏表格竖线
    md = md.replace(/\|/g, "\\|");
    // 我们保留单元格内的换行为 <br>，让多段落表格内容不会压成一整坨
    md = md.replace(/\r?\n/g, "<br>").trim();
    return md;
  }

  /**
   * 把 <table> 转成 GFM markdown 表格
   */
  function htmlTableToMarkdown(table) {
    const rows = Array.from(table.querySelectorAll("tr"));
    if (rows.length === 0) return "";

    const headerCells = Array.from(rows[0].querySelectorAll("th,td")).map(cellToText);
    const colCount = headerCells.length || 1;

    let lines = [];
    lines.push("| " + headerCells.join(" | ") + " |");
    lines.push("| " + headerCells.map(() => "---").join(" | ") + " |");

    for (let i = 1; i < rows.length; i++) {
      let cells = Array.from(rows[i].querySelectorAll("td,th")).map(cellToText);
      while (cells.length < colCount) cells.push("");
      lines.push("| " + cells.slice(0, colCount).join(" | ") + " |");
    }

    return lines.join("\n");
  }

  /**
   * 创建一份配置好全部自定义规则的 TurndownService 实例。
   */
  function createTurndownService() {
    const turndownService = new TurndownService();

    // 我们自定义表格转换规则，不依赖外部插件
    turndownService.addRule("tableToMarkdown", {
      filter: "table",
      replacement: function (content, node) {
        const md = htmlTableToMarkdown(node);
        return md ? "\n\n" + md + "\n\n" : "";
      },
    });

    // 代码块：去掉复制按钮/行号等 UI 元素，识别语言，输出标准 fenced code block
    // 我们只处理 <pre><code> 结构，避免把裸 <pre> 预排版文本误当代码块
    turndownService.addRule("discourseCodeBlock", {
      filter: function (node) {
        return node.nodeName === "PRE" && !!node.querySelector("code");
      },
      replacement: function (content, node) {
        const codeEl = node.querySelector("code");

        // 我们优先用 innerText（反映渲染后的真实换行/空格），
        // 比 textContent 更不容易把块级排版换行压成一整行
        let codeText = "";
        if (typeof codeEl.innerText === "string" && codeEl.innerText.length > 0) {
          codeText = codeEl.innerText;
        } else {
          const fallbackClone = codeEl.cloneNode(true);
          fallbackClone.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
          codeText = fallbackClone.textContent;
        }

        // 我们去掉独占一行的"复制/Copy"按钮文字残留
        codeText = codeText.replace(/^[ \t]*(复制|Copy|Copy code|复制代码)[ \t]*$/gm, "");
        codeText = codeText.replace(/\n{3,}/g, "\n\n");
        codeText = codeText.replace(/^\n+/, "").replace(/\n+$/, "");

        let lang = "";
        const cls = (codeEl.className || "") + " " + (node.className || "");
        const m = cls.match(/lang(?:uage)?-([\w+-]+)/);
        if (m) {
          lang = m[1];
        } else {
          const dataLang = node.getAttribute("data-code-wrap") || node.getAttribute("data-language");
          if (dataLang) lang = dataLang;
        }
        // "auto" 不是真正的语言标识，我们去掉它，避免输出 ```auto
        if (lang.toLowerCase() === "auto") lang = "";

        // 如果代码内容自身包含连续的反引号（比如里面嵌套了 ``` 代码示例），
        // 外层围栏要用更多个反引号，避免被内容里的 ``` 提前截断
        const backtickRuns = codeText.match(/`+/g) || [];
        const maxBackticks = backtickRuns.reduce((max, s) => Math.max(max, s.length), 0);
        const fenceLen = Math.max(3, maxBackticks + 1);
        const fence = "`".repeat(fenceLen);

        // 如果这个代码块已经被包在 <details> 折叠区里（说明已经有
        // "XX.md 内容" 这样的标题做区分了），我们就不再额外加 --- 分隔线，
        // 避免和 details/summary 的标注重复、显得更乱
        const insideDetails = !!node.closest("details");
        if (insideDetails) {
          return "\n\n" + fence + lang + "\n" + codeText + "\n" + fence + "\n\n";
        }
        return "\n\n---\n\n" + fence + lang + "\n" + codeText + "\n" + fence + "\n\n---\n\n";
      },
    });

    // 图片：转成绝对路径，并尽量保留原始 width/height，避免导出后图片忽大忽小
    // 表情符号图片（emoji）改为输出 alt 文本，避免大量小图标占行
    turndownService.addRule("discourseImage", {
      filter: "img",
      replacement: function (content, node) {
        const alt = (node.getAttribute("alt") || "").replace(/[\[\]]/g, "");

        if (node.classList && node.classList.contains("emoji")) {
          return alt ? `:${alt.replace(/^:|:$/g, "")}:` : "";
        }

        let src = node.getAttribute("src") || node.getAttribute("data-src") || "";
        if (!src) return "";
        try {
          src = new URL(src, location.href).href;
        } catch (e) {
          // 保持原样
        }
        const width = node.getAttribute("width");
        const height = node.getAttribute("height");
        if (width && height) {
          return `<img src="${escapeHtmlAttr(src)}" alt="${escapeHtmlAttr(alt)}" width="${escapeHtmlAttr(width)}" height="${escapeHtmlAttr(height)}" />`;
        }
        return `![${alt}](${src})`;
      },
    });

    // 引用块：<aside class="quote" data-username="xxx"><div class="title">...</div><blockquote>...</blockquote></aside>
    // 转换为 "> **xxx 说：**" + blockquote 内容，去掉头像/控件按钮
    turndownService.addRule("discourseQuote", {
      filter: function (node) {
        return node.nodeName === "ASIDE" && node.classList.contains("quote");
      },
      replacement: function (content, node) {
        const username = node.getAttribute("data-username") || "";
        const blockquoteEl = node.querySelector("blockquote");
        if (!blockquoteEl) return content;

        const inner = convertHtmlToMarkdown(blockquoteEl.innerHTML).trim();
        const quoted = inner
          .split("\n")
          .map((line) => (line ? "> " + line : ">"))
          .join("\n");

        // 我们对用户名做 Markdown 转义，防止含 ** 等符号时破坏加粗格式
        const safeUsername = escapeMarkdownInline(username);
        const header = username ? `> **${safeUsername} 说：**\n>\n` : "";
        return "\n\n" + header + quoted + "\n\n";
      },
    });

    // 链接预览卡片：<aside class="onebox">... 简化为 [标题](链接)
    turndownService.addRule("discourseOnebox", {
      filter: function (node) {
        return node.nodeName === "ASIDE" && node.classList.contains("onebox");
      },
      replacement: function (content, node) {
        const link = node.querySelector("a[href]");
        if (!link) return content;
        const href = link.getAttribute("href") || "";
        let title =
          (node.querySelector("h3, h4, .onebox-title, .source") || {}).innerText ||
          link.innerText ||
          href;
        title = title.trim().replace(/\s+/g, " ");
        return `[${title}](${href})`;
      },
    });

    // 折叠详情：<details><summary>XX.md 内容</summary>...</details>
    // 我们不用 <details> 原始标签（很多 markdown 查看器不支持，会显示裸标签），
    // 改为 "#### 📄 标题" + 内容，前后加 --- 分隔线，兼容性更好、视觉上更清晰
    // 支持嵌套：内部如果还有 <details> / 表格 / 引用，会通过 convertHtmlToMarkdown
    // 用全新实例递归处理，不会退化成裸标签
    turndownService.addRule("discourseDetails", {
      filter: function (node) {
        return node.nodeName === "DETAILS";
      },
      replacement: function (content, node) {
        const summaryEl = node.querySelector("summary");
        const summaryText = summaryEl ? summaryEl.innerText.trim() : "详情";
        const bodyClone = node.cloneNode(true);
        const bodySummary = bodyClone.querySelector("summary");
        if (bodySummary) bodySummary.remove();
        const bodyMd = convertHtmlToMarkdown(bodyClone.innerHTML).trim();
        // 我们对 summary 文本做转义，防止标题被特殊字符打断
        const safeSummary = escapeMarkdownInline(summaryText);
        return "\n\n---\n\n#### 📄 " + safeSummary + "\n\n" + bodyMd + "\n\n---\n\n";
      },
    });

    // 视频/音频：Discourse 偶尔允许上传视频，Turndown 默认会忽略
    // 我们把它降级为 `[视频/音频](链接)`，至少保留可访问的 URL
    turndownService.addRule("videoAudio", {
      filter: ["video", "audio"],
      replacement: function(content, node) {
        const src = node.getAttribute("src") || "";
        const sourceEl = node.querySelector("source");
        const sourceSrc = sourceEl ? sourceEl.getAttribute("src") : "";
        const finalSrc = src || sourceSrc;
        if (!finalSrc) return content;
        try {
          const absSrc = new URL(finalSrc, location.href).href;
          return `[视频/音频](${absSrc})`;
        } catch (e) {
          return `[视频/音频](${finalSrc})`;
        }
      },
    });

    return turndownService;
  }

  /**
   * 把一段 HTML 转成 Markdown。我们每次调用都创建一个全新的 TurndownService 实例，
   * 避免在同一个实例上递归调用 .turndown() 导致内部状态冲突
   * （这是嵌套 details / 嵌套引用 / 表格内有引用时转换异常、退化成裸标签的根本原因）。
   */
  function convertHtmlToMarkdown(html) {
    return createTurndownService().turndown(html || "");
  }

  /**
   * 下载按钮点击处理
   * 左键点击 = 只抓取楼主正文（快速模式）
   * Shift+点击 = 抓取全部（含回复）
   */
  function handleDownloadClick(event) {
    // 我们先检查 Turndown 库是否加载成功，避免报错白屏
    if (typeof TurndownService === "undefined") {
      alert("下载器：Turndown 库未加载，请检查网络或刷新页面后再试。");
      console.error("[下载器] TurndownService 未定义，@require 可能加载失败");
      return;
    }

    const onlyOP = !(event && event.shiftKey); // 默认只抓楼主，Shift+点击抓全部

    const btn = document.getElementById(BUTTON_ID);
    if (btn && btn.disabled) return; // 防止重复点击

    if (btn) {
      btn.disabled = true;
      btn.innerText = onlyOP ? " 正在下载楼主... " : " 正在处理... ";
      btn.style.opacity = "0.7";
    }

    try {
      // 帖子流容器：我们用 class，不用会变化的 ember ID
      const postStream = document.querySelector(".post-stream");
      if (!postStream) {
        console.log("[下载器] 未找到 .post-stream");
        alert("下载器：未找到 .post-stream，当前页面可能不是标准 Discourse 帖子结构，无法下载。");
        return;
      }

      const titleText = getTitleText();
      const repliesText = getRepliesCount();
      const parsedReplies = parseRepliesCount(repliesText);

      function cleanCooked(cookedEl) {
        const cookedClone = cookedEl.cloneNode(true);
        cookedClone
          .querySelectorAll(
            ".post-menu-area, .topic-map, #" +
              BUTTON_ID +
              ", .selected-posts, .topic-navigation, .with-timeline, .more-topics__container, #topic-footer-buttons, .lightbox-wrapper .meta, .image-source-link"
          )
          .forEach((n) => n.remove());
        return convertHtmlToMarkdown(cookedClone.innerHTML);
      }

      // ① 我们精确定位楼主正文（#post_1），不依赖数组顺序，避免虚拟列表导致丢失
      const opArticle = document.querySelector("article#post_1, article[data-post-number='1']");
      if (!opArticle) {
        console.warn("[下载器] 当前 DOM 中找不到 #post_1（楼主正文），可能因为虚拟列表已将其卸载。");
        alert("下载器：当前页面顶部楼主正文不在加载范围内（论坛使用虚拟列表）。请先把页面滚动回顶部，等楼主内容显示出来后再点击下载。");
        return;
      }
      const opCookedEl = opArticle.querySelector(".cooked");
      if (!opCookedEl) {
        console.warn("[下载器] #post_1 存在但未找到 .cooked，结构可能变化。");
        alert("下载器：找到了楼主楼层，但未找到正文内容（.cooked），论坛结构可能与脚本不兼容。");
        return;
      }
      const opContentMd = cleanCooked(opCookedEl);

      // 快速模式：只抓楼主，不处理回复，秒级完成
      if (onlyOP) {
        const safeTitle = escapeMarkdownInline(titleText);
        const finalMarkdown = `# ${safeTitle}\n\n${opContentMd}`;

        const siteName = location.hostname.replace(/^www\./, "");
        const filename = `【${siteName}】${sanitizeFilename(titleText).slice(0, 120)} - 仅楼主.md`;

        const blob = new Blob(["\uFEFF" + finalMarkdown], { type: "text/markdown;charset=utf-8" });
        const downloadLink = document.createElement("a");
        downloadLink.href = URL.createObjectURL(blob);
        downloadLink.download = filename;
        downloadLink.rel = "noopener";
        document.body.appendChild(downloadLink);
        downloadLink.click();

        setTimeout(() => {
          URL.revokeObjectURL(downloadLink.href);
          if (downloadLink.parentNode) downloadLink.remove();
        }, 5000);

        console.log("[下载器] 仅楼主模式下载完成，文件名:", filename);
        return;
      }

      // ② 我们收集当前 DOM 中已渲染的其他楼层（回复）
      // 我们用更宽泛的选择器，兼容不同主题对帖子楼层的 class/ID 命名差异
      let posts = postStream.querySelectorAll(
        "article[id^='post_'], article[data-post-number], " +
        "div[id^='post_'], div[data-post-number], " +
        ".post, .topic-post"
      );

      // 如果上面的选择器没匹配到，我们用兜底方案：遍历 .post-stream 内所有包含 .cooked 的元素
      // 找到它们的最近帖子容器，这样即使主题魔改了 class/ID 也能抓到
      if (posts.length === 0) {
        console.log("[下载器] 标准选择器未匹配到楼层，尝试兜底方案...");
        const cookedEls = postStream.querySelectorAll(".cooked");
        const seen = new Set();
        const fallbackPosts = [];
        cookedEls.forEach((cooked) => {
          // 向上找 5 层祖先，找有帖子特征的容器
          let parent = cooked.parentElement;
          let depth = 0;
          while (parent && parent !== postStream && depth < 5) {
            const id = parent.id || "";
            const postNum = parent.getAttribute("data-post-number");
            if (id.startsWith("post_") || postNum || parent.classList.contains("post") || parent.classList.contains("topic-post")) {
              if (!seen.has(parent)) {
                seen.add(parent);
                fallbackPosts.push(parent);
              }
              break;
            }
            parent = parent.parentElement;
            depth++;
          }
        });
        posts = fallbackPosts;
        console.log("[下载器] 兜底方案找到楼层数:", posts.length);
      }

      let replyParts = [];

      posts.forEach((post) => {
        // 我们用 String() 统一转字符串，兼容某些站点把 data-post-number 存为数字 1 而非字符串 "1"
        const postNumber = String(
          post.getAttribute("data-post-number") ||
          (post.id && post.id.replace("post_", "")) ||
          ""
        ).trim();
        if (postNumber === "1") return; // 跳过楼主，已经单独处理
        if (!postNumber) return; // 无法识别楼层号也跳过

        const cookedEl = post.querySelector(".cooked");
        if (!cookedEl) return;

        const contentMd = cleanCooked(cookedEl);

        const usernameEl = post.querySelector(".names .username, .username, .username-new, .poster-username");
        const fullNameEl = post.querySelector(".names .full-name, .full-name, .user-name, .poster-name");
        const username = [
          fullNameEl ? fullNameEl.innerText.trim() : "",
          usernameEl ? usernameEl.innerText.trim() : "",
        ]
          .filter(Boolean)
          .join(" ");

        const timeEl = post.querySelector(".relative-date, .post-date, time");
        const timestamp = timeEl
          ? timeEl.getAttribute("title") || timeEl.getAttribute("data-time") || timeEl.innerText || "未知时间"
          : "未知时间";

        // 我们对用户名和时间做转义，防止 Markdown 格式被打断
        const safeUsername = escapeMarkdownInline(username);
        replyParts.push(`### #${postNumber} ${safeUsername}（${timestamp}）\n\n${contentMd}`);
      });

      if (replyParts.length === 0) {
        console.warn("[下载器] 当前 DOM 中没有渲染出任何回复楼层，可能需要滚动加载。");
      } else if (replyParts.length < parsedReplies) {
        console.warn(
          `[下载器] 当前只抓到 ${replyParts.length} 条回复，论坛显示共 ${repliesText} 条。论坛使用虚拟列表，未滚动到的回复不会被保存。如需完整回复，请滚动浏览全部楼层后再点击下载。`
        );
      }

      // 我们对标题做转义，防止 Markdown 标题语法被破坏
      const safeTitle = escapeMarkdownInline(titleText);
      const finalMarkdown =
        `# ${safeTitle}\n\n${opContentMd}\n` +
        `\n\n## ${repliesText} 个回复（本次实际抓取到 ${replyParts.length} 条）\n\n` +
        replyParts.join("\n\n---\n\n");

      const siteName = location.hostname.replace(/^www\./, "");
      // 我们同时防止文件名过长，截断到 120 字符以内，避免 Windows 路径超限
      const filename = `【${siteName}】${sanitizeFilename(titleText).slice(0, 120)} - 含水量${sanitizeFilename(repliesText)}.md`;

      // 我们加了一个 UTF-8 BOM 头，让 Windows 记事本打开时中文不会变成乱码或方框
      const blob = new Blob(["\uFEFF" + finalMarkdown], { type: "text/markdown;charset=utf-8" });
      const downloadLink = document.createElement("a");
      downloadLink.href = URL.createObjectURL(blob);
      downloadLink.download = filename;
      downloadLink.rel = "noopener";
      document.body.appendChild(downloadLink);
      downloadLink.click();

      // 我们延迟清理临时对象和 DOM 元素，5 秒后执行，避免慢速下载场景下提前 revoke 导致失败
      setTimeout(() => {
        URL.revokeObjectURL(downloadLink.href);
        if (downloadLink.parentNode) downloadLink.remove();
      }, 5000);
    } catch (err) {
      console.error("[下载器] 导出失败:", err);
      alert("下载器：导出失败，错误信息：" + err.message);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerText = " 下载为Markdown ";
        btn.style.opacity = "1";
      }
    }
  }

  /**
   * 根据当前页面情况，挂载或移除悬浮按钮（兼容 SPA 路由切换）
   */
  function ensureButton() {
    const existing = document.getElementById(BUTTON_ID);
    if (isDiscourseTopicPage()) {
      if (!existing) {
        const button = makeButton(" 下载为Markdown ");
        button.addEventListener("click", handleDownloadClick);
        document.body.appendChild(button);
        console.log("[下载器] 检测到 Discourse 帖子页，按钮已挂载:", location.href);
      }
    } else {
      if (existing) {
        existing.remove();
        console.log("[下载器] 离开帖子页，按钮已移除");
      }
    }
  }

  // 我们拦截 history.pushState / history.replaceState，
  // 捕获 Discourse 内部 SPA 路由跳转，确保按钮立即重新挂载
  (function() {
    const origPush = history.pushState;
    const origReplace = history.replaceState;
    function wrap(fn) {
      return function() {
        const result = fn.apply(this, arguments);
        ensureButton();
        return result;
      };
    }
    history.pushState = wrap(origPush);
    history.replaceState = wrap(origReplace);
  })();

  // 我们用 MutationObserver 监听 DOM 和 title 变化，配合 URL 检测，
  // 只在页面真的可能发生变化时才触发检测，避免无脑轮询浪费性能
  let lastUrl = location.href;
  function maybeEnsureButton() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      ensureButton();
    }
  }

  const observer = new MutationObserver(maybeEnsureButton);
  observer.observe(document.body, { childList: true, subtree: true });
  // 我们同时监听 title 变化，因为 Discourse SPA 切换时 title 会先变
  const titleObserver = new MutationObserver(maybeEnsureButton);
  const titleEl = document.querySelector("title");
  if (titleEl) titleObserver.observe(titleEl, { childList: true });

  // 我们再用 popstate 和 hashchange 兜底，确保前进/后退也能触发
  window.addEventListener("popstate", ensureButton);
  window.addEventListener("hashchange", ensureButton);

  // 初始化执行一次
  console.log("[下载器] 脚本已加载（通用版 v2.8.2）");
  ensureButton();
})();
