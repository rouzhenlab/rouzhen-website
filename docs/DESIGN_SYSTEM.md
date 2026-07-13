# ROUZHEN Design System

ROUZHEN 品牌设计系统规范文档。

## 目录

- [品牌色彩](#品牌色彩)
- [间距系统](#间距系统)
- [层级系统](#层级系统)
- [动画时间线](#动画时间线)
- [字体系统](#字体系统)
- [容器规范](#容器规范)

---

## 品牌色彩

### 核心色（Brand Core Colors）

| 变量名 | 色值 | 用途 |
|--------|------|------|
| `--color-cloud` | `#e8ecef` | 云色，品牌主色调 |
| `--color-moss` | `#6b7c5e` | 苔藓绿，品牌核心色 |
| `--color-moss-light` | `#8a9a7c` | 苔藓绿-浅色变体 |
| `--color-moss-dark` | `#4d5a42` | 苔藓绿-深色变体 |
| `--color-stone` | `#2d2d2d` | 山石色，深色调 |
| `--color-stone-light` | `#555555` | 山石色-浅色变体 |

### 辅助色（Brand Accent Colors）

| 变量名 | 色值 | 用途 |
|--------|------|------|
| `--color-mist` | `rgba(255, 255, 255, 0.6)` | 雾色，半透明效果 |
| `--color-ink` | `#1a1a1a` | 墨色，深色背景 |
| `--color-paper` | `#ffffff` | 纸色，纯白背景 |
| `--color-paper-warm` | `#f7f6f3` | 暖纸色，温和背景 |
| `--color-border` | `#ececea` | 边框色 |

### 文字色系（Text Colors）

| 变量名 | 色值 | 用途 |
|--------|------|------|
| `--color-text-primary` | `#1a1a1a` | 主要文字 |
| `--color-text-secondary` | `#666666` | 次要文字 |
| `--color-text-muted` | `#999999` | 弱化文字 |
| `--color-text-light` | `#ffffff` | 浅色文字 |
| `--color-text-light-muted` | `rgba(255, 255, 255, 0.6)` | 浅色弱化文字 |

### 使用原则

1. **品牌主色**：用于强调元素、按钮、链接
2. **Paper 系列**：用于背景，营造纸张质感
3. **Text 系列**：用于文字层级，保持可读性
4. **避免魔法数字**：使用语义化变量名（`--color-moss` 而非 `--green-1`）

---

## 间距系统

基于 4px 基础单位递增，用于 margin、padding、gap。

### 间距变量

| 变量名 | 值 | 用途 |
|--------|-----|------|
| `--space-1` | `4px` | 紧凑元素间距 |
| `--space-2` | `8px` | 小间距 |
| `--space-3` | `16px` | 基础间距 |
| `--space-4` | `24px` | 中等间距 |
| `--space-5` | `32px` | 区块内间距 |
| `--space-6` | `48px` | 区块间距 |
| `--space-7` | `64px` | 大区块间距 |
| `--space-8` | `96px` | 章节间距 |
| `--space-9` | `128px` | 大章节间距 |
| `--space-10` | `160px` | 特大间距 |

### 圆角

| 变量名 | 值 | 用途 |
|--------|-----|------|
| `--radius-sm` | `2px` | 小圆角 |
| `--radius-md` | `4px` | 中等圆角 |
| `--radius-lg` | `8px` | 大圆角 |

### 阴影

| 变量名 | 值 | 用途 |
|--------|-----|------|
| `--shadow-sm` | `0 2px 8px rgba(0, 0, 0, 0.04)` | 微阴影 |
| `--shadow-md` | `0 8px 24px rgba(0, 0, 0, 0.06)` | 中等阴影 |
| `--shadow-lg` | `0 20px 40px rgba(0, 0, 0, 0.08)` | 大阴影 |

### 过渡时间

| 变量名 | 值 | 用途 |
|--------|-----|------|
| `--transition-fast` | `0.3s cubic-bezier(0.4, 0, 0.2, 1)` | 快速过渡 |
| `--transition-base` | `0.6s cubic-bezier(0.4, 0, 0.2, 1)` | 基础过渡 |
| `--transition-slow` | `1s cubic-bezier(0.4, 0, 0.2, 1)` | 慢速过渡 |

---

## 层级系统

### 分层原则

| 层级 | 范围 | 用途 |
|------|------|------|
| 背景层 | 1-10 | 山景、雾气 |
| 内容层 | 11-20 | Logo、Slogan、内容区块 |
| 固定层 | 100+ | 导航栏、弹窗 |

### Z-Index 变量

| 变量名 | 值 | 用途 |
|--------|-----|------|
| `--z-mountain` | `1` | 山景背景 |
| `--z-fog` | `5` | 雾气层 |
| `--z-content` | `10` | 普通内容 |
| `--z-hero-bottom` | `15` | Hero 底部区域 |
| `--z-hero-content` | `20` | Hero Logo/Slogan |
| `--z-header` | `100` | 导航栏 |
| `--z-modal` | `200` | 弹窗（未来预留） |
| `--z-toast` | `300` | 提示（未来预留） |

### 使用规则

- **禁止使用魔法数字**：新增层级必须使用变量
- **保持层级间隔**：每层预留空间，便于未来扩展
- **遵循分层原则**：新元素应归入对应层级

---

## 动画时间线

### Hero 开场动画时间线

完整的 10 秒开场动画，按时间顺序：

```
0s    - 山景黑白渐入开始
3s    - 雾气开始出现
6s    - 山景彩色渐变开始
8s    - Logo 渐显
10s   - Slogan 渐显
10.5s - 语言选择器渐显
11s   - 滚动指示器渐显 + 弹跳
```

### 山景动画变量

| 变量名 | 默认值 | 用途 |
|--------|--------|------|
| `--hero-mountain-bw-duration` | `3s` | 山景黑白渐入时长 |
| `--hero-mountain-bw-delay` | `3s` | 山景黑白渐入延迟 |
| `--hero-mountain-fade-duration` | `2.5s` | 山景渐隐时长 |
| `--hero-mountain-fade-delay` | `6s` | 山景渐隐延迟 |
| `--hero-mountain-color-duration` | `2.5s` | 山景彩色渐变时长 |
| `--hero-mountain-color-delay` | `6s` | 山景彩色渐变延迟 |

### 雾气动画变量

| 变量名 | 默认值 | 用途 |
|--------|--------|------|
| `--hero-fog-appear-duration` | `3s` | 雾气出现时长 |
| `--hero-fog-appear-2-duration` | `3.5s` | 雾气2出现时长 |
| `--hero-fog-1-delay` | `1s` | 雾气1延迟 |
| `--hero-fog-2-delay` | `1.5s` | 雾气2延迟 |
| `--hero-fog-drift-1-duration` | `18s` | 雾气漂移1时长 |
| `--hero-fog-drift-2-duration` | `22s` | 雾气漂移2时长 |
| `--hero-fog-drift-3-duration` | `20s` | 雾气漂移3时长 |

### 雾脉动画变量

| 变量名 | 默认值 | 用途 |
|--------|--------|------|
| `--hero-tendril-1-duration` | `35s` | 雾脉1时长 |
| `--hero-tendril-2-duration` | `40s` | 雾脉2时长 |
| `--hero-tendril-3-duration` | `38s` | 雾脉3时长 |
| `--hero-tendril-1-delay` | `3s` | 雾脉1延迟 |
| `--hero-tendril-2-delay` | `3.5s` | 雾脉2延迟 |
| `--hero-tendril-3-delay` | `3s` | 雾脉3延迟 |

### 内容动画变量

| 变量名 | 默认值 | 用途 |
|--------|--------|------|
| `--hero-logo-duration` | `1.2s` | Logo 渐显时长 |
| `--hero-logo-delay` | `8s` | Logo 渐显延迟 |
| `--hero-slogan-duration` | `1.2s` | Slogan 渐显时长 |
| `--hero-slogan-delay` | `10s` | Slogan 渐显延迟 |
| `--hero-lang-duration` | `1s` | 语言选择器渐显时长 |
| `--hero-lang-delay` | `10.5s` | 语言选择器渐显延迟 |
| `--hero-scroll-duration` | `1s` | 滚动指示器渐显时长 |
| `--hero-scroll-delay` | `11s` | 滚动指示器渐显延迟 |
| `--hero-scroll-bounce-duration` | `2s` | 滚动指示器弹跳时长 |

### 调整建议

- **修改 delay 值**：可改变元素出现时间
- **保持顺序**：`mountain → fog → logo → slogan → lang → scroll`
- **整体调整**：建议同时调整相关变量，保持视觉连贯
- **避免单独修改**：会影响动画节奏

---

## 字体系统

### 字体变量

| 变量名 | 字体栈 | 用途 |
|--------|--------|------|
| `--font-logo` | Georgia, LXGW WenKai, Noto Serif SC | Logo 专用 |
| `--font-heading` | Georgia, LXGW WenKai, Noto Serif SC | 标题 |
| `--font-body` | Noto Serif SC, Georgia, Songti SC | 正文 |
| `--font-cn` | LXGW WenKai, Noto Serif SC, Songti SC | 中文 |
| `--font-sans` | Noto Serif SC, Georgia, -apple-system | 无衬线回退 |
| `--font-slogan` | Cinzel, Georgia | Slogan 专用 |
| `--font-cn-heading` | LXGW WenKai, Noto Serif SC, Songti SC | 中文标题 |
| `--font-cn-body` | Noto Serif SC, LXGW WenKai, Songti SC | 中文正文 |

### 字体加载

外部字体通过 HTML `<link>` 加载：
- Google Fonts: Cinzel
- 霞鹜文楷（LXGW WenKai）
- Noto Serif SC

---

## 容器规范

### 容器变量

| 变量名 | 值 | 用途 |
|--------|-----|------|
| `--container-max` | `1200px` | 主容器最大宽度 |
| `--container-narrow` | `640px` | 窄容器最大宽度 |

### 使用方式

```css
.container {
  max-width: var(--container-max);
  margin: 0 auto;
  padding: 0 var(--space-3);
}
```

---

## 修改记录

| 版本 | 日期 | 修改内容 |
|------|------|----------|
| v1.0 | 2026-07 | 初始版本，包含品牌色彩、间距、层级、动画时间线 |