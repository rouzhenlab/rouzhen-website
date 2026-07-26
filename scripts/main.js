document.addEventListener('DOMContentLoaded', () => {
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
  (async () => {
    const linkEl = document.getElementById('nowLatestEntry');
    const dateEl = document.getElementById('nowDate');
    const titleEl = document.getElementById('nowTitle');
    const projectEl = document.getElementById('nowProjectName');

    // 如果当前页面没有 Now 模块，直接跳过执行
    if (!linkEl) return;

    // 1. 同步检测主页现有的中英文切换机制（依据根节点 lang 属性）
    const htmlLang = document.documentElement.lang || navigator.language || 'zh';
    const isEnglish = htmlLang.toLowerCase().startsWith('en');

    if (isEnglish && projectEl) {
      projectEl.textContent = 'Ting Yun';
    }

    try {
      // 2. 使用绝对路径读取 Publisher 维护的 entries.json
      const response = await fetch('/journal/data/entries.json');
      if (!response.ok) return;

      const entries = await response.json();
      if (!Array.isArray(entries) || entries.length === 0) return;

      // 3. Publisher 保证最新文章永远在第一项，直接取 entries[0]
      const latest = entries[0];

      if (latest) {
        linkEl.href = `/journal/entries/${latest.slug}.html`;
        dateEl.textContent = latest.date.replace(/-/g, '.');

        // 4. 根据当前语言环境自动匹配对应标题字段
        if (isEnglish) {
          titleEl.textContent = latest.title_en || latest.title_zh || latest.title;
        } else {
          titleEl.textContent = latest.title_zh || latest.title || latest.title_en;
        }
      }
    } catch (e) {
      // 5. 失败 Fallback：保持默认 href="/journal/" 指向 Journal 首页
      console.debug('Now module fallback to Journal index.');
    }
  })();
});
