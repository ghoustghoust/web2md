// ==UserScript==
// @name         CSDN 文章下载器（免登录版）
// @namespace    https://github.com/ghoustghoust/web2md
// @source       https://github.com/ghoustghoust/web2md
// @version      1.0.0
// @description  适用于 CSDN 博客文章页：免登录阅读全文 + 免登录复制 + 一键导出 Markdown。支持 KaTeX 公式、代码块、表格、任务列表、注脚等富语法。
// @author       ghoustghoust
// @match        https://*.csdn.net/*
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
 *    - 免登录：自动展开"阅读全文"、解锁复制（解绑 copy 事件、user-select、版权尾巴）
 *    - 免登录：抑制自动弹出的登录提示层（不拦截用户主动登录）
 *    - 导出：#content_views 正文 → Markdown，标题/作者/时间齐全
 *    - CSDN 特有处理：代码块复制按钮清除、link.csdn.net 跳转还原、标题空锚点清除
 *    - 接入共享富语法规则库（公式/任务列表/注脚/表格展平等）
 *    - 右下角悬浮按钮
 */

(function () {
  "use strict";

  const BUTTON_ID = "csdn-downloader-floating-button";
  const DEBUG_PREFIX = "[下载器]";

  /* ==================== 免登录模块 ==================== */

  /**
   * 解锁复制：CSDN 未登录时通过 copy 事件、user-select、版权尾巴三层限制复制
   * 思路参考 CSDNGreener（AGPL-3.0），代码独立实现
   */
  function unlockCopy() {
    // 1. 解绑 CSDN 挂在正文上的 copy 事件
    const content = document.querySelector("#content_views");
    if (content) {
      content.removeAttribute("oncopy");
      content.oncopy = null;
    }

    // 2. 恢复文本选择
    const style = document.createElement("style");
    style.id = "csdn-downloader-unlock";
    style.textContent =
      "#content_views, #content_views code, #content_views pre, article pre { user-select: auto !important; -webkit-user-select: auto !important; }";
    document.head.appendChild(style);

    // 3. 代码块复制按钮去掉登录要求
    document.querySelectorAll(".hljs-button").forEach((btn) => {
      btn.classList.remove("signin");
    });

    // 4. 锁死 articleType，防止复制时追加版权信息
    try {
      Object.defineProperty(window, "articleType", {
        value: 0, writable: false, configurable: false
      });
    } catch (e) { /* 已定义则忽略 */ }

    // 5. 清空 CSDN 版权信息初始化
    try {
      if (window.csdn && window.csdn.copyright && typeof window.csdn.copyright.init === "function") {
        window.csdn.copyright.init("", "", "");
      }
    } catch (e) { /* 忽略 */ }

    console.log(DEBUG_PREFIX, "免登录复制已解锁");
  }

  /**
   * 展开"阅读全文"：CSDN 有两代 DOM，都尝试
   * 思路参考 CSDNGreener（AGPL-3.0），代码独立实现
   */
  function expandArticle() {
    // 新一代：.hide-article-box 里的 .read-all-content-btn
    const readAll = document.querySelector(".hide-article-box .read-all-content-btn");
    if (readAll) {
      readAll.click();
      console.log(DEBUG_PREFIX, "已点击 read-all-content-btn 展开全文");
      return;
    }
    // 老一代：.btn-readmore 带 no-login class 时点击会跳登录页，
    // 换成 fans-read-more、剥掉 href 再 click 就走正常展开路径
    const readmore = document.querySelector(".btn-readmore");
    if (readmore) {
      readmore.classList.remove("no-login");
      readmore.classList.add("fans-read-more");
      readmore.removeAttribute("href");
      readmore.removeAttribute("target");
      readmore.removeAttribute("rel");
      readmore.click();
      console.log(DEBUG_PREFIX, "已点击 btn-readmore 展开全文");
    }
  }

  /**
   * 抑制自动弹出的登录提示/营销浮层（不动真正的登录框，用户可主动登录）
   */
  function killPopups() {
    const POPUP_SELECTORS = [
      ".passport-login-tip-container",   // 登录后权益提示
      "#csdn-redpack",                   // 红包雨
      ".csdn-redpack-lottery-btn-box",
      ".csdn-highschool-window",
      ".leftPop",
      ".totast-box"
    ];
    const hide = () => {
      POPUP_SELECTORS.forEach((sel) => {
        document.querySelectorAll(sel).forEach((el) => {
          el.style.setProperty("display", "none", "important");
        });
      });
      // 评论区登录遮罩（不挡评论区本身）
      document.querySelectorAll(".login-mark, .login-box").forEach((el) => {
        el.style.setProperty("display", "none", "important");
      });
    };
    hide();
    const observer = new MutationObserver(hide);
    observer.observe(document.body, { childList: true, subtree: true });
  }

  /* ==================== 页面判断与工具 ==================== */

  function isArticlePage() {
    return /\/article\/details\//.test(location.pathname);
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
    $button.setAttribute("title", "点击下载当前 CSDN 文章为 Markdown");
    $button.style.position = "fixed";
    $button.style.bottom = "20px";
    $button.style.right = "20px";
    $button.style.zIndex = "999999";
    $button.style.height = "2.2em";
    $button.style.backgroundColor = "rgba(252, 85, 49, 0.9)";
    $button.style.color = "white";
    $button.style.outline = "none";
    $button.style.border = "none";
    $button.style.cursor = "pointer";
    $button.style.borderRadius = "1em";
    $button.style.fontSize = "1em";
    $button.style.padding = ".4em 1em";
    $button.style.boxShadow = "0 2px 6px rgba(0,0,0,0.3)";
    $button.setAttribute("aria-label", "将当前 CSDN 文章导出为 Markdown");
    return $button;
  }

  /* ==================== 导出 ==================== */

  function getArticleTitle() {
    const el = document.querySelector("#articleContentId, .title-article, h1");
    if (el && el.textContent.trim()) return el.textContent.trim();
    return document.title.trim();
  }

  function getArticleAuthor() {
    const el = document.querySelector("#uid, .follow-nickName, .profile-user-name");
    return el ? el.textContent.trim() : "";
  }

  function getArticleTime() {
    const t = document.querySelector(".time");
    if (t) {
      const dt = t.getAttribute("data-time");
      if (dt) return dt.trim();
      if (t.textContent.trim()) return t.textContent.trim();
    }
    const bar = document.querySelector(".bar-content");
    if (bar) {
      const m = bar.textContent.match(/\d{4}-\d{2}-\d{2}[ ]\d{2}:\d{2}(:\d{2})?/);
      if (m) return m[0];
    }
    return "";
  }

  /** 清理正文克隆体 */
  function cleanContent(clone) {
    // CSDN 注入的代码复制按钮、工具条、广告追踪、推荐区
    const removeSelectors = [
      ".hljs-button", ".opt-box", ".more-toolbox",
      ".csdn-tracking-statistics", ".recommend-box",
      ".recommend-nps-box", ".template-box",
      "script", "style", "iframe"
    ];
    removeSelectors.forEach((sel) => {
      clone.querySelectorAll(sel).forEach((el) => el.remove());
    });
    // 标题里的空锚点（CSDN 注入的 # 号锚链接）
    clone.querySelectorAll("h1 a, h2 a, h3 a, h4 a").forEach((a) => {
      if (!a.textContent.trim() && !a.querySelector("img")) a.remove();
    });
    return clone;
  }

  function downloadArticle() {
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

      // 导出前再展开一次，防万一
      expandArticle();

      const contentEl = document.querySelector("#content_views");
      if (!contentEl) {
        alert("下载器：未找到文章正文，请确认页面已加载完成。");
        console.warn(DEBUG_PREFIX, "未找到 #content_views");
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

      // 共享富语法规则（公式/任务列表/注脚/表格等），站点规则后加可覆盖
      if (window.Web2mdRichRules) window.Web2mdRichRules.apply(td);

      // 图片：懒加载兜底
      td.addRule("csdnImage", {
        filter: "img",
        replacement: (content, node) => {
          const alt = (node.getAttribute("alt") || "").trim();
          let src =
            node.getAttribute("data-src") ||
            node.getAttribute("data-original") ||
            node.getAttribute("src") || "";
          if (!src) return "";
          if (src.startsWith("//")) src = "https:" + src;
          return `![${alt}](${src})`;
        }
      });

      // 链接：还原 link.csdn.net 跳转中间页为真实地址
      td.addRule("csdnLink", {
        filter: "a",
        replacement: (content, node) => {
          let href = node.getAttribute("href") || "";
          const m = href.match(/link\.csdn\.net\/\?target=([^&]+)/);
          if (m) {
            try { href = decodeURIComponent(m[1]); } catch (e) { /* 保留原样 */ }
          }
          const title = node.getAttribute("title") || "";
          const text = content.trim();
          if (!text) return "";
          if (!href) return text;
          return title ? `[${text}](${href} "${title}")` : `[${text}](${href})`;
        }
      });

      let markdown = td.turndown(clone.innerHTML || "");
      markdown = markdown
        .replace(/\n{3,}/g, "\n\n")
        .replace(/[ \t]+\n/g, "\n")
        .trim();

      if (!markdown || markdown.length < 10) {
        alert("下载器：正文内容为空，页面可能还没渲染完，请稍等再试。");
        return;
      }

      const title = getArticleTitle();
      const author = getArticleAuthor();
      const time = getArticleTime();
      const dateStr = new Date().toISOString().slice(0, 10);

      let fullMd = `# ${title}\n\n`;
      if (author) fullMd += `**作者：** ${author}  \n`;
      if (time) fullMd += `**发布时间：** ${time}  \n`;
      fullMd += `**来源：** ${location.href}  \n`;
      fullMd += `**下载时间：** ${dateStr}  \n`;
      fullMd += `\n---\n\n`;
      fullMd += markdown + "\n";

      const filename = `【CSDN】${sanitizeFilename(title)}.md`;
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

      console.log(DEBUG_PREFIX, "CSDN 导出完成:", filename, "字数:", fullMd.length);
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

  /* ==================== 按钮挂载 ==================== */

  function ensureButton() {
    const existing = document.getElementById(BUTTON_ID);
    if (isArticlePage()) {
      if (!existing) {
        const button = makeButton(" 下载为Markdown ");
        button.addEventListener("click", downloadArticle);
        document.body.appendChild(button);
        console.log(DEBUG_PREFIX, "检测到 CSDN 文章页，按钮已挂载:", location.href);
      }
    } else {
      if (existing) {
        existing.remove();
        console.log(DEBUG_PREFIX, "离开 CSDN 文章页，按钮已移除");
      }
    }
  }

  // SPA 路由监听（CSDN 站内跳转部分走 pushState）
  (function () {
    const origPush = history.pushState;
    const origReplace = history.replaceState;
    function wrap(fn) {
      return function () {
        const result = fn.apply(this, arguments);
        setTimeout(ensureButton, 300);
        return result;
      };
    }
    history.pushState = wrap(origPush);
    history.replaceState = wrap(origReplace);
  })();

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
  window.addEventListener("hashchange", ensureButton);

  /* ==================== 启动 ==================== */

  // 免登录能力全页面生效（不只文章页）
  unlockCopy();
  killPopups();
  if (isArticlePage()) {
    // 页面加载后自动展开全文，并等内容稳定再挂按钮
    expandArticle();
    setTimeout(expandArticle, 1500); // 部分页面展开按钮渲染晚
  }

  console.log(DEBUG_PREFIX, "CSDN 下载器已加载（v1.0.0，免登录已启用）");
  setTimeout(ensureButton, 500);
})();
