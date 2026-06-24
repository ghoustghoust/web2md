# web2md

一键将任意网站文章导出为 Markdown。支持 X/Twitter、Discourse 论坛等，保留标题、图片、链接、加粗、表格、代码块等完整格式。基于 Tampermonkey 用户脚本，即装即用。

---

## 支持网站

| 网站 | 脚本文件 | 状态 | 说明 |
|------|---------|------|------|
| **X / Twitter** | `adapters/x-article-downloader.js` | ✅ 稳定 | 支持文章页、图片、链接、加粗、标题层级 |
| **Discourse 论坛** | `adapters/discourse-downloader.js` | ✅ 稳定 | 支持帖子正文+回复、表格、代码块、折叠详情、引用块 |
| **少数派** | `adapters/sspai-downloader.js` | 🧪 测试 | 支持文章页（标题、作者、时间、正文）、矩阵页文章列表 |
| 知乎 | 待开发 | 🚧 计划 | — |
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

导出文件包含：标题、作者、发布时间、来源链接、正文（含图片、表格、代码块等）。

---

## 开发计划

- [ ] 知乎专栏适配
- [ ] CSDN 博客适配
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
│   ├── zhihu-downloader.js            # 知乎（预留）
│   ├── csdn-downloader.js             # CSDN（预留）
│   └── juejin-downloader.js           # 稀土掘金（预留）
├── docs/                              # 文档
│   ├── CONTRIBUTING.md                # 贡献指南
│   └── X-DOM-分析.md                  # 各网站 DOM 特性记录
├── lib/                               # 共享工具库（未来）
│   └── turndown-utils.js              # Turndown 通用配置
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
