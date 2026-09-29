// ==UserScript==
// @name         知乎回答下载器
// @namespace    https://github.com/ghoustghoust/web2md
// @source       https://github.com/ghoustghoust/web2md
// @version      1.1.0
// @description  适用于知乎问题页（含 /answer/ 直达页）：一键将问题与已加载的回答导出为 Markdown，含问题描述、回答作者、正文（图片、表格、代码块）。
// @author       ghoustghoust
// @match        https://www.zhihu.com/question/*
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
 * 富语法升级：接入共享规则库 lib/turndown-rich-rules.js
 *    - 支持 KaTeX 公式（$...$ / $$...$$）、任务列表、注脚
 *    - 支持高亮 ==、上下标、下划线、kbd、Bilibili 视频、文本对齐
 *    - 表格 rowspan/colspan 自动展平防错位
 * 1.0.0: 初始版本
 *    - 支持知乎问题页当前页导出（问题标题、问题描述、已加载的所有回答）
 *    - 支持 /question/xxx/answer/yyy 直达回答页
 *    - 图片优先取 data-original（知乎懒加载，src 常为占位图）
 *    - SPA 路由监听（pushState + popstate + MutationObserver）
 *    - 右下角悬浮按钮
 */

(function () {
  "use strict";

  const BUTTON_ID = "zhihu-downloader-floating-button";
  const DEBUG_PREFIX = "[下载器]";

  /**
   * 判断当前是否问题页
   */
  function isQuestionPage() {
    return /^\/question\/\d+/.test(location.pathname);
  }

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
    $button.setAttribute("title", "点击下载当前知乎问题页为 Markdown");
    $button.style.position = "fixed";
    $button.style.bottom = "20px";
    $button.style.right = "20px";
    $button.style.zIndex = "999999";
    $button.style.height = "2.2em";
    $button.style.backgroundColor = "rgba(0, 132, 255, 0.9)";
    $button.style.color = "white";
    $button.style.outline = "none";
    $button.style.border = "none";
    $button.style.cursor = "pointer";
    $button.style.borderRadius = "1em";
    $button.style.fontSize = "1em";
    $button.style.padding = ".4em 1em";
    $button.style.boxShadow = "0 2px 6px rgba(0,0,0,0.3)";
    $button.setAttribute("aria-label", "将当前知乎页面导出为 Markdown");
    return $button;
  }

  /**
   * 创建配置好规则的 TurndownService
   */
  function createTurndown() {
    const td = new TurndownService({
      headingStyle: "atx",
      bulletListMarker: "-",
      codeBlockStyle: "fenced",
      emDelimiter: "*"
    });

    // 共享富语法规则（公式/任务列表/注脚/表格等），站点规则后加可覆盖
    if (window.Web2mdRichRules) window.Web2mdRichRules.apply(td);

    // 知乎图片懒加载：真实地址在 data-original / data-actualsrc，src 常是占位图
    td.addRule("zhihuImage", {
      filter: "img",
      replacement: (content, node) => {
        const alt = (node.getAttribute("alt") || "").trim();
        let src =
          node.getAttribute("data-original") ||
          node.getAttribute("data-actualsrc") ||
          node.getAttribute("src") ||
          "";
        if (!src) return "";
        if (src.startsWith("//")) src = "https:" + src;
        // 去掉知乎的图片处理参数（如 _r、_b），保留原图地址
        src = src.replace(/_(r|b|hd|sd|sx|sy)\.(jpg|jpeg|png|gif|webp)$/i, ".$2");
        return `![${alt}](${src})`;
      }
    });

    // 代码块
    td.addRule("fencedCodeBlock", {
      filter: (node) => node.nodeName === "PRE" && node.firstChild && node.firstChild.nodeName === "CODE",
      replacement: (content, node) => {
        const code = node.firstChild.textContent || "";
        let lang = (node.firstChild.className || "").replace(/language-/, "").trim();
        // 知乎代码块语言标注在 pre 的 data-lang 或 class 上
        if (!lang) lang = (node.getAttribute("data-lang") || "").trim();
        return "\n\n```" + lang + "\n" + code.replace(/\n+$/, "") + "\n```\n\n";
      }
    });

    // 知乎站内链接里的卡片（赞同按钮、收起按钮等转成空）
    td.addRule("dropWidgets", {
      filter: (node) => {
        const cls = node.className || "";
        return typeof cls === "string" && /(Voters|RichContent-collapsedText|ContentItem-actions|CommentComp)/.test(cls);
      },
      replacement: () => ""
    });

    return td;
  }

  /**
   * 获取问题标题
   */
  function getQuestionTitle() {
    const h1 = document.querySelector(".QuestionHeader-title, h1.QuestionHeader-title");
    if (h1 && h1.textContent.trim()) return h1.textContent.trim();
    const og = document.querySelector('meta[property="og:title"]');
    if (og) return og.getAttribute("content").trim();
    return document.title.trim();
  }

  /**
   * 获取问题描述（可能折叠，完整文本在 QuestionRichText 里）
   */
  function getQuestionDetailHtml() {
    const el = document.querySelector(".QuestionHeader-detail .QuestionRichText, .QuestionRichText.QuestionRichText--expandable");
    return el ? el.innerHTML : "";
  }

  /**
   * 获取当前页已加载的所有回答
   * 每个回答返回 { author, contentHtml }
   */
  function getAnswers() {
    // 知乎回答容器 class 带 AnswerItem，新版的带 data-za-detail-view-path 属性，双保险
    let items = Array.from(document.querySelectorAll(".AnswerItem, div[class*='AnswerItem']"));
    // 去重（可能同时命中两个选择器）
    items = items.filter((el, idx, arr) => arr.indexOf(el) === idx);
    // 过滤掉折叠/隐藏的占位
    items = items.filter((el) => el.offsetParent !== null || el.getClientRects().length > 0);

    return items.map((item, index) => {
      // 作者
      let author = "匿名用户";
      const authorEl = item.querySelector(".AuthorInfo-name, .AuthorInfo a[class*='UserLink'], meta[itemprop='name']");
      if (authorEl) {
        author = (authorEl.getAttribute("content") || authorEl.textContent || "").trim() || author;
      }

      // 正文：RichContent 里的 RichText 才是完整内容（含被"收起"的部分）
      let contentEl = item.querySelector(".RichContent .RichText, .RichText.ztext");
      // 有的回答正文直接在 RichContent-inner 下的第一个 div
      if (!contentEl) {
        const inner = item.querySelector(".RichContent-inner");
        if (inner) contentEl = inner.firstElementChild;
      }
      let contentHtml = contentEl ? contentEl.innerHTML : "";

      // 点赞数
      let votes = "";
      const voteEl = item.querySelector(".VoteButton--up, button[class*='VoteButton']");
      if (voteEl) votes = (voteEl.textContent || "").trim();

      console.log(DEBUG_PREFIX, `回答 ${index + 1}: 作者=${author}, 正文长度=${contentHtml.length}, 赞同=${votes}`);
      return { author, contentHtml, votes };
    }).filter((a) => a.contentHtml.length > 0);
  }

  /**
   * 导出当前页为 Markdown 并下载
   */
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

      const td = createTurndown();
      const title = getQuestionTitle();
      const detailHtml = getQuestionDetailHtml();
      const answers = getAnswers();
      const dateStr = new Date().toISOString().slice(0, 10);

      if (!answers.length && !detailHtml) {
        alert("下载器：没有找到回答内容。\n知乎可能要求登录或出现了安全验证，请先完成验证再试。");
        console.warn(DEBUG_PREFIX, "内容为空，可能遇到登录墙/安全验证");
        return;
      }

      let fullMd = `# ${title}\n\n`;
      fullMd += `**来源：** ${location.href}  \n`;
      fullMd += `**下载时间：** ${dateStr}  \n`;
      fullMd += `**回答数（本页已加载）：** ${answers.length}  \n`;
      fullMd += `\n---\n\n`;

      // 问题描述
      if (detailHtml) {
        let detailMd = td.turndown(detailHtml).trim();
        if (detailMd) {
          fullMd += `## 问题描述\n\n${detailMd}\n\n---\n\n`;
        }
      }

      // 各回答
      answers.forEach((a, i) => {
        let md = td.turndown(a.contentHtml)
          .replace(/\n{3,}/g, "\n\n")
          .replace(/[ \t]+\n/g, "\n")
          .trim();
        fullMd += `## 回答 ${i + 1}（${a.author}${a.votes ? " · 赞同 " + a.votes : ""}）\n\n`;
        fullMd += md + "\n\n";
        if (i < answers.length - 1) fullMd += "---\n\n";
      });

      const filename = `【知乎】${sanitizeFilename(title)}.md`;
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

      console.log(DEBUG_PREFIX, "知乎导出完成:", filename, "回答数:", answers.length, "总字数:", fullMd.length);
      alert(`下载完成！\n文件名：${filename}\n回答数：${answers.length}`);
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
    if (isQuestionPage()) {
      if (!existing) {
        const button = makeButton(" 下载为Markdown ");
        button.addEventListener("click", downloadPage);
        document.body.appendChild(button);
        console.log(DEBUG_PREFIX, "检测到知乎问题页，按钮已挂载:", location.href);
      }
    } else {
      if (existing) {
        existing.remove();
        console.log(DEBUG_PREFIX, "离开知乎问题页，按钮已移除");
      }
    }
  }

  // 拦截 SPA 路由跳转（知乎站内切换问题不改整页）
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

  // MutationObserver 兜底（初次加载 / 异步渲染）
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

  // 初始化
  console.log(DEBUG_PREFIX, "知乎下载器已加载（v1.0.0）");
  setTimeout(ensureButton, 500);
})();
