# Tag Specification

> 版本：v1.0  
> 最后更新：2026-07-31  
> 关联文档：`Architecture.md`（架构原则）、`Tag-Audit-Report.md`（数据现状）

本文档定义 ROUZHEN 标签系统的规则与命名规范。所有新增标签、修改标签、标签相关代码都必须遵循本规范。

---

## 1. Tag Identity（标签身份）

每个标签有且仅有一个 `id`，作为其唯一身份标识。

| 属性 | 规则 | 示例 |
|------|------|------|
| **id** | 唯一，永久不变。全小写，连字符分隔 | `ai-general`, `moss`, `content-os` |
| **cn** | 中文 Display Name，可修改 | `AI`, `苔藓`, `Content OS` |
| **en** | 英文 Display Name，可修改 | `AI`, `Moss`, `Content OS` |
| **slug** | URL 友好版本，与 id 对齐 | `ai`, `moss`, `content-os` |
| **category** | 所属分类 ID，见 §3 | `cat-ai`, `cat-nature`, `cat-craft` |
| **type** | 固定值 `"tag"` | `"tag"` |

**原则：**

- `id` 是数据库 key。改 `cn` 或 `en` 不影响关联、筛选、URL。
- 不要用 Display Name 做 key。
- 不要用 `#`、空格、大写字母做 id。

---

## 2. Tag Naming Convention（命名规则）

### 2.1 id 命名

```
<主题>[-<修饰>]
```

| 模式 | 含义 | 示例 |
|------|------|------|
| `{noun}` | 单一名词，无歧义 | `moss`, `fog`, `ecology` |
| `{noun}-general` | 大类/泛称，区别于更具体的子标签 | `ai-general`, `nature-general`, `craft-general` |
| `{product}` | 产品/工具名 | `claude`, `codebuddy`, `cloudflare` |

**禁止：**

- 中文 ID（如 `苔藓`）- 用 slug 代替
- 空格（如 `Content OS`）- 用 `-` 代替
- 大写字母（如 `AI`）- 全转小写
- `#` 前缀（如 `#AI`）- 取消前缀

### 2.2 Display Name 命名

- `cn` 和 `en` 可以独立修改，不影响 id。
- 未来如"神话叙事"改为"神话故事"，只需改 `cn` 字段，id 不变。
- Display Name 支持大写、空格、中文，不做限制。

---

## 3. Category System（分类体系）

标签必须隶属一个 category：

| Category ID | 中文 | 英文 |
|-------------|------|------|
| `cat-ai` | AI | AI |
| `cat-nature` | 自然 | Nature |
| `cat-craft` | 创作 | Craft |
| `cat-web` | Web | Web |

**规则：**

- 新标签必须指定 category。
- Category 比 tag 更稳定，不应频繁增删。
- 一个 tag 只能属于一个 category。

---

## 4. URL Format（链接格式）

### 4.1 统一规范

```
/journal/index.html?tag={id}
```

**示例：**

| 当前（混乱） | 规范（统一） |
|-------------|-------------|
| `?tag=#AI` | `?tag=ai-general` |
| `?tag=AI` | `?tag=ai-general` |
| `/browse.html?tag=ROUZHEN` | `/journal/index.html?tag=studio` |
| `?tag=%23AI%E5%88%9B%E4%BD%9C` | `?tag=ai-general` |

### 4.2 未来升级路径（暂不实现）

```
/tag/{id}
```

当项目引入路由时，统一重定向至 `/tag/{id}`。`?tag=` 参数仅作为过渡方案。

### 4.3 browse.html

`browse.html` 文件不存在。不修复、不恢复。所有引用统一替换为 `journal/index.html?tag=...`。

---

## 5. Migration Rules（迁移规则）

### 5.1 tags.json 迁移表

`tags.json` 中的 `migration.map` 是迁移的唯一权威来源：

```json
{
  "AI": "ai-general",
  "#AI": "ai-general",
  "创作": "craft-general",
  "自然": "nature-general",
  "哲学": "philosophy",
  "ROUZHEN": "studio",
  "个人工作室": "studio",
  "#个人工作室": "studio",
  "Content OS": "content-os",
  "#ContentOS": "content-os",
  "Creator System": "creator",
  "#CreativeProcess": "craft-general",
  "Creation": "craft-general",
  "Nature": "nature-general",
  "Philosophy": "philosophy"
}
```

### 5.2 迁移原则

1. **迁移是一次性操作**，不在运行时代码中保留转换逻辑。
2. **迁移脚本**负责将 `entries.json` 和 article HTML 中的旧标签转为新 ID。
3. **无法自动映射的标签**：标记为 `MANUAL_REVIEW`，不改动数据，仅输出警告。
4. **迁移后的数据**只包含 tag ID，不再包含 Display Name 或原始字符串。

### 5.3 手动审核清单

| 旧标签 | 原因 | 操作 |
|--------|------|------|
| `#AI创作` | 复合标签，可能是"AI 创作工具"、"AI 创作过程"或"AI 创作作品" | **人工确认**后再决定映射目标，不自动拆分 |

---

## 6. Reserved Tags（保留标签）

以下 `id` 为系统保留，不能分配给内容标签：

| ID | 用途 |
|----|------|
| `featured` | 精选/推荐标记 |
| `draft` | 草稿状态 |
| `internal` | 内部使用，不公开 |
| `all` | 筛选器"全部"的保留参数 |

**新增保留标签**需要更新本文档并同步到 `tags.json`。

---

## 7. Adding a New Tag（新增标签流程）

1. 确认 `id` 符合命名规则（§2），不与已有 `id` 和保留标签（§6）冲突。
2. 在 `tags.json` 的 `tags` 数组中追加：
   ```json
   { "id": "new-tag", "type": "tag", "category": "cat-xxx", "slug": "new-tag", "cn": "新标签", "en": "New Tag" }
   ```
3. 如果涉及历史数据，在 `migration.map` 中追加映射。
4. 更新 `Tag-Audit-Report.md`（如果是大规模迁移）。
5. 不需要改代码——运行时从 `tags.json` 动态读取。

---

## 8. Changing a Display Name（修改标签显示名）

1. 修改 `tags.json` 中对应 `id` 的 `cn` 或 `en` 字段。
2. **不要改 `id`**。
3. **不要改 `slug`**（除非 URL 策略变更）。
4. 无需迁移 `entries.json` 或 article HTML。

---

## 9. Design Rationale（设计依据）

| 决策 | 理由 |
|------|------|
| `id` 不可变 | 如果 Display Name 变了就要改 URL 和数据，标签系统无法扩展 |
| 迁移是一次性的 | 不在运行时保留"如果是旧标签就转换"的逻辑，避免永久维护成本 |
| URL 用 id 不用 slug | `slug` 可能撞名；`id` 已保证唯一，少一层映射 |
| 不自动拆分复合标签 | `#AI创作` 的语义机器无法判断，人工确认更准确 |
| `browse.html` 直接废弃 | 文件不存在，为它保留兼容逻辑是技术债 |

---

## 10. Relationship to Other Docs

```
Architecture.md
  └─ 回答"为什么这样设计"（原则、约束、演进方向）

Tag-Spec.md ← 本文档
  └─ 回答"标签必须遵守什么规则"（命名、URL、迁移流程）

Tag-Audit-Report.md
  └─ 回答"当前数据长什么样"（一次性快照，迁移后归档）
```

修改标签系统时，三份文档按顺序读：先看原则（Architecture），再看规范（Spec），最后看现状（Audit）。
