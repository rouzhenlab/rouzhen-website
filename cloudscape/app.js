
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

  let bgSprite = null;
  document.getElementById('bgUploader').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      PIXI.Assets.load(event.target.result).then((texture) => {
        bgLayer.removeChildren();
        bgSprite = new PIXI.Sprite(texture);
        bgSprite.anchor.set(0.5);
        bgSprite.x = app.screen.width / 2;
        bgSprite.y = app.screen.height / 2;
        const scale = Math.max(app.screen.width / bgSprite.width, app.screen.height / bgSprite.height);
        bgSprite.scale.set(scale);
        bgLayer.addChild(bgSprite);
      });
    };
    reader.readAsDataURL(file);
  });

  let currentTool = 'smoke'; 
  const clouds = [];
  const MAX_BUDGET = 10;
  const CLOUD_COSTS = { smoke: 1, cloud: 2, mist: 3, sea: 5 };

  function getCurrentBudget() {
    return clouds.reduce((total, c) => total + (CLOUD_COSTS[c.type] || 1), 0);
  }

  document.querySelectorAll('.cloud-tools .tool-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.cloud-tools .tool-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      currentTool = e.target.dataset.type;
    });
  });

  function createCloudTexture(type) {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    if (type === 'smoke') {
      grad.addColorStop(0, 'rgba(240, 242, 239, 0.35)');
      grad.addColorStop(0.5, 'rgba(240, 242, 239, 0.15)');
      grad.addColorStop(1, 'rgba(240, 242, 239, 0)');
    } else if (type === 'cloud') {
      grad.addColorStop(0, 'rgba(255, 255, 255, 0.6)');
      grad.addColorStop(0.6, 'rgba(230, 235, 232, 0.2)');
      grad.addColorStop(1, 'rgba(230, 235, 232, 0)');
    } else if (type === 'mist') {
      grad.addColorStop(0, 'rgba(210, 220, 215, 0.45)');
      grad.addColorStop(0.5, 'rgba(210, 220, 215, 0.2)');
      grad.addColorStop(1, 'rgba(210, 220, 215, 0)');
    } else {
      grad.addColorStop(0, 'rgba(190, 205, 200, 0.5)');
      grad.addColorStop(0.6, 'rgba(190, 205, 200, 0.2)');
      grad.addColorStop(1, 'rgba(190, 205, 200, 0)');
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    return PIXI.Texture.from(canvas);
  }

  const textures = {
    smoke: createCloudTexture('smoke'),
    cloud: createCloudTexture('cloud'),
    mist: createCloudTexture('mist'),
    sea: createCloudTexture('sea')
  };

  let lastX = 0, lastY = 0;
  let pointerVX = 0, pointerVY = 0;
  let currentPointerX = 0, currentPointerY = 0;
  let isPointerDown = false;
  let distanceSinceLastSpawn = 0;
  const SPAWN_DISTANCE_THRESHOLD = 120;

  window.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.ui-overlay')) return;
    isPointerDown = true;
    lastX = e.clientX;
    lastY = e.clientY;
    currentPointerX = e.clientX;
    currentPointerY = e.clientY;
    pointerVX = 0;
    pointerVY = 0;
    distanceSinceLastSpawn = 0;
    trySpawnCloud(e.clientX, e.clientY, currentTool);
  });

  window.addEventListener('pointermove', (e) => {
    if (!isPointerDown) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    pointerVX = dx * 0.4;
    pointerVY = dy * 0.4;
    currentPointerX = e.clientX;
    currentPointerY = e.clientY;
    distanceSinceLastSpawn += Math.hypot(dx, dy);
    if (distanceSinceLastSpawn >= SPAWN_DISTANCE_THRESHOLD) {
      trySpawnCloud(e.clientX, e.clientY, currentTool);
      distanceSinceLastSpawn = 0;
    }
    lastX = e.clientX;
    lastY = e.clientY;
  });

  // 统一的手势释放与安全重置（涵盖离开、取消、抬起）
  const releasePointer = () => {
    isPointerDown = false;
    pointerVX = 0;
    pointerVY = 0;
  };

  window.addEventListener('pointerup', releasePointer);
  window.addEventListener('pointercancel', releasePointer);
  window.addEventListener('pointerleave', releasePointer);

  function trySpawnCloud(x, y, type) {
    const cost = CLOUD_COSTS[type] || 1;
    if (getCurrentBudget() + cost > MAX_BUDGET) return;

    const sprite = new PIXI.Sprite(textures[type] || textures.smoke);
    sprite.anchor.set(0.5);
    sprite.x = x;
    sprite.y = y;
    
    let scale = 1.0;
    if (type === 'cloud') scale = 1.6;
    if (type === 'mist') scale = 2.2;
    if (type === 'sea') scale = 3.2;
    sprite.scale.set(scale);
    sprite.alpha = 0;

    cloudLayer.addChild(sprite);

    clouds.push({
      sprite,
      type: type,
      vx: (Math.random() - 0.5) * 0.1,
      vy: -0.2 - Math.random() * 0.15,
      life: 0,
      maxLife: 500 + Math.random() * 200,
      influenceRadius: 180
    });
  }

  document.getElementById('clearBtn').addEventListener('click', () => {
    clouds.forEach(c => cloudLayer.removeChild(c.sprite));
    clouds.length = 0;
  });

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

  app.ticker.add(() => {
    if (!isPointerDown) {
      pointerVX *= 0.85;
      pointerVY *= 0.85;
    } else {
      pointerVX *= 0.6;
      pointerVY *= 0.6;
    }

    const damping = 0.94;

    for (let i = clouds.length - 1; i >= 0; i--) {
      const c = clouds[i];
      const dx = c.sprite.x - currentPointerX;
      const dy = c.sprite.y - currentPointerY;
      const distance = Math.hypot(dx, dy);

      if (distance < c.influenceRadius && (Math.abs(pointerVX) > 0.05 || Math.abs(pointerVY) > 0.05)) {
        const falloff = 1.0 - (distance / c.influenceRadius);
        c.vx += pointerVX * falloff * 0.35;
        c.vy += pointerVY * falloff * 0.35;
      }

      c.vx *= damping;
      c.vy *= damping;
      c.sprite.x += c.vx;
      c.sprite.y += c.vy;

      c.life++;
      const progress = c.life / c.maxLife;
      if (progress < 0.1) {
        c.sprite.alpha = (progress / 0.1) * 0.75;
      } else if (progress > 0.8) {
        c.sprite.alpha = ((1.0 - progress) / 0.2) * 0.75;
      }

      if (c.life >= c.maxLife) {
        cloudLayer.removeChild(c.sprite);
        clouds.splice(i, 1);
      }
    }
  });

  window.addEventListener('resize', () => {
    if (bgSprite) {
      bgSprite.x = app.screen.width / 2;
      bgSprite.y = app.screen.height / 2;
    }
  });
})();
