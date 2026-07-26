document.addEventListener('DOMContentLoaded', () => {
  // 提到最前面：setLanguage() 在页面加载时会立即被调用（见下方语言检测逻辑），
  // 必须确保 updateNowModule 用到的这个变量在那之前就已经完成初始化，
  // 否则 let 声明会因为"暂时性死区"直接报错（Cannot access before initialization）。
  let nowEntriesCache = null;

  const header = document.getElementById('header');
  const navMenu = document.getElementById('navMenu');
  const menuToggle = document.getElementById('menuToggle');
  const navLinks = document.querySelectorAll('.nav-link');
  const langBtns = document.querySelectorAll('.lang-btn');

  function setLanguage(lang) {
    const elements = document.querySelectorAll('[data-en][data-cn]');
    elements.forEach(el => {
      el.textContent = el.getAttribute('data-' + lang);
    });

    const hrefElements = document.querySelectorAll('[data-en-href][data-cn-href]');
    hrefElements.forEach(el => {
      el.setAttribute('href', el.getAttribute('data-' + lang + '-href'));
    });

    langBtns.forEach(btn => {
      if (btn.getAttribute('data-lang') === lang) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    document.body.classList.remove('lang-en', 'lang-cn');
    document.body.classList.add('lang-' + lang);

    try {
      localStorage.setItem('rouzhen-lang', lang);
    } catch (e) {}

    updateNowModule(lang);
  }

  langBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const lang = btn.getAttribute('data-lang');
      setLanguage(lang);
    });
  });

  function detectLanguage() {
    const zhLangCodes = ['zh-CN', 'zh-SG', 'zh', 'zh-Hans'];
    const browserLang = navigator.language || navigator.userLanguage || 'en';
    return zhLangCodes.some(code => browserLang.startsWith(code)) ? 'cn' : 'en';
  }

  // 优先级：页面声明语言 (data-page-lang) > localStorage > 浏览器语言检测
  // 文章页通过 body data-page-lang 声明自身语言，确保跳转后语言状态一致
  try {
    const pageLang = document.body.getAttribute('data-page-lang');
    const savedLang = localStorage.getItem('rouzhen-lang');
    
    if (pageLang) {
      setLanguage(pageLang);
    } else if (savedLang) {
      setLanguage(savedLang);
    } else {
      setLanguage(detectLanguage());
    }
  } catch (e) {
    setLanguage(detectLanguage());
  }

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
  // entries.json 缓存变量已提到文件最前面声明，这里直接用

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
