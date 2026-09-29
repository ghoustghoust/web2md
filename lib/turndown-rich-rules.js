/**
 * web2md 共享富语法规则库
 * https://github.com/ghoustghoust/web2md
 *
 * 用法（在适配器里，创建 TurndownService 之后、添加站点专属规则之前）：
 *
 *   @require https://raw.githubusercontent.com/ghoustghoust/web2md/main/lib/turndown-rich-rules.js
 *
 *   const td = new TurndownService({...});
 *   window.Web2mdRichRules.apply(td, {});          // 注册全部富语法规则
 *   window.Web2mdRichRules.flattenTables(clone);   // 可选：展平 rowspan/colspan
 *
 * 设计约定：
 *   - 语法偏向 Obsidian 风格：高亮 ==text==、上标 ^text^、下标 ~text~
 *   - 无 Obsidian 对应语法的（下划线、快捷键）保留 HTML：<u>、<kbd>
 *   - 规则按"后加优先"注册，站点专属规则后加可覆盖这里的默认行为
 *   - 思路参考 csdn2md（PolyForm Strict），代码为本项目独立实现
 */
(function (global) {
  "use strict";

  /**
   * 从 KaTeX 渲染后的 DOM 元素里还原 LaTeX 源码。
   * 优先读 <annotation encoding="application/x-tex">（标准 KaTeX 输出都带），
   * 没有再走"MathML 文本前缀剥离"和"最长段"启发式。
   */
  function extractKatexLatex(katexEl) {
    if (!katexEl) return "";
    // 1. 标准 KaTeX：annotation 里就是源码
    const ann = katexEl.querySelector('annotation[encoding="application/x-tex"]');
    if (ann && ann.textContent.trim()) return ann.textContent.trim();
    // 2. 前缀剥离：mathml 纯文本 = 可见文本 + 源码拼接
    const mathml = katexEl.querySelector(".katex-mathml");
    const htmlPart = katexEl.querySelector(".katex-html");
    if (mathml && htmlPart) {
      const full = clearSpecialChars(mathml.textContent || "");
      const visible = clearSpecialChars(htmlPart.textContent || "");
      if (full.startsWith(visible) && full.length > visible.length) {
        return full.slice(visible.length).trim();
      }
    }
    // 3. 最长段启发式
    if (mathml) {
      const full = clearSpecialChars(mathml.textContent || "");
      const parts = full.split(/[\s\u00a0]{2,}|\n+/).filter(Boolean);
      if (parts.length) return parts.sort((a, b) => b.length - a.length)[0].trim();
    }
    // 4. 兜底：可见文本
    return (katexEl.textContent || "").trim();
  }

  /** KaTeX 用来画大括号/分栏的特殊 Unicode，还原文本时清掉 */
  function clearSpecialChars(text) {
    return text
      .replace(/[\u23A1-\u23A6\u23A7-\u23AB\u23AC\u23B0\u23B1]/g, "")
      .replace(/\u200B/g, "");
  }

  /**
   * 判断一个 .katex 元素是不是"最外层"的公式节点
   * （KaTeX 嵌套渲染时内部 span 也带 katex class）
   */
  function isOutermostKatex(node) {
    if (!node.classList || !node.classList.contains("katex")) return false;
    const parent = node.parentElement;
    return !(parent && parent.closest && parent.closest(".katex"));
  }

  /**
   * 注册全部富语法规则到 TurndownService 实例
   * @param {TurndownService} td
   * @param {object} options 可选：{ tocPlaceholder: true, obsidianSyntax: true }
   */
  function apply(td, options) {
    const opts = Object.assign({ tocPlaceholder: true, obsidianSyntax: true }, options);

    /* ---------- 公式 ---------- */

    // KaTeX 公式（内联 $...$ / 块级 $$...$$）
    td.addRule("katexMath", {
      filter: (node) => {
        if (node.nodeType !== 1) return false;
        // CSDN 风格：katex--inline / katex--display 直接标在元素上
        if (node.classList.contains("katex--inline") || node.classList.contains("katex--display")) return true;
        // 标准 KaTeX：最外层 .katex 节点
        return isOutermostKatex(node);
      },
      replacement: (content, node) => {
        const latex = extractKatexLatex(node);
        if (!latex) return content;
        const isDisplay =
          node.classList.contains("katex--display") ||
          (node.classList.contains("katex") && node.closest(".katex-display")) !== null;
        if (isDisplay) return "\n\n$$\n" + latex + "\n$$\n\n";
        return " $" + latex + "$ ";
      }
    });

    // 图片形式的公式（CSDN <img class="mathcode">）
    td.addRule("mathImage", {
      filter: (node) => node.nodeName === "IMG" && /(^|\s)mathcode(\s|$)/.test(node.className || ""),
      replacement: (content, node) => {
        const alt = (node.getAttribute("alt") || "").trim();
        return alt ? "\n\n$$\n" + alt + "\n$$\n\n" : "";
      }
    });

    /* ---------- 任务列表 ---------- */

    td.addRule("taskCheckbox", {
      filter: (node) => node.nodeName === "INPUT" && node.getAttribute("type") === "checkbox",
      replacement: (content, node) => (node.checked ? "[x] " : "[ ] ")
    });

    // li 里有 checkbox 时，让列表项输出成 - [x] 文本（覆盖 Turndown 默认 listItem）
    td.addRule("taskListItem", {
      filter: (node) => {
        if (node.nodeName !== "LI") return false;
        return !!node.querySelector(':scope > input[type="checkbox"], :scope > p > input[type="checkbox"], :scope > div > input[type="checkbox"]');
      },
      replacement: (content, node, options2) => {
        const checked = !!node.querySelector('input[type="checkbox"]').checked;
        let text = content
          .replace(/^\s*\[.\]\s*/, "")  // 去掉 checkbox 规则产生的 [x] 占位，统一在这里加
          .replace(/^\n+|\n+$/g, "");
        const prefix = "- [" + (checked ? "x" : " ") + "] ";
        const parent = node.parentNode;
        const isLoose = /^\s*(\d+\.|[-*+])/.test(text);  // 内嵌列表，保持缩进
        const indent = "  ";
        if (isLoose) {
          text = text.split("\n").map((line, i) => (i === 0 ? line : indent + line)).join("\n");
        }
        return prefix + text + "\n";
      }
    });

    /* ---------- 注脚 ---------- */

    // 引用处：<sup class="footnote-ref"> 或 sup 里指向 #fn 的链接
    td.addRule("footnoteRef", {
      filter: (node) => {
        if (node.nodeName !== "SUP") return false;
        if (/footnote-ref/.test(node.className || "")) return true;
        const a = node.querySelector('a[href^="#fn"], a[href^="#footnote"]');
        return !!a;
      },
      replacement: (content, node) => {
        const a = node.querySelector("a");
        const num = (a ? a.textContent : node.textContent).replace(/[[\]]/g, "").trim();
        return "[^" + num + "]";
      }
    });

    // 返回箭头
    td.addRule("footnoteBackref", {
      filter: (node) => node.nodeName === "A" && /footnote-backref/.test(node.className || ""),
      replacement: () => ""
    });

    // 定义处：<section class="footnotes"> 或 <div class="footnotes">
    td.addRule("footnoteDefinitions", {
      filter: (node) => {
        if (!/^(SECTION|DIV)$/.test(node.nodeName)) return false;
        return /(^|\s)footnotes(\s|$)/.test(node.className || "") || node.id === "footnotes";
      },
      replacement: (content, node) => {
        const items = node.querySelectorAll("ol > li");
        if (!items.length) return content;
        let out = "\n\n---\n\n";
        items.forEach((li, i) => {
          let text = li.textContent.replace(/↩︎|↩/g, "").replace(/\n+/g, " ").trim();
          out += "[^" + (i + 1) + "]: " + text + "\n\n";
        });
        return out;
      }
    });

    /* ---------- 行内格式（Obsidian 风格） ---------- */

    td.addRule("highlight", {
      filter: ["mark", "highlight"],
      replacement: (content, node) => {
        const text = content.trim();
        if (!text) return content;
        return opts.obsidianSyntax ? "==" + text + "==" : "<mark>" + text + "</mark>";
      }
    });

    td.addRule("subscript", {
      filter: "sub",
      replacement: (content) => {
        const text = content.trim();
        if (!text) return content;
        return opts.obsidianSyntax ? "~" + text + "~" : "<sub>" + text + "</sub>";
      }
    });

    // sup 且不是注脚引用时，按上标处理
    td.addRule("superscript", {
      filter: (node) => {
        if (node.nodeName !== "SUP") return false;
        if (/footnote-ref/.test(node.className || "")) return false;
        if (node.querySelector('a[href^="#fn"], a[href^="#footnote"]')) return false;
        return true;
      },
      replacement: (content) => {
        const text = content.trim();
        if (!text) return content;
        return opts.obsidianSyntax ? "^" + text + "^" : "<sup>" + text + "</sup>";
      }
    });

    td.addRule("underline", {
      filter: ["u", "ins"],
      replacement: (content) => {
        const text = content.trim();
        return text ? "<u>" + text + "</u>" : content;
      }
    });

    td.addRule("kbd", {
      filter: "kbd",
      replacement: (content) => {
        const text = content.trim();
        return text ? "<kbd>" + text + "</kbd>" : content;
      }
    });

    /* ---------- 代码块 ---------- */

    td.addRule("richCodeBlock", {
      filter: (node) => {
        if (node.nodeName !== "PRE") return false;
        // 含 <code> 子节点，或自身是代码容器
        return true;
      },
      replacement: (content, node) => {
        let codeEl = node.querySelector("code");
        let lang = "";
        const cls = ((codeEl && codeEl.className) || node.className || "").toString();
        const m = cls.match(/(?:language|lang)-([\w+-]+)/);
        if (m) lang = m[1];
        else if (/^\s*hljs/.test(cls)) {
          // 老版高亮：class="hljs javascript"
          const parts = cls.trim().split(/\s+/);
          if (parts[1]) lang = parts[1];
        } else {
          const dm = cls.match(/\b(mermaid|flow|sequence|gantt)\b/i);
          if (dm) lang = dm[1].toLowerCase();
        }

        let code;
        if (codeEl) {
          // 新版编辑器：代码每行一个 <li>（带行号）
          const ol = codeEl.querySelector("ol");
          if (ol) {
            code = Array.from(ol.children).map((li) => li.textContent).join("\n");
          } else {
            code = codeEl.textContent;
          }
        } else {
          code = node.textContent;
        }
        code = (code || "").replace(/\n+$/, "");
        return "\n\n```" + lang + "\n" + code + "\n```\n\n";
      }
    });

    /* ---------- 表格（Turndown 核心不带表格规则） ---------- */

    td.addRule("richTable", {
      filter: "table",
      replacement: (content, node) => {
        const rows = Array.from(node.querySelectorAll("tr")).filter((tr) => tr.querySelector("th,td"));
        if (!rows.length) return content;
        const cellText = (cell) => {
          const raw = td.turndown(cell.innerHTML);
          return raw.replace(/\|/g, "\\|").replace(/\n+/g, " ").trim() || " ";
        };
        const firstRowCells = Array.from(rows[0].children);
        const isHeaderRow = firstRowCells.some((c) => c.nodeName === "TH");
        const colCount = Math.max(...rows.map((r) => r.children.length));

        let md = "\n\n";
        const headerCells = isHeaderRow
          ? firstRowCells.map(cellText)
          : Array.from({ length: colCount }, () => " ");
        md += "| " + headerCells.join(" | ") + " |\n";
        md += "| " + Array.from({ length: Math.max(colCount, headerCells.length) }, () => "---").join(" | ") + " |\n";

        const bodyRows = isHeaderRow ? rows.slice(1) : rows;
        bodyRows.forEach((row) => {
          const cells = Array.from(row.children).map(cellText);
          while (cells.length < colCount) cells.push(" ");
          md += "| " + cells.join(" | ") + " |\n";
        });
        return md + "\n";
      }
    });

    /* ---------- 视频 / iframe ---------- */

    td.addRule("bilibiliVideo", {
      filter: (node) => {
        if (!/^(IFRAME|EMBED)$/.test(node.nodeName)) return false;
        const src = node.getAttribute("src") || "";
        return /bilibili\.com\/video|player\.bilibili\.com/.test(src);
      },
      replacement: (content, node) => {
        let src = node.getAttribute("src") || "";
        src = src.replace(/autoplay=1/g, "autoplay=0");
        const page = src.match(/bilibili\.com\/video\/(BV[\w]+|av\d+)/);
        const pageUrl = page ? "https://www.bilibili.com/video/" + page[1] : src;
        return (
          "\n\n<div align=\"center\">\n\n" +
          "[▶ Bilibili 视频](" + pageUrl + ")\n\n" +
          '<iframe src="' + src + '" style="width:100%;aspect-ratio:16/9;" allowfullscreen loading="lazy"></iframe>' +
          "\n\n</div>\n\n"
        );
      }
    });

    td.addRule("genericIframe", {
      filter: ["iframe", "embed"],
      replacement: (content, node) => {
        const src = node.getAttribute("src") || "";
        if (!src) return "";
        const title = node.getAttribute("title") || "嵌入内容";
        return "\n\n[" + title + "](" + src + ")\n\n";
      }
    });

    /* ---------- 对齐 ---------- */

    td.addRule("textAlign", {
      filter: (node) => {
        if (!/^(P|DIV|H1|H2|H3|H4|H5|H6)$/.test(node.nodeName)) return false;
        const style = (node.getAttribute("style") || "").toLowerCase();
        if (/text-align:\s*(center|right)/.test(style)) return true;
        return node.nodeName === "CENTER";
      },
      replacement: (content, node) => {
        const style = (node.getAttribute("style") || "").toLowerCase();
        const align = node.nodeName === "CENTER" || /text-align:\s*center/.test(style) ? "center" : "right";
        // 只有纯文本/行内内容才包 align，里面有大块元素就放弃转换
        const inner = content.trim();
        if (!inner) return "";
        if (/\n\n/.test(inner)) return "\n\n" + inner + "\n\n";
        return '\n\n<div align="' + align + '">' + inner + "</div>\n\n";
      }
    });

    /* ---------- 目录占位 ---------- */

    if (opts.tocPlaceholder) {
      td.addRule("tocPlaceholder", {
        filter: (node) => {
          if (node.nodeType !== 1) return false;
          if (/^(DIV|SECTION|NAV)$/.test(node.nodeName) && /(^|\s)toc(\s|$)|table-of-contents/.test(node.className || "")) return true;
          return node.id === "main-toc" || node.getAttribute("role") === "doc-toc";
        },
        replacement: () => "\n\n**目录**\n\n[TOC]\n\n"
      });
    }

    /* ---------- dl 定义列表 ---------- */

    td.addRule("definitionList", {
      filter: "dl",
      replacement: (content, node) => {
        const parts = [];
        Array.from(node.children).forEach((child) => {
          if (child.nodeName === "DT") parts.push("**" + child.textContent.trim() + "**");
          else if (child.nodeName === "DD") parts.push(child.textContent.trim());
        });
        return "\n\n" + parts.join("\n") + "\n\n";
      }
    });
  }

  /**
   * 展平表格的 rowspan / colspan（DOM 预处理，在 clone 上调用，再交给 Turndown）
   * 被合并占位的单元格补一个空 td，保证 Markdown 表格列不错位。
   */
  function flattenTables(root) {
    if (!root) return;
    root.querySelectorAll("table").forEach((table) => {
      const rows = Array.from(table.querySelectorAll("tr"));
      if (!rows.length) return;
      const pending = {}; // colIndex -> { remaining: n }
      const grid = [];    // 每行展开后的 cell HTML 数组

      rows.forEach((row) => {
        const out = [];
        let col = 0;
        const cells = Array.from(row.children).filter((c) => /^(TD|TH)$/.test(c.nodeName));

        const fillPending = () => {
          while (pending[col] && pending[col].remaining > 0) {
            out.push("");
            pending[col].remaining--;
            if (pending[col].remaining <= 0) delete pending[col];
            col++;
          }
        };

        cells.forEach((cell) => {
          fillPending();
          const colspan = Math.max(1, parseInt(cell.getAttribute("colspan") || "1", 10));
          const rowspan = Math.max(1, parseInt(cell.getAttribute("rowspan") || "1", 10));
          const tag = cell.nodeName.toLowerCase();
          const html = cell.innerHTML;
          out.push("<" + tag + ">" + html + "</" + tag + ">");
          for (let i = 1; i < colspan; i++) out.push("");
          if (rowspan > 1) {
            for (let i = 0; i < colspan; i++) {
              pending[col + i] = { remaining: rowspan - 1 };
            }
          }
          col += colspan;
        });
        fillPending();
        grid.push(out);
      });

      const colCount = Math.max.apply(null, grid.map((r) => r.length));
      const doc = table.ownerDocument;
      const newTable = doc.createElement("table");
      const tbody = doc.createElement("tbody");
      grid.forEach((rowCells) => {
        const tr = doc.createElement("tr");
        for (let i = 0; i < colCount; i++) {
          const td = doc.createElement("td");
          td.innerHTML = rowCells[i] || "";
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      });
      newTable.appendChild(tbody);
      table.parentNode.replaceChild(newTable, table);
    });
  }

  global.Web2mdRichRules = { apply: apply, flattenTables: flattenTables, extractKatexLatex: extractKatexLatex };
})(typeof window !== "undefined" ? window : this);
