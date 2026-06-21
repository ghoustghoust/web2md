// ==UserScript==
// @name         X 文章下崽器（Article 通用版）
// @namespace    http://x.com/
// @source       https://github.com/
// @version      2.0.15
// @description  适用于 X（Twitter）Articles 详情页：一键将文章正文全格式导出为 Markdown，支持图片、标题、双语段落
// @author       xdd (modified)
// @match        *://x.com/*
// @match        *://twitter.com/*
// @license      MIT
// @grant        none
// @run-at       document-idle
// @noframes
// @homepageURL  https://x.com/
// @supportURL   https://x.com/
// @connect      unpkg.com
// @require      https://unpkg.com/turndown@7.1.3/dist/turndown.js
// ==/UserScript==

/** 更新日志
 * 2.0.15: 修复链接被错误分段 + 图片 404 + 边界优化
 *    ① fixImageUrl: 已有扩展名的图片 URL 去掉所有参数（避免 name=orig 导致 404）。
 *      无扩展名的 URL 使用 format=jpg&name=large。
 *    ② xImage / extractImages: 优先使用 data-src 而非 src（避免懒加载占位符），
 *      支持从 srcset 提取最大尺寸图片。
 *    ③ postprocess 逐行扫描：支持单向合并（前向/后向），解决前面是标题时
 *      链接无法合并的问题（如 [Bun] 链接在标题后）。
 *    ④ mergeTextDivs 新增 flattenIfSingleDiv：展平 div > div > text 嵌套。
 *    ⑤ isBlockStart: `!` 改为 `![` 精确匹配，避免误判以 `!` 开头的文本行。
 *    ⑥ extractImages srcset: 按尺寸 w 排序取最大，而非取最后一个。
 *    ⑦ 保留：v2.0.14 的按钮可靠性、加粗/标题区分等。
 */

(function () {
  "use strict";

  const BUTTON_ID = "x-article-downloader-floating-button";
  const DEBUG_PREFIX = "[下崽器]";

  function getText(el) {
    if (!el || typeof el.innerText !== "string") return "";
    try { return String(el.innerText || "").trim(); } catch (e) { return ""; }
  }

  function isXArticlePage() {
    const host = location.hostname.toLowerCase();
    const path = location.pathname;
    return /(x\.com|twitter\.com)$/.test(host) && /\/status\//.test(path);
  }

  function sanitizeFilename(str) {
    if (!str) return "untitled";
    return String(str).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim();
  }

  function makeButton(text) {
    const btn = document.createElement("div");
    btn.id = BUTTON_ID;
    btn.innerText = text;
    btn.setAttribute("title", "点击下载当前文章为 Markdown");
    btn.style.cssText = "position:fixed !important;bottom:20px !important;right:20px !important;z-index:999999999 !important;display:block !important;visibility:visible !important;opacity:1 !important;pointer-events:auto !important;height:auto !important;line-height:2.2em !important;background:rgba(29,155,240,0.95) !important;color:white !important;border:none !important;border-radius:1em !important;font-size:1em !important;padding:.4em 1.2em !important;box-shadow:0 2px 8px rgba(0,0,0,0.4) !important;cursor:pointer !important;white-space:nowrap !important;";
    if (window.matchMedia && window.matchMedia("(max-width: 768px)").matches) {
      btn.style.bottom = "60px !important";
    }
    return btn;
  }

  // ========== 作者信息 ==========
  function collectAuthorInfo() {
    const info = { name: "", handle: "" };
    const primaryColumn = document.querySelector('[data-testid="primaryColumn"]');
    if (!primaryColumn) return info;

    const articles = primaryColumn.querySelectorAll("article");
    for (const article of articles) {
      const text = getText(article);
      if (text.length < 100) continue;
      const handleMatch = text.match(/@([a-zA-Z0-9_]+)/);
      if (handleMatch) info.handle = "@" + handleMatch[1];
      break;
    }

    if (info.handle) {
      const handleWithoutAt = info.handle.replace("@", "");
      const links = document.querySelectorAll('a[href^="/"]');
      for (const link of links) {
        const href = link.getAttribute("href") || "";
        const text = getText(link);
        if (href === "/" + handleWithoutAt && !text.startsWith("@") && text.length > 2 && text.length < 30) {
          info.name = text;
          break;
        }
      }
    }

    console.log(DEBUG_PREFIX, "作者:", info);
    return info;
  }

  // ========== 工具函数 ==========
  function isAvatar(src) {
    return !src || src.includes("_bigger") || src.includes("_normal") || src.includes("_mini") || src.includes("profile_images");
  }

  function isUIKeyword(text) {
    if (!text || typeof text !== "string") return true;
    const keywords = [
      "Article", "See new posts", "Conversation", "Show more",
      "Home", "Search", "Explore", "Notifications", "Messages", "Grok", "Bookmarks",
      "Lists", "Communities", "Premium", "Profile", "More", "Post",
      "Follow", "Following", "Relevant", "View quotes",
      "Reply", "Retweet", "Like", "Share", "Copy link",
      "Upgrade to Premium", "Want to publish your own Article?",
      "Get Verified", "Get Comments", "Sign in", "Log in", "Sign up",
      "Terms of Service", "Privacy Policy", "Cookie Policy",
      "Terms", "Privacy", "Cookies", "Accessibility",
      "Ads Info", "More…", "© 2026 X Corp.", "View",
    ];
    for (const kw of keywords) {
      if (text === kw || text.startsWith(kw + " ")) return true;
    }
    return false;
  }

  function isUserLink(href) {
    if (!href) return false;
    return /^\/[a-zA-Z0-9_]+$/.test(href) ||
           /^\/[a-zA-Z0-9_]+\?/.test(href) ||
           /^https:\/\/x\.com\/[a-zA-Z0-9_]+/.test(href) ||
           /^https:\/\/twitter\.com\/[a-zA-Z0-9_]+/.test(href) ||
           /^\/[a-zA-Z0-9_]+\/status\//.test(href) ||
           /^\/[a-zA-Z0-9_]+\/article\//.test(href);
  }

  function isAuthor(text, info) {
    if (!text || !info) return false;
    return (info.name && text === info.name) ||
           (info.handle && text.includes(info.handle));
  }

  function fixImageUrl(src) {
    if (!src) return "";
    if (src.includes("pbs.twimg.com")) {
      // 如果已有文件扩展名，去掉所有参数（避免 name=orig 等导致 404）
      if (/\.(jpg|jpeg|png|webp|gif)(\?.*)?$/i.test(src)) {
        return src.replace(/\?.*$/, '');
      }
      // 对于无扩展名的 URL，使用 format=jpg&name=large（更兼容）
      const formatMatch = src.match(/[?&]format=([^&]+)/);
      const format = formatMatch ? formatMatch[1] : "jpg";
      return src.replace(/\?.*$/, `?format=${format}&name=large`);
    }
    return src;
  }

  // ========== 核心：在原始 DOM 中标记样式（图片 + 加粗 + 标题） ==========
  function markStyles(container) {
    if (!container) return;
    const elements = container.querySelectorAll("*");
    for (const el of elements) {
      try {
        const tag = el.tagName.toLowerCase();
        
        // 原生标题标签直接标记为 data-x-heading
        if (/^h[1-6]$/.test(tag)) {
          el.setAttribute("data-x-heading", "true");
          el.removeAttribute("data-x-bold");
          continue;
        }
        
        const style = window.getComputedStyle(el);
        
        // 标记背景图
        const bg = style.backgroundImage;
        if (bg && bg !== "none") {
          const match = bg.match(/url\(["']?(.*?)["']?\)/);
          if (match && match[1] && !isAvatar(match[1])) {
            el.setAttribute("data-x-image", fixImageUrl(match[1]));
          }
        }
        
        // 标记视频（原生 video 标签或 X 视频容器 div[data-media-key]）
        if (tag === "video" || el.getAttribute("data-media-key") || el.querySelector("video")) {
          const videoEl = tag === "video" ? el : el.querySelector("video");
          if (videoEl) {
            const src = videoEl.getAttribute("src") || "";
            const source = videoEl.querySelector("source");
            const src2 = source ? source.getAttribute("src") || "" : "";
            const poster = videoEl.getAttribute("poster") || "";
            const finalSrc = src || src2 || poster;
            if (finalSrc) {
              el.setAttribute("data-x-video", finalSrc);
            }
          }
        }
        const fw = style.fontWeight;
        const fz = style.fontSize;
        const fzVal = parseFloat(fz);
        const isBold = fw === "bold" || (parseInt(fw) >= 600 && !isNaN(parseInt(fw)));

        if (isBold) {
          const text = getText(el);
          if (text.length > 0) {
            if (fzVal >= 18) {
              el.setAttribute("data-x-heading", "true");
              el.removeAttribute("data-x-bold");
            } else {
              el.setAttribute("data-x-bold", "true");
            }
          }
        }
      } catch (e) {}
    }
  }

  // ========== 核心：从元素提取图片 ==========
  function extractImagesFromElement(element) {
    const images = [];
    if (!element) return images;

    const imgs = element.querySelectorAll("img");
    for (const img of imgs) {
      let src = img.getAttribute("data-src") || img.getAttribute("src") || "";
      if (!src || src.startsWith("data:")) {
        const srcset = img.getAttribute("srcset");
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
      if (!src || isAvatar(src)) continue;
      images.push({ src: fixImageUrl(src), alt: img.getAttribute("alt") || "Image" });
    }

    const marked = element.querySelectorAll("[data-x-image]");
    for (const el of marked) {
      const src = el.getAttribute("data-x-image") || "";
      if (src && !isAvatar(src)) {
        images.push({ src, alt: "Image" });
      }
    }

    const divs = element.querySelectorAll("div");
    for (const div of divs) {
      const style = div.getAttribute("style") || "";
      if (style.includes("background-image")) {
        const match = style.match(/url\(["']?(.*?)["']?\)/);
        if (match && match[1] && !isAvatar(match[1])) {
          images.push({ src: fixImageUrl(match[1]), alt: "Image" });
        }
      }
    }

    return images;
  }

  // ========== 核心：unwrap <strong> 和 <b> 标签（避免与 data-x-bold 叠加） ==========
  function unwrapBoldTags(node) {
    if (!node) return;
    Array.from(node.querySelectorAll("strong, b")).forEach(el => {
      if (el.parentNode) {
        const text = document.createTextNode(el.innerText || "");
        el.parentNode.replaceChild(text, el);
      }
    });
  }

  // ========== 核心：合并相邻 div（包含 inline 元素如 <a>） ==========
  function mergeTextDivs(node) {
    if (!node || node.children.length < 2) return;
    
    // 展平单层嵌套 div（div > div > text → div > text），避免内层 div 被 Turndown 当作 block 分段
    function flattenIfSingleDiv(el) {
      if (el.children.length === 1 && el.children[0].tagName === "DIV") {
        const child = el.children[0];
        const hasBlock = child.querySelectorAll('p, h1, h2, h3, h4, h5, h6, ul, ol, li, pre, blockquote, img, table, video, [data-x-heading]').length > 0;
        if (!hasBlock) {
          while (child.firstChild) {
            el.appendChild(child.firstChild);
          }
          child.remove();
          return true;
        }
      }
      return false;
    }
    
    const children = Array.from(node.children);
    let i = 0;
    let mergedCount = 0;
    while (i < children.length - 1) {
      const current = children[i];
      const next = children[i + 1];
      
      // 只合并相邻的 <div>
      if (current.tagName === "DIV" && next.tagName === "DIV") {
        // 先展平单层嵌套
        flattenIfSingleDiv(current);
        flattenIfSingleDiv(next);
        
        // 检查是否没有 block 级子元素（p, h1-h6, ul, ol, li, pre, blockquote, img, table, video, [data-x-heading]）
        // 允许包含 <a>、<span>、<strong>、<em> 等 inline 元素
        const hasBlockChild = (el) => {
          const blocks = el.querySelectorAll('p, h1, h2, h3, h4, h5, h6, ul, ol, li, pre, blockquote, img, table, video, [data-x-heading]');
          return blocks.length > 0;
        };
        
        if (!hasBlockChild(current) && !hasBlockChild(next)) {
          const currentText = getText(current);
          const nextText = getText(next);
          if (currentText && nextText && currentText.length > 0 && nextText.length > 0) {
            // 合并内容：把 next 的所有子节点（含 <a> 等 inline 标签）移到 current
            current.appendChild(document.createTextNode(" "));
            while (next.firstChild) {
              current.appendChild(next.firstChild);
            }
            next.remove();
            children.splice(i + 1, 1);
            mergedCount++;
            continue; // 继续检查当前 div 是否还能和下一个合并
          }
        }
      }
      i++;
    }
    
    if (mergedCount > 0) {
      console.log(DEBUG_PREFIX, "mergeTextDivs: 合并了", mergedCount, "对相邻 div");
    }
    
    // 递归处理子元素
    for (const child of children) {
      mergeTextDivs(child);
    }
  }

  // ========== 核心：DOM 清理 ==========
  function cleanDOM(node, authorInfo) {
    if (!node) return;

    // 0. 先把 data-x-image 的 div 替换为 img（避免被删除空元素误删）
    Array.from(node.querySelectorAll("[data-x-image]")).forEach(el => {
      const src = el.getAttribute("data-x-image");
      if (src && !isAvatar(src) && el.parentNode) {
        const img = document.createElement("img");
        img.setAttribute("src", src);
        img.setAttribute("alt", "Image");
        el.parentNode.replaceChild(img, el);
      }
    });

    // 0.5 处理视频容器：将标记了 data-x-video 的 div 替换为 video 标签（保留视频链接）
    Array.from(node.querySelectorAll("[data-x-video]")).forEach(el => {
      const src = el.getAttribute("data-x-video");
      if (src && el.parentNode) {
        const video = document.createElement("video");
        video.setAttribute("src", src);
        video.setAttribute("controls", "true");
        video.setAttribute("data-x-video-mark", "true");
        el.parentNode.replaceChild(video, el);
      }
    });
    const ariaHidden = Array.from(node.querySelectorAll('[aria-hidden="true"]'));
    ariaHidden.sort((a, b) => {
      const getDepth = (el) => {
        let d = 0, p = el;
        while (p && p !== node) { d++; p = p.parentElement; }
        return d;
      };
      return getDepth(b) - getDepth(a);
    });

    for (const el of ariaHidden) {
      if (!el.parentNode) continue;
      const images = extractImagesFromElement(el);
      if (images.length > 0) {
        for (const img of images) {
          const newImg = document.createElement("img");
          newImg.setAttribute("src", img.src);
          newImg.setAttribute("alt", img.alt);
          el.parentNode.insertBefore(newImg, el);
        }
      }
      el.remove();
    }

    // 2. 删除头像图片（优先检查 data-src 避免懒加载占位符误判）
    Array.from(node.querySelectorAll("img")).forEach(img => {
      const src = img.getAttribute("data-src") || img.getAttribute("src") || "";
      if (isAvatar(src)) img.remove();
    });

    // 3. 处理 <a> 标签
    Array.from(node.querySelectorAll("a")).forEach(a => {
      if (!a.parentNode) return;
      const href = a.getAttribute("href") || "";
      const text = getText(a);

      const images = extractImagesFromElement(a);
      if (images.length > 0) {
        for (const img of images) {
          const newImg = document.createElement("img");
          newImg.setAttribute("src", img.src);
          newImg.setAttribute("alt", img.alt);
          a.parentNode.insertBefore(newImg, a);
        }
        a.remove();
        return;
      }

      if (isUserLink(href) || href.includes("/media/")) {
        a.remove();
        return;
      }

      if (!text || text.length < 2 || isAuthor(text, authorInfo) || isUIKeyword(text)) {
        a.remove();
        return;
      }
    });

    // 4. 去重嵌套 data-x-bold / data-x-heading
    Array.from(node.querySelectorAll("[data-x-bold]")).forEach(el => {
      let p = el.parentElement;
      while (p && p !== node) {
        if (p.getAttribute("data-x-bold") === "true" || p.getAttribute("data-x-heading") === "true") {
          el.removeAttribute("data-x-bold");
          break;
        }
        p = p.parentElement;
      }
    });
    Array.from(node.querySelectorAll("[data-x-heading]")).forEach(el => {
      let p = el.parentElement;
      while (p && p !== node) {
        if (p.getAttribute("data-x-heading") === "true") {
          el.removeAttribute("data-x-heading");
          break;
        }
        p = p.parentElement;
      }
    });

    // 5. 删除 data-x-bold / data-x-heading 元素内部的 <strong> 和 <b>（避免 ****）
    Array.from(node.querySelectorAll("[data-x-bold]")).forEach(el => unwrapBoldTags(el));
    Array.from(node.querySelectorAll("[data-x-heading]")).forEach(el => unwrapBoldTags(el));

    // 6. 删除空元素（跳过 img、data-x-bold、data-x-heading）
    Array.from(node.querySelectorAll("*")).forEach(el => {
      if (el.tagName === "IMG") return;
      if (el.getAttribute("data-x-bold") === "true") return;
      if (el.getAttribute("data-x-heading") === "true") return;
      if (el.children.length === 0) {
        const text = getText(el);
        if (!text || text.length < 2 || isUIKeyword(text) || /^\d+[KM]?$/.test(text)) {
          el.remove();
        }
      }
    });

    // 7. 合并相邻 div（关键修复：包含 <a> 的 div 也合并）
    mergeTextDivs(node);
  }

  // 找到文章容器
  function findArticleContainer() {
    const primaryColumn = document.querySelector('[data-testid="primaryColumn"]');
    if (!primaryColumn) return null;

    const articles = primaryColumn.querySelectorAll("article");
    let best = null, bestLen = 0;
    for (const a of articles) {
      const len = getText(a).length;
      if (len > bestLen) { bestLen = len; best = a; }
    }

    if (best && bestLen > 50) return best;
    return primaryColumn;
  }

  // 创建 TurndownService
  function createTurndown() {
    const td = new TurndownService({ headingStyle: "atx", bulletListMarker: "-" });

    // 标题规则：data-x-heading → ##
    td.addRule("xHeading", {
      filter: function(node) {
        return node.getAttribute && node.getAttribute("data-x-heading") === "true";
      },
      replacement: function(content) {
        if (!content || content.trim().length === 0) return content;
        return "\n\n## " + content.trim() + "\n\n";
      }
    });

    // 加粗规则：data-x-bold
    td.addRule("xBold", {
      filter: function(node) {
        return node.getAttribute && node.getAttribute("data-x-bold") === "true";
      },
      replacement: function(content) {
        if (!content || content.trim().length === 0) return content;
        return "**" + content.trim() + "**";
      }
    });

    td.addRule("xImage", {
      filter: "img",
      replacement: (content, node) => {
        // 优先 data-src（真实图片），避免 lazy-load 占位符 src
        let src = node.getAttribute("data-src") || node.getAttribute("src") || "";
        // 如果 src 是 data URI 或空，尝试从 srcset 提取最大图片
        if (!src || src.startsWith("data:")) {
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
        if (!src) return "";
        if (isAvatar(src)) return "";
        src = fixImageUrl(src);
        const alt = (node.getAttribute("alt") || "Image").replace(/[\[\]]/g, "");
        return `\n\n![${alt}](${src})\n\n`;
      }
    });

    td.addRule("xVideo", {
      filter: function(node) {
        return node.nodeName === "VIDEO" || (node.getAttribute && node.getAttribute("data-x-video-mark") === "true");
      },
      replacement: (content, node) => {
        let src = node.getAttribute("src") || "";
        const source = node.querySelector("source");
        const src2 = source ? source.getAttribute("src") || "" : "";
        const final = src || src2;
        if (!final) return "";
        // 如果视频链接是 blob 或 data URI，降级为提示
        if (final.startsWith("blob:") || final.startsWith("data:")) {
          return "\n\n> [视频内容：浏览器内部链接，无法直接下载]\n\n";
        }
        return `\n\n[视频](${final})\n\n`;
      }
    });

    return td;
  }

  // 后处理 Markdown
  function postprocess(md, authorInfo) {
    if (!md) return "";
    md = String(md);

    // 1. 删除头像图片行
    md = md.replace(/!\[.*?\]\(.*?(bigger|normal|mini|profile_images).*?\)/g, "");

    // 2. 删除图片链接包装
    md = md.replace(/\[\n+\n*!\[Image\]\([^)]+\)\n+\n*\]\(\/[^)]+\)/g, function(match) {
      const imgMatch = match.match(/!\[Image\]\([^)]+\)/);
      return imgMatch ? imgMatch[0] : "";
    });

    // 3. 删除相邻重复的图片
    md = md.replace(/(!\[Image\]\((https:\/\/pbs\.twimg\.com\/[^)]+)\))\n*\n+!\[Image\]\(\2\)/g, "$1");

    // 4. 逐行合并孤立的 Markdown 内联元素（链接、加粗、斜体、行内代码）
    // 用逐行扫描替代正则，避免贪婪匹配导致的错位问题
    (function mergeInlineLines() {
      const lines = md.split('\n');
      let changed = true;
      while (changed) {
        changed = false;
        for (let i = 1; i < lines.length - 1; i++) {
          const currLine = lines[i].trim();
          
          // 当前行是否是孤立的 Markdown 内联元素
          const isLink = /^\[[^\]]+\]\([^)]+\)$/.test(currLine);
          const isBold = /^\*\*.+\*\*$/.test(currLine);
          const isItalic = /^_[^_]+_$/.test(currLine) || /^\*[^*]+\*$/.test(currLine);
          const isInlineCode = /^`[^`]+`$/.test(currLine);
          
          if (isLink || isBold || isItalic || isInlineCode) {
            // 向前查找最近的非空文本行
            let prevIdx = i - 1;
            while (prevIdx >= 0 && !lines[prevIdx].trim()) prevIdx--;
            // 向后查找最近的非空文本行
            let nextIdx = i + 1;
            while (nextIdx < lines.length && !lines[nextIdx].trim()) nextIdx++;
            
            if (prevIdx >= 0 && nextIdx < lines.length) {
              const prevLine = lines[prevIdx].trim();
              const nextLine = lines[nextIdx].trim();
              
              // 检查前后行是否是普通文本（非 block 元素开头）
              const isBlockStart = (line) => !line || line.startsWith('#') || line.startsWith('-') || 
                                    line.startsWith('>') || line.startsWith('![') || 
                                    line.startsWith('```') || line.startsWith('---') ||
                                    line.startsWith('|');
              
              if (prevLine && nextLine && !isBlockStart(prevLine) && !isBlockStart(nextLine)) {
                // 双向合并：前后都是普通文本
                lines[prevIdx] = lines[prevIdx] + ' ' + currLine + ' ' + lines[nextIdx];
                lines.splice(i, nextIdx - i + 1); // 删除 currLine 到 nextIdx（包括空行和 nextIdx）
                changed = true;
                console.log(DEBUG_PREFIX, "合并行双向:", currLine.slice(0, 80));
                break; // 重新扫描
              } else if (prevLine && !isBlockStart(prevLine)) {
                // 只向前合并：前面是普通文本，后面是 block/空/不存在
                lines[prevIdx] = lines[prevIdx] + ' ' + currLine;
                lines.splice(i, 1); // 只删除 currLine
                changed = true;
                console.log(DEBUG_PREFIX, "合并行前向:", currLine.slice(0, 80));
                break; // 重新扫描
              } else if (nextLine && !isBlockStart(nextLine)) {
                // 只向后合并：后面是普通文本，前面是 block/空
                lines[i] = currLine + ' ' + lines[nextIdx];
                lines.splice(i + 1, nextIdx - i); // 删除 i+1 到 nextIdx（中间空行和 nextIdx）
                changed = true;
                console.log(DEBUG_PREFIX, "合并行后向:", currLine.slice(0, 80));
                break; // 重新扫描
              }
            }
          }
        }
      }
      md = lines.join('\n');
    })();

    // 5. 拆分链接和标题混排：链接后紧跟 ## 标题
    md = md.replace(/(\[[^\n]+\]\([^)]+\))\s+(##\s+[^\n]+)/g, '$1\n\n$2');

    // 6. 删除所有 [ ](href) 格式
    md = md.replace(/\[\s*\]\(\/[^)]+\)/g, "");

    // 7. 删除所有 ](href) 格式（单独一行）
    md = md.replace(/^\]\(\/[^)]+\)\s*$/gm, "");

    // 8. 删除纯用户名行
    md = md.replace(/^@[a-zA-Z0-9_]+\s*$/gm, "");
    // 9. 删除纯路径行
    md = md.replace(/^\/[a-zA-Z0-9_/]+\s*$/gm, "");
    // 10. 删除空标题
    md = md.replace(/^#+\s*$/gm, "");
    // 11. 删除孤立标点行
    md = md.replace(/^[\,\.\:\;\!\?]\s*$/gm, "");

    // 12. 删除 UI 残留行
    md = md.replace(/^Want to publish your own Article\?.*$/gm, "");
    md = md.replace(/^Upgrade to Premium.*$/gm, "");
    md = md.replace(/^\d+[KM]?\s*Views?.*$/gm, "");
    md = md.replace(/^View quotes.*$/gm, "");
    md = md.replace(/^Relevant.*$/gm, "");

    // 13. 删除作者名单行
    if (authorInfo && authorInfo.name) {
      const nameEscaped = authorInfo.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const nameRegex = new RegExp("^" + nameEscaped + "\\s*$", "gm");
      md = md.replace(nameRegex, "");
    }

    // 14. 把正文第一个 ## 改为 #（主标题）
    md = md.replace(/^##\s+(.+)$/m, "# $1");

    // 15. 合并多余空行
    md = md.replace(/\n{3,}/g, "\n\n");
    md = md.replace(/^[ \t]+|[ \t]+$/gm, "");

    return md.trim();
  }

  // 获取标题
  function getTitle() {
    const meta = document.querySelector('meta[property="og:title"]');
    if (meta) {
      const c = meta.getAttribute("content");
      if (c && c.length > 5 && c !== "X") return c;
    }
    const t = document.title;
    if (t && t !== "X" && t.length > 5) {
      return t.replace(/\s*[\/|]\s*X\s*$/, "").trim();
    }
    return "untitled";
  }

  function getAuthor(info) {
    return info.handle || "";
  }

  function getTime() {
    const time = document.querySelector("time");
    return time ? (time.getAttribute("datetime") || getText(time)) : "";
  }

  // 点击处理
  function handleClick() {
    if (typeof TurndownService === "undefined") {
      alert("Turndown 库未加载，请刷新页面");
      return;
    }

    const btn = document.getElementById(BUTTON_ID);
    if (btn && btn.disabled) return;
    if (btn) { btn.disabled = true; btn.innerText = " 提取中... "; btn.style.opacity = "0.7"; }

    try {
      console.log(DEBUG_PREFIX, "开始提取...");

      const container = findArticleContainer();
      if (!container) {
        alert("未找到文章正文，请等页面加载完成");
        return;
      }

      const authorInfo = collectAuthorInfo();
      markStyles(container);

      const clone = container.cloneNode(true);
      cleanDOM(clone, authorInfo);

      Array.from(clone.querySelectorAll('[role="banner"], [role="group"], [role="navigation"], [data-testid="sidebarColumn"], [data-testid="bottomBar"], #' + BUTTON_ID)).forEach(el => el.remove());

      const td = createTurndown();
      let md = td.turndown(clone.innerHTML || "");

      console.log(DEBUG_PREFIX, "Turndown 原始长度:", md.length);
      md = postprocess(md, authorInfo);
      console.log(DEBUG_PREFIX, "后处理长度:", md.length);

      if (md.length < 100) {
        alert("提取内容很短（" + md.length + " 字符），可能不是文章页");
        return;
      }

      const title = getTitle();
      const author = getAuthor(authorInfo);
      const time = getTime();

      let finalMd = `# ${title}\n\n`;
      if (author) finalMd += `> **作者：** ${author}\n`;
      if (time) finalMd += `> **发布时间：** ${time}\n`;
      finalMd += `> **来源：** [X](${location.href})\n\n---\n\n${md}`;

      const site = location.hostname.replace(/^www\./, "");
      const filename = `【${site}】${sanitizeFilename(title).slice(0, 80)} - Article${author ? " - " + author : ""}.md`;

      const blob = new Blob(["\uFEFF" + finalMd], { type: "text/markdown;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 5000);

      console.log(DEBUG_PREFIX, "完成:", filename);

    } catch (err) {
      console.error(DEBUG_PREFIX, "失败:", err);
      alert("导出失败: " + err.message);
    } finally {
      if (btn) { btn.disabled = false; btn.innerText = " 下载文章 "; btn.style.opacity = "1"; }
    }
  }

  function ensureButton() {
    const existing = document.getElementById(BUTTON_ID);
    if (isXArticlePage()) {
      if (!existing) {
        const btn = makeButton(" 下载文章 ");
        btn.addEventListener("click", handleClick);
        document.body.appendChild(btn);
        console.log(DEBUG_PREFIX, "按钮已挂载");
      }
    } else if (existing) {
      existing.remove();
    }
  }

  (function() {
    const origPush = history.pushState;
    const origReplace = history.replaceState;
    function wrap(fn) {
      return function() {
        const result = fn.apply(this, arguments);
        setTimeout(ensureButton, 1000);
        return result;
      };
    }
    history.pushState = wrap(origPush);
    history.replaceState = wrap(origReplace);
  })();

  let lastUrl = location.href;
  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(ensureButton, 1500);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  window.addEventListener("popstate", () => setTimeout(ensureButton, 1000));

  console.log(DEBUG_PREFIX, "脚本已加载（X Article v2.0.15）");
  setTimeout(ensureButton, 2000);

  setInterval(() => {
    if (isXArticlePage() && !document.getElementById(BUTTON_ID)) {
      console.log(DEBUG_PREFIX, "按钮丢失，重新挂载");
      ensureButton();
    }
  }, 2000);
})();