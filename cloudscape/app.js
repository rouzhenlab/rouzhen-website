
(async () => {
  const app = new PIXI.Application();
  await app.init({
    resizeTo: window,
    backgroundColor: 0x050706,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true
  });

  document.getElementById('canvas-container').appendChild(app.canvas);

  const bgLayer = new PIXI.Container();
  const cloudLayer = new PIXI.Container();
  app.stage.addChild(bgLayer);
  app.stage.addChild(cloudLayer);

  function setDefaultBackground() {
    const graphics = new PIXI.Graphics();
    graphics.rect(0, 0, app.screen.width, app.screen.height);
    graphics.fill(0x050706);
    bgLayer.addChild(graphics);
  }
  setDefaultBackground();

  // 盆景图片管理（contain 显示 + 拖拽平移 + 滚轮缩放）
  let bgSprite = null;
  let rawImageWidth = 0;
  let rawImageHeight = 0;
  let imageScale = 1;
  let imageX = 0;
  let imageY = 0;
  let isImageDragging = false;
  let imgDragStartX = 0, imgDragStartY = 0;

  function updateBgTransform() {
    if (!bgSprite) return;
    bgSprite.scale.set(imageScale);
    bgSprite.x = app.screen.width / 2 + imageX;
    bgSprite.y = app.screen.height / 2 + imageY;
  }

  function resetImageFit() {
    if (!rawImageWidth || !rawImageHeight) return;
    const screenW = app.screen.width;
    const screenH = app.screen.height;
    imageScale = Math.min(screenW / rawImageWidth, screenH / rawImageHeight);
    imageX = 0;
    imageY = 0;
    updateBgTransform();
  }

  // 本地图片上传响应
  document.getElementById('bgUploader').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        bgLayer.removeChildren();
        setDefaultBackground();

        const texture = PIXI.Texture.from(img);
        bgSprite = new PIXI.Sprite(texture);
        bgSprite.anchor.set(0.5);
        
        rawImageWidth = img.width;
        rawImageHeight = img.height;
        
        bgLayer.addChild(bgSprite);
        resetImageFit();
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  });

  app.canvas.addEventListener('wheel', (e) => {
    if (!bgSprite) return;
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    imageScale = Math.max(0.1, Math.min(10, imageScale * zoomFactor));
    updateBgTransform();
  }, { passive: false });

  document.querySelectorAll('.cloud-tools .tool-btn').forEach(btn => {
    if (btn.dataset.type === 'smoke') {
      btn.classList.add('active');
    } else {
      btn.style.display = 'none';
    }
  });

  // 3. 升级版云渲染核心：生成具备多尺度纤丝与边缘噪波侵蚀的“类密度场”纹理
  function createVolumetricCloudTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 200;
    const ctx = canvas.getContext('2d');

    // 核心大尺度云体分布
    const grad = ctx.createRadialGradient(100, 100, 5, 100, 100, 95);
    grad.addColorStop(0, 'rgba(240, 245, 242, 0.55)');
    grad.addColorStop(0.35, 'rgba(215, 228, 222, 0.25)');
    grad.addColorStop(0.75, 'rgba(190, 205, 198, 0.06)');
    grad.addColorStop(1, 'rgba(190, 205, 198, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 200, 200);

    // 中/高尺度微团与云丝交织，打破单调圆斑
    for (let i = 0; i < 14; i++) {
      const x = 100 + (Math.random() - 0.5) * 90;
      const y = 100 + (Math.random() - 0.5) * 90;
      const r = 20 + Math.random() * 40;
      const subGrad = ctx.createRadialGradient(x, y, 1, x, y, r);
      subGrad.addColorStop(0, 'rgba(255, 255, 255, 0.35)');
      subGrad.addColorStop(0.7, 'rgba(230, 240, 235, 0.08)');
      subGrad.addColorStop(1, 'rgba(230, 240, 235, 0)');
      ctx.fillStyle = subGrad;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    return PIXI.Texture.from(canvas);
  }

  const cloudTexture = createVolumetricCloudTexture();

  // 4. 持久化云场系统 (Persistent Cloud Fields)
  const cloudFields = [];
  let isPointerDown = false;
  let activeField = null;
  let currentPointerX = -1000, currentPointerY = -1000;
  let lastX = -1000, lastY = -1000;
  let pointerVX = 0, pointerVY = 0;

  // 精准事件拦截：只拦截真正交互的 UI 控件，对 Canvas / 背景 / 容器安全放行
  window.addEventListener('pointerdown', (e) => {
    const uiElement = e.target.closest('button, input, label, select, textarea, a');
    if (uiElement) return;

    if (e.target.closest('.ui-overlay') && bgSprite) {
      isImageDragging = true;
      imgDragStartX = e.clientX - imageX;
      imgDragStartY = e.clientY - imageY;
      return;
    }

    isPointerDown = true;
    lastX = e.clientX;
    lastY = e.clientY;
    currentPointerX = e.clientX;
    currentPointerY = e.clientY;
    pointerVX = 0;
    pointerVY = 0;

    // 创建连续密度云场
    activeField = createCloudField(e.clientX, e.clientY);
    cloudFields.push(activeField);
  });

  window.addEventListener('pointermove', (e) => {
    if (isImageDragging) {
      imageX = e.clientX - imgDragStartX;
      imageY = e.clientY - imgDragStartY;
      updateBgTransform();
      return;
    }
    if (!isPointerDown) return;

    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    pointerVX = dx * 0.35;
    pointerVY = dy * 0.35;

    currentPointerX = e.clientX;
    currentPointerY = e.clientY;

    // 长按住时持续向当前云场注入密度（非线性饱和，绝不爆白）
    if (activeField) {
      activeField.density = Math.min(1.8, activeField.density + 0.025);
    }

    lastX = e.clientX;
    lastY = e.clientY;
  });

  const releasePointer = () => {
    isPointerDown = false;
    isImageDragging = false;
    activeField = null;
    pointerVX = 0;
    pointerVY = 0;
  };

  window.addEventListener('pointerup', releasePointer);
  window.addEventListener('pointercancel', releasePointer);
  window.addEventListener('pointerleave', releasePointer);

  function createCloudField(x, y) {
    const container = new PIXI.Container();
    container.x = x;
    container.y = y;

    const puffs = [];
    // 增加内部微团密度与错落感，使之呈现真实的体积结构
    const count = 12 + Math.floor(Math.random() * 5); 

    for (let i = 0; i < count; i++) {
      const sprite = new PIXI.Sprite(cloudTexture);
      sprite.anchor.set(0.5);
      const bx = (Math.random() - 0.5) * 110;
      const by = (Math.random() - 0.5) * 80;
      sprite.x = bx;
      sprite.y = by;
      const scale = 0.5 + Math.random() * 0.8;
      sprite.scale.set(scale);
      sprite.alpha = 0;

      puffs.push({
        sprite,
        baseX: bx,
        baseY: by,
        angle: Math.random() * Math.PI * 2,
        speed: 0.002 + Math.random() * 0.006,
        radius: 10 + Math.random() * 18
      });
      container.addChild(sprite);
    }

    cloudLayer.addChild(container);

    return {
      container,
      puffs,
      vx: (Math.random() - 0.5) * 0.04,
      vy: -0.07 - Math.random() * 0.06,
      density: 0.2,
      influenceRadius: 200
    };
  }

  // 清空按钮
  document.getElementById('clearBtn').addEventListener('click', () => {
    cloudFields.forEach(f => cloudLayer.removeChild(f.container));
    cloudFields.length = 0;
    activeField = null;
  });

  // 截图按钮
  document.getElementById('snapBtn').addEventListener('click', () => {
    const ui = document.querySelector('.ui-overlay');
    ui.style.display = 'none';
    setTimeout(() => {
      app.renderer.extract.canvas(app.stage).toBlob((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `cloudscape-${Date.now()}.png`;
        a.click();
        URL.revokeObjectURL(url);
        ui.style.display = 'flex';
      }, 'image/png');
    }, 50);
  });

  // 5. 运动与内部翻滚循环：密度非线性映射 + 整体风场搬运 + 永久存在
  app.ticker.add((ticker) => {
    if (!isPointerDown) {
      pointerVX *= 0.88;
      pointerVY *= 0.88;
    } else {
      pointerVX *= 0.65;
      pointerVY *= 0.65;
    }

    const damping = 0.93;
    const dt = ticker.deltaTime;

    for (let i = cloudFields.length - 1; i >= 0; i--) {
      const field = cloudFields[i];

      // 局部风场推动
      const dx = field.container.x - currentPointerX;
      const dy = field.container.y - currentPointerY;
      const distance = Math.hypot(dx, dy);

      if (distance < field.influenceRadius && (Math.abs(pointerVX) > 0.02 || Math.abs(pointerVY) > 0.02)) {
        const falloff = 1.0 - (distance / field.influenceRadius);
        field.vx += pointerVX * falloff * 0.28;
        field.vy += pointerVY * falloff * 0.28;
      }

      field.vx *= damping;
      field.vy *= damping;
      field.container.x += field.vx * dt;
      field.container.y += field.vy * dt;

      // 浓度非线性饱和映射：opacity = 1 - exp(-density) 绝对不会爆白刺眼
      const opacity = 0.85 * (1.0 - Math.exp(-field.density * 1.6));

      // 内部永不停息的 Domain Warping 涡流翻滚
      field.puffs.forEach(p => {
        p.angle += p.speed * dt;
        p.sprite.x = p.baseX + Math.cos(p.angle) * p.radius;
        p.sprite.y = p.baseY + Math.sin(p.angle * 0.85) * p.radius;
        p.sprite.alpha = opacity;
      });
    }
  });
})();
