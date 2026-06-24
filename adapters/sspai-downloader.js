// ==UserScript==
// @name         少数派文章下载器
// @namespace    https://github.com/ghoustghoust/web2md
// @source       https://github.com/ghoustghoust/web2md
// @version      1.0.0
// @description  适用于少数派（sspai.com）文章页：一键将文章导出为 Markdown，含标题、作者、发布时间、正文、图片等
// @author       ghoustghoust
// @match        https://sspai.com/post/*
// @match        https://sspai.com/matrix
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
   * 提取文章正文容器（多套选择器备选）
   */
  function getArticleContent() {
    const selectors = [
      ".content",
      ".wangEditor-txt",
      ".article-content",
      "article .content",
      ".post-content",
      "article"
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.innerText.trim().length > 50) {
        console.log(DEBUG_PREFIX, "找到正文容器:", sel, "长度:", el.innerText.trim().length);
        return el;
      }
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

    // 删除不需要的元素
    const removeSelectors = [
      "script", "style", "nav", "header", "footer", "aside",
      ".comments", "#comments", ".comment",
      ".sidebar", ".related", ".recommend",
      ".ads", ".ad", ".advertisement",
      "#" + BUTTON_ID
    ];
    removeSelectors.forEach(sel => {
      clone.querySelectorAll(sel).forEach(el => el.remove());
    });

    return clone;
  }

  /**
   * 创建 TurndownService 实例
   */
  function createTurndownService() {
    const td = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
      bulletListMarker: "-",
      emDelimiter: "*",
      strongDelimiter: "**"
    });

    // 图片：保留 alt，转绝对路径
    td.addRule("sspaiImage", {
      filter: "img",
      replacement: (content, node) => {
        let src = node.getAttribute("src") || node.getAttribute("data-src") || "";
        if (!src) return "";
        try {
          src = new URL(src, location.href).href;
        } catch (e) {
          // 保持原样
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
  function downloadArticle() {
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

      const cleaned = cleanContent(contentEl);
      if (!cleaned) {
        alert("下载器：正文清理失败。");
        return;
      }

      const td = createTurndownService();
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

      console.log(DEBUG_PREFIX, "文章下载完成:", filename);

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
  console.log(DEBUG_PREFIX, "少数派下载器已加载（v1.0.0）");
  ensureButton();
})();
