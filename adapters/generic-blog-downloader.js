// ==UserScript==
// @name         通用博客/文档站下载器
// @namespace    https://github.com/ghoustghoust/web2md
// @source       https://github.com/ghoustghoust/web2md
// @version      1.0.0
// @description  通用适配器：自动识别 Hugo / Hexo / VitePress / Astro / WordPress 等静态博客和文档站的文章正文，一键导出 Markdown。已适配专门脚本（少数派/知乎/CSDN/X 等）的网站自动跳过，避免重复按钮。
// @author       ghoustghoust
// @match        *://*/*
// @exclude      *://*.sspai.com/*
// @exclude      *://*.zhihu.com/*
// @exclude      *://*.csdn.net/*
// @exclude      *://x.com/*
// @exclude      *://twitter.com/*
// @exclude      *://*.x.com/*
// @exclude      *://hlib.cc/*
// @exclude      *://wiki.lifeupapp.fun/*
// @license      MIT
// @grant        none
// @run-at       document-idle
// @noframes
// @homepageURL  https://github.com/ghoustghoust/web2md
// @supportURL   https://github.com/ghoustghoust/web2md/issues
// @require      https://unpkg.com/turndown@7.1.3/dist/turndown.js
// @require      https://raw.githubusercontent.com/ghoustghoust/web2md/main/lib/turndown-rich-rules.js
// ==/UserScript==

/** 更新日志
 * 1.0.0: 初始版本
 *    - 多选择器 + 密度评分自动识别文章正文（Hugo/Hexo/VitePress/Astro/WordPress 等）
 *    - 排除已有专门适配器的网站，避免重复按钮
 *    - 元数据：og:title / meta author / article:published_time
 *    - 接入共享富语法规则库（公式/任务列表/注脚/表格展平等）
 *    - 右下角悬浮按钮
 */

(function () {
  "use strict";

  const BUTTON_ID = "generic-blog-downloader-floating-button";
  const DEBUG_PREFIX = "[下载器]";

  // 正文容器候选选择器（按优先级）
  const CONTENT_SELECTORS = [
    "article .post-content", "article .article-content", "article .entry-content",
    "article .markdown", "article .content",
    ".post-content", ".article-content", ".entry-content",
    ".markdown-body", ".md-content", ".theme-default-content",
    "article main", "article",
    "main article", "main .content", "main",
    "[role='main']"
  ];

  // 启发式检测：排除明显不是文章页的容器
  function isProbableArticle(el) {
    const text = el.innerText || "";
    const len = text.trim().length;
    if (len < 500) return false;
    // 正文特征：多个段落或标题
    const pCount = el.querySelectorAll("p").length;
    const hCount = el.querySelectorAll("h1,h2,h3,h4").length;
    if (pCount < 3 && hCount < 2) return false;
    // 链接密度过高 → 更像列表页/导航
    const linkText = Array.from(el.querySelectorAll("a"))
      .reduce((s, a) => s + (a.textContent || "").length, 0);
    if (linkText / Math.max(len, 1) > 0.5) return false;
    return true;
  }

  /** 定位正文容器：取评分最高（文本最长且不过度嵌套）的候选 */
  function findContentElement() {
    let best = null, bestLen = 0;
    for (const sel of CONTENT_SELECTORS) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        // 跳过嵌在另一个候选里的（保留最外层）
        const len = (el.innerText || "").trim().length;
        if (len < 500) continue;
        if (!best || len > bestLen) {
          // 防止把整个 body 当正文：限制 main 的文本占比
          if (sel === "main" && document.body) {
            const bodyLen = (document.body.innerText || "").trim().length;
            if (len / bodyLen > 0.9) continue; // main 几乎等于整页，不可靠
          }
          best = el;
          bestLen = len;
        }
      }
      if (best) break; // 高优先级选择器命中就停
    }
    if (best && isProbableArticle(best)) return best;
    return null;
  }

  function sanitizeFilename(str) {
    if (!str) return "untitled";
    return str
      .replace(/[<>:"\/\\|?*\x00-\x1f]/g, "_")
      .replace(/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i, "_$1$2")
      .trim()
      .slice(0, 120) || "untitled";
  }

  function makeButton(buttonText) {
    const $button = document.createElement("button");
    $button.id = BUTTON_ID;
    $button.setAttribute("type", "button");
    $button.innerText = buttonText;
    $button.setAttribute("title", "点击下载当前文章为 Markdown");
    $button.style.position = "fixed";
    $button.style.bottom = "20px";
    $button.style.right = "20px";
    $button.style.zIndex = "999999";
    $button.style.height = "2.2em";
    $button.style.backgroundColor = "rgba(80, 120, 200, 0.9)";
    $button.style.color = "white";
    $button.style.outline = "none";
    $button.style.border = "none";
    $button.style.cursor = "pointer";
    $button.style.borderRadius = "1em";
    $button.style.fontSize = "1em";
    $button.style.padding = ".4em 1em";
    $button.style.boxShadow = "0 2px 6px rgba(0,0,0,0.3)";
    $button.setAttribute("aria-label", "将当前页面导出为 Markdown");
    return $button;
  }

  /** 元数据：标题 / 作者 / 发布时间，全走 meta 标签优先 */
  function getMeta() {
    const meta = (name) => {
      const el = document.querySelector(`meta[property="${name}"], meta[name="${name}"]`);
      return el ? el.getAttribute("content") : "";
    };
    const title =
      meta("og:title") ||
      (document.querySelector("article h1, h1") || {}).textContent || "";
    const author =
      meta("author") || meta("article:author") || meta("twitter:creator") || "";
    const time =
      meta("article:published_time") || meta("date") || meta("publishdate") || "";
    let timeText = time;
    if (timeText) {
      const d = new Date(timeText);
      if (!isNaN(d.getTime())) timeText = d.toISOString().slice(0, 10);
    }
    return {
      title: (title || document.title || "untitled").trim(),
      author: (author || "").trim(),
      time: (timeText || "").trim()
    };
  }

  function cleanContent(clone) {
    const removeSelectors = [
      "script", "style", "iframe", "nav", "aside", "form",
      ".sidebar", ".related", ".recommend", ".comments", "#comments",
      ".post-nav", ".pagination", ".toc", ".share", ".advertisement",
      "[class*='cookie']", "[class*='newsletter']", "[id*='newsletter']"
    ];
    removeSelectors.forEach((sel) => {
      clone.querySelectorAll(sel).forEach((el) => el.remove());
    });
    // 标题里的空锚点
    clone.querySelectorAll("h1 a, h2 a, h3 a, h4 a, h5 a, h6 a").forEach((a) => {
      if (!a.textContent.trim() && !a.querySelector("img")) a.remove();
    });
    return clone;
  }

  function downloadPage() {
    const btn = document.getElementById(BUTTON_ID);
    if (btn) {
      btn.disabled = true;
      btn.innerText = " 导出中… ";
      btn.style.opacity = "0.7";
    }

    try {
      if (typeof TurndownService === "undefined") {
        alert("下载器：Turndown 库未加载，请检查网络或刷新页面后再试。");
        console.error(DEBUG_PREFIX, "TurndownService 未定义，@require 可能加载失败");
        return;
      }

      const contentEl = findContentElement();
      if (!contentEl) {
        alert("下载器：未识别到文章正文，这个页面可能不在支持范围。");
        console.warn(DEBUG_PREFIX, "未找到正文容器:", location.href);
        return;
      }

      const clone = cleanContent(contentEl.cloneNode(true));
      if (window.Web2mdRichRules) window.Web2mdRichRules.flattenTables(clone);

      const td = new TurndownService({
        headingStyle: "atx",
        bulletListMarker: "-",
        codeBlockStyle: "fenced",
        emDelimiter: "*"
      });

      if (window.Web2mdRichRules) window.Web2mdRichRules.apply(td);

      // 图片：懒加载兜底（data-src / data-original 优先）
      td.addRule("lazyImage", {
        filter: "img",
        replacement: (content, node) => {
          const alt = (node.getAttribute("alt") || "").trim();
          let src =
            node.getAttribute("data-src") ||
            node.getAttribute("data-original") ||
            node.getAttribute("data-lazy-src") ||
            node.getAttribute("src") || "";
          if (!src) return "";
          if (src.startsWith("//")) src = "https:" + src;
          return `![${alt}](${src})`;
        }
      });

      let markdown = td.turndown(clone.innerHTML || "");
      markdown = markdown
        .replace(/\n{3,}/g, "\n\n")
        .replace(/[ \t]+\n/g, "\n")
        .trim();

      if (!markdown || markdown.length < 50) {
        alert("下载器：正文内容为空或过少，页面可能还没渲染完。");
        return;
      }

      const meta = getMeta();
      const dateStr = new Date().toISOString().slice(0, 10);

      let fullMd = `# ${meta.title}\n\n`;
      if (meta.author) fullMd += `**作者：** ${meta.author}  \n`;
      if (meta.time) fullMd += `**发布时间：** ${meta.time}  \n`;
      fullMd += `**来源：** ${location.href}  \n`;
      fullMd += `**下载时间：** ${dateStr}  \n`;
      fullMd += `\n---\n\n`;
      fullMd += markdown + "\n";

      const filename = `【博客】${sanitizeFilename(meta.title)}.md`;
      const blob = new Blob(["\uFEFF" + fullMd], { type: "text/markdown;charset=utf-8" });
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

      console.log(DEBUG_PREFIX, "通用适配器导出完成:", filename, "字数:", fullMd.length);
      alert(`下载完成！\n文件名：${filename}`);
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

  function ensureButton() {
    const existing = document.getElementById(BUTTON_ID);
    // 只在像文章的页面挂按钮
    const contentEl = findContentElement();
    if (contentEl) {
      if (!existing) {
        const button = makeButton(" 下载为Markdown ");
        button.addEventListener("click", downloadPage);
        document.body.appendChild(button);
        console.log(DEBUG_PREFIX, "识别到文章页，按钮已挂载:", location.href);
      }
    } else if (existing) {
      existing.remove();
    }
  }

  // SPA 路由监听
  (function () {
    const origPush = history.pushState;
    const origReplace = history.replaceState;
    function wrap(fn) {
      return function () {
        const result = fn.apply(this, arguments);
        setTimeout(ensureButton, 500);
        return result;
      };
    }
    history.pushState = wrap(origPush);
    history.replaceState = wrap(origReplace);
  })();

  let lastUrl = location.href;
  let observerTimer = null;
  function maybeEnsureButton() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(ensureButton, 500);
      return;
    }
    // 页面初次渲染时正文可能还没出来，防抖后重试
    if (!document.getElementById(BUTTON_ID)) {
      clearTimeout(observerTimer);
      observerTimer = setTimeout(ensureButton, 800);
    }
  }
  const observer = new MutationObserver(maybeEnsureButton);
  observer.observe(document.body, { childList: true, subtree: true });

  window.addEventListener("popstate", ensureButton);
  window.addEventListener("hashchange", ensureButton);

  console.log(DEBUG_PREFIX, "通用博客下载器已加载（v1.0.0）");
  setTimeout(ensureButton, 800);
  setTimeout(ensureButton, 2500); // 延迟渲染的页面二次检测
})();
