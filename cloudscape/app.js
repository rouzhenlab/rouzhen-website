(() => {
  'use strict';

  // ==================================================================
  // Canvas 初始化
  // ==================================================================
  const canvas = document.getElementById('mainCanvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  let viewW = 0, viewH = 0, dpr = 1;

  // 背景图相关（提前声明，避免 resizeCanvas 中的暂时性死区）
  const bgImg = new Image();
  let bgScale = 1, bgX = 0, bgY = 0;
  let isImageDragging = false, imgDragStartX = 0, imgDragStartY = 0;
  let bgFitScale = 1;

  function resetImageFit() {
    if (!bgImg.naturalWidth) return;
    bgFitScale = Math.min(viewW / bgImg.naturalWidth, viewH / bgImg.naturalHeight);
    bgScale = bgFitScale;
    bgX = 0; bgY = 0;
  }

  function resizeCanvas() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    viewW = window.innerWidth;
    viewH = window.innerHeight;
    canvas.width = Math.floor(viewW * dpr);
    canvas.height = Math.floor(viewH * dpr);
    canvas.style.width = viewW + 'px';
    canvas.style.height = viewH + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (bgImg.complete && bgImg.naturalWidth > 0) resetImageFit();
  }
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  window.addEventListener('contextmenu', (e) => e.preventDefault());

  // ==================================================================
  // 伪随机 + 值噪声 + FBM + 扭曲FBM
  // ==================================================================
  function mulberry32(seed) {
    return function () {
      let t = seed += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function makeNoise2D(seed) {
    const rand = mulberry32(seed);
    const size = 256;
    const perm = new Uint8Array(size * 2);
    const grad = new Float32Array(size);
    for (let i = 0; i < size; i++) { perm[i] = i; grad[i] = rand() * 2 - 1; }
    for (let i = size - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = perm[i]; perm[i] = perm[j]; perm[j] = tmp;
    }
    for (let i = 0; i < size; i++) perm[i + size] = perm[i];
    const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
    const lerp = (a, b, t) => a + (b - a) * t;
    return function (x, y) {
      const xi = Math.floor(x) & 255, yi = Math.floor(y) & 255;
      const xf = x - Math.floor(x), yf = y - Math.floor(y);
      const u = fade(xf), v = fade(yf);
      const aa = grad[perm[perm[xi] + yi] & 255];
      const ab = grad[perm[perm[xi] + yi + 1] & 255];
      const ba = grad[perm[perm[xi + 1] + yi] & 255];
      const bb = grad[perm[perm[xi + 1] + yi + 1] & 255];
      return lerp(lerp(aa, ba, u), lerp(ab, bb, u), v);
    };
  }
  function fbm(noise, x, y, octaves, lacunarity, gain) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * noise(x * freq, y * freq);
      norm += amp; amp *= gain; freq *= lacunarity;
    }
    return sum / norm;
  }
  function twistedFBM(noise, x, y, t) {
    const qx = fbm(noise, x + t * 0.03, y + 3.2 + t * 0.02, 3, 2, 0.5);
    const qy = fbm(noise, x + 5.1 - t * 0.025, y + 1.7 + t * 0.018, 3, 2, 0.5);
    return fbm(noise, x + qx * 1.8, y + qy * 1.8, 5, 2, 0.5);
  }

  // ==================================================================
  // 生成云纹理（中式水墨感）
  //   style = 'puff' 团块 'wisp' 纤丝 'layer' 层叠
  // ==================================================================
  function buildCloudTexture(style, seed) {
    const W = 512, H = 512;
    const tc = document.createElement('canvas');
    tc.width = W; tc.height = H;
    const tx = tc.getContext('2d');
    const noise = makeNoise2D(seed);
    const imgData = tx.createImageData(W, H);
    const d = imgData.data;
    const cx = W / 2, cy = H / 2;
    const maxR = Math.min(W, H) / 2;

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const nx = x / W, ny = y / H;
        let n;
        if (style === 'puff') {
          n = fbm(noise, nx * 3.2, ny * 3.2, 4, 2.1, 0.55);
        } else if (style === 'wisp') {
          n = twistedFBM(noise, nx * 4.5, ny * 4.5, seed * 0.01);
        } else {
          n = fbm(noise, nx * 5.0 + seed * 0.003, ny * 3.8, 6, 2.0, 0.5);
        }
        const dx = (x - cx) / (maxR * 0.95);
        const dy = (y - cy) / (maxR * 0.80);
        const r2 = dx * dx + dy * dy;
        let mask = Math.max(0, 1 - r2);
        mask = Math.pow(mask, style === 'wisp' ? 1.1 : 1.6);
        const edgeNoise = fbm(noise, nx * 9 + seed * 0.02, ny * 9, 3, 2.2, 0.55);
        const edgeErode = Math.max(0, edgeNoise * 0.9 + (r2 > 0.55 ? (r2 - 0.55) * 2.4 : 0));
        mask = Math.max(0, mask - edgeErode * 0.8);
        let dens = (n + 1) * 0.5;
        if (style === 'puff') dens = Math.pow(dens, 1.8) * 1.1;
        else if (style === 'wisp') dens = Math.pow(Math.max(0, dens - 0.28), 1.2) * 1.6;
        else dens = Math.pow(dens, 1.4) * 1.2;
        const alpha = Math.min(1, dens * mask);
        // 中式水墨色调：偏青灰
        d[i] = Math.floor(240 + alpha * 14);
        d[i + 1] = Math.floor(244 + alpha * 10);
        d[i + 2] = Math.floor(243 + alpha * 10);
        d[i + 3] = Math.floor(alpha * 255);
      }
    }
    tx.putImageData(imgData, 0, 0);
    return tc;
  }

  const TEXTURE_POOL = {
    puff: [buildCloudTexture('puff', 101), buildCloudTexture('puff', 202), buildCloudTexture('puff', 303)],
    wisp: [buildCloudTexture('wisp', 404), buildCloudTexture('wisp', 505), buildCloudTexture('wisp', 606)],
    layer: [buildCloudTexture('layer', 707), buildCloudTexture('layer', 808), buildCloudTexture('layer', 909)],
  };
  function randTexture(style) {
    const a = TEXTURE_POOL[style];
    return a[(Math.random() * a.length) | 0];
  }

  // ==================================================================
  // 全局风场
  // ==================================================================
  const windNoiseA = makeNoise2D(777);
  const windNoiseB = makeNoise2D(888);
  let windTime = 0;
  function sampleWind(x, y) {
    const t = windTime;
    const wx = twistedFBM(windNoiseA, x * 0.0018 + t * 0.004, y * 0.0018, t) * 0.85;
    const wy = twistedFBM(windNoiseB, x * 0.0018, y * 0.0018 + t * 0.0035, t) * 0.7 - 0.12;
    return { x: wx, y: wy };
  }

  // ==================================================================
  // 背景图片上传
  // ==================================================================
  document.getElementById('bgUploader').addEventListener('change', (e) => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = (ev) => {
      bgImg.onload = () => resetImageFit();
      bgImg.src = ev.target.result;
    };
    r.readAsDataURL(f);
  });

  canvas.addEventListener('wheel', (e) => {
    if (!bgImg.naturalWidth) return;
    e.preventDefault();
    const zf = e.deltaY < 0 ? 1.08 : 0.92;
    bgScale = Math.max(0.1, Math.min(10, bgScale * zf));
  }, { passive: false });

  // ==================================================================
  // 模式切换
  // ==================================================================
  let interactionMode = 'cloud';
  const modeCloudBtn = document.getElementById('modeCloud');
  const modeDragBtn = document.getElementById('modeDrag');
  function setMode(m) {
    interactionMode = m;
    modeCloudBtn.classList.toggle('active', m === 'cloud');
    modeDragBtn.classList.toggle('active', m === 'drag');
  }
  modeCloudBtn.addEventListener('click', () => setMode('cloud'));
  modeDragBtn.addEventListener('click', () => setMode('drag'));

  // ==================================================================
  // 粒子系统
  // ==================================================================
  const particles = [];
  const MAX_PARTICLES = 700;

  function spawnParticle(x, y, opts) {
    opts = opts || {};
    if (particles.length >= MAX_PARTICLES) particles.shift();

    const r = Math.random();
    let style, layer;
    if (r < 0.55) { style = 'puff'; layer = 'soft'; }
    else if (r < 0.82) { style = 'layer'; layer = Math.random() < 0.5 ? 'soft' : 'sharp'; }
    else { style = 'wisp'; layer = 'sharp'; }
    style = opts.style || style;
    layer = opts.layer || layer;

    const tex = randTexture(style);
    const depth = layer === 'soft'
      ? (0.55 + Math.random() * 0.45)
      : (0.95 + Math.random() * 0.55);
    const baseScale = style === 'puff'
      ? (0.45 + Math.random() * 0.55)
      : style === 'layer'
        ? (0.35 + Math.random() * 0.5)
        : (0.25 + Math.random() * 0.45);
    const scale = baseScale * depth;
    const lifeBase = style === 'puff' ? 6.5 : style === 'layer' ? 5.0 : 3.8;
    const lifespan = lifeBase + Math.random() * 2.5;
    const wind = sampleWind(x, y);
    const vx = (opts.vx || 0) + wind.x * 0.6 + (Math.random() - 0.5) * 0.3;
    const vy = (opts.vy || 0) + wind.y * 0.6 + (Math.random() - 0.5) * 0.25 - 0.05;
    const spread = opts.spread !== undefined ? opts.spread : 40;
    const sx = x + (Math.random() - 0.5) * spread;
    const sy = y + (Math.random() - 0.5) * spread;
    const squishY = style === 'wisp' ? 0.55 : 1;

    particles.push({
      tex, style, layer, depth,
      life: 0, lifespan,
      x: sx, y: sy, vx, vy,
      targetScale: scale, curScale: scale * 0.4,
      rot: (Math.random() - 0.5) * 0.6,
      rotSpeed: (Math.random() - 0.5) * 0.003,
      squishY, phase: Math.random() * Math.PI * 2, alpha: 0,
    });
  }

  // ==================================================================
  // 指针交互
  // ==================================================================
  let isPointerDown = false;
  let pointerX = -9999, pointerY = -9999;
  let lastPX = -9999, lastPY = -9999;
  let pointerVX = 0, pointerVY = 0;
  let spawnAccumulator = 0;

  canvas.addEventListener('pointerdown', (e) => {
    if (interactionMode === 'drag' && bgImg.naturalWidth > 0) {
      isImageDragging = true;
      imgDragStartX = e.clientX - bgX;
      imgDragStartY = e.clientY - bgY;
      return;
    }
    isPointerDown = true;
    pointerX = e.clientX; pointerY = e.clientY;
    lastPX = pointerX; lastPY = pointerY;
    pointerVX = 0; pointerVY = 0;
    spawnAccumulator = 0;
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    const burst = 12 + ((Math.random() * 8) | 0);
    for (let i = 0; i < burst; i++) spawnParticle(pointerX, pointerY, { spread: 60 });
  });

  canvas.addEventListener('pointermove', (e) => {
    if (isImageDragging) {
      bgX = e.clientX - imgDragStartX;
      bgY = e.clientY - imgDragStartY;
      return;
    }
    if (!isPointerDown) return;
    const dx = e.clientX - lastPX;
    const dy = e.clientY - lastPY;
    const dist = Math.hypot(dx, dy);
    pointerVX = pointerVX * 0.55 + dx * 0.45;
    pointerVY = pointerVY * 0.55 + dy * 0.45;
    pointerX = e.clientX; pointerY = e.clientY;
    lastPX = pointerX; lastPY = pointerY;
    const densityScale = Math.min(1.8, 0.7 + dist * 0.03);
    spawnAccumulator += dist * densityScale;
    const STEP = 14;
    while (spawnAccumulator >= STEP) {
      spawnAccumulator -= STEP;
      const t = 1 - (spawnAccumulator / STEP);
      const ix = lastPX - dx * t;
      const iy = lastPY - dy * t;
      const n = 3 + ((Math.random() * 5) | 0);
      for (let i = 0; i < n; i++) {
        spawnParticle(ix, iy, { vx: pointerVX * 0.04, vy: pointerVY * 0.04, spread: 30 + dist * 0.3 });
      }
    }
  });

  const releasePointer = (e) => {
    isPointerDown = false;
    isImageDragging = false;
    spawnAccumulator = 0;
    try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
  };
  canvas.addEventListener('pointerup', releasePointer);
  canvas.addEventListener('pointercancel', releasePointer);
  canvas.addEventListener('pointerleave', releasePointer);

  // ==================================================================
  // 清空 & 截图
  // ==================================================================
  document.getElementById('clearBtn').addEventListener('click', () => {
    particles.length = 0;
  });

  document.getElementById('snapBtn').addEventListener('click', async () => {
    const ui = document.querySelector('.ui-overlay');
    ui.style.display = 'none';
    await new Promise(r => setTimeout(r, 80));
    try {
      updateAndRender(performance.now(), 1 / 60);
      canvas.toBlob((blob) => {
        if (!blob) { alert('截图失败'); ui.style.display = 'flex'; return; }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'cloudscape-' + Date.now() + '.png';
        a.click();
        URL.revokeObjectURL(url);
        ui.style.display = 'flex';
      }, 'image/png');
    } catch (err) {
      alert('截图出错：' + err.message);
      ui.style.display = 'flex';
    }
  });

  // ==================================================================
  // 核心逻辑：统一粒子更新 + 渲染
  // ==================================================================
  let lastTs = performance.now();

  function updateAndRender(ts, singleStepDt) {
    const rawDt = singleStepDt !== undefined ? singleStepDt : ((ts - lastTs) / 1000);
    const dt = Math.min(0.05, rawDt > 0 ? rawDt : 1 / 60);
    if (singleStepDt === undefined) lastTs = ts;
    windTime += dt * 1.2;
    if (!isPointerDown) { pointerVX *= 0.9; pointerVY *= 0.9; }

    // 更新粒子
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life += dt;
      const u = Math.min(1, p.life / p.lifespan);
      let lifeCurve;
      if (u < 0.18) lifeCurve = Math.pow(u / 0.18, 1.4);
      else if (u > 0.72) { const o = (u - 0.72) / 0.28; lifeCurve = Math.max(0, 1 - Math.pow(o, 1.7)); }
      else lifeCurve = 1;

      const growT = Math.min(1, p.life / (p.lifespan * 0.85));
      const grow = 1 + growT * (p.style === 'wisp' ? 1.6 : 0.9);
      p.curScale = p.targetScale * grow;

      const wind = sampleWind(p.x, p.y);
      const depthFactor = 0.35 + p.depth * 0.7;
      p.vx += wind.x * 3.2 * dt * depthFactor;
      p.vy += wind.y * 3.2 * dt * depthFactor;
      const damp = Math.pow(0.985, dt * 60);
      p.vx *= damp; p.vy *= damp;
      p.x += p.vx * dt * 60;
      p.y += p.vy * dt * 60;
      p.phase += dt * (p.style === 'wisp' ? 1.4 : 0.8);
      p.rot += p.rotSpeed * dt * 60 + Math.sin(p.phase) * 0.001;
      const baseAlpha = p.layer === 'sharp' ? 0.30 : 0.55;
      p.alpha = baseAlpha * lifeCurve * (0.8 + 0.4 * p.depth);

      if (p.life >= p.lifespan) particles.splice(i, 1);
    }

    // ===== 渲染 =====
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#050706';
    ctx.fillRect(0, 0, viewW, viewH);

    if (bgImg.complete && bgImg.naturalWidth > 0) {
      const cw = bgImg.naturalWidth * bgScale;
      const ch = bgImg.naturalHeight * bgScale;
      ctx.drawImage(bgImg, viewW / 2 + bgX - cw / 2, viewH / 2 + bgY - ch / 2, cw, ch);
    }

    // soft 层（source-over，淡墨晕染）
    ctx.globalCompositeOperation = 'source-over';
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      if (p.layer !== 'soft') continue;
      drawParticle(p);
    }
    // sharp 层（lighter = 加色混合，浓墨通透）
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      if (p.layer !== 'sharp') continue;
      drawParticle(p);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  function drawParticle(p) {
    const tw = p.tex.width * p.curScale;
    const th = p.tex.height * p.curScale * p.squishY;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.globalAlpha = p.alpha;
    ctx.drawImage(p.tex, -tw / 2, -th / 2, tw, th);
    ctx.restore();
  }

  // RAF 主循环
  (function startLoop() {
    lastTs = performance.now();
    function frame(ts) {
      updateAndRender(ts);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  })();
})();
