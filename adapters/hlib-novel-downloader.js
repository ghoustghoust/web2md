// ==UserScript==
// @name         hlib.cc 小说下载器
// @namespace    https://github.com/ghoustghoust/web2md
// @source       https://github.com/ghoustghoust/web2md
// @version      1.0.0
// @description  适用于 hlib.cc 小说阅读页：一键下载小说章节，支持多页自动翻页合并，生成适合手机阅读的 Markdown 格式
// @author       ghoustghoust
// @match        https://hlib.cc/n/*
// @license      MIT
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// @noframes
// @homepageURL  https://github.com/ghoustghoust/web2md
// @supportURL   https://github.com/ghoustghoust/web2md/issues
// @connect      hlib.cc
// ==/UserScript==

/** 更新日志
 * 1.0.0: 初始版本
 *    - 支持 hlib.cc 小说阅读页（/n/*）
 *    - 自动翻页合并：检测"下一页"链接，fetch 多页内容合并
 *    - 提取 #content 容器作为正文，清理广告和导航
 *    - 输出 Markdown 格式，适合手机阅读（正确段落换行、保留章节标题）
 *    - 生成目录（TOC）对应章节标题
 *    - 右下角悬浮按钮，支持页面路由切换
 */

(function () {
  "use strict";

  const BUTTON_ID = "hlib-downloader-floating-button";
  const DEBUG_PREFIX = "[下载器]";
  const MAX_PAGES = 100; // 最大翻页数，防止无限循环

  /**
   * 清洗文件名中的非法字符
   */
  function sanitizeFilename(str) {
    if (!str) return "untitled";
    return str
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
      .replace(/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i, "_$1$2")
      .trim();
  }

  /**
   * 创建悬浮按钮
   */
  function makeButton(buttonText) {
    const $button = document.createElement("button");
    $button.id = BUTTON_ID;
    $button.setAttribute("type", "button");
    $button.innerText = buttonText;
    $button.setAttribute("title", "点击下载当前章节（自动翻页合并）");
    $button.style.position = "fixed";
    $button.style.bottom = "20px";
    $button.style.right = "20px";
    $button.style.zIndex = "999999";
    $button.style.height = "2.2em";
    $button.style.backgroundColor = "rgba(139, 90, 43, 0.9)"; // 棕色，适配小说阅读
    $button.style.color = "white";
    $button.style.outline = "none";
    $button.style.border = "none";
    $button.style.cursor = "pointer";
    $button.style.borderRadius = "1em";
    $button.style.fontSize = "1em";
    $button.style.padding = ".4em 1em";
    $button.style.boxShadow = "0 2px 6px rgba(0,0,0,0.3)";
    $button.setAttribute("aria-label", "将当前章节导出为 Markdown");

    if (window.matchMedia && window.matchMedia("(max-width: 768px)").matches) {
      $button.style.bottom = "60px";
    }

    return $button;
  }

  /**
   * 提取章节标题（从页面 title 或 h1）
   */
  function getChapterTitle() {
    const titleEl = document.querySelector("h1");
    if (titleEl && titleEl.innerText.trim()) {
      return titleEl.innerText.trim();
    }
    // 从 document.title 提取（格式通常是 "章节名 - 书名 - hlib.cc"）
    const titleParts = document.title.split(" - ");
    if (titleParts.length >= 2) {
      return titleParts[0].trim();
    }
    return document.title.trim() || "untitled";
  }

  /**
   * 提取书名（从页面 title 或 URL）
   */
  function getBookTitle() {
    const titleParts = document.title.split(" - ");
    if (titleParts.length >= 2) {
      return titleParts[1].trim();
    }
    return "未知书名";
  }

  /**
   * 提取 #content 中的正文 HTML
   */
  function getContentHTML() {
    const content = document.querySelector("#content");
    if (!content) {
      console.warn(DEBUG_PREFIX, "未找到 #content 容器");
      return null;
    }
    // 深克隆，避免修改原始 DOM
    return content.cloneNode(true);
  }

  /**
   * 清理正文中的无关元素
   */
  function cleanContent(node) {
    if (!node) return null;
    const clone = node.cloneNode(true);

    // 删除不需要的元素
    const removeSelectors = [
      "script", "style", "nav", "header", "footer", "aside",
      ".ads", ".ad", ".advertisement", ".banner",
      ".pagination", ".page-nav", ".chapter-nav",
      ".comments", "#comments", ".comment",
      ".share", ".share-bar", ".social-share",
      ".recommend", ".related", ".sidebar",
      "#" + BUTTON_ID
    ];
    removeSelectors.forEach(sel => {
      clone.querySelectorAll(sel).forEach(el => el.remove());
    });

    return clone;
  }

  /**
   * 检测"下一页"链接
   */
  function getNextPageUrl() {
    // 常见分页选择器
    const selectors = [
      "a[rel='next']",
      "a[aria-label='下一页']",
      ".pagination a:last-child",
      ".next a",
      "a.next",
      "[class*='next'] a",
      "a[href*='?page=']"
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.href) {
        // 排除"下一章"链接（通常包含 chapter 或明显不同）
        const text = (el.innerText || el.textContent || "").trim();
        if (text.includes("下一章") || text.includes("下一节")) {
          continue; // 跳过章节跳转，只翻页
        }
        return el.href;
      }
    }
    // 兜底：从页面链接中找下一页
    const allLinks = document.querySelectorAll("a");
    for (const link of allLinks) {
      const text = (link.innerText || link.textContent || "").trim();
      if (/下一页|下页|下一頁/.test(text) && link.href) {
        return link.href;
      }
    }
    return null;
  }

  /**
   * 使用 GM_xmlhttpRequest 获取下一页内容
   */
  function fetchPage(url) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== "undefined") {
        GM_xmlhttpRequest({
          method: "GET",
          url: url,
          onload: function(response) {
            if (response.status === 200) {
              resolve(response.responseText);
            } else {
              reject(new Error("HTTP " + response.status + " for " + url));
            }
          },
          onerror: function(err) {
            reject(new Error("Failed to fetch " + url));
          }
        });
      } else {
        fetch(url)
          .then(r => {
            if (!r.ok) throw new Error("HTTP " + r.status);
            return r.text();
          })
          .then(resolve)
          .catch(reject);
      }
    });
  }

  /**
   * 从 HTML 字符串中提取 #content 正文
   */
  function extractContentFromHTML(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const content = doc.querySelector("#content");
    if (!content) return null;
    return cleanContent(content);
  }

  /**
   * 从 HTML 字符串中提取下一页链接
   */
  function extractNextPageUrl(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    const selectors = [
      "a[rel='next']",
      "a[aria-label='下一页']",
      ".pagination a:last-child",
      ".next a",
      "a.next",
      "[class*='next'] a"
    ];
    for (const sel of selectors) {
      const el = doc.querySelector(sel);
      if (el && el.href) {
        const text = (el.innerText || el.textContent || "").trim();
        if (/下一章|下一节/.test(text)) continue;
        try {
          return new URL(el.href, location.href).href;
        } catch (e) {
          return el.href;
        }
      }
    }
    const allLinks = doc.querySelectorAll("a");
    for (const link of allLinks) {
      const text = (link.innerText || link.textContent || "").trim();
      if (/下一页|下页|下一頁/.test(text) && link.href) {
        try {
          return new URL(link.href, location.href).href;
        } catch (e) {
          return link.href;
        }
      }
    }
    return null;
  }

  /**
   * 将 HTML 转换为适合手机阅读的 Markdown
   * 处理段落、换行、空行等
   */
  function htmlToMarkdown(node) {
    if (!node) return "";

    let md = "";
    const children = node.childNodes;

    for (const child of children) {
      if (child.nodeType === Node.TEXT_NODE) {
        // 文本节点：保留内容，去除多余空白
        md += child.textContent;
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const tag = child.tagName.toLowerCase();
        const text = child.innerText.trim();

        if (!text) continue;

        switch (tag) {
          case "p":
            md += "\n\n" + htmlToMarkdown(child).trim() + "\n\n";
            break;
          case "br":
            md += "\n";
            break;
          case "h1":
          case "h2":
          case "h3":
          case "h4":
          case "h5":
          case "h6": {
            const level = parseInt(tag[1]);
            const hashes = "#".repeat(level);
            md += "\n\n" + hashes + " " + text + "\n\n";
            break;
          }
          case "div":
            // div 如果包含块级元素，递归处理；否则当作段落
            if (child.querySelector("p, h1, h2, h3, h4, h5, h6, div")) {
              md += htmlToMarkdown(child);
            } else {
              md += "\n\n" + htmlToMarkdown(child).trim() + "\n\n";
            }
            break;
          case "span":
          case "strong":
          case "em":
          case "b":
          case "i":
          case "a":
          case "small":
          case "big":
          case "font":
          case "center":
          case "blockquote":
            // 行内元素和简单块元素，递归处理
            md += htmlToMarkdown(child);
            break;
          case "img":
            // 小说通常没有图片，如果有则保留链接
            const src = child.getAttribute("src") || "";
            if (src) {
              md += "\n\n![Image](" + src + ")\n\n";
            }
            break;
          case "hr":
            md += "\n\n---\n\n";
            break;
          case "ul":
          case "ol": {
            const items = child.querySelectorAll("li");
            items.forEach((li, idx) => {
              const prefix = tag === "ol" ? (idx + 1) + ". " : "- ";
              md += "\n" + prefix + li.innerText.trim();
            });
            md += "\n\n";
            break;
          }
          case "table": {
            // 简单表格处理
            const rows = child.querySelectorAll("tr");
            if (rows.length > 0) {
              rows.forEach((row, ridx) => {
                const cells = row.querySelectorAll("td, th");
                const cellTexts = Array.from(cells).map(c => c.innerText.trim().replace(/\|/g, "\\|"));
                md += "\n| " + cellTexts.join(" | ") + " |";
                if (ridx === 0) {
                  md += "\n| " + cellTexts.map(() => "---").join(" | ") + " |";
                }
              });
              md += "\n\n";
            }
            break;
          }
          default:
            // 其他元素，递归处理文本
            md += htmlToMarkdown(child);
        }
      }
    }

    return md;
  }

  /**
   * 后处理 Markdown：清理多余空行、统一段落格式
   */
  function postprocessMarkdown(md) {
    // 1. 将多个连续换行压缩为最多两个（段落分隔）
    md = md.replace(/\n{3,}/g, "\n\n");
    // 2. 去除每行首尾空白
    md = md.split("\n").map(line => line.trimRight()).join("\n");
    // 3. 去除开头和结尾的空行
    md = md.replace(/^\n+/, "").replace(/\n+$/, "");
    // 4. 段落内部：将多个空格压缩为一个
    md = md.replace(/([^\n])  +/g, "$1 ");
    // 5. 处理 HTML 实体
    md = md.replace(/&nbsp;/g, " ");
    md = md.replace(/&lt;/g, "<");
    md = md.replace(/&gt;/g, ">");
    md = md.replace(/&amp;/g, "&");
    md = md.replace(/&quot;/g, '"');
    md = md.replace(/&#39;/g, "'");
    return md;
  }

  /**
   * 生成目录（TOC）
   */
  function generateTOC(chapters) {
    let toc = "## 目录\n\n";
    chapters.forEach((ch, idx) => {
      toc += (idx + 1) + ". [" + ch.title + "](#chapter-" + (idx + 1) + ")\n";
    });
    toc += "\n---\n\n";
    return toc;
  }

  /**
   * 主下载函数：翻页合并
   */
  async function downloadChapter() {
    const btn = document.getElementById(BUTTON_ID);
    if (btn && btn.disabled) return;

    if (btn) {
      btn.disabled = true;
      btn.innerText = " 正在翻页... ";
      btn.style.opacity = "0.7";
    }

    try {
      const chapters = []; // 存储所有页的内容
      let currentUrl = location.href;
      let pageCount = 0;

      console.log(DEBUG_PREFIX, "开始下载章节:", getChapterTitle());

      // 翻页循环
      while (currentUrl && pageCount < MAX_PAGES) {
        pageCount++;
        console.log(DEBUG_PREFIX, `正在获取第 ${pageCount} 页:`, currentUrl);

        let contentHTML;
        let nextUrl;

        if (pageCount === 1) {
          // 第一页：直接从当前 DOM 获取
          contentHTML = getContentHTML();
          nextUrl = getNextPageUrl();
        } else {
          // 后续页：通过 fetch 获取
          try {
            const html = await fetchPage(currentUrl);
            contentHTML = extractContentFromHTML(html);
            nextUrl = extractNextPageUrl(html);
          } catch (err) {
            console.error(DEBUG_PREFIX, "获取页面失败:", currentUrl, err.message);
            break;
          }
        }

        if (!contentHTML) {
          console.warn(DEBUG_PREFIX, "第", pageCount, "页无内容");
          break;
        }

        // 转换为 Markdown
        let md = htmlToMarkdown(contentHTML);
        md = postprocessMarkdown(md);

        chapters.push({
          title: pageCount === 1 ? getChapterTitle() : `第 ${pageCount} 页`,
          content: md,
          url: currentUrl
        });

        console.log(DEBUG_PREFIX, `第 ${pageCount} 页获取完成，字数:`, md.length);

        // 检测是否还有下一页
        if (!nextUrl || nextUrl === currentUrl) {
          console.log(DEBUG_PREFIX, "没有更多页面");
          break;
        }

        currentUrl = nextUrl;

        // 小延迟，避免请求过快
        if (pageCount < MAX_PAGES) {
          await new Promise(r => setTimeout(r, 500));
        }
      }

      if (chapters.length === 0) {
        alert("下载器：未获取到任何内容。");
        return;
      }

      console.log(DEBUG_PREFIX, "共获取", chapters.length, "页");

      // 组装最终 Markdown
      const bookTitle = getBookTitle();
      const chapterTitle = getChapterTitle();
      const dateStr = new Date().toISOString().slice(0, 10);

      let finalMarkdown = `# ${chapterTitle}\n\n`;
      finalMarkdown += `**书名：** ${bookTitle}  \n`;
      finalMarkdown += `**来源：** ${location.href}  \n`;
      finalMarkdown += `**下载时间：** ${dateStr}  \n`;
      finalMarkdown += `**共 ${chapters.length} 页**\n\n`;
      finalMarkdown += `---\n\n`;

      // 生成目录
      if (chapters.length > 1) {
        finalMarkdown += generateTOC(chapters);
      }

      // 合并内容
      chapters.forEach((ch, idx) => {
        if (chapters.length > 1) {
          finalMarkdown += `<a id="chapter-${idx + 1}"></a>\n\n`;
          finalMarkdown += `## ${ch.title}\n\n`;
        }
        finalMarkdown += ch.content + "\n\n";
        if (idx < chapters.length - 1) {
          finalMarkdown += `---\n\n`;
        }
      });

      // 下载文件
      const filename = sanitizeFilename(`${bookTitle} - ${chapterTitle}`).slice(0, 120) + ".md";
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

      console.log(DEBUG_PREFIX, "下载完成:", filename, "页数:", chapters.length, "总字数:", finalMarkdown.length);
      alert(`下载完成！\n\n文件名：${filename}\n页数：${chapters.length}\n总字数：${finalMarkdown.length}`);

    } catch (err) {
      console.error(DEBUG_PREFIX, "导出失败:", err);
      alert("下载器：导出失败，错误信息：" + err.message);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerText = " 下载章节 ";
        btn.style.opacity = "1";
      }
    }
  }

  /**
   * 挂载或移除按钮
   */
  function ensureButton() {
    const existing = document.getElementById(BUTTON_ID);
    const isNovelPage = location.hostname === "hlib.cc" && /^\/n\//.test(location.pathname);

    if (isNovelPage) {
      if (!existing) {
        const button = makeButton(" 下载章节 ");
        button.addEventListener("click", downloadChapter);
        document.body.appendChild(button);
        console.log(DEBUG_PREFIX, "检测到 hlib.cc 小说页，按钮已挂载:", location.href);
      }
    } else {
      if (existing) {
        existing.remove();
        console.log(DEBUG_PREFIX, "离开 hlib.cc 小说页，按钮已移除");
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
  console.log(DEBUG_PREFIX, "hlib.cc 小说下载器已加载（v1.0.0）");
  ensureButton();
})();
