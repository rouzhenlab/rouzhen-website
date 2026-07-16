# ROUZHEN Collaboration Notes

> 给未来的 Trae / AI / 开发者 — 请先读这个文件，再动手。

## 项目定位

ROUZHEN 不是普通网站，是一个小型品牌内容系统。

```
ROUZHEN/
├── Brand Bible        → 我是谁
├── Website System     → 我在哪里呈现
├── Publisher System   → 我如何持续表达
└── Aesthetic Rules    → 我永远不要变成什么
```

## 品牌气质

- **安静、克制、东方审美**
- 技术隐藏在自然之后，不炫耀
- 表现人与自然的关系
- 复杂的自然，最后呈现简单

## 协作风格

1. **先读规则再动手** — 改任何东西前，先读 `docs/` 下的三个文件
2. **改动最小化** — 不要过度工程化，只做被要求的事
3. **每次改动都推送验证** — 不要积累太多改动再提交
4. **不要自作主张加功能** — 用户说做什么就做什么
5. **中文回复** — 除非用户用英文

## Journal 文章 HTML 规范

新文章 HTML 模板必须包含：

```html
<head>
  <meta name="article-date" content="YYYY.MM.DD">
  <meta property="og:title" content="文章标题">
  <meta property="og:description" content="一句话摘要">
  <meta property="og:url" content="https://rouzhen.pages.dev/journal/entries/文件名.html">
  <link rel="canonical" href="https://rouzhen.pages.dev/journal/entries/文件名.html">
  <title>文章标题 — ROUZHEN Journal</title>
</head>

<body data-page-lang="cn">

  <article>
    <header class="article-hero">
      <time class="article-date" datetime="YYYY-MM-DD">YYYY.MM.DD</time>
      <h1 class="article-title">文章标题</h1>
      <div class="article-divider"></div>
    </header>

    <!-- 多个 article-body，用 pull-quote / reflection / closing 分隔 -->
    <div class="article-body">
      <p>正文段落</p>
    </div>

    <div class="article-pull-quote">
      <p>核心思想句</p>
    </div>

    <div class="article-body">
      <p>更多正文</p>
    </div>

    <div class="article-reflection">
      <p>反思句</p>
    </div>

    <div class="article-closing">
      <p>品牌哲学收束句</p>
    </div>

    <footer class="article-footer">
      <div class="article-tags">
        <span class="article-tag">标签</span>
      </div>
      <div class="article-nav">
        <a href="/journal/index.html" class="article-back">返回札记</a>
        <span class="article-lang-switch"><a href="对应英文版.html">English</a></span>
      </div>
    </footer>
  </article>
</body>
```

### 关键规则

- **SEO 地址统一用 `https://rouzhen.pages.dev`**（不是 rouzhen.com）
- **`<title>` 必须和 `<h1>` 一致**
- **`data-page-lang` 声明语言**（cn / en）
- **article-body 可以有多个**，Publisher 会按顺序合并
- **pull-quote 独立提取**，不放在 article-body 里
- **article-reflection 独立提取**，不放在 article-body 里
- **文章日期**：文件名 `YYYY-MM-DD-xxx.html` + meta article-date + `<time>` 标签

### 中英文版本

- 中文：`YYYY-MM-DD-slug.html`，`data-page-lang="cn"`
- 英文：`YYYY-MM-DD-slug-en.html`，`data-page-lang="en"`
- 两个文件互相链接
- 更新 `journal/index.html` 的文章列表
- 更新 `sitemap.xml` 加新 URL

## Publisher 四人格

| 人格 | 角色 | 平台 |
|------|------|------|
| Long | The Creator | 完整叙事 |
| Image | The Seeker | 小红书 |
| Photo | The Observer | Instagram |
| Micro | The Philosopher | 思想碎片 |

详见 `docs/ROUZHEN_Publisher_Aesthetic_Rules.md`

## 联系方式

- Email: rouzhen.cloud@gmail.com
- Instagram: @rouzhen.cloud
- 小红书: rouzhen

## 部署

- Cloudflare Pages，域名 `rouzhen.pages.dev`
- 推送到 GitHub main 自动部署
