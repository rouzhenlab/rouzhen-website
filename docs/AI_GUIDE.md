# ROUZHEN AI Collaboration Guide

ROUZHEN 网站项目 AI 协作指南。

## 目录

- [项目概述](#项目概述)
- [核心原则](#核心原则)
- [技术架构](#技术架构)
- [文件结构](#文件结构)
- [代码规范](#代码规范)
- [常见任务](#常见任务)
- [注意事项](#注意事项)

---

## 项目概述

ROUZHEN 是一个生态系统品牌，而非传统企业官网。

### 品牌架构

- **Philosophy** - 品牌哲学
- **Story** - 品牌故事
- **Collections** - 产品系列
- **Lab** - 实验项目
- **Journal** - 生态档案（未来扩展）
- **Contact** - 联系方式

### 核心理念

- 自然、禅意、静谧
- 苔藓绿 + 云白 + 山石灰配色
- 开场动画营造沉浸体验
- 内容即产品

---

## 核心原则

### ⚠️ 不可违反

1. **禁止引入框架**
   - 不使用 React、Vue、Angular 等框架
   - 保持 HTML + CSS + Vanilla JS 架构
   - 未来可考虑轻量级增强（Alpine.js），但非当前阶段

2. **禁止修改视觉设计**
   - 不改变现有配色方案
   - 不改变动画效果
   - 不改变布局结构
   - 优化仅限于代码层面

3. **长期可维护优先**
   - 代码可读性 > 性能优化
   - 明确的命名规范
   - 完善的注释文档
   - 变量化参数管理

### ✅ 推荐做法

- 使用 CSS 变量管理设计系统
- 语义化 HTML 结构
- 渐进增强策略
- 模块化组件设计

---

## 技术架构

### 技术栈

- **HTML5** - 语义化结构
- **CSS3** - 变量系统 + 动画
- **Vanilla JavaScript** - 交互逻辑
- **Cloudflare Pages** - 部署平台

### 构建方式

- 无构建工具
- 直接部署静态文件
- 使用原生 CSS 变量
- 无需编译打包

### 部署流程

```
GitHub Push → Cloudflare Pages → 自动部署
```

---

## 文件结构

```
/workspace/
├── src/
│   ├── index.html              # 首页
│   ├── components/             # 组件目录
│   │   ├── Hero/               # 开场动画组件
│   │   │   ├── Hero.css
│   │   │   └── Hero.js
│   │   ├── Navigation/         # 导航组件
│   │   │   ├── Navigation.css
│   │   │   └── Navigation.js
│   │   ├── Philosophy/         # 哲学板块
│   │   ├── Story/              # 故事板块
│   │   ├── Collections/        # 产品系列
│   │   ├── Lab/                # 实验项目
│   │   ├── Contact/            # 联系方式
│   │   ├── Footer/             # 页脚
│   │   └── Values/             # 价值观
│   ├── styles/                 # 样式系统
│   │   ├── variables.css       # 设计系统变量 ⭐
│   │   ├── typography.css      # 字体样式
│   │   ├── animation.css       # 动画定义
│   │   └── layout.css           # 布局样式
│   └── assets/                 # 静态资源
│       ├── fonts/              # 字体文件
│       ├── images/             # 图片资源
│       └── video/              # 视频资源
├── docs/                       # 文档目录
│   ├── DESIGN_SYSTEM.md        # 设计系统规范
│   └── AI_GUIDE.md             # AI 协作指南
└── README.md                   # 项目说明
```

### 关键文件

| 文件 | 重要性 | 说明 |
|------|--------|------|
| `src/styles/variables.css` | ⭐⭐⭐ | 设计系统核心，所有变量定义 |
| `src/components/Hero/Hero.css` | ⭐⭐⭐ | 开场动画核心 |
| `src/components/Hero/Hero.js` | ⭐⭐ | 山景 SVG 生成逻辑 |
| `src/index.html` | ⭐⭐ | 页面入口 |

---

## 代码规范

### CSS 规范

#### 变量命名

```css
/* ✅ 推荐：语义化命名 */
--color-moss
--color-cloud
--space-3

/* ❌ 禁止：魔法数字 */
color: #6b7c5e;
margin: 16px;
```

#### z-index 使用

```css
/* ✅ 推荐：使用变量 */
z-index: var(--z-header);

/* ❌ 禁止：魔法数字 */
z-index: 1000;
```

#### 动画时间

```css
/* ✅ 推荐：使用变量 */
animation: fadeIn var(--hero-logo-duration) var(--hero-logo-delay);

/* ❌ 禁止：硬编码 */
animation: fadeIn 1.2s 8s;
```

### JavaScript 规范

#### DOM 操作

```javascript
// ✅ 推荐：使用现代 API
document.querySelector('.element');
document.querySelectorAll('.elements');

// ❌ 避免：使用 jQuery 等库
$('.element');
```

#### 事件监听

```javascript
// ✅ 推荐：使用现代语法
element.addEventListener('click', () => {
  // handler
});
```

### HTML 规范

#### 语义化标签

```html
<!-- ✅ 推荐 -->
<header>
  <nav>...</nav>
</header>
<main>
  <section>...</section>
</main>
<footer>...</footer>

<!-- ❌ 避免 -->
<div class="header">...</div>
```

---

## 常见任务

### 修改动画时间

1. 打开 `src/styles/variables.css`
2. 找到 Hero Animation Timeline 区块
3. 修改变量值
4. 相关组件自动生效

```css
/* 示例：延迟 Logo 出现 */
--hero-logo-delay: 9s; /* 原值 8s */
```

### 调整层级

1. 打开 `src/styles/variables.css`
2. 找到 Z-Index System 区块
3. 修改变量值或添加新变量

```css
/* 示例：添加新层级 */
--z-overlay: 150;
```

### 添加新颜色

1. 在 `variables.css` 添加变量
2. 使用语义化命名
3. 添加注释说明用途

```css
/* 示例：添加强调色 */
--color-accent: #c4a35a; /* 金色强调 */
```

### 创建新组件

1. 在 `src/components/` 创建目录
2. 创建 `ComponentName.css` 和 `ComponentName.js`
3. 在 `index.html` 引入样式和脚本
4. 遵循现有命名规范

---

## 注意事项

### ⚠️ 禁止操作

1. **不修改设计**
   - 不改变配色
   - 不改变动画效果
   - 不改变布局

2. **不引入框架**
   - 不使用 React/Vue/Angular
   - 不使用 jQuery
   - 不使用构建工具

3. **不破坏变量系统**
   - 不在组件中硬编码值
   - 不删除已有变量
   - 不改变变量语义

### ✅ 最佳实践

1. **修改前先阅读**
   - 阅读相关组件代码
   - 理解设计意图
   - 参考现有实现

2. **保持一致性**
   - 遵循现有命名规范
   - 使用现有变量系统
   - 保持代码风格统一

3. **添加注释**
   - 复杂逻辑添加说明
   - 关键变量添加用途注释
   - 修改原因添加备注

### 调试建议

1. 使用浏览器开发者工具
2. 检查 CSS 变量计算值
3. 验证动画时间线
4. 测试响应式布局

---

## 未来扩展

### Journal 模块（规划中）

```
/src/journal/
├── index.html           # Journal 首页
├── entries/             # 文章目录
│   └── *.html          # 文章页面
└── data/                # 数据目录
    └── entries.json    # 文章索引
```

### 内容流程（规划中）

```
Markdown → GitHub → Cloudflare Pages
```

### 国际化（规划中）

- 多语言支持
- i18n 数据文件
- 语言切换逻辑

---

## 联系与更新

此文档随项目演进持续更新。

最后更新：2026-07