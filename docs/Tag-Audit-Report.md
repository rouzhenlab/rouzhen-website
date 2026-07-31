# Tag Audit Report — Phase 1

> 生成时间：2026-07-31  
> 范围：entries.json（4 条）+ 16 篇 article HTML  
> 原则：只统计，不修改

---

## 1. 总览

| 指标 | 数值 |
|------|------|
| 文章总数（去重） | 8 个内容单元 |
| entries.json 条目 | 4 条 |
| 仅有 HTML 无 entries.json | 4 条 |
| 总标签引用次数 | 59 次（HTML + entries.json） |
| 唯一标签字符串 | 16 个 |
| 可自动迁移 | 14 个（88%） |
| 需要人工确认 | 2 个（13%） |
| 空标签文章 | 1 篇 |

---

## 2. 标签清单

### 2.1 # 前缀标签（社交媒体风格）

这些出现在含 `ROUZHEN`+`AI`+`Content OS`+`Creator System` 的"新风格"文章中。

| Tag 原文 | 出现次数 | tags.json ID | 迁移目标 | 状态 |
|----------|----------|-------------|----------|------|
| `#AI创作` | 6 | — | `ai-general` + `craft-general` | ⚠️ 复合标签 |
| `#个人工作室` | 6 | `studio` | `studio` | ✅ 自动迁移 |
| `#ContentOS` | 6 | `content-os` | `content-os` | ✅ 自动迁移 |
| `#AI` | 6 | — | `ai-general` | ✅ 自动迁移 |
| `#CreativeProcess` | 6 | — | `craft-general` | ⚠️ 语义判断 |

> 注：6 次 = 4 个内容单元各自 1 次 + entries.json 各 2 条

### 2.2 干净标签（无 # 前缀）

| Tag 原文 | 出现次数 | tags.json ID | 迁移目标 | 状态 |
|----------|----------|-------------|----------|------|
| `AI` | 5 | — | `ai-general` | ✅ 与 `#AI` 合并 |
| `ROUZHEN` | 3 | `rouzhen` | `rouzhen` | ✅ 自动迁移 |
| `Content OS` | 3 | `content-os` | `content-os` | ✅ 与 `#ContentOS` 合并 |
| `Creator System` | 3 | — | `creator` | ✅ 自动迁移 |
| `创作` | 4 | `craft-general` | `craft-general` | ✅ 自动迁移 |
| `自然` | 4 | `nature-general` | `nature-general` | ✅ 自动迁移 |
| `哲学` | 2 | `philosophy-general` | `philosophy-general` | ✅ 自动迁移 |
| `Creation` | 4 | `craft-general` | `craft-general` | ✅ EN 对应 创作 |
| `Nature` | 4 | `nature-general` | `nature-general` | ✅ EN 对应 自然 |
| `Philosophy` | 2 | `philosophy-general` | `philosophy-general` | ✅ EN 对应 哲学 |

---

## 3. 需合并的标签对

| 标签 A | 标签 B | 合并后 ID | 说明 |
|--------|--------|-----------|------|
| `#AI` | `AI` | `ai-general` | 同一概念，# 只是装饰 |
| `#ContentOS` | `Content OS` | `content-os` | 空格 + # 差异 |
| `#个人工作室` | — | `studio` | 去 # 即匹配 |
| `#AI创作` | `AI` + `创作` | `ai-general` + `craft-general` | 拆分为两个独立标签 |
| `#CreativeProcess` | `Creator System` / `创作` | `craft-general` | 语义相同：创作过程 |

---

## 4. 链接问题

| 问题类型 | 数量 | 涉及文章 |
|----------|------|----------|
| 链接到 `/browse.html`（404） | 4 篇 | 2026-07-25-date, 2026-07-25-the-free-battle, 2026-07-29-the-free-battle, 2026-07-29-date |
| 链接到 `/journal/index.html?tag=` | 2 篇 | 2026-07-15-the-free-battle, 2026-07-15-the-free-battle-en |
| `<span>` 无链接 | 4 篇 | cloud-without-patent（×2）, ai-website（×2） |
| 空标签 | 1 篇 | 2026-07-28-the-free-battle（×2 CN+EN） |

---

## 5. 迁移策略建议

### 第一阶段：数据迁移

```
# tags.json migration map 已有覆盖：
✅ ROUZHEN     → rouzhen
✅ 创作        → craft-general
✅ 自然        → nature-general
✅ 哲学        → philosophy-general
✅ 个人工作室  → studio
✅ Content OS  → content-os
✅ Creator System → creator

# 需要新增的映射：
⚠️ #AI            → ai-general   （去 #）
⚠️ AI             → ai-general   （与 #AI 合并）
⚠️ #ContentOS     → content-os   （去 # + 去空格）
⚠️ #AI创作        → 拆分为 [ai-general, craft-general]
⚠️ #CreativeProcess → craft-general （语义映射）
⚠️ #个人工作室    → studio       （去 #）
⚠️ Creation       → craft-general （EN）
⚠️ Nature         → nature-general （EN）
⚠️ Philosophy     → philosophy-general （EN）
```

### 第二阶段：链接统一

统一为 `/journal/index.html?tag=<tag-id>`（不含 # 前缀），不再使用 `/browse.html`。

### 第三阶段：补充缺失

2026-07-28 的两篇文章补充标签（内容与其他 the-free-battle 系列一致）。

---

## 6. entry.json 迁移对照表

| entries.json ID | 当前 tags | 迁移后 tag IDs |
|-----------------|----------|---------------|
| `the-free-battle` (2026-07-29) | `#AI创作`, `#个人工作室`, `#ContentOS`, `#AI`, `#CreativeProcess` | `[ai-general, craft-general, studio, content-os]` |
| `2026-07-25` (2026-07-29) | `ROUZHEN`, `AI`, `Content OS`, `Creator System`, `#AI创作`, `#个人工作室`, `#ContentOS`, `#AI`, `#CreativeProcess` | `[rouzhen, ai-general, content-os, creator, craft-general, studio]` |
| `ai-website` | cn: `创作`, `自然`, `AI` / en: `Creation`, `Nature`, `AI` | `[craft-general, nature-general, ai-general]` |
| `cloud-without-patent` | cn: `创作`, `自然`, `哲学` / en: `Creation`, `Nature`, `Philosophy` | `[craft-general, nature-general, philosophy-general]` |

---

## 7. 建议的 tags.json 补充

当前 `migration.map` 已有的：`AI`, `创作`, `自然`, `哲学`, `ROUZHEN`, `个人工作室`, `创作者`, `Content OS`, `Creator System`, `Creation`, `Nature`, `Philosophy`

**建议新增**（migration.map 里补）：

| 旧标签 | 映射到的 tag ID |
|--------|----------------|
| `#AI` | `ai-general` |
| `#AI创作` | `ai-general` → 配合手动拆分为 `ai-general` + `craft-general` |
| `#ContentOS` | `content-os` |
| `#CreativeProcess` | `craft-general` |
| `#个人工作室` | `studio` |

---

## 8. 下一步

Phase 2：接入 tags.json — 让 journal/index.html 的筛选逻辑从 tags.json 读取标签定义，而非直接从 entries.json 的原始字符串进行匹配。
