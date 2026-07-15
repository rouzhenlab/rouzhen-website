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

  try {
    const savedLang = localStorage.getItem('rouzhen-lang');
    if (savedLang) {
      setLanguage(savedLang);
    } else {
      const detectedLang = detectLanguage();
      setLanguage(detectedLang);
    }
  } catch (e) {
    const detectedLang = detectLanguage();
    setLanguage(detectedLang);
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
});
