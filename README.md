# web2md

一键将任意网站文章导出为 Markdown。支持 X/Twitter、Discourse 论坛、少数派、知乎、LifeUp Wiki、hlib.cc 小说等，保留标题、图片、链接、加粗、表格、代码块等完整格式。基于 Tampermonkey 用户脚本，即装即用。

---

## 支持网站

| 网站 | 脚本文件 | 状态 | 说明 |
|------|---------|------|------|
| **X / Twitter** | `adapters/x-article-downloader.js` | ✅ 稳定 | 支持文章页、图片、链接、加粗、标题层级 |
| **Discourse 论坛** | `adapters/discourse-downloader.js` | ✅ 稳定 | 支持帖子正文+回复、表格、代码块、折叠详情、引用块 |
| **少数派** | `adapters/sspai-downloader.js` | 🧪 测试 | 支持文章页（标题、作者、时间、正文）、矩阵页文章列表 |
| **LifeUp Wiki** | `adapters/lifeup-wiki-downloader.js` | 🧪 测试 | 支持文档页当前页导出（hash 路由，含图片、表格、代码块） |
| **知乎** | `adapters/zhihu-downloader.js` | 🧪 测试 | 支持问题页（含 /answer/ 直达页）：问题描述 + 已加载回答 |
| **hlib.cc 小说** | `adapters/hlib-novel-downloader.js` | 🧪 测试 | 支持自动翻页合并整章、手动单页保存，适合手机阅读 |
| **CSDN** | `adapters/csdn-downloader.js` | 🧪 测试 | 免登录阅读全文+免登录复制，文章页导出 Markdown |
| **通用博客/文档站** | `adapters/generic-blog-downloader.js` | 🧪 测试 | 自动识别 Hugo/Hexo/VitePress/Astro/WordPress 等，个人博客和 wiki 通用 |
| CSDN | 待开发 | 🚧 计划 | — |
| 稀土掘金 | 待开发 | 🚧 计划 | — |

---

## 安装方法

### 1. 安装 Tampermonkey 浏览器扩展

- [Chrome 商店](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
- [Firefox 附加组件](https://addons.mozilla.org/firefox/addon/tampermonkey/)
- Edge / Safari 用户请搜索对应商店

### 2. 安装脚本

**方式一：GitHub 直接安装（推荐，自动更新）**

点击下方链接，Tampermonkey 会自动弹出安装提示：

- [安装 X 文章下载器](https://github.com/ghoustghoust/web2md/raw/main/adapters/x-article-downloader.js)
- [安装 Discourse 论坛下载器](https://github.com/ghoustghoust/web2md/raw/main/adapters/discourse-downloader.js)
- [安装 少数派下载器](https://github.com/ghoustghoust/web2md/raw/main/adapters/sspai-downloader.js) 🧪 测试版
- [安装 LifeUp Wiki 下载器](https://github.com/ghoustghoust/web2md/raw/main/adapters/lifeup-wiki-downloader.js) 🧪 测试版
- [安装 知乎下载器](https://github.com/ghoustghoust/web2md/raw/main/adapters/zhihu-downloader.js) 🧪 测试版
- [安装 hlib.cc 小说下载器](https://github.com/ghoustghoust/web2md/raw/main/adapters/hlib-novel-downloader.js) 🧪 测试版
- [安装 CSDN 下载器](https://github.com/ghoustghoust/web2md/raw/main/adapters/csdn-downloader.js) 🧪 测试版（免登录）
- [安装 通用博客下载器](https://github.com/ghoustghoust/web2md/raw/main/adapters/generic-blog-downloader.js) 🧪 测试版（全站匹配，仅在识别为文章页时显示按钮）

**方式二：手动复制**

1. 打开 Tampermonkey 面板 → 点击 "添加新脚本"
2. 将 `adapters/` 目录下对应脚本的内容全部复制进去
3. 按 `Ctrl + S` 保存

### 3. 使用

打开支持的网站，右下角会出现悬浮按钮：

- **X 文章页**：点击按钮 → 自动下载 Markdown 文件
- **Discourse 帖子页**：
  - 单击按钮 = 仅下载楼主正文（快速）
  - `Shift + 单击` = 下载全部楼层（含回复）
- **少数派**：点击按钮 → 导出文章（含本地图片下载）；Matrix 页导出文章列表
- **知乎问题页**：点击按钮 → 导出问题描述 + 已加载的回答（先滚动加载更多回答再点）
- **LifeUp Wiki**：点击按钮 → 导出当前文档页
- **hlib.cc 小说**：`Shift + A` 自动翻页合并整章；`Shift + S` 手动保存当前页；`Shift + N` 下一页；`Shift + M` 下一章
- **CSDN**：打开文章页自动免登录展开全文、解锁复制；点按钮导出 Markdown（含作者、发布时间）
- **通用博客/文档站**：打开文章页自动识别正文（个人博客、wiki 均可），点按钮导出；已有专门适配器的网站自动跳过

导出文件包含：标题、作者、发布时间、来源链接、正文（含图片、表格、代码块等）。

---

## 支持的 Markdown 语法

所有适配器共享同一套转换规则（`lib/turndown-rich-rules.js`），支持：

- **公式**：KaTeX 内联 `$...$`、公式块 `$$...$$`（自动从渲染后的 DOM 还原 LaTeX）
- **代码**：内联代码、代码块（自动识别语言，兼容行号版编辑器）
- **列表**：有序 / 无序 / 任务列表（`- [x]`）/ 定义列表
- **表格**：自动展平 rowspan/colspan 合并单元格，防止列错位
- **行内格式**：加粗、斜体、删除线 `~~`、`==高亮==`（Obsidian）、`^上标^`、`~下标~`、下划线、快捷键 `<kbd>`
- **注脚**：`[^1]` 引用 + 文末定义
- **其他**：引用块、链接、目录占位 `[TOC]`、文本居中/右对齐、Bilibili 视频嵌入块

---

## 开发计划

- [x] 知乎问题页适配（专栏待开发）
- [x] CSDN 博客适配（免登录 + 导出）
- [ ] 稀土掘金适配
- [ ] 通用适配器模板（降低新网站接入门槛）
- [ ] 共享工具库（DOM 清理、Turndown 配置等）

欢迎提交 Issue 或 PR 贡献新网站适配。

---

## 项目结构

```
web2md/
├── README.md                          # 本文件
├── DISCLAIMER.md                      # 免责声明
├── LICENSE                            # MIT 许可证
├── adapters/                          # 各网站适配器（用户脚本）
│   ├── x-article-downloader.js          # X / Twitter 文章下载器
│   ├── discourse-downloader.js          # Discourse 论坛下载器
│   ├── sspai-downloader.js              # 少数派下载器（文章页 + 矩阵页）
│   ├── zhihu-downloader.js              # 知乎问题页下载器
│   ├── lifeup-wiki-downloader.js        # LifeUp Wiki 下载器
│   └── hlib-novel-downloader.js         # hlib.cc 小说下载器（自动翻页合并）
│   └── csdn-downloader.js               # CSDN 下载器（免登录+导出）
│   └── generic-blog-downloader.js       # 通用博客/文档站下载器（Hugo/Hexo/VitePress 等）
├── docs/                              # 文档
│   ├── CONTRIBUTING.md                # 贡献指南
│   └── X-DOM-分析.md                  # 各网站 DOM 特性记录
├── lib/                               # 共享工具库
│   └── turndown-rich-rules.js         # 富语法 Turndown 规则（公式/任务列表/注脚/表格展平等）
└── templates/                         # 新适配器模板
    └── adapter-template.js            # 开发脚手架
```

---

## 常见问题

**Q：按钮没有出现？**
- 确认当前页面是文章/帖子页（不是首页或列表页）
- 刷新页面，等待 2-3 秒让脚本加载
- 按 F12 打开控制台，查看是否有错误信息

**Q：下载的文件是空的或内容很少？**
- Discourse 论坛使用虚拟列表，如果滚动到页面底部后只抓到了回复、漏了楼主，请滚动回顶部再点击
- 部分网站需要登录后才能看到完整内容

**Q：图片没有显示？**
- 脚本会尝试提取最佳质量的图片，但部分网站使用 CDN 防盗链或懒加载，无法 100% 保证
- 建议下载后检查图片链接，必要时手动替换

**Q：更新脚本后富语法规则没有生效？**
- 规则库通过 `@require` 从 GitHub 加载，Tampermonkey 会缓存外部资源（最长约 1 天）
- 强制刷新：Tampermonkey 面板 → 脚本「设置」标签 → 外部资源下找到 turndown-rich-rules.js → 点删除缓存

**Q：如何适配新网站？**
- 查看 `docs/CONTRIBUTING.md` 了解开发规范
- 复制 `templates/adapter-template.js` 作为起点

---

## 免责声明

**本脚本仅供个人学习、研究和备份自己拥有合法访问权限的内容使用。** 使用本脚本即表示您同意遵守各网站的服务条款，不侵犯版权，不批量爬取无权访问的内容。详细条款请阅读 [DISCLAIMER.md](./DISCLAIMER.md)。

---

## 作者

[@ghoustghoust](https://github.com/ghoustghoust)

---

## 许可证

MIT License — 详见 [LICENSE](./LICENSE)
