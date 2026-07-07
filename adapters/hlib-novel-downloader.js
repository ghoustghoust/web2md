// ==UserScript==
// @name         hlib.cc 小说下载器（自动翻页合并版）
// @namespace    https://github.com/ghoustghoust/web2md
// @version      2.0.0
// @description  hlib.cc 小说下载器：一键自动翻页合并整章，生成适合手机阅读的 Markdown。支持手动单页保存（localStorage）和自动翻页合并两种模式。
// @author       ghoustghoust（基于 xzyl4303 原版改进）
// @match        https://hlib.cc/n/*
// @license      MIT
// @grant        GM_xmlhttpRequest
// @connect      hlib.cc
// @homepageURL  https://github.com/ghoustghoust/web2md
// @supportURL   https://github.com/ghoustghoust/web2md/issues
// ==/UserScript==

/** 更新日志
 * 2.0.0: 基于 xzyl4303 原版重写，功能清晰化 + 自动翻页合并
 *    ① 新增【自动翻页合并】：一键 fetch 所有分页，合并为一个 Markdown 文件
 *    ② 保留【手动保存】：逐页点击保存到 localStorage，适合需要筛选内容的场景
 *    ③ 改进 UI：按钮功能标注清晰，避免意义不明
 *    ④ 输出 Markdown 格式：正确段落换行、生成目录（TOC）、适合手机阅读
 *    ⑤ 自动检测正文容器：支持 #content 和 .text-center.m-3 标题提取
 * 1.0: xzyl4303 原版（GreasyFork）
 *    - 手动保存/清除/下载/下一页/下一章功能
 *    - 快捷键支持（Shift+S/T/N/M/Backspace）
 */

(function() {
    'use strict';

    const DEBUG_PREFIX = "[hlib下载器]";
    const MAX_PAGES = 100; // 最大翻页数，防止无限循环

    // ========== 工具函数 ==========

    function sanitizeFilename(str) {
        if (!str) return "untitled";
        return str
            .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
            .replace(/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i, "_$1$2")
            .trim();
    }

    function extractTextFromContent(contentEl) {
        if (!contentEl) return "";
        const paragraphs = contentEl.querySelectorAll('p');
        let text = '';
        paragraphs.forEach(p => {
            const t = p.textContent.trim();
            if (t) text += t + '\n\n';
        });
        return text.trim();
    }

    function getChapterTitle() {
        const titleEl = document.querySelector('.text-center.m-3, h1');
        if (titleEl && titleEl.innerText.trim()) {
            return titleEl.innerText.trim();
        }
        const parts = document.title.split(" - ");
        if (parts.length >= 2) return parts[0].trim();
        return document.title.trim() || "untitled";
    }

    function getBookTitle() {
        const parts = document.title.split(" - ");
        if (parts.length >= 2) return parts[1].trim();
        return "未知书名";
    }

    // ========== 侧边栏 UI ==========

    const menuBar = document.createElement('div');
    menuBar.style.position = 'fixed';
    menuBar.style.top = '0';
    menuBar.style.left = '0';
    menuBar.style.height = '100%';
    menuBar.style.width = '120px';
    menuBar.style.backgroundColor = '#333';
    menuBar.style.color = '#fff';
    menuBar.style.padding = '10px 0';
    menuBar.style.display = 'flex';
    menuBar.style.flexDirection = 'column';
    menuBar.style.alignItems = 'center';
    menuBar.style.zIndex = '9999';
    menuBar.style.boxShadow = '2px 0 4px rgba(0, 0, 0, 0.2)';
    menuBar.style.transition = 'transform 0.3s ease';
    menuBar.style.overflowY = 'auto';

    const toggleBtn = document.createElement('button');
    toggleBtn.textContent = '≡';
    toggleBtn.style.position = 'fixed';
    toggleBtn.style.top = '10px';
    toggleBtn.style.left = '120px';
    toggleBtn.style.backgroundColor = '#333';
    toggleBtn.style.color = '#fff';
    toggleBtn.style.border = 'none';
    toggleBtn.style.padding = '10px';
    toggleBtn.style.cursor = 'pointer';
    toggleBtn.style.zIndex = '10000';
    toggleBtn.style.fontSize = '18px';
    toggleBtn.addEventListener('click', () => {
        if (menuBar.style.transform === 'translateX(-100%)') {
            menuBar.style.transform = 'translateX(0)';
            toggleBtn.style.left = '120px';
        } else {
            menuBar.style.transform = 'translateX(-100%)';
            toggleBtn.style.left = '0';
        }
    });

    function createButton(text, backgroundColor, title, onClick) {
        const button = document.createElement('button');
        button.textContent = text;
        button.title = title || text;
        button.style.marginBottom = '8px';
        button.style.padding = '8px 4px';
        button.style.border = 'none';
        button.style.backgroundColor = backgroundColor;
        button.style.color = '#fff';
        button.style.cursor = 'pointer';
        button.style.width = '90%';
        button.style.textAlign = 'center';
        button.style.fontSize = '12px';
        button.style.borderRadius = '4px';
        button.addEventListener('click', onClick);
        return button;
    }

    // ========== ① 自动翻页合并（主要功能）==========

    async function autoMergeDownload() {
        const btn = document.getElementById('auto-merge-btn');
        if (btn) {
            btn.textContent = '合并中...';
            btn.disabled = true;
        }

        const pages = [];
        let currentUrl = location.href;
        let pageCount = 0;

        console.log(DEBUG_PREFIX, "开始自动翻页合并...");

        while (currentUrl && pageCount < MAX_PAGES) {
            pageCount++;
            console.log(DEBUG_PREFIX, `获取第 ${pageCount} 页: ${currentUrl}`);

            let html, contentEl, nextUrl;

            if (pageCount === 1) {
                contentEl = document.querySelector('#content');
                nextUrl = findNextPageUrl(document);
            } else {
                try {
                    html = await fetchPage(currentUrl);
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(html, 'text/html');
                    contentEl = doc.querySelector('#content');
                    nextUrl = findNextPageUrl(doc);
                } catch (err) {
                    console.error(DEBUG_PREFIX, "获取失败:", err.message);
                    break;
                }
            }

            if (!contentEl) {
                console.warn(DEBUG_PREFIX, "第", pageCount, "页无内容");
                break;
            }

            const text = extractTextFromContent(contentEl);
            pages.push({ text, url: currentUrl });
            console.log(DEBUG_PREFIX, `第 ${pageCount} 页获取完成，字数: ${text.length}`);

            if (!nextUrl || nextUrl === currentUrl) {
                console.log(DEBUG_PREFIX, "没有更多页面");
                break;
            }

            currentUrl = nextUrl;
            await new Promise(r => setTimeout(r, 300));
        }

        // 组装 Markdown
        const chapterTitle = getChapterTitle();
        const bookTitle = getBookTitle();
        const dateStr = new Date().toISOString().slice(0, 10);

        let md = `# ${chapterTitle}\n\n`;
        md += `**书名：** ${bookTitle}  \n`;
        md += `**来源：** ${location.href}  \n`;
        md += `**下载时间：** ${dateStr}  \n`;
        md += `**共 ${pages.length} 页**\n\n`;
        md += `---\n\n`;

        if (pages.length > 1) {
            md += `## 目录\n\n`;
            pages.forEach((p, i) => {
                md += `${i + 1}. [第 ${i + 1} 页](#page-${i + 1})\n`;
            });
            md += `\n---\n\n`;
        }

        pages.forEach((p, i) => {
            if (pages.length > 1) {
                md += `<a id="page-${i + 1}"></a>\n\n`;
                md += `## 第 ${i + 1} 页\n\n`;
            }
            md += p.text + '\n\n';
            if (i < pages.length - 1) md += `---\n\n`;
        });

        // 下载
        const filename = sanitizeFilename(`${bookTitle} - ${chapterTitle}`).slice(0, 120) + ".md";
        const blob = new Blob(["\uFEFF" + md], { type: "text/markdown;charset=utf-8" });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);

        console.log(DEBUG_PREFIX, "下载完成:", filename, "页数:", pages.length);
        alert(`下载完成！\n文件名：${filename}\n共 ${pages.length} 页，${pages.reduce((s, p) => s + p.text.length, 0)} 字`);

        if (btn) {
            btn.textContent = '自动翻页合并';
            btn.disabled = false;
        }
    }

    function fetchPage(url) {
        return new Promise((resolve, reject) => {
            if (typeof GM_xmlhttpRequest !== "undefined") {
                GM_xmlhttpRequest({
                    method: "GET", url: url,
                    onload: r => r.status === 200 ? resolve(r.responseText) : reject(new Error("HTTP " + r.status)),
                    onerror: () => reject(new Error("Failed"))
                });
            } else {
                fetch(url).then(r => r.ok ? r.text() : Promise.reject(new Error("HTTP " + r.status)))
                    .then(resolve).catch(reject);
            }
        });
    }

    function findNextPageUrl(doc) {
        const selectors = [
            "a[rel='next']", "a[aria-label='下一页']",
            ".pagination a:last-child", ".next a", "a.next"
        ];
        for (const sel of selectors) {
            const el = doc.querySelector(sel);
            if (el && el.href) {
                const text = (el.innerText || "").trim();
                if (/下一章/.test(text)) continue;
                return new URL(el.href, location.href).href;
            }
        }
        for (const link of doc.querySelectorAll("a")) {
            if (/下一页/.test(link.innerText || "") && link.href) {
                return new URL(link.href, location.href).href;
            }
        }
        return null;
    }

    // ========== ② 手动保存（保留原功能）==========

    function saveCurrentPage() {
        let content = '';
        if (checkBox.checked) {
            const titleEl = document.querySelector('.text-center.m-3, h1');
            if (titleEl) content += `# ${titleEl.textContent.trim()}\n\n`;
        }
        const contentEl = document.getElementById('content');
        if (contentEl) {
            const paragraphs = contentEl.querySelectorAll('p');
            paragraphs.forEach(p => {
                const t = p.textContent.trim();
                if (t) content += t + '\n\n';
            });
        }
        let saved = localStorage.getItem('savedContent') || '';
        localStorage.setItem('savedContent', saved + '\n\n' + content);
        sessionStorage.setItem('recentContent', content);
        console.log(DEBUG_PREFIX, '已手动保存当前页');
        printSavedStatus();
    }

    function clearAllSaved() {
        localStorage.removeItem('savedContent');
        console.log(DEBUG_PREFIX, '已清除所有保存内容');
        printSavedStatus();
    }

    function clearRecentSaved() {
        let saved = localStorage.getItem('savedContent') || '';
        const recent = sessionStorage.getItem('recentContent') || '';
        if (recent && saved.includes(recent)) {
            saved = saved.replace(recent, '');
            localStorage.setItem('savedContent', saved);
            console.log(DEBUG_PREFIX, '已清除最近保存');
        }
        sessionStorage.removeItem('recentContent');
        printSavedStatus();
    }

    function downloadManualSaved() {
        const content = localStorage.getItem('savedContent');
        if (!content) {
            alert('没有保存的内容，请先逐页点击【保存当前页】');
            return;
        }
        const filename = prompt('输入文件名:', document.title) || 'download.txt';
        const blob = new Blob([content], { type: 'text/plain' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
        localStorage.removeItem('savedContent');
        console.log(DEBUG_PREFIX, '已下载手动保存内容');
        printSavedStatus();
    }

    function printSavedStatus() {
        const saved = localStorage.getItem('savedContent') || '';
        const lines = saved.split('\n').filter(l => l.trim()).length;
        console.log(DEBUG_PREFIX, '手动保存内容行数:', lines);
    }

    // ========== ③ 按钮创建 ==========

    const autoMergeBtn = createButton('自动翻页合并', '#2196F3', '一键自动翻页，合并所有分页为 Markdown', autoMergeDownload);
    autoMergeBtn.id = 'auto-merge-btn';
    autoMergeBtn.style.fontSize = '13px';
    autoMergeBtn.style.fontWeight = 'bold';

    const saveBtn = createButton('保存当前页', '#4CAF50', '将当前页内容保存到 localStorage（手动模式）', saveCurrentPage);
    const clearAllBtn = createButton('清除全部', '#f44336', '清除所有手动保存的内容', clearAllSaved);
    const clearRecentBtn = createButton('清除最近', '#f44336', '清除最近一次手动保存的内容', clearRecentSaved);

    const checkBoxLabel = document.createElement('label');
    checkBoxLabel.innerHTML = '<input type="checkbox" style="margin-right:5px">添加章节标题';
    checkBoxLabel.style.marginBottom = '8px';
    checkBoxLabel.style.fontSize = '12px';
    checkBoxLabel.style.color = '#fff';
    const checkBox = checkBoxLabel.querySelector('input');

    const downloadBtn = createButton('下载手动保存', '#FF9800', '下载所有手动保存的内容（需先逐页保存）', downloadManualSaved);

    // 下一页/下一章（辅助导航）
    let nextPageBtn = null;
    document.querySelectorAll('.btn.btn-primary.py-2, .btn.btn-light.py-2.me-3').forEach(button => {
        if (button.onclick && !nextPageBtn) {
            nextPageBtn = createButton('下一页', '#607D8B', '跳转到下一页', button.onclick);
        }
    });

    let nextChapterBtn = null;
    const pagination = document.querySelector('.row.pagination.mb-3');
    if (pagination) {
        const items = pagination.querySelectorAll('li');
        if (items.length > 0) {
            const nextUrl = items.length === 1
                ? items[0].querySelector('a').href
                : items[1].querySelector('a').href;
            nextChapterBtn = createButton('下一章', '#8E44AD', '跳转到下一章', () => {
                window.location.href = nextUrl;
            });
        }
    }

    // 分隔线
    const separator = document.createElement('div');
    separator.style.width = '80%';
    separator.style.height = '1px';
    separator.style.backgroundColor = '#555';
    separator.style.margin = '8px 0';

    const separator2 = separator.cloneNode();

    // 组装菜单
    menuBar.appendChild(autoMergeBtn);
    menuBar.appendChild(separator);
    menuBar.appendChild(saveBtn);
    menuBar.appendChild(clearAllBtn);
    menuBar.appendChild(clearRecentBtn);
    menuBar.appendChild(checkBoxLabel);
    menuBar.appendChild(downloadBtn);
    menuBar.appendChild(separator2);
    if (nextPageBtn) menuBar.appendChild(nextPageBtn);
    if (nextChapterBtn) menuBar.appendChild(nextChapterBtn);

    document.body.appendChild(menuBar);
    document.body.appendChild(toggleBtn);

    // 快捷键
    document.addEventListener('keydown', (e) => {
        if (!e.shiftKey) return;
        switch (e.key) {
            case 'A': autoMergeDownload(); break;
            case 'S': saveCurrentPage(); break;
            case 'Backspace': clearAllSaved(); break;
            case 'T': checkBox.checked = !checkBox.checked; break;
            case 'N': if (nextPageBtn) nextPageBtn.click(); break;
            case 'M': if (nextChapterBtn) nextChapterBtn.click(); break;
        }
    });

    console.log(DEBUG_PREFIX, '已加载 v2.0.0，快捷键：Shift+A 自动合并，Shift+S 手动保存');
    printSavedStatus();
})();
