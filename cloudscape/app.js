(() => {
  'use strict';

  // ==================================================================
  // 剪映云雾借鉴 → 实现要点
  //  1) 方向性扫掠 + 缓出尾迹  → Wake 风场
  //  2) 三层视差 (近=快浓/中稳/远=慢薄) → depth ∈ {0.35, 0.7, 1.1}
  //  3) 混合 = Screen(低alpha, 通透) + Overlay(层次)
  //  4) alpha 指数渐近饱和 → 永远盖不住背景
  // 用户4问题:
  //  A 尺寸大      → baseScale ×0.32, 单云屏占比 <1/10
  //  B 核爆白光    → 去掉 lighter/sharp 层,  maxPerParticleAlpha=0.135
  //  C 云消失      → 删除 lifespan, 粒子永生; anchor + 呼吸微摆动, 不漂远
  //  C' 拖尾滞后   → Wake 场 (网格速度记忆, damping=0.994, 残留2-3s)
  //  D 按住不遮背  → alpha 渐近饱和 + 每粒子上限
  // ==================================================================

  const canvas = document.getElementById('mainCanvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  let viewW = 0, viewH = 0, dpr = 1;

  const bgImg = new Image();
  let bgScale = 1, bgX = 0, bgY = 0;
  let isImageDragging = false, imgDragStartX = 0, imgDragStartY = 0;

  function resetImageFit() {
    if (!bgImg.naturalWidth) return;
    bgScale = Math.min(viewW / bgImg.naturalWidth, viewH / bgImg.naturalHeight);
    bgX = 0; bgY = 0;
  }

  function resizeCanvas() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    viewW = window.innerWidth; viewH = window.innerHeight;
    canvas.width = Math.floor(viewW * dpr);
    canvas.height = Math.floor(viewH * dpr);
    canvas.style.width = viewW + 'px';
    canvas.style.height = viewH + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (bgImg.complete && bgImg.naturalWidth > 0) resetImageFit();
    rebuildWakeGrid();
  }
  window.addEventListener('resize', resizeCanvas);

  window.addEventListener('contextmenu', (e) => e.preventDefault());

  // ================== 伪随机 + 噪声 ==================
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

  // ================== 云纹理（中式水墨：青灰 + 噪声腐蚀 + 偏纤丝） ==================
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
        if (style === 'puff') n = fbm(noise, nx * 3.6, ny * 3.2, 4, 2.1, 0.55);
        else if (style === 'wisp') n = twistedFBM(noise, nx * 4.8, ny * 4.8, seed * 0.01);
        else n = fbm(noise, nx * 5.2 + seed * 0.003, ny * 4.0, 6, 2.0, 0.5);

        const dx = (x - cx) / (maxR * 0.95);
        const dy = (y - cy) / (maxR * 0.78);
        const r2 = dx * dx + dy * dy;
        let mask = Math.max(0, 1 - r2);
        mask = Math.pow(mask, style === 'wisp' ? 1.2 : 1.9);
        const edgeNoise = fbm(noise, nx * 10 + seed * 0.02, ny * 10, 3, 2.2, 0.55);
        const edgeErode = Math.max(0, edgeNoise * 1.05 + (r2 > 0.5 ? (r2 - 0.5) * 2.6 : 0));
        mask = Math.max(0, mask - edgeErode * 0.85);
        let dens = (n + 1) * 0.5;
        if (style === 'puff') dens = Math.pow(dens, 2.0) * 1.0;
        else if (style === 'wisp') dens = Math.pow(Math.max(0, dens - 0.32), 1.25) * 1.5;
        else dens = Math.pow(dens, 1.5) * 1.05;
        const alpha = Math.min(1, dens * mask);
        // 水墨青灰偏冷：R < G ≈ B
        d[i] = Math.floor(236 + alpha * 16);
        d[i + 1] = Math.floor(242 + alpha * 12);
        d[i + 2] = Math.floor(245 + alpha * 10);
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
  function randTexture(style) { return TEXTURE_POOL[style][(Math.random() * TEXTURE_POOL[style].length) | 0]; }

  // ================== 全局风场（轻柔，不主导） ==================
  const windNoiseA = makeNoise2D(777);
  const windNoiseB = makeNoise2D(888);
  let windTime = 0;
  function sampleAmbientWind(x, y) {
    const t = windTime;
    const wx = twistedFBM(windNoiseA, x * 0.0015 + t * 0.0028, y * 0.0015, t) * 0.18;
    const wy = twistedFBM(windNoiseB, x * 0.0015, y * 0.0015 + t * 0.0022, t) * 0.14 - 0.02;
    return { x: wx, y: wy };
  }

  // ================== Wake 拖尾风场（剪映扫掠+滞后延续的核心） ==================
  const WAKE_CELL = 36;
  let wakeCols = 0, wakeRows = 0;
  let wakeVX = null, wakeVY = null, wakeAge = null;

  function rebuildWakeGrid() {
    wakeCols = Math.ceil(viewW / WAKE_CELL) + 2;
    wakeRows = Math.ceil(viewH / WAKE_CELL) + 2;
    wakeVX = new Float32Array(wakeCols * wakeRows);
    wakeVY = new Float32Array(wakeCols * wakeRows);
    wakeAge = new Float32Array(wakeCols * wakeRows);
  }
  function depositWake(x, y, vx, vy, strength) {
    const col = Math.floor(x / WAKE_CELL);
    const row = Math.floor(y / WAKE_CELL);
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const c = col + dc, r = row + dr;
        if (c < 0 || r < 0 || c >= wakeCols || r >= wakeRows) continue;
        const w = 1 - Math.hypot(dc, dr) / 1.8;
        if (w <= 0) continue;
        const idx = r * wakeCols + c;
        wakeVX[idx] = wakeVX[idx] * (1 - w * 0.5) + vx * strength * w;
        wakeVY[idx] = wakeVY[idx] * (1 - w * 0.5) + vy * strength * w;
        if (wakeAge[idx] > 0) wakeAge[idx] = Math.min(wakeAge[idx], 2);
      }
    }
  }
  function sampleWake(x, y) {
    const fx = x / WAKE_CELL, fy = y / WAKE_CELL;
    const c0 = Math.floor(fx), r0 = Math.floor(fy);
    const c1 = c0 + 1, r1 = r0 + 1;
    if (c0 < 0 || r0 < 0 || c1 >= wakeCols || r1 >= wakeRows) return { x: 0, y: 0 };
    const tx = fx - c0, ty = fy - r0;
    let vx = 0, vy = 0, wsum = 0;
    const cells = [[c0, r0], [c1, r0], [c0, r1], [c1, r1]];
    const wts = [[(1 - tx) * (1 - ty)], [tx * (1 - ty)], [(1 - tx) * ty], [tx * ty]];
    for (let k = 0; k < 4; k++) {
      const [cx, ry] = cells[k], wt = wts[k];
      const idx = ry * wakeCols + cx;
      const decay = Math.max(0, 1 - wakeAge[idx] / 180);
      vx += wakeVX[idx] * wt * decay;
      vy += wakeVY[idx] * wt * decay;
      wsum += wt;
    }
    if (wsum === 0) return { x: 0, y: 0 };
    return { x: vx / wsum, y: vy / wsum };
  }
  function stepWake(dtFrames) {
    const decay = Math.pow(0.994, dtFrames);
    for (let i = 0; i < wakeVX.length; i++) {
      wakeVX[i] *= decay;
      wakeVY[i] *= decay;
      wakeAge[i] += dtFrames;
    }
  }

  // ================== 模式切换 ==================
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

  // ================== 上传 / 滚轮缩放 ==================
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

  // ================== 粒子系统（永生 + anchor + 呼吸摆动 + Wake 场位移） ==================
  const particles = [];
  const MAX_PARTICLES = 600;

  function spawnParticle(x, y, opts) {
    opts = opts || {};
    if (particles.length >= MAX_PARTICLES) particles.shift();

    const r = Math.random();
    let style, depth;
    // 三层深度视差 (剪映 sweep 感)
    if (r < 0.28) { style = 'wisp'; depth = 0.35 + Math.random() * 0.1; }
    else if (r < 0.78) { style = 'layer'; depth = 0.65 + Math.random() * 0.15; }
    else { style = 'puff'; depth = 1.05 + Math.random() * 0.15; }
    style = opts.style || style;
    depth = opts.depth || depth;

    const tex = randTexture(style);

    // —— 问题A：云尺寸砍到原来 30–38% ——
    const baseScale = style === 'puff'
      ? (0.15 + Math.random() * 0.18)
      : style === 'layer'
        ? (0.11 + Math.random() * 0.13)
        : (0.09 + Math.random() * 0.11);
    const targetScale = baseScale * (0.8 + depth * 0.4);

    const spread = opts.spread !== undefined ? opts.spread : 22;
    const sx = x + (Math.random() - 0.5) * spread;
    const sy = y + (Math.random() - 0.5) * spread;

    const squishY = style === 'wisp' ? 0.52 : style === 'layer' ? 0.78 : 0.92;

    particles.push({
      tex, style, depth,
      anchorX: sx, anchorY: sy,
      x: sx, y: sy,
      driftX: 0, driftY: 0,
      vx: opts.vx || 0, vy: opts.vy || 0,
      targetScale,
      curScale: targetScale * 0.35,
      growT: 0,
      breathAmtX: (style === 'wisp' ? 8 : 4) * (0.7 + Math.random() * 0.6),
      breathAmtY: (style === 'wisp' ? 4 : 2.5) * (0.7 + Math.random() * 0.6),
      breathFreq: 0.35 + Math.random() * 0.55,
      phase: Math.random() * Math.PI * 2,
      phase2: Math.random() * Math.PI * 2,
      rot: (Math.random() - 0.5) * 0.5,
      rotSpeed: (Math.random() - 0.5) * 0.0018,
      squishY,
      baseAlpha: style === 'puff'
        ? (depth > 1 ? 0.085 : 0.06)
        : style === 'layer'
          ? 0.055
          : 0.04,
      alpha: 0,
      densityLevel: 0,
    });
  }

  // ================== 指针交互 + 加厚（渐近饱和） + Wake 沉积 ==================
  let isPointerDown = false;
  let pointerX = -9999, pointerY = -9999;
  let lastPX = -9999, lastPY = -9999;
  let pointerVX = 0, pointerVY = 0;
  let spawnAccumulator = 0;
  const thickenTargets = new Set();

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
    const burst = 7 + ((Math.random() * 6) | 0);
    for (let i = 0; i < burst; i++)
      spawnParticle(pointerX, pointerY, { spread: 52 });
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

    if (dist > 0.5) {
      depositWake(pointerX, pointerY, pointerVX * 0.035, pointerVY * 0.035, 1.0);
    }

    const densityScale = Math.min(1.5, 0.65 + dist * 0.022);
    spawnAccumulator += dist * densityScale;
    const STEP = 18;
    while (spawnAccumulator >= STEP) {
      spawnAccumulator -= STEP;
      const t = 1 - (spawnAccumulator / STEP);
      const ix = lastPX - dx * t;
      const iy = lastPY - dy * t;
      const n = 2 + ((Math.random() * 3) | 0);
      for (let i = 0; i < n; i++)
        spawnParticle(ix, iy, { vx: pointerVX * 0.012, vy: pointerVY * 0.012, spread: 22 + dist * 0.22 });
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

  // ================== 清空 & 截图 ==================
  document.getElementById('clearBtn').addEventListener('click', () => { particles.length = 0; });
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

  // ================== 更新 + 渲染 ==================
  let lastTs = performance.now();

  function updateAndRender(ts, singleStepDt) {
    const rawDt = singleStepDt !== undefined ? singleStepDt : ((ts - lastTs) / 1000);
    const dt = Math.min(0.05, rawDt > 0 ? rawDt : 1 / 60);
    if (singleStepDt === undefined) lastTs = ts;
    windTime += dt * 1.1;
    const dtFrames = dt * 60;
    stepWake(dtFrames);

    if (!isPointerDown) { pointerVX *= 0.9; pointerVY *= 0.9; }

    thickenTargets.clear();
    if (isPointerDown) {
      const R2 = 110 * 110;
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        const dx = p.anchorX - pointerX, dy = p.anchorY - pointerY;
        if (dx * dx + dy * dy < R2) thickenTargets.add(i);
      }
    }

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.phase += dt * p.breathFreq;
      p.phase2 += dt * (p.breathFreq * 0.73);
      p.rot += p.rotSpeed * dtFrames;

      p.growT = Math.min(1, p.growT + dt * 1.2);
      p.curScale = p.targetScale * (0.35 + 0.65 * p.growT);

      if (thickenTargets.has(i)) {
        p.densityLevel += (1 - p.densityLevel) * 0.035;
      } else {
        p.densityLevel *= Math.pow(0.999, dtFrames);
      }
      const densBoost = 1 + p.densityLevel * 1.4;
      const maxAlphaPerP = Math.min(0.135, p.baseAlpha * 2.3);
      p.alpha = Math.min(maxAlphaPerP, p.baseAlpha * (0.55 + 0.9 * p.growT) * densBoost);

      const offsX = Math.sin(p.phase) * p.breathAmtX + Math.sin(p.phase2 * 1.37) * p.breathAmtX * 0.35;
      const offsY = Math.cos(p.phase * 0.83) * p.breathAmtY + Math.sin(p.phase2 * 1.1) * p.breathAmtY * 0.3;

      const wk = sampleWake(p.x, p.y);
      const aw = sampleAmbientWind(p.x, p.y);
      p.vx += (wk.x * 2.2 + aw.x * 0.25) * dtFrames;
      p.vy += (wk.y * 2.2 + aw.y * 0.25) * dtFrames;
      p.vx += ((p.anchorX - p.x) * 0.004 - p.driftX * 0.03);
      p.vy += ((p.anchorY - p.y) * 0.004 - p.driftY * 0.03);
      const damp = Math.pow(0.90, dtFrames);
      p.vx *= damp; p.vy *= damp;
      p.driftX += p.vx * dtFrames * 0.35;
      p.driftY += p.vy * dtFrames * 0.35;
      const maxDrift = 160;
      const dlen = Math.hypot(p.driftX, p.driftY);
      if (dlen > maxDrift) { p.driftX = p.driftX / dlen * maxDrift; p.driftY = p.driftY / dlen * maxDrift; }

      p.x = p.anchorX + offsX + p.driftX;
      p.y = p.anchorY + offsY + p.driftY;
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

    drawLayer('screen', particles);
    drawLayer('over', particles);

    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  function drawLayer(mode, list) {
    if (mode === 'screen') ctx.globalCompositeOperation = 'screen';
    else ctx.globalCompositeOperation = 'source-over';

    const layerAlpha = mode === 'screen' ? 0.55 : 0.85;

    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (mode === 'screen' && p.style === 'layer' && p.depth < 0.7) continue;
      if (mode === 'over' && p.style === 'wisp' && p.depth < 0.5) continue;

      const a = p.alpha * layerAlpha;
      if (a < 0.003) continue;

      const tw = p.tex.width * p.curScale;
      const th = p.tex.height * p.curScale * p.squishY;

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = a;
      ctx.drawImage(p.tex, -tw / 2, -th / 2, tw, th);
      ctx.restore();
    }
  }

  (function startLoop() {
    resizeCanvas();
    lastTs = performance.now();
    function frame(ts) {
      updateAndRender(ts);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  })();
})();
