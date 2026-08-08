(() => {
  'use strict';

  // ==================================================================
  // V0.4 Calm Cloud
  //
  // 调整目标：
  //   1) 不要 30% 湿痕残留固化 → 完整消散
  //   2) 消失时长延长一倍再减半 → 生命周期 32-56s，alpha smoothstep 柔和
  //   3) 不要羽绒飞溅、不要突然抖动 → curl 降幅度 + 高阻尼 + 低速度上限
  //   4) 手指点哪里就在哪里生成 → 小 spread，跟随手指速度
  //   5) 按住移动 → 粒子跟随手指缓慢移动
  //   6) 消除突然消失（抖动真因）：
  //      - alpha 阈值 0.0035 → 0.0006（接近不可见才剪）
  //      - MAX_PARTICLES 满了拒绝新增（不 shift）
  //      - 屏幕外软切（只在 alpha 已经很低时清理）
  //      - 渲染跳过阈值 0.003 → 0.0008
  //      - alpha 曲线末端用 smoothstep
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

  // ================== 伪随机 + 值噪声 + FBM ==================
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

  // ================== Curl 涡旋场（翻滚核心） ==================
  const curlNoiseA = makeNoise2D(1111);
  const curlNoiseB = makeNoise2D(2222);
  let curlTime = 0;

  function sampleCurl(x, y) {
    const eps = 1.5;
    const s = 0.0018;
    const t = curlTime;
    const n1_x = fbm(curlNoiseA, (x + eps) * s, y * s + t * 0.08, 3, 2, 0.5);
    const n1_xm = fbm(curlNoiseA, (x - eps) * s, y * s + t * 0.08, 3, 2, 0.5);
    const n1_y = fbm(curlNoiseA, x * s, (y + eps) * s + t * 0.08, 3, 2, 0.5);
    const n1_ym = fbm(curlNoiseA, x * s, (y - eps) * s + t * 0.08, 3, 2, 0.5);

    const n2_x = fbm(curlNoiseB, (x + eps) * s + 100, y * s - t * 0.06, 3, 2, 0.5);
    const n2_xm = fbm(curlNoiseB, (x - eps) * s + 100, y * s - t * 0.06, 3, 2, 0.5);
    const n2_y = fbm(curlNoiseB, x * s + 100, (y + eps) * s - t * 0.06, 3, 2, 0.5);
    const n2_ym = fbm(curlNoiseB, x * s + 100, (y - eps) * s - t * 0.06, 3, 2, 0.5);

    const cx = (n1_y - n1_ym) / (2 * eps) - (n2_x - n2_xm) / (2 * eps);
    const cy = -(n1_x - n1_xm) / (2 * eps) - (n2_y - n2_ym) / (2 * eps);

    // curl 幅度再减半（45 → 22），运动更缓慢
    return { x: cx * 22, y: cy * 22 };
  }

  // ================== 全局风场（极弱，避免抖动） ==================
  const windNoiseA = makeNoise2D(777);
  const windNoiseB = makeNoise2D(888);
  let windTime = 0;
  function sampleAmbientWind(x, y) {
    const t = windTime;
    // 环境风再减半，运动极缓慢
    const wx = fbm(windNoiseA, x * 0.0012 + t * 0.02, y * 0.0012, 3, 2, 0.5) * 0.012 + 0.002;
    const wy = fbm(windNoiseB, x * 0.0012, y * 0.0012 + t * 0.015, 3, 2, 0.5) * 0.006;
    return { x: wx, y: wy };
  }

  // ================== 云纹理 ==================
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
        else if (style === 'wisp') {
          const qx = fbm(noise, nx * 3 + seed * 0.01, ny * 3 + 3.2, 3, 2, 0.5);
          const qy = fbm(noise, nx * 3 + 5.1, ny * 3 + 1.7, 3, 2, 0.5);
          n = fbm(noise, nx * 5 + qx * 2, ny * 5 + qy * 2, 5, 2, 0.5);
        } else n = fbm(noise, nx * 5.2 + seed * 0.003, ny * 4.0, 6, 2.0, 0.5);

        const dx = (x - cx) / (maxR * 0.95);
        const dy = (y - cy) / (maxR * 0.78);
        const r2 = dx * dx + dy * dy;
        let mask = Math.max(0, 1 - r2);
        mask = Math.pow(mask, style === 'wisp' ? 1.2 : 1.9);
        const edgeNoise = fbm(noise, nx * 10 + seed * 0.02, ny * 10, 3, 2.2, 0.55);
        const edgeErode = Math.max(0, edgeNoise * 1.3 + (r2 > 0.5 ? (r2 - 0.5) * 2.6 : 0));
        mask = Math.max(0, mask - edgeErode * 0.9);
        let dens = (n + 1) * 0.5;
        if (style === 'puff') dens = Math.pow(dens, 2.0) * 1.0;
        else if (style === 'wisp') dens = Math.pow(Math.max(0, dens - 0.32), 1.25) * 1.5;
        else dens = Math.pow(dens, 1.5) * 1.05;
        const alpha = Math.min(1, dens * mask);
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

  // ================== Wake 拖尾风场（延迟跟随感） ==================
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
    const wts = [(1 - tx) * (1 - ty), tx * (1 - ty), (1 - tx) * ty, tx * ty];
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
  canvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  canvas.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

  // ==================================================================
  // 粒子系统 V0.4：无残留 + 长寿命 + 慢速平稳 + 精准生成 + 无突然消失
  // 生命周期：born(0~8%) → active(8~55%) → dissipating(55~100%) → 完整消散
  // ==================================================================
  const particles = [];
  const MAX_PARTICLES = 650;

  function spawnParticle(x, y, opts) {
    opts = opts || {};
    // 满了拒绝新增（不 shift，避免最老粒子突然消失造成抖动）
    if (particles.length >= MAX_PARTICLES) return;

    const r = Math.random();
    let style, depth;
    if (r < 0.40) { style = 'wisp'; depth = 0.35 + Math.random() * 0.15; }
    else if (r < 0.88) { style = 'layer'; depth = 0.65 + Math.random() * 0.15; }
    else { style = 'puff'; depth = 1.05 + Math.random() * 0.15; }
    style = opts.style || style;
    depth = opts.depth || depth;

    const tex = randTexture(style);

    const baseScale = style === 'puff'
      ? (0.15 + Math.random() * 0.18)
      : style === 'layer'
        ? (0.11 + Math.random() * 0.13)
        : (0.09 + Math.random() * 0.11);
    const initScale = baseScale * (0.8 + depth * 0.4);

    // spread 默认小（14），点哪里生成哪里
    const spread = opts.spread !== undefined ? opts.spread : 14;
    const sx = x + (Math.random() - 0.5) * spread;
    const sy = y + (Math.random() - 0.5) * spread;

    const squishY = style === 'wisp' ? 0.60 : style === 'layer' ? 0.82 : 0.95;

    // 生命周期再延长一倍：32-56s（均值 ~44s），消失极缓慢
    const lifespan = 32 + Math.random() * 24;

    // 初始速度：继承指针速度（跟随手指），去掉随机发散（减少羽绒飞溅感）
    const initVX = (opts.vx || 0) + (Math.random() - 0.5) * 0.08;
    const initVY = (opts.vy || 0) + (Math.random() - 0.5) * 0.06;

    particles.push({
      tex, style, depth,
      x: sx, y: sy,
      vx: initVX, vy: initVY,
      // 翻滚参数：旋转幅度/速度减半（消除突然抖动）
      rot: (Math.random() - 0.5) * 0.25,
      rotSpeed: (Math.random() - 0.5) * 0.0018 * (style === 'wisp' ? 0.3 : 1),
      stretchAngle: 0,
      stretchAmount: 0,
      initScale,
      curScale: initScale * 0.5,
      life: 0,
      lifespan,
      phase: 'born', // born → active → dissipating
      // baseAlpha 略提高，因为没有叠加湿痕
      baseAlpha: style === 'puff'
        ? (depth > 1 ? 0.25 : 0.19)
        : style === 'layer'
          ? 0.18
          : 0.14,
      alpha: 0,
      squishY,
      // spawn 时标记，避免首帧被 alpha 阈值误清理
      _born: true,
    });
  }

  // ================== 指针交互 ==================
  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  let isPointerDown = false;
  let pointerX = -9999, pointerY = -9999;
  let lastPX = -9999, lastPY = -9999;
  let pointerVX = 0, pointerVY = 0;
  let spawnAccumulator = 0;
  let holdTimer = 0;

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const pos = getPos(e);

    if (interactionMode === 'drag' && bgImg.naturalWidth > 0) {
      isImageDragging = true;
      imgDragStartX = pos.x - bgX;
      imgDragStartY = pos.y - bgY;
      return;
    }
    isPointerDown = true;
    pointerX = pos.x; pointerY = pos.y;
    lastPX = pointerX; lastPY = pointerY;
    pointerVX = 0; pointerVY = 0;
    spawnAccumulator = 0;
    holdTimer = 0;
    // 点击生成 3-5 个，spread 极小（点哪里在哪里）
    const burst = 3 + ((Math.random() * 3) | 0);
    for (let i = 0; i < burst; i++)
      spawnParticle(pointerX, pointerY, { spread: 18 });
  });

  window.addEventListener('pointermove', (e) => {
    if (isImageDragging) {
      const pos = getPos(e);
      bgX = pos.x - imgDragStartX;
      bgY = pos.y - imgDragStartY;
      return;
    }
    if (!isPointerDown) return;
    const pos = getPos(e);
    const dx = pos.x - lastPX;
    const dy = pos.y - lastPY;
    const dist = Math.hypot(dx, dy);
    pointerVX = pointerVX * 0.55 + dx * 0.45;
    pointerVY = pointerVY * 0.55 + dy * 0.45;
    pointerX = pos.x; pointerY = pos.y;
    lastPX = pointerX; lastPY = pointerY;

    // 沉积 Wake 场（轻柔，避免强冲量导致飞溅）
    if (dist > 0.5) {
      depositWake(pointerX, pointerY, pointerVX * 0.04, pointerVY * 0.04, 1.0);
    }

    // 对附近已有粒子施加轻柔冲量（纯跟随手指方向，不向外发散）
    const impulseR = 90;
    const impulseR2 = impulseR * impulseR;
    const impulseStrength = Math.min(1.6, dist * 0.032);
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const pdx = p.x - pointerX;
      const pdy = p.y - pointerY;
      const pd2 = pdx * pdx + pdy * pdy;
      if (pd2 < impulseR2 && pd2 > 1) {
        const falloff = 1 - Math.sqrt(pd2) / impulseR;
        // 纯跟随手指（去掉向外发散，消除飞溅）
        p.vx += pointerVX * 0.045 * falloff * impulseStrength;
        p.vy += pointerVY * 0.045 * falloff * impulseStrength;
      }
    }

    // 沿轨迹生成新粒子（跟随手指速度，精准生成）
    const densityScale = Math.min(1.1, 0.5 + dist * 0.015);
    spawnAccumulator += dist * densityScale;
    const STEP = 24;
    while (spawnAccumulator >= STEP) {
      spawnAccumulator -= STEP;
      const t = 1 - (spawnAccumulator / STEP);
      const ix = lastPX - dx * t;
      const iy = lastPY - dy * t;
      const n = 1 + ((Math.random() * 2) | 0);
      for (let i = 0; i < n; i++)
        spawnParticle(ix, iy, {
          vx: pointerVX * 0.045, // 高继承手指速度 → 跟随移动
          vy: pointerVY * 0.045,
          spread: 10 + Math.min(15, dist * 0.1),
        });
    }
  });

  const releasePointer = () => {
    isPointerDown = false;
    isImageDragging = false;
    spawnAccumulator = 0;
    holdTimer = 0;
  };
  window.addEventListener('pointerup', releasePointer);
  window.addEventListener('pointercancel', releasePointer);

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

  // ==================================================================
  // 更新 + 渲染
  // ==================================================================
  let lastTs = performance.now();

  function updateAndRender(ts, singleStepDt) {
    const rawDt = singleStepDt !== undefined ? singleStepDt : ((ts - lastTs) / 1000);
    const dt = Math.min(0.05, rawDt > 0 ? rawDt : 1 / 60);
    if (singleStepDt === undefined) lastTs = ts;
    const dtFrames = dt * 60;
    windTime += dt * 1.0;
    curlTime += dt * 0.5;
    stepWake(dtFrames);

    if (!isPointerDown) { pointerVX *= 0.9; pointerVY *= 0.9; }

    // 按住不动：每 0.18s 生成 1 个（慢慢加厚，不突兀）
    if (isPointerDown) {
      holdTimer += dt;
      if (holdTimer > 0.18) {
        holdTimer = 0;
        spawnParticle(pointerX, pointerY, { spread: 15, vx: pointerVX * 0.03, vy: pointerVY * 0.03 });
      }
    }

    // ===== 粒子更新（无锚点、无固化残留、高阻尼、低速度上限） =====
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life += dt;
      const u = p.life / p.lifespan;

      // 三阶段：born(0~8%) → active(8~55%) → dissipating(55~100%)
      if (u < 0.08) p.phase = 'born';
      else if (u < 0.55) p.phase = 'active';
      else p.phase = 'dissipating';

      // 全阶段受力（无固化阶段，粒子永远缓慢运动）
      const aw = sampleAmbientWind(p.x, p.y);
      const cl = sampleCurl(p.x, p.y);
      const wk = sampleWake(p.x, p.y);

      const curlWeight = p.style === 'wisp' ? 0.25 : p.style === 'layer' ? 0.65 : 1.0;
      const windWeight = p.depth < 0.5 ? 1.3 : 1.0;

      let ax = aw.x * windWeight + cl.x * curlWeight * 0.012 + wk.x * 1.8;
      let ay = aw.y * windWeight + cl.y * curlWeight * 0.012 + wk.y * 1.8;

      // 高阻尼（再提高）：消除抖动，运动更缓慢
      const damping = p.phase === 'dissipating' ? 0.988 : (p.phase === 'born' ? 0.95 : 0.978);
      const dampPerFrame = Math.pow(damping, dtFrames);

      p.vx += ax * dtFrames;
      p.vy += ay * dtFrames;
      p.vx *= dampPerFrame;
      p.vy *= dampPerFrame;

      // 低速度上限（3.2 → 1.6）：运动减半
      const maxV = 1.6;
      const vlen = Math.hypot(p.vx, p.vy);
      if (vlen > maxV) { p.vx = p.vx / vlen * maxV; p.vy = p.vy / vlen * maxV; }

      p.x += p.vx * dtFrames;
      p.y += p.vy * dtFrames;

      // 极慢旋转（柔和翻滚）
      const rotMul = p.phase === 'dissipating' ? 0.7 : 1.0;
      p.rot += p.rotSpeed * dtFrames * rotMul;

      // 消散期极微弱拉伸（轻柔）
      if (p.phase === 'dissipating' && vlen > 0.15) {
        p.stretchAngle = Math.atan2(p.vy, p.vx);
        const disU = (u - 0.55) / 0.45;
        p.stretchAmount = disU * 0.22; // 最多拉伸 22%
      }

      // 尺寸：出生缓慢生长 + 消散轻微扩散 + active 极慢聚集
      if (p.phase === 'born') {
        const growU = u / 0.08;
        p.curScale = p.initScale * (0.5 + 0.5 * growU);
      } else if (p.phase === 'dissipating') {
        const disU = (u - 0.55) / 0.45;
        p.curScale = p.initScale * (1.0 + disU * 0.55);
      } else {
        const actU = (u - 0.08) / (0.55 - 0.08);
        p.curScale = p.initScale * (1.0 + actU * 0.15);
      }

      // === alpha：完整消散曲线（无残留），smoothstep 末端柔和 ===
      let lifeAlpha;
      if (p.phase === 'born') {
        lifeAlpha = Math.pow(u / 0.08, 1.15);
      } else if (p.phase === 'active') {
        lifeAlpha = 1.0;
      } else {
        // 缓慢完整消散：1 → 0，smoothstep 让尾部柔和（避免突然消失的抖动感）
        const disU = (u - 0.55) / 0.45;
        const t = Math.max(0, 1 - disU);
        lifeAlpha = t * t * (3 - 2 * t); // smoothstep
      }
      p.alpha = p.baseAlpha * lifeAlpha;
      if (p._born && p.life > 0.05) p._born = false;

      // 屏幕外软切（超出边界才清理，且只在 alpha 已经很低时清理，避免可见时被剪）
      const offEdge = (p.x < -250 || p.x > viewW + 250 || p.y < -250 || p.y > viewH + 250);
      if (offEdge && p.alpha < 0.02) {
        particles.splice(i, 1);
        continue;
      }
      // 寿命结束彻底清理（u>=1 时 smoothstep 已归零，无视觉跳变）
      // alpha 阈值降到 0.0006（远低于可见度，避免可见时被剪造成抖动）
      if (u >= 1.0 || (!p._born && p.alpha < 0.0006)) {
        particles.splice(i, 1);
      }
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

    // 先画 dissipating（底层、通透）再画 active + born（主体层）
    drawLayer('dissipating', particles);
    drawLayer('active', particles);

    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  function drawLayer(mode, list) {
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (mode === 'dissipating' && p.phase !== 'dissipating') continue;
      if (mode === 'active' && p.phase !== 'active' && p.phase !== 'born') continue;

      const a = p.alpha;
      if (a < 0.0008) continue; // 阈值降到接近不可见，避免可见粒子被跳过造成抖动

      const tw = p.tex.width * p.curScale;
      const th = p.tex.height * p.curScale * p.squishY;

      ctx.save();
      ctx.translate(p.x, p.y);
      if (p.stretchAmount > 0.01) {
        ctx.rotate(p.stretchAngle);
        ctx.scale(1 + p.stretchAmount, 1 - p.stretchAmount * 0.3);
      } else {
        ctx.rotate(p.rot);
      }
      ctx.globalAlpha = a;
      ctx.drawImage(p.tex, -tw / 2, -th / 2, tw, th);
      ctx.restore();
    }
  }

  window.__dbg = { particles, canvas, getPos, sampleCurl, sampleAmbientWind };

  // —— 启动 ——
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
