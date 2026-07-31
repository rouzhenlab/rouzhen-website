# ROUZHEN Architecture

> 本文档描述 ROUZHEN Website 的完整信息架构、导航、语言系统和内容分类模型。
> 任何 AI（Claude、CodeBuddy、Copilot、Gemini）在修改代码前应先阅读本文档。

**版本**: v0.8.1  
**最后更新**: 2026-07-31

---

## Architecture Principles

ROUZHEN 项目的五条核心架构原则，优先级从高到低：

1. **Content First** — 页面首先服务阅读与内容消费，功能不喧宾夺主。
2. **Single Source of Truth** — 所有共享数据（标签、配置）只有一个权威来源，杜绝数据漂移。
3. **Progressive Enhancement** — 核心体验不依赖 JS/网络；增强功能层层叠加，允许回退。
4. **Minimal Coupling** — 展示端（Website）与生产端（Studio）通过数据文件（JSON + HTML）解耦。
5. **Backward Compatibility** — 新架构必须兼容旧文章，迁移渐进完成，不强制一次性全量升级。

---

## Engineering Principles

衍生的工程实践原则：

1. **Single Source of Truth** — 标签、配置只能有一份定义。
2. **Progressive Disclosure** — 默认简单，复杂功能随内容增长再开放。
3. **Content First** — 页面优先服务阅读，功能不抢戏。
4. **Minimal Navigation** — 一个页面最多承担一级导航职责。
5. **Backward Compatibility** — 新旧数据共存，渐进迁移。

---

## Information Architecture

```
ROUZHEN Website (rouzhen.pages.dev)
├── Home           /index.html
├── Philosophy     /#philosophy (Home 锚点)
├── Story          /#narrative  (Home 锚点)
├── Journal        /journal/index.html
│   ├── Entry CN   /journal/entries/{date}-{slug}.html
│   └── Entry EN   /journal/entries/{date}-{slug}-en.html
├── Gallery        /gallery.html
├── Asset Library  /asset-library.html
└── Contact        /#contact (Home 锚点)
```

```
ROUZHEN Studio (内部后台)
├── Dashboard      /dashboard.html
├── Editor         /editor.html
├── Browse         /browse.html (公开)
└── Worker         /_worker.js  (Cloudflare Worker)
```

### 数据流向

```
Editor (editor.js)
  → markdown frontmatter 解析
  → meta.tags / meta.tags_cn / meta.tags_en
  → buildArticleHtml() 生成 HTML
  → _worker.js /api/publish/github
  → GitHub 写入:
      journal/entries/{date}-{slug}.html
      journal/entries/{date}-{slug}-en.html
      journal/data/entries.json (增量更新)
  → Cloudflare Pages 自动部署
```

---

## Navigation

### 浏览闭环

```
Home ←→ Journal ←→ Article
  ↑                     ↓
  └——— 上一篇/下一篇 ←——┘
```

- **Home → Journal**: 通过 nav 中的 `Journal/札记` 链接
- **Journal → Home**: 通过 nav 中的 `Home/首页` 链接
- **Journal → Article**: 点击文章卡片
- **Article → Journal**: "返回札记" 按钮 + 上/下一篇导航
- **Article → Home**: 通过 Article 页 nav 中的 `Home/首页` 链接

### 各页面导航职责

| 页面 | 导航包含 |
|------|---------|
| Home | Home · Philosophy · Story · Journal · Gallery · Library · Contact + lang-switch |
| Journal | Home · Philosophy · Story · Journal(active) · Gallery · Library · Contact + lang-switch |
| Article | Home · ←Journal · 上一篇/下一篇 + lang-switch |

### lang-switch 位置规则

- **统一位置**: nav 右侧，menu-toggle 之前
- **DOM 结构**: `<div.lang-switch> <button.lang-btn data-lang="cn">中文</button> <span.lang-sep>/</span> <button.lang-btn data-lang="en">EN</button> </div>`
- **CSS**: `components/Navigation/Navigation.css` 中的 `.lang-switch` 块，全站共用

---

## Language System

### LanguageManager (`scripts/main.js`)

集中式语言状态管理，位于 `scripts/main.js` 顶部全局作用域。

```
LanguageManager
├── init()      — 自动检测 (page-lang > localStorage > browser)
├── get()       — 返回 'cn' | 'en'
├── set(lang)   — 切换语言 + 通知所有订阅者
├── subscribe(fn) — 注册语言变化监听器
│
内部:
├── _apply()    — 更新 data-en/data-cn 文本、data-lang-href 链接、body class、localStorage
└── _notify()   — 遍历 _listeners[]
```

### 调用约定

**任何组件修改语言 →** 调用 `LanguageManager.set('cn')` 或 `LanguageManager.set('en')`

**任何组件需要响应语言变化 →** 注册 `LanguageManager.subscribe(lang => { ... })`

**禁止直接操作:**
- `document.body.classList.toggle/add/remove('lang-xxx')` — 绕过 LanguageManager
- 直接操作 item.dataset 文本 — 应由 `_apply()` 统一处理

### Article 页面特殊处理

Article 页面通过 `body[data-page-lang]` 声明自身语言（因为 CN/EN 是不同 URL）。LanguageManager 初始时尊重此声明。Article 页的 lang-switch 默认是页面跳转链接，不是 JS 切换（避免回到 journal 时语言状态不一致）。此行为可后续通过 `subscribe` 增强。

### TODO: `subscribe(fn, { immediate: true })`

当前 `subscribe()` 注册后需要调用方手动补偿首次渲染（见 `updateNowModule` 的 compensate call）。当新增模块（Footer、Tags、Search、Theme 等）增多时，手动补偿会变成重复模式。

**建议改进**: `subscribe(fn, { immediate: true })` — 让 init 后的首次通知自动触发。或调整 init 顺序：`init()` 内部收集 pre-init 订阅，在 `_apply()` 结束后统一 `_notify()`。不改当前行为，仅作为未来重构方向。

---

## Category / Series / Tag 模型

### 三层结构

```
Category（分类）— 必填，唯一
  ├── 负责网站结构 / 一级导航
  ├── 数量 3-5 个，变化极慢
  └── 例: AI · Nature · Craft · Web

Series（系列）— 可选，唯一
  ├── 负责连续阅读 / 内容组织
  ├── 必须有 parent Category
  └── 例: AI Tool Reviews · Rouzhen Lab

Tag（标签）— 可选，多个
  ├── 负责搜索 / SEO / 内容发现
  ├── 每个 Tag 归属一个 Category
  └── 例: Claude · CodeBuddy · Moss · Fog
```

### 数据格式

所有标签定义集中于 `journal/data/tags.json`，这是全站唯一标签数据源。

```json
{
  "categories": [
    { "id": "cat-ai", "cn": "AI", "en": "AI", "slug": "ai" }
  ],
  "series": [
    { "id": "ser-ai-tools", "cn": "AI 工具横评", "en": "AI Tool Reviews", "category": "cat-ai" }
  ],
  "tags": [
    { "id": "claude", "type": "tag", "category": "cat-ai", "cn": "Claude", "en": "Claude" }
  ]
}
```

### 消费者

| 模块 | 读取方式 | 用途 |
|------|---------|------|
| `journal/index.html` | `fetch('/journal/data/tags.json')` | Topics 渲染 |
| Article 模板 (`editor.js`) | `fetch('../data/tags.json')` | 标签显示 |
| `_worker.js` | `fetch` 或构建时注入 | publish 写入 |
| `js/editor.js` (Studio) | HTTP 读取 | 标签选择器 |

### 文章数据中的标签字段

```json
// entries.json — 文章只存 ID
{
  "category": "cat-ai",
  "series": "ser-ai-tools",     // 可选
  "tags": ["claude", "codebuddy", "copilot"]
}
```

显示时通过 `tags.json` 字典解析 ID → 显示文本。不再同时存储 `tags_cn` / `tags_en`。

### 迁移兼容

`tags.json` 内置 `migration.map` 字段，将旧 `tags_cn` 字符串映射到新 tag ID。Worker publish 时自动转换，旧文章 `tags_cn` 字段暂时保留作为回退。

---

## Data Flow

```
┌── 共享层 ────────────────────────────────────────┐
│  journal/data/tags.json    标签字典 (SSoT)        │
│  scripts/main.js           LanguageManager        │
│  components/Navigation/    CSS + DOM 规范          │
└───────────────────────────────────────────────────┘
         │                          │
         ▼                          ▼
┌── Website (展示端) ──────┐ ┌── Studio (生产端) ───┐
│ journal/index.html       │ │ editor.js            │
│ article templates        │ │ _worker.js           │
│ gallery.html             │ │ browse.html          │
│ asset-library.html       │ │ dashboard.js         │
└──────────────────────────┘ └──────────────────────┘
```

### 关键原则

- **Website 不写标签数据** — 只读 `tags.json` 和 `entries.json`
- **Studio 不写标签定义** — 发布时引用 `tags.json` 的 migration map
- **Worker 不维护标签副本** — 连到同一份 `tags.json`（Future: 运行时 fetch 或构建时注入）
- **旧数据保留** — `entries.json` 中旧 `tags_cn` 字段暂不删除，新文章逐步迁移

---

## Version History

| 版本 | 日期 | 变更 |
|------|------|------|
| v0.8.1 | 2026-07-31 | LanguageManager + tags.json + Navigation 规范 |
