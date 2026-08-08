(async () => {
  const app = new PIXI.Application();
  await app.init({
    resizeTo: window,
    backgroundColor: 0x0b0d0c,
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
    graphics.fill(0x0e1210);
    bgLayer.addChild(graphics);
  }
  setDefaultBackground();

  // 盆景图片：严格采用 contain 模式，完整展示、黑色留白、不裁剪不变形
  let bgSprite = null;
  let rawImageWidth = 0;
  let rawImageHeight = 0;

  function updateBgLayout() {
    if (!bgSprite) return;
    const screenW = app.screen.width;
    const screenH = app.screen.height;
    const scale = Math.min(screenW / rawImageWidth, screenH / rawImageHeight);
    bgSprite.scale.set(scale);
    bgSprite.x = screenW / 2;
    bgSprite.y = screenH / 2;
  }

  document.getElementById('bgUploader').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      PIXI.Assets.load(event.target.result).then((texture) => {
        bgLayer.removeChildren();
        bgSprite = new PIXI.Sprite(texture);
        bgSprite.anchor.set(0.5);
        rawImageWidth = texture.width;
        rawImageHeight = texture.height;
        bgLayer.addChild(bgSprite);
        updateBgLayout();
      });
    };
    reader.readAsDataURL(file);
  });

  // 隐藏顶部多余工具按钮（当前聚焦于单一极致的高级云场）
  const toolBtns = document.querySelectorAll('.cloud-tools .tool-btn');
  toolBtns.forEach(btn => {
    if (btn.dataset.type === 'smoke') {
      btn.classList.add('active');
    } else {
      btn.style.display = 'none'; // 暂收起伪分类，聚焦单一云体
    }
  });

  // 生成具有“纤丝感与不规则块状”的复合云纹理
  function createAdvancedCloudTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 160;
    const ctx = canvas.getContext('2d');

    // 多重径向叠加，制造不规则边缘与核心体积
    const grad = ctx.createRadialGradient(80, 80, 10, 80, 80, 80);
    grad.addColorStop(0, 'rgba(240, 243, 240, 0.45)');
    grad.addColorStop(0.4, 'rgba(225, 232, 228, 0.2)');
    grad.addColorStop(0.75, 'rgba(210, 220, 215, 0.05)');
    grad.addColorStop(1, 'rgba(200, 210, 205, 0)');

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 160, 160);

    // 叠加微小纤丝斑驳，打破纯圆死板
    for (let i = 0; i < 12; i++) {
      const x = 80 + (Math.random() - 0.5) * 60;
      const y = 80 + (Math.random() - 0.5) * 60;
      const r = 20 + Math.random() * 30;
      const subGrad = ctx.createRadialGradient(x, y, 2, x, y, r);
      subGrad.addColorStop(0, 'rgba(255, 255, 255, 0.25)');
      subGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = subGrad;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    return PIXI.Texture.from(canvas);
  }

  const cloudTexture = createAdvancedCloudTexture();

  // 云场生态系统状态
  const clouds = [];
  let isPointerDown = false;
  let currentPointerX = 0, currentPointerY = 0;
  let lastX = 0, lastY = 0;
  let pointerVX = 0, pointerVY = 0;
  let spawnAccumulator = 0;

  window.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.ui-overlay')) return;
    isPointerDown = true;
    lastX = e.clientX;
    lastY = e.clientY;
    currentPointerX = e.clientX;
    currentPointerY = e.clientY;
    pointerVX = 0;
    pointerVY = 0;
    spawnAccumulator = 0;

    // 落下瞬间立刻生成一朵基础云团
    spawnCloudCluster(e.clientX, e.clientY);
  });

  window.addEventListener('pointermove', (e) => {
    if (!isPointerDown) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    
    pointerVX = dx * 0.35;
    pointerVY = dy * 0.35;

    currentPointerX = e.clientX;
    currentPointerY = e.clientY;

    // 拖动时随距离持续在当前位置增生云气（越按越浓，越划越长）
    spawnAccumulator += Math.hypot(dx, dy);
    if (spawnAccumulator > 70) {
      spawnCloudCluster(e.clientX, e.clientY);
      spawnAccumulator = 0;
    }

    lastX = e.clientX;
    lastY = e.clientY;
  });

  const releasePointer = () => {
    isPointerDown = false;
    pointerVX = 0;
    pointerVY = 0;
  };

  window.addEventListener('pointerup', releasePointer);
  window.addEventListener('pointercancel', releasePointer);
  window.addEventListener('pointerleave', releasePointer);

  // 核心造云函数：生成一个包含多个内部子微粒（Puff）的复合云团对象
  function spawnCloudCluster(x, y) {
    const clusterContainer = new PIXI.Container();
    clusterContainer.x = x + (Math.random() - 0.5) * 30;
    clusterContainer.y = y + (Math.random() - 0.5) * 30;

    const puffs = [];
    const puffCount = 3 + Math.floor(Math.random() * 3); // 每团包含 3-5 个纤丝小块

    for (let i = 0; i < puffCount; i++) {
      const sprite = new PIXI.Sprite(cloudTexture);
      sprite.anchor.set(0.5);
      const offsetX = (Math.random() - 0.5) * 40;
      const offsetY = (Math.random() - 0.5) * 40;
      sprite.x = offsetX;
      sprite.y = offsetY;
      
      const scale = 0.8 + Math.random() * 0.8;
      sprite.scale.set(scale);
      sprite.alpha = 0; // 初始透明，后续渐显至稳定态
      
      // 内部翻滚专属相异参数
      puffs.push({
        sprite,
        baseOffsetX: offsetX,
        baseOffsetY: offsetY,
        angleOffset: Math.random() * Math.PI * 2,
        internalSpeed: 0.005 + Math.random() * 0.01,
        internalRadius: 5 + Math.random() * 10
      });

      clusterContainer.addChild(sprite);
    }

    cloudLayer.addChild(clusterContainer);

    clouds.push({
      container: clusterContainer,
      puffs,
      vx: (Math.random() - 0.5) * 0.05,
      vy: -0.1 - Math.random() * 0.1, // 整体微微向上浮动
      age: 0,
      targetAlpha: 0.75, // 永久存在的稳态浓度上限
      influenceRadius: 160
    });
  }

  // 清空按钮
  document.getElementById('clearBtn').addEventListener('click', () => {
    clouds.forEach(c => cloudLayer.removeChild(c.container));
    clouds.length = 0;
  });

  // 截屏留影
  document.getElementById('snapBtn').addEventListener('click', () => {
    const ui = document.querySelector('.ui-overlay');
    ui.style.display = 'none';
    setTimeout(() => {
      app.renderer.extract.canvas(app.stage).toBlob((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `cloudscape-v0.2-${Date.now()}.png`;
        a.click();
        URL.revokeObjectURL(url);
        ui.style.display = 'flex';
      }, 'image/png');
    }, 50);
  });

  // 物理与动态渲染循环：永久存在、风场推动、内部翻滚
  app.ticker.add((ticker) => {
    // 惯性风衰减
    if (!isPointerDown) {
      pointerVX *= 0.88;
      pointerVY *= 0.88;
    } else {
      pointerVX *= 0.65;
      pointerVY *= 0.65;
    }

    const damping = 0.93;
    const dt = ticker.deltaTime;

    for (let i = clouds.length - 1; i >= 0; i--) {
      const c = clouds[i];

      // 1. 距离指针风场交互
      const dx = c.container.x - currentPointerX;
      const dy = c.container.y - currentPointerY;
      const distance = Math.hypot(dx, dy);

      if (distance < c.influenceRadius && (Math.abs(pointerVX) > 0.02 || Math.abs(pointerVY) > 0.02)) {
        const falloff = 1.0 - (distance / c.influenceRadius);
        c.vx += pointerVX * falloff * 0.3;
        c.vy += pointerVY * falloff * 0.3;
      }

      // 2. 整体位移与阻尼
      c.vx *= damping;
      c.vy *= damping;
      c.container.x += c.vx * dt;
      c.container.y += c.vy * dt;

      // 3. 永久存在与淡入机制（无消散，达到目标浓度后恒定保持）
      c.age++;
      const fadeProgress = Math.min(1.0, c.age / 90); // 1.5秒平滑淡入到场
      
      // 4. 内部翻滚：子雾团在主容器内进行独立的细腻涡流运动
      c.puffs.forEach(p => {
        p.angleOffset += p.internalSpeed * dt;
        p.sprite.x = p.baseOffsetX + Math.cos(p.angleOffset) * p.internalRadius;
        p.sprite.y = p.baseOffsetY + Math.sin(p.angleOffset * 0.8) * p.internalRadius;
        p.sprite.alpha = c.targetAlpha * fadeProgress;
      });
    }
  });

  window.addEventListener('resize', () => {
    updateBgLayout();
  });
})();
