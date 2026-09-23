// ==UserScript==
// @name         LifeUp Wiki 页面下载器
// @namespace    https://github.com/ghoustghoust/web2md
// @source       https://github.com/ghoustghoust/web2md
// @version      1.0.0
// @description  适用于 LifeUp（人升）Wiki（wiki.lifeupapp.fun）：一键将当前文档页导出为 Markdown，含标题、正文、图片、表格、代码块。支持 hash 路由切换页面。
// @author       ghoustghoust
// @match        https://wiki.lifeupapp.fun/*
// @license      MIT
// @grant        none
// @run-at       document-idle
// @noframes
// @homepageURL  https://github.com/ghoustghoust/web2md
// @supportURL   https://github.com/ghoustghoust/web2md/issues
// @require      https://unpkg.com/turndown@7.1.3/dist/turndown.js
// ==/UserScript==

/** 更新日志
 * 1.0.0: 初始版本
 *    - 支持 wiki.lifeupapp.fun 文档页当前页导出
 *    - 多选择器自动定位正文容器（docsify / vuepress 等主题兼容）
 *    - hashchange + MutationObserver 双监听，切换页面后按钮自动跟随
 *    - 点击时才抓取正文，避免路由切换后内容过期
 *    - 右下角悬浮按钮
 */

(function () {
  "use strict";

  const BUTTON_ID = "lifeup-wiki-downloader-floating-button";
  const DEBUG_PREFIX = "[下载器]";

  /**
   * 清洗文件名中的非法字符
   */
  function sanitizeFilename(str) {
    if (!str) return "untitled";
    return str
      .replace(/[<>:"\/\\|?*\x00-\x1f]/g, "_")
      .replace(/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i, "_$1$2")
      .trim()
      .slice(0, 120) || "untitled";
  }

  /**
   * 创建右下角悬浮按钮
   */
  function makeButton(buttonText) {
    const $button = document.createElement("button");
    $button.id = BUTTON_ID;
    $button.setAttribute("type", "button");
    $button.innerText = buttonText;
    $button.setAttribute("title", "点击下载当前 Wiki 页面为 Markdown");
    $button.style.position = "fixed";
    $button.style.bottom = "20px";
    $button.style.right = "20px";
    $button.style.zIndex = "999999";
    $button.style.height = "2.2em";
    $button.style.backgroundColor = "rgba(76, 140, 208, 0.9)";
    $button.style.color = "white";
    $button.style.outline = "none";
    $button.style.border = "none";
    $button.style.cursor = "pointer";
    $button.style.borderRadius = "1em";
    $button.style.fontSize = "1em";
    $button.style.padding = ".4em 1em";
    $button.style.boxShadow = "0 2px 6px rgba(0,0,0,0.3)";
    $button.setAttribute("aria-label", "将当前 Wiki 页面导出为 Markdown");
    return $button;
  }

  /**
   * 定位正文容器。
   * LifeUp Wiki 是 hash 路由的静态文档站（docsify 风格），
   * 不同主题的正文容器 class 不同，这里用多个候选选择器，
   * 取文本最长的一个作为正文。
   */
  function findContentElement() {
    const candidates = [];
    const selectors = [
      "main .markdown-section",           // docsify 默认主题
      ".markdown-section",                // docsify
      "main .theme-default-content",      // vuepress
      ".theme-default-content",
      "article",
      "main",
      ".content",
      "[class*='content']"
    ];
    selectors.forEach((sel) => {
      document.querySelectorAll(sel).forEach((el) => {
        // 过滤掉嵌套在另一个候选里的元素（保留最外层大容器）
        if (!el.innerText || el.innerText.trim().length < 50) return;
        candidates.push(el);
      });
    });
    if (!candidates.length) return null;
    // 取文本最长且不是整个 body 的容器
    candidates.sort((a, b) => b.innerText.trim().length - a.innerText.trim().length);
    const best = candidates[0];
    if (best === document.body) return null;
    return best;
  }

  /**
   * 克隆正文并清理无关元素（侧边栏、导航、翻页等）
   */
  function cleanContent(clone) {
    const removeSelectors = [
      ".sidebar",
      ".navbar",
      ".nav",
      "nav",
      "aside",
      "header",
      "footer",
      ".pagination",
      ".page-nav",
      ".page-navigator",
      ".toc",
      ".anchor",
      "script",
      "style",
      "iframe"
    ];
    removeSelectors.forEach((sel) => {
      clone.querySelectorAll(sel).forEach((el) => el.remove());
    });
    return clone;
  }

  /**
   * 获取当前页标题：优先 hash 路由对应的链接文本，其次第一个 h1
   */
  function getPageTitle(contentEl) {
    // hash 形如 #/guide/hello_lifeup，取最后一段
    const hash = location.hash || "";
    const last = hash.replace(/^#\/?/, "").split("/").filter(Boolean).pop();
    if (last) {
      // 尝试从侧边栏找到对应链接的显示文本
      const link = document.querySelector(`a[href*="${last}"]`);
      if (link && link.textContent.trim()) return link.textContent.trim();
    }
    if (contentEl) {
      const h1 = contentEl.querySelector("h1");
      if (h1 && h1.textContent.trim()) return h1.textContent.trim();
    }
    const title = document.querySelector("title");
    if (title && title.textContent.trim()) {
      return title.textContent.trim().replace(/\s*-\s*.*$/, "");
    }
    return last || "未命名页面";
  }

  /**
   * 导出当前页为 Markdown 并下载
   */
  function downloadCurrentPage() {
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
        alert("下载器：未找到正文内容，请确认页面已加载完成。");
        console.warn(DEBUG_PREFIX, "未找到正文容器，location:", location.href);
        return;
      }

      const clone = cleanContent(contentEl.cloneNode(true));
      const pageTitle = getPageTitle(contentEl);
      const dateStr = new Date().toISOString().slice(0, 10);

      const td = new TurndownService({
        headingStyle: "atx",
        bulletListMarker: "-",
        codeBlockStyle: "fenced",
        emDelimiter: "*"
      });

      // 图片：保留浏览器已解析的绝对地址
      td.addRule("absoluteImage", {
        filter: "img",
        replacement: (content, node) => {
          const alt = (node.getAttribute("alt") || "").trim();
          let src = node.getAttribute("src") || "";
          if (!src) return "";
          // 相对路径补全为绝对路径
          try {
            src = new URL(src, location.origin).href;
          } catch (e) { /* 保留原样 */ }
          return `![${alt}](${src})`;
        }
      });

      // 代码块：pre>code 保留语言标注
      td.addRule("fencedCodeBlock", {
        filter: (node) => node.nodeName === "PRE" && node.firstChild && node.firstChild.nodeName === "CODE",
        replacement: (content, node) => {
          const code = node.firstChild.textContent || "";
          const lang = (node.firstChild.className || "").replace(/language-/, "").trim();
          return "\n\n```" + lang + "\n" + code.replace(/\n+$/, "") + "\n```\n\n";
        }
      });

      let markdown = td.turndown(clone.innerHTML || "");

      // 后处理：压缩多余空行、去掉行尾空格
      markdown = markdown
        .replace(/\n{3,}/g, "\n\n")
        .replace(/[ \t]+\n/g, "\n")
        .trim();

      if (!markdown || markdown.length < 10) {
        alert("下载器：正文内容为空，页面可能还没渲染完，请稍等再试。");
        console.warn(DEBUG_PREFIX, "正文为空，contentEl:", contentEl);
        return;
      }

      let fullMd = `# ${pageTitle}\n\n`;
      fullMd += `**来源：** ${location.href}  \n`;
      fullMd += `**下载时间：** ${dateStr}  \n`;
      fullMd += `\n---\n\n`;
      fullMd += markdown + "\n";

      const filename = `【lifeup】${sanitizeFilename(pageTitle)}.md`;
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

      console.log(DEBUG_PREFIX, "LifeUp Wiki 导出完成:", filename, "字数:", fullMd.length);
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
   * 挂载或移除按钮
   */
  function ensureButton() {
    const existing = document.getElementById(BUTTON_ID);
    // 只在文档页显示按钮（hash 里要有路径，排除首页空 hash）
    const hash = location.hash || "";
    const isDocPage = hash.replace(/^#\/?/, "").trim().length > 0;

    if (isDocPage) {
      if (!existing) {
        const button = makeButton(" 下载为Markdown ");
        button.addEventListener("click", downloadCurrentPage);
        document.body.appendChild(button);
        console.log(DEBUG_PREFIX, "检测到 LifeUp Wiki 文档页，按钮已挂载:", location.href);
      }
    } else {
      if (existing) {
        existing.remove();
        console.log(DEBUG_PREFIX, "离开文档页，按钮已移除");
      }
    }
  }

  // hash 路由：docsify 切换页面只改 hash，必须监听 hashchange
  window.addEventListener("hashchange", () => {
    // 延迟一点等 docsify 渲染完正文
    setTimeout(ensureButton, 300);
  });

  // MutationObserver 兜底：页面初次加载 / 异步渲染完成后补挂按钮
  let lastUrl = location.href;
  function maybeEnsureButton() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(ensureButton, 300);
    }
  }
  const observer = new MutationObserver(maybeEnsureButton);
  observer.observe(document.body, { childList: true, subtree: true });

  window.addEventListener("popstate", ensureButton);

  // 初始化
  console.log(DEBUG_PREFIX, "LifeUp Wiki 下载器已加载（v1.0.0）");
  setTimeout(ensureButton, 500);
})();
