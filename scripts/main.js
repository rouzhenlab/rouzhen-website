/* ────────────────────────────────────────────────────────────────
   LanguageManager v1.0
   集中式语言控制 — 取代分散的 body.classList.toggle 机制
   ──────────────────────────────────────────────────────────────── */
const LanguageManager = {
  _lang: 'cn',
  _listeners: [],

  /** 自动检测并应用初始语言（page-lang > localStorage > browser） */
  init() {
    const pageLang = document.body.getAttribute('data-page-lang');
    const savedLang = localStorage.getItem('rouzhen-lang');

    if (pageLang) {
      this._lang = pageLang;
    } else if (savedLang) {
      this._lang = savedLang;
    } else {
      const zh = ['zh-CN','zh-SG','zh','zh-Hans'];
      const b = navigator.language || navigator.userLanguage || 'en';
      this._lang = zh.some(c => b.startsWith(c)) ? 'cn' : 'en';
    }
    this._apply();
  },

  /** 返回当前语言 'cn' | 'en' */
  get() {
    return this._lang;
  },

  /** 切换语言并通知所有订阅者 */
  set(lang) {
    if (!lang || this._lang === lang) return;
    this._lang = lang;
    this._apply();
    this._notify();
  },

  /** 注册语言变化监听器 */
  subscribe(fn) {
    this._listeners.push(fn);
  },

  /* ── 内部 ── */
  _apply() {
    const L = this._lang;
    document.documentElement.lang = L;
    document.querySelectorAll('[data-en][data-cn]').forEach(el => {
      el.textContent = el.getAttribute('data-' + L);
    });
    document.querySelectorAll('[data-en-href][data-cn-href]').forEach(el => {
      el.setAttribute('href', el.getAttribute('data-' + L + '-href'));
    });
    document.querySelectorAll('.lang-btn[data-lang]').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-lang') === L);
    });
    document.body.classList.remove('lang-en','lang-cn');
    document.body.classList.add('lang-' + L);
    try { localStorage.setItem('rouzhen-lang', L); } catch(e) {}
  },

  _notify() {
    this._listeners.forEach(fn => fn(this._lang));
  }
};

/* ────────────────────────────────────────────────────────────────
   主入口
   ──────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  let nowEntriesCache = null;

  /* ── LanguageManager 初始化 ── */
  LanguageManager.init();

  /* ── 绑定所有 lang-btn（含 Home Hero 底部 + Journal nav） ── */
  document.querySelectorAll('.lang-btn[data-lang]').forEach(btn => {
    btn.addEventListener('click', () => {
      LanguageManager.set(btn.getAttribute('data-lang'));
    });
  });

  /* ── Navigation ── */
  const header = document.getElementById('header');
  const navMenu = document.getElementById('navMenu');
  const menuToggle = document.getElementById('menuToggle');
  const navLinks = document.querySelectorAll('.nav-link');

  window.addEventListener('scroll', () => {
    if (window.scrollY > 50) {
      header.classList.add('scrolled');
    } else {
      header.classList.remove('scrolled');
    }
  });

  menuToggle.addEventListener('click', () => {
    navMenu.classList.toggle('active');
    menuToggle.classList.toggle('active');
  });

  navLinks.forEach(link => {
    link.addEventListener('click', () => {
      navMenu.classList.remove('active');
      menuToggle.classList.remove('active');
    });
  });

  const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateY(0)';
      }
    });
  }, observerOptions);

  const animateElements = document.querySelectorAll(
    '.collection-card, .value-card, .story-text, .story-image, .philosophy-text, .philosophy-intro, .lab-text, .lab-tags, .contact-channel, .contact-intro'
  );
  animateElements.forEach(el => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(24px)';
    el.style.transition = 'all 0.8s cubic-bezier(0.4, 0, 0.2, 1)';
    observer.observe(el);
  });

  // ==================== Now / 停雲 时间入口 ====================

  // 语言切换时自动更新 Now 模块（仅在 Home 页面有 #nowLatestEntry 时生效）
  LanguageManager.subscribe(lang => updateNowModule(lang));
  // init() 时还没有 subscriber，需要手动补偿一次初始调用
  if (document.getElementById('nowLatestEntry')) {
    updateNowModule(LanguageManager.get());
  }

  async function updateNowModule(lang) {
    const linkEl = document.getElementById('nowLatestEntry');
    const dateEl = document.getElementById('nowDate');
    const titleEl = document.getElementById('nowTitle');

    // 如果当前页面没有 Now 模块，直接跳过执行
    if (!linkEl) return;

    const isEnglish = lang === 'en';

    try {
      if (!nowEntriesCache) {
        // entries.json 顶层是 { entries: [...], meta: {...} }，取值要用 data.entries
        const response = await fetch('/journal/data/entries.json');
        if (!response.ok) return;

        const data = await response.json();
        nowEntriesCache = Array.isArray(data.entries) ? data.entries : [];
      }

      if (nowEntriesCache.length === 0) return;

      // Publisher 保证最新文章永远在第一项，直接取 [0]
      const latest = nowEntriesCache[0];
      if (!latest) return;

      // 字段名对应 entries.json 实际结构：file/fileEn 已含 entries/ 前缀，中文标题字段是 title，英文是 titleEn
      const file = isEnglish ? (latest.fileEn || latest.file) : (latest.file || latest.fileEn);
      linkEl.href = `/journal/${file}`;
      dateEl.textContent = latest.date.replace(/-/g, '.');
      titleEl.textContent = isEnglish
        ? (latest.titleEn || latest.title)
        : (latest.title || latest.titleEn);

      // 数据齐全才显示这个区块，避免露出加载中的半成品状态
      const sectionEl = document.getElementById('nowTimeSection');
      if (sectionEl) sectionEl.classList.add('is-ready');
    } catch (e) {
      // 失败 Fallback：整个区块保持隐藏，不露出半成品状态
      console.debug('Now module failed to load, section stays hidden.', e);
    }
  }
});
