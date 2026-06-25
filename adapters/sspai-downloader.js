// ==UserScript==
// @name         少数派文章下载器
// @namespace    https://github.com/ghoustghoust/web2md
// @source       https://github.com/ghoustghoust/web2md
// @version      1.1.4
// @description  适用于少数派（sspai.com）文章页：一键将文章导出为 Markdown 并下载图片到本地文件夹，含标题、作者、发布时间、正文、图片等。支持 File System Access API 选择保存文件夹。
// @author       ghoustghoust
// @match        https://sspai.com/post/*
// @match        https://sspai.com/matrix
// @license      MIT
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// @noframes
// @homepageURL  https://github.com/ghoustghoust/web2md
// @supportURL   https://github.com/ghoustghoust/web2md/issues
// @connect      unpkg.com
// @connect      cdnfile.sspai.com
// @connect      sspai.com
// @connect      *
// @require      https://unpkg.com/turndown@7.1.3/dist/turndown.js
// ==/UserScript==

/** 更新日志
 * 1.1.1: 修复图片下载问题
 *    - 修复 imageMap URL 键不匹配：extractImagesFromContent 也做 imageView2 清理，
 *      确保与 Turndown 规则中的 URL 处理一致
 *    - 修复 GM_xmlhttpRequest 缺少 Referer 头：添加 Referer: location.href，
 *      解决少数派 CDN 403 防盗链问题
 *    - fetch 回退也添加 Referer 头
 *    - 增强调试日志：显示每张图片的下载进度、成功/失败统计
 * 1.1.0: 支持图片下载到本地文件夹
 *    - 新增 File System Access API 支持，点击下载后弹窗选择保存文件夹
 *    - 浏览器内直接下载图片（使用 GM_xmlhttpRequest 跨域，带正确 Referer）
 *    - 图片保存到选择的文件夹下的 images/ 子文件夹
 *    - 图片文件名格式：YYYYMMDD-文章标题-序号.扩展名
 *    - Markdown 中图片路径自动替换为相对路径（images/xxx.png）
 *    - 如果浏览器不支持 File System Access API，回退到 blob 下载方式
 * 1.0.0: 初始版本
 *    - 支持少数派文章页（sspai.com/post/*）和矩阵页（sspai.com/matrix）
 *    - 提取标题、作者、发布时间、正文、图片
 *    - 使用 Turndown 转换 HTML 为 Markdown，保留格式
 *    - 右下角悬浮按钮，支持文章页和矩阵页
 *    - 矩阵页：提取文章列表（标题+链接），不下载单篇文章内容
 */

(function () {
  "use strict";

  const BUTTON_ID = "sspai-downloader-floating-button";
  const DEBUG_PREFIX = "[下载器]";

  /**
   * 判断当前页面类型
   */
  function getPageType() {
    const path = location.pathname;
    if (/^\/post\/\d+/.test(path)) return "article";
    if (path === "/matrix" || path === "/matrix/") return "matrix";
    return null;
  }

  /**
   * 清洗文件名中的非法字符
   */
  function sanitizeFilename(str) {
    if (!str) return "untitled";
    return str
      .replace(/[<>:"\/\\|?*\x00-\x1f]/g, "_")
      .replace(/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i, "_$1$2")
      .trim();
  }

  /**
   * 转义 Markdown 内联语法
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
    $button.setAttribute("title", "点击下载当前页面为 Markdown");
    $button.style.position = "fixed";
    $button.style.bottom = "20px";
    $button.style.right = "20px";
    $button.style.zIndex = "999999";
    $button.style.height = "2.2em";
    $button.style.backgroundColor = "rgba(208, 76, 56, 0.9)";
    $button.style.color = "white";
    $button.style.outline = "none";
    $button.style.border = "none";
    $button.style.cursor = "pointer";
    $button.style.borderRadius = "1em";
    $button.style.fontSize = "1em";
    $button.style.padding = ".4em 1em";
    $button.style.boxShadow = "0 2px 6px rgba(0,0,0,0.3)";
    $button.setAttribute("aria-label", "将当前页面导出为 Markdown");

    if (window.matchMedia && window.matchMedia("(max-width: 768px)").matches) {
      $button.style.bottom = "60px";
    }

    return $button;
  }

  /**
   * 提取文章标题（多套选择器备选）
   */
  function getArticleTitle() {
    const selectors = [
      "h1.title",
      "h1.post-title",
      "article h1",
      ".content h1",
      "header h1",
      "h1"
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.innerText.trim()) {
        return el.innerText.trim();
      }
    }
    return document.title.trim() || "untitled";
  }

  /**
   * 提取作者信息（多套选择器备选）
   */
  function getAuthor() {
    const selectors = [
      ".author .name",
      ".author-name",
      ".post-author",
      ".meta .author",
      "[data-author]",
      ".author"
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.innerText.trim()) {
        return el.innerText.trim();
      }
    }
    // 尝试从 meta 标签提取
    const metaAuthor = document.querySelector("meta[name='author']");
    if (metaAuthor) return metaAuthor.getAttribute("content") || "";
    return "未知作者";
  }

  /**
   * 提取发布时间（多套选择器备选）
   */
  function getPublishTime() {
    const selectors = [
      ".time",
      ".post-time",
      ".publish-time",
      ".date",
      "time",
      ".meta .time"
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const timeAttr = el.getAttribute("datetime") || el.getAttribute("title");
        if (timeAttr) return timeAttr;
        if (el.innerText.trim()) return el.innerText.trim();
      }
    }
    return "";
  }

  /**
   * 提取文章正文容器（只选择正文容器，避免包含作者信息等无关内容）
   */
  function getArticleContent() {
    const selectors = [
      ".wangEditor-txt",    // 少数派正文容器（最优先）
      ".content",           // 通用正文容器
      ".article-content",  // 文章内容
      "article .content", // article 内部的 content
      ".post-content"     // 帖子内容
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.innerText.trim().length > 50) {
        console.log(DEBUG_PREFIX, "选择正文容器:", sel, "文本:", el.innerText.trim().length, "图片:", el.querySelectorAll("img").length);
        return el;
      }
    }
    // 兜底：如果找不到正文容器，尝试 article 或 body
    const article = document.querySelector("article");
    if (article && article.innerText.trim().length > 50) {
      console.log(DEBUG_PREFIX, "兜底选择 article 容器");
      return article;
    }
    console.warn(DEBUG_PREFIX, "未找到正文容器，尝试 body");
    return document.body;
  }

  /**
   * 清理 DOM（删除不需要的元素）
   */
  function cleanContent(node) {
    if (!node) return null;
    const clone = node.cloneNode(true);

    // 删除不需要的元素（作者卡片、关注按钮、分享、评论等）
    const removeSelectors = [
      "script", "style", "nav", "header", "footer", "aside",
      ".comments", "#comments", ".comment",
      ".sidebar", ".related", ".recommend",
      ".ads", ".ad", ".advertisement",
      ".author", ".author-card", ".author-info", ".meta-author",
      ".follow-btn", ".follow-button", ".attention",
      ".share", ".share-bar", ".social-share",
      ".like-btn", ".collect-btn", ".report-btn",
      ".copy-link", ".qr-code", ".wechat-share",
      "#" + BUTTON_ID
    ];
    removeSelectors.forEach(sel => {
      clone.querySelectorAll(sel).forEach(el => el.remove());
    });

    // 删除基于文本内容的元素（作者信息、关注按钮等）
    const textRemovePatterns = [
      /主作者/,
      /少数派作者/,
      /联合作者/,
      /关注/,
      /分享收藏举报/,
      /点击下方按钮可复制链接/,
      /微信扫码分享/,
      /以图片分享/,
      /Matrix 首页推荐/,
      /文章代表作者个人观点/,
      /下载 .*客户端/,
      /关注 .*公众号/,
      /位派友已充电/
    ];
    clone.querySelectorAll("div, p, span, section, article").forEach(el => {
      const text = el.innerText.trim();
      if (text.length < 200) { // 只检查短文本元素，避免误删正文
        for (const pattern of textRemovePatterns) {
          if (pattern.test(text)) {
            el.remove();
            break;
          }
        }
      }
    });

    return clone;
  }

  /**
   * 从内容中提取图片列表
   */
  /**
   * 提取图片列表（返回原始 URL 和清理 URL）
   */
  function extractImagesFromContent(node) {
    const images = [];
    const imgs = node.querySelectorAll("img");
    imgs.forEach((img, index) => {
      let domSrc = img.src || "";
      let attrSrc = img.getAttribute("data-original") ||
                    img.getAttribute("data-original-src") ||
                    img.getAttribute("data-src") ||
                    img.getAttribute("data-lazy-src") ||
                    img.getAttribute("src") || "";
      
      let originalUrl = "";
      if (domSrc && !domSrc.startsWith("data:")) {
        originalUrl = domSrc;
      } else if (attrSrc && !attrSrc.startsWith("data:")) {
        originalUrl = attrSrc;
      }
      
      if (!originalUrl) {
        const srcset = img.getAttribute("srcset");
        if (srcset) {
          const candidates = srcset.split(',').map(s => {
            const parts = s.trim().split(/\s+/);
            const url = parts[0];
            const w = parts[1] ? parseInt(parts[1].replace(/[^0-9]/g, '')) : 0;
            return { url, w };
          }).filter(c => c.url && !c.url.startsWith("data:"));
          candidates.sort((a, b) => b.w - a.w);
          if (candidates.length > 0) originalUrl = candidates[0].url;
        }
      }
      
      if (!originalUrl) return;
      
      try {
        originalUrl = new URL(originalUrl, location.href).href;
      } catch (e) {}
      
      // 清理后的 URL（用于下载）
      let cleanUrl = originalUrl;
      if (cleanUrl.includes("cdnfile.sspai.com") && (cleanUrl.includes("imageView2") || cleanUrl.includes("imageMogr2"))) {
        cleanUrl = cleanUrl.replace(/\?(imageView2|imageMogr2).*$/, "");
      }
      
      images.push({ originalUrl, cleanUrl, index });
    });
    return images;
  }

  /**
   * 从 URL 提取文件扩展名
   */
  function getExtensionFromUrl(url) {
    if (!url) return "jpg";
    const match = url.match(/\.([a-zA-Z0-9]+)(?:\?.*)?$/);
    return match ? match[1].toLowerCase() : "jpg";
  }

  /**
   * 生成图片文件名：日期-文章标题-序号
   */
  function generateImageFilename(dateStr, title, index) {
    const safeTitle = sanitizeFilename(title).slice(0, 30);
    return `${dateStr}-${safeTitle}-${String(index).padStart(3, '0')}`;
  }

  /**
   * 使用 GM_xmlhttpRequest 下载图片（支持跨域）
   */
  function downloadImageWithGM(url) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== "undefined") {
        GM_xmlhttpRequest({
          method: "GET",
          url: url,
          responseType: "blob",
          headers: {
            "Referer": location.href
          },
          onload: function(response) {
            if (response.status === 200) {
              resolve(response.response);
            } else {
              reject(new Error("HTTP " + response.status + " for " + url));
            }
          },
          onerror: function(err) {
            reject(new Error("Failed to download " + url));
          }
        });
      } else {
        fetch(url, { headers: { "Referer": location.href } })
          .then(r => {
            if (!r.ok) throw new Error("HTTP " + r.status);
            return r.blob();
          })
          .then(resolve)
          .catch(reject);
      }
    });
  }

  /**
   * 使用 File System Access API 选择文件夹
   */
  async function showFolderPicker() {
    try {
      if (typeof window.showDirectoryPicker === "function") {
        const dirHandle = await window.showDirectoryPicker();
        return dirHandle;
      }
    } catch (err) {
      console.log(DEBUG_PREFIX, "用户取消文件夹选择或浏览器不支持:", err.message);
    }
    return null;
  }

  /**
   * 保存 Blob 到文件系统
   */
  async function saveBlobToFolder(blob, filename, folderHandle) {
    const fileHandle = await folderHandle.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
  }

  /**
   * 创建 TurndownService 实例
   */
  function createTurndownService(imageMap) {
    const td = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
      bulletListMarker: "-",
      emDelimiter: "*",
      strongDelimiter: "**"
    });

    // 图片：保留 alt，转绝对路径，过滤占位符，支持本地路径映射
    td.addRule("sspaiImage", {
      filter: "img",
      replacement: (content, node) => {
        // 使用与 extractImagesFromContent 完全相同的 URL 提取逻辑
        let domSrc = node.src || "";
        let attrSrc = node.getAttribute("data-original") ||
                      node.getAttribute("data-original-src") ||
                      node.getAttribute("data-src") ||
                      node.getAttribute("data-lazy-src") ||
                      node.getAttribute("src") || "";
        
        let src = "";
        if (domSrc && !domSrc.startsWith("data:")) {
          src = domSrc;
        } else if (attrSrc && !attrSrc.startsWith("data:")) {
          src = attrSrc;
        }
        
        if (!src) {
          const srcset = node.getAttribute("srcset");
          if (srcset) {
            const candidates = srcset.split(',').map(s => {
              const parts = s.trim().split(/\s+/);
              const url = parts[0];
              const w = parts[1] ? parseInt(parts[1].replace(/[^0-9]/g, '')) : 0;
              return { url, w };
            }).filter(c => c.url && !c.url.startsWith("data:"));
            candidates.sort((a, b) => b.w - a.w);
            if (candidates.length > 0) src = candidates[0].url;
          }
        }
        
        if (!src || src.startsWith("data:")) return "";
        
        // 转换为绝对路径（与 extractImagesFromContent 一致）
        try {
          src = new URL(src, location.href).href;
        } catch (e) {}
        
        // 清理 CDN 参数（与 extractImagesFromContent 一致：支持 imageMogr2 和 imageView2）
        if (src.includes("cdnfile.sspai.com") && (src.includes("imageView2") || src.includes("imageMogr2"))) {
          src = src.replace(/\?(imageView2|imageMogr2).*$/, "");
        }
        
        // 如果该图片在 imageMap 中有映射，使用本地路径
        if (imageMap && imageMap[src]) {
          src = imageMap[src];
        }
        
        const alt = (node.getAttribute("alt") || "Image").replace(/[\[\]]/g, "");
        return `\n\n![${alt}](${src})\n\n`;
      }
    });

    // 代码块
    td.addRule("sspaiCodeBlock", {
      filter: function(node) {
        return node.nodeName === "PRE" && !!node.querySelector("code");
      },
      replacement: (content, node) => {
        const codeEl = node.querySelector("code");
        let codeText = codeEl.innerText || codeEl.textContent || "";
        codeText = codeText.replace(/^\n+/, "").replace(/\n+$/, "");

        let lang = "";
        const cls = (codeEl.className || "") + " " + (node.className || "");
        const m = cls.match(/lang(?:uage)?-([\w+-]+)/);
        if (m) lang = m[1];

        const backtickRuns = codeText.match(/`+/g) || [];
        const maxBackticks = backtickRuns.reduce((max, s) => Math.max(max, s.length), 0);
        const fenceLen = Math.max(3, maxBackticks + 1);
        const fence = "`".repeat(fenceLen);

        return `\n\n${fence}${lang}\n${codeText}\n${fence}\n\n`;
      }
    });

    // 表格
    td.addRule("sspaiTable", {
      filter: "table",
      replacement: (content, node) => {
        const rows = Array.from(node.querySelectorAll("tr"));
        if (rows.length === 0) return "";

        const headerCells = Array.from(rows[0].querySelectorAll("th,td")).map(cell => {
          let md = (cell.innerText || "").trim().replace(/\|/g, "\\|").replace(/\n/g, "<br>");
          return md;
        });
        const colCount = headerCells.length || 1;

        let lines = [];
        lines.push("| " + headerCells.join(" | ") + " |");
        lines.push("| " + headerCells.map(() => "---").join(" | ") + " |");

        for (let i = 1; i < rows.length; i++) {
          let cells = Array.from(rows[i].querySelectorAll("td,th")).map(cell => {
            let md = (cell.innerText || "").trim().replace(/\|/g, "\\|").replace(/\n/g, "<br>");
            return md;
          });
          while (cells.length < colCount) cells.push("");
          lines.push("| " + cells.slice(0, colCount).join(" | ") + " |");
        }

        return "\n\n" + lines.join("\n") + "\n\n";
      }
    });

    return td;
  }

  /**
   * 下载单篇文章
   */
  async function downloadArticle() {
    if (typeof TurndownService === "undefined") {
      alert("下载器：Turndown 库未加载，请检查网络或刷新页面后再试。");
      console.error(DEBUG_PREFIX, "TurndownService 未定义");
      return;
    }

    const btn = document.getElementById(BUTTON_ID);
    if (btn && btn.disabled) return;

    if (btn) {
      btn.disabled = true;
      btn.innerText = " 正在下载... ";
      btn.style.opacity = "0.7";
    }

    try {
      const title = getArticleTitle();
      const author = getAuthor();
      const time = getPublishTime();
      const contentEl = getArticleContent();

      if (!contentEl) {
        alert("下载器：未找到文章正文，请确认当前页面是少数派文章页。");
        console.error(DEBUG_PREFIX, "未找到正文容器");
        return;
      }

    // 先从原始 DOM 提取图片（避免 cleanContent 删除）
    const images = extractImagesFromContent(contentEl);
    console.log(DEBUG_PREFIX, "从原始 DOM 检测到图片数量:", images.length);

    const cleaned = cleanContent(contentEl);
    if (!cleaned) {
      alert("下载器：正文清理失败。");
      return;
    }
    
    // 再从 cleaned 中提取图片（浏览器可能在此期间加载了更多图片）
    const cleanedImages = extractImagesFromContent(cleaned);
    console.log(DEBUG_PREFIX, "从 cleaned DOM 检测到图片数量:", cleanedImages.length);
    
    // 合并图片列表，去重（使用 originalUrl 作为键）
    const allImagesMap = {};
    [...images, ...cleanedImages].forEach(img => {
      allImagesMap[img.originalUrl] = img;
    });
    const allImages = Object.values(allImagesMap);
    console.log(DEBUG_PREFIX, "合并后图片数量:", allImages.length);

      // 选择文件夹（如果浏览器支持且有图片）
      let dirHandle = null;
      let imageMap = {};

      if (allImages.length > 0) {
        dirHandle = await showFolderPicker();
      }

      // 获取日期字符串
      let dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      if (time) {
        const dateMatch = time.match(/(\d{4})-(\d{2})-(\d{2})/);
        if (dateMatch) {
          dateStr = dateMatch[1] + dateMatch[2] + dateMatch[3];
        }
      }

      // 下载图片到文件夹
      if (dirHandle && allImages.length > 0) {
        const imagesFolder = await dirHandle.getDirectoryHandle("images", { create: true });
        let successCount = 0;
        let failCount = 0;

        for (let i = 0; i < allImages.length; i++) {
          const img = allImages[i];
          const ext = getExtensionFromUrl(img.cleanUrl);
          const filename = generateImageFilename(dateStr, title, i + 1) + "." + ext;

          console.log(DEBUG_PREFIX, `正在下载图片 ${i + 1}/${allImages.length}:`, img.cleanUrl.slice(0, 80));

          try {
            const blob = await downloadImageWithGM(img.cleanUrl);
            await saveBlobToFolder(blob, filename, imagesFolder);
            imageMap[img.cleanUrl] = "images/" + filename;
            successCount++;
            console.log(DEBUG_PREFIX, "图片下载成功:", filename, "大小:", Math.round(blob.size / 1024), "KB");
          } catch (err) {
            failCount++;
            console.error(DEBUG_PREFIX, "图片下载失败:", img.cleanUrl, "错误:", err.message);
            imageMap[img.cleanUrl] = img.originalUrl; // 失败时保留原 URL
          }
        }

        console.log(DEBUG_PREFIX, "图片下载统计:", successCount, "成功,", failCount, "失败, 共", allImages.length, "张");
      }

      const td = createTurndownService(imageMap);
      const markdown = td.turndown(cleaned.innerHTML);

      // 组装最终 Markdown
      const safeTitle = escapeMarkdownInline(title);
      const safeAuthor = escapeMarkdownInline(author);
      const timeStr = time ? ` - ${time}` : "";

      const finalMarkdown =
        `# ${safeTitle}\n\n` +
        `**作者：** ${safeAuthor}  \n` +
        `**发布时间：** ${time || "未知"}  \n` +
        `**来源：** ${location.href}\n\n` +
        `---\n\n` +
        markdown;

      if (dirHandle) {
        // 保存 Markdown 到选择的文件夹
        const mdFilename = sanitizeFilename(title).slice(0, 120) + ".md";
        const mdFile = await dirHandle.getFileHandle(mdFilename, { create: true });
        const writable = await mdFile.createWritable();
        await writable.write("\uFEFF" + finalMarkdown);
        await writable.close();
        console.log(DEBUG_PREFIX, "文件保存完成:", mdFilename, "图片数:", images.length);
        alert("下载完成！\n\nMarkdown 和图片已保存到选择的文件夹\n图片保存在 images/ 子文件夹");
      } else {
        // 回退：使用 blob 下载（旧方式）
        const filename = `【少数派】${sanitizeFilename(title).slice(0, 120)}${timeStr}.md`;

        const blob = new Blob(["\uFEFF" + finalMarkdown], { type: "text/markdown;charset=utf-8" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        link.rel = "noopener";
        document.body.appendChild(link);
        link.click();

        setTimeout(() => {
          URL.revokeObjectURL(link.href);
          if (link.parentNode) link.remove();
        }, 5000);

        console.log(DEBUG_PREFIX, "文章下载完成（blob 方式）:", filename, "图片数:", images.length);
      }

    } catch (err) {
      console.error(DEBUG_PREFIX, "导出失败:", err);
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
   * 下载矩阵页（文章列表）
   */
  function downloadMatrix() {
    const btn = document.getElementById(BUTTON_ID);
    if (btn) {
      btn.disabled = true;
      btn.innerText = " 正在下载... ";
      btn.style.opacity = "0.7";
    }

    try {
      // 提取矩阵页的文章列表
      const articles = [];
      const cardSelectors = [
        ".article-card",
        ".post-card",
        ".matrix-item",
        "article",
        ".item"
      ];

      let foundCards = [];
      for (const sel of cardSelectors) {
        foundCards = document.querySelectorAll(sel);
        if (foundCards.length > 0) {
          console.log(DEBUG_PREFIX, "矩阵页选择器命中:", sel, "数量:", foundCards.length);
          break;
        }
      }

      if (foundCards.length === 0) {
        // 兜底：尝试提取所有链接
        console.warn(DEBUG_PREFIX, "未找到文章卡片，尝试提取所有文章链接");
        const links = document.querySelectorAll("a[href^='/post/']");
        links.forEach(link => {
          const title = link.innerText.trim();
          const href = link.href;
          if (title && href) {
            articles.push({ title, href });
          }
        });
      } else {
        foundCards.forEach(card => {
          const titleEl = card.querySelector("h2, h3, h4, .title, .post-title");
          const linkEl = card.querySelector("a[href^='/post/']") || card.querySelector("a");
          const title = titleEl ? titleEl.innerText.trim() : (linkEl ? linkEl.innerText.trim() : "");
          const href = linkEl ? linkEl.href : "";
          if (title && href) {
            articles.push({ title, href });
          }
        });
      }

      if (articles.length === 0) {
        alert("下载器：未找到文章列表，请确认当前页面是少数派矩阵页。");
        console.error(DEBUG_PREFIX, "矩阵页未提取到任何文章");
        return;
      }

      // 去重
      const seen = new Set();
      const uniqueArticles = articles.filter(a => {
        if (seen.has(a.href)) return false;
        seen.add(a.href);
        return true;
      });

      let markdown = `# 少数派 Matrix - 文章列表\n\n`;
      markdown += `**来源：** ${location.href}\n\n`;
      markdown += `**共 ${uniqueArticles.length} 篇文章**\n\n`;
      markdown += `---\n\n`;

      uniqueArticles.forEach((article, index) => {
        const safeTitle = escapeMarkdownInline(article.title);
        markdown += `${index + 1}. [${safeTitle}](${article.href})\n`;
      });

      const filename = `【少数派 Matrix】文章列表 - ${sanitizeFilename(document.title).slice(0, 60)}.md`;

      const blob = new Blob(["\uFEFF" + markdown], { type: "text/markdown;charset=utf-8" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();

      setTimeout(() => {
        URL.revokeObjectURL(link.href);
        if (link.parentNode) link.remove();
      }, 5000);

      console.log(DEBUG_PREFIX, "矩阵页下载完成:", filename, "文章数:", uniqueArticles.length);

    } catch (err) {
      console.error(DEBUG_PREFIX, "矩阵页导出失败:", err);
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
   * 根据页面类型处理下载
   */
  function handleDownload() {
    const pageType = getPageType();
    if (pageType === "article") {
      downloadArticle();
    } else if (pageType === "matrix") {
      downloadMatrix();
    } else {
      alert("下载器：当前页面不是少数派文章页或矩阵页，无法下载。");
    }
  }

  /**
   * 挂载或移除按钮
   */
  function ensureButton() {
    const existing = document.getElementById(BUTTON_ID);
    const pageType = getPageType();

    if (pageType) {
      if (!existing) {
        const button = makeButton(" 下载为Markdown ");
        button.addEventListener("click", handleDownload);
        document.body.appendChild(button);
        console.log(DEBUG_PREFIX, "检测到少数派页面，按钮已挂载:", location.href, "类型:", pageType);
      }
    } else {
      if (existing) {
        existing.remove();
        console.log(DEBUG_PREFIX, "离开少数派页面，按钮已移除");
      }
    }
  }

  // 拦截路由变化
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

  // MutationObserver 监听
  let lastUrl = location.href;
  function maybeEnsureButton() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      ensureButton();
    }
  }

  const observer = new MutationObserver(maybeEnsureButton);
  observer.observe(document.body, { childList: true, subtree: true });
  const titleEl = document.querySelector("title");
  if (titleEl) {
    const titleObserver = new MutationObserver(maybeEnsureButton);
    titleObserver.observe(titleEl, { childList: true });
  }

  window.addEventListener("popstate", ensureButton);
  window.addEventListener("hashchange", ensureButton);

  // 初始化
  console.log(DEBUG_PREFIX, "少数派下载器已加载（v1.1.0）");
  ensureButton();
})();
