(() => {
  'use strict';

  // ==================================================================
  // V0.2 Motion Rewrite
  //
  // 核心理念：让云失去锚点。
  //   云来了 → 云经过 → 云翻滚 → 云散开 → 只留很淡的湿痕 → 下一团再经过
  //
  // 与 V0.1 的根本区别：
  //   1) 删除 anchorX/Y + spring + maxDrift + densityLevel
  //      粒子不再问"我该回到哪里"，只问"此刻我受到什么力"
  //   2) 纯力积分：风 → curl涡旋 → 指针冲量 → 加速度 → 速度 → 位置
  //   3) curl 噪声涡旋场：粒子同时前进+上升+横向拉伸+局部旋转+卷曲
  //   4) 生命周期 8-14s：出生淡入 → 稳定翻滚 → 消散拉长 → 留 30% 湿痕底
  //   5) 30% 不是死粒子残骸，是云场底密度（淡湿痕），新云从上面经过叠加
  //   6) 指针 = 冲量扰动（不是原地加厚），划过带走已有粒子
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
  // 用两层 FBM 的梯度差分构造旋转向量场
  // 粒子在 curl 场中会自然产生涡旋、卷曲、拉伸运动
  const curlNoiseA = makeNoise2D(1111);
  const curlNoiseB = makeNoise2D(2222);
  let curlTime = 0;

  function sampleCurl(x, y) {
    const eps = 1.5;
    const s = 0.0018;
    const t = curlTime;
    // 两个独立标量场的梯度，交叉构成旋转向量
    const n1_x = fbm(curlNoiseA, (x + eps) * s, y * s + t * 0.08, 3, 2, 0.5);
    const n1_xm = fbm(curlNoiseA, (x - eps) * s, y * s + t * 0.08, 3, 2, 0.5);
    const n1_y = fbm(curlNoiseA, x * s, (y + eps) * s + t * 0.08, 3, 2, 0.5);
    const n1_ym = fbm(curlNoiseA, x * s, (y - eps) * s + t * 0.08, 3, 2, 0.5);

    const n2_x = fbm(curlNoiseB, (x + eps) * s + 100, y * s - t * 0.06, 3, 2, 0.5);
    const n2_xm = fbm(curlNoiseB, (x - eps) * s + 100, y * s - t * 0.06, 3, 2, 0.5);
    const n2_y = fbm(curlNoiseB, x * s + 100, (y + eps) * s - t * 0.06, 3, 2, 0.5);
    const n2_ym = fbm(curlNoiseB, x * s + 100, (y - eps) * s - t * 0.06, 3, 2, 0.5);

    // curl = (dN1/dy, -dN1/dx) + (dN2/dy, -dN2/dx) 的变体
    // 交叉构造旋转感
    const cx = (n1_y - n1_ym) / (2 * eps) - (n2_x - n2_xm) / (2 * eps);
    const cy = -(n1_x - n1_xm) / (2 * eps) - (n2_y - n2_ym) / (2 * eps);

    return { x: cx * 120, y: cy * 120 };
  }

  // ================== 全局风场（大尺度流动，curl 的底层） ==================
  const windNoiseA = makeNoise2D(777);
  const windNoiseB = makeNoise2D(888);
  let windTime = 0;
  function sampleAmbientWind(x, y) {
    const t = windTime;
    // 横向缓慢向右（云"经过"），垂直双向弱扰动（翻滚而不整体飞出屏幕顶部）
    const wx = fbm(windNoiseA, x * 0.0012 + t * 0.02, y * 0.0012, 3, 2, 0.5) * 0.06 + 0.008;
    const wy = fbm(windNoiseB, x * 0.0012, y * 0.0012 + t * 0.015, 3, 2, 0.5) * 0.025;
    return { x: wx, y: wy };
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
        // 边缘腐蚀加强 ×1.25（去蛋花颗粒感）
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

  // ================== Wake 拖尾风场（网格版，不上 ping-pong） ==================
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
  // 粒子系统 V0.2：纯力积分 + curl 翻滚 + 生命周期 + 30% 湿痕
  //
  // 粒子不再有 anchor，不再回弹。
  // 力来源：ambientWind（大尺度流） + curl（涡旋翻滚） + wake（手指残影） + pointerImpulse（直接冲量）
  //
  // 生命周期（均值 ~10s）:
  //   0~12%   出生淡入：alpha 0→1，scale 0.4→1.0
  //   12~40%  稳定翻滚：alpha=1，curl 主导旋转卷曲
  //   40~85%  消散拉长：alpha 1→0.3，scale 1.0→1.8（扩散），速度阻尼降低（飘走）
  //   85~100% 湿痕沉积：alpha 冻结 0.3，运动几乎停止，只留极淡底密度
  // ==================================================================
  const particles = [];
  const MAX_PARTICLES = 650;

  function spawnParticle(x, y, opts) {
    opts = opts || {};
    if (particles.length >= MAX_PARTICLES) particles.shift();

    const r = Math.random();
    let style, depth;
    // wisp 40%（更多纤丝飘带）、layer 48%（中景主体）、puff 12%（少团块）
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

    const spread = opts.spread !== undefined ? opts.spread : 22;
    const sx = x + (Math.random() - 0.5) * spread;
    const sy = y + (Math.random() - 0.5) * spread;

    const squishY = style === 'wisp' ? 0.52 : style === 'layer' ? 0.78 : 0.92;

    // 生命周期 8-14s（均值 ~11s）
    const lifespan = 8 + Math.random() * 6;

    // 初始速度：继承指针速度 + 随机发散
    const initVX = (opts.vx || 0) + (Math.random() - 0.5) * 0.4;
    const initVY = (opts.vy || 0) + (Math.random() - 0.5) * 0.3 - 0.08;

    particles.push({
      tex, style, depth,
      x: sx, y: sy,
      vx: initVX, vy: initVY,
      // 翻滚参数
      rot: (Math.random() - 0.5) * 0.5,
      rotSpeed: (Math.random() - 0.5) * 0.004 * (style === 'wisp' ? 0.3 : 1),
      // 拉伸参数：消散期沿运动方向拉长
      stretchAngle: 0,
      stretchAmount: 0,
      // 尺寸
      initScale,
      curScale: initScale * 0.4,  // 出生时小
      // 生命周期
      life: 0,
      lifespan,
      phase: 'born', // born → active → dissipating → settled
      // 透明度
      baseAlpha: style === 'puff'
        ? (depth > 1 ? 0.22 : 0.16)
        : style === 'layer'
          ? 0.15
          : 0.12,
      alpha: 0,
      squishY,
      // settled 后的微呼吸
      settlePhase: Math.random() * Math.PI * 2,
    });
  }

  // ================== 指针交互：冲量扰动（不是原地加厚） ==================
  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  let isPointerDown = false;
  let pointerX = -9999, pointerY = -9999;
  let lastPX = -9999, lastPY = -9999;
  let pointerVX = 0, pointerVY = 0;
  let spawnAccumulator = 0;
  // 按住持续计时：用于生成少量新粒子（不是一堆蛋蛋）
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
    // 点击小爆发：5-8 个（减量，避免蛋花）
    const burst = 5 + ((Math.random() * 4) | 0);
    for (let i = 0; i < burst; i++)
      spawnParticle(pointerX, pointerY, { spread: 45 });
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

    // 沉积 Wake 场
    if (dist > 0.5) {
      depositWake(pointerX, pointerY, pointerVX * 0.04, pointerVY * 0.04, 1.0);
    }

    // 对附近已有粒子施加冲量（带走云，不是原地加厚）
    const impulseR = 120;
    const impulseR2 = impulseR * impulseR;
    const impulseStrength = Math.min(3, dist * 0.06);
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      if (p.phase === 'settled') continue; // 湿痕不动
      const pdx = p.x - pointerX;
      const pdy = p.y - pointerY;
      const pd2 = pdx * pdx + pdy * pdy;
      if (pd2 < impulseR2 && pd2 > 1) {
        const pd = Math.sqrt(pd2);
        const falloff = 1 - pd / impulseR;
        // 冲量 = 指针方向 + 向外发散
        p.vx += pointerVX * 0.06 * falloff * impulseStrength;
        p.vy += pointerVY * 0.06 * falloff * impulseStrength;
        // 一点向外推力（扩散感）
        p.vx += (pdx / pd) * 0.15 * falloff * impulseStrength;
        p.vy += (pdy / pd) * 0.15 * falloff * impulseStrength;
      }
    }

    // 沿轨迹生成新粒子（步长拉长，减量）
    const densityScale = Math.min(1.3, 0.6 + dist * 0.02);
    spawnAccumulator += dist * densityScale;
    const STEP = 20;
    while (spawnAccumulator >= STEP) {
      spawnAccumulator -= STEP;
      const t = 1 - (spawnAccumulator / STEP);
      const ix = lastPX - dx * t;
      const iy = lastPY - dy * t;
      const n = 2 + ((Math.random() * 2) | 0);
      for (let i = 0; i < n; i++)
        spawnParticle(ix, iy, { vx: pointerVX * 0.015, vy: pointerVY * 0.015, spread: 20 + dist * 0.2 });
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

    // 按住不放：持续生成少量新粒子（不是一堆，是慢慢补充）
    if (isPointerDown) {
      holdTimer += dt;
      if (holdTimer > 0.12) { // 每 ~0.12s 生成 1-2 个
        holdTimer = 0;
        const n = 1 + ((Math.random() * 2) | 0);
        for (let i = 0; i < n; i++)
          spawnParticle(pointerX, pointerY, { spread: 35 });
      }
    }

    // ===== 粒子更新（纯力积分，无锚点无回弹） =====
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life += dt;
      const u = p.life / p.lifespan;

      // 生命阶段判定
      if (u < 0.12) p.phase = 'born';
      else if (u < 0.40) p.phase = 'active';
      else if (u < 0.85) p.phase = 'dissipating';
      else p.phase = 'settled';

      // === 力积分（settled 跳过，只做微呼吸） ===
      if (p.phase !== 'settled') {
        // 大尺度环境风
        const aw = sampleAmbientWind(p.x, p.y);
        // curl 涡旋（翻滚核心）
        const cl = sampleCurl(p.x, p.y);
        // wake 拖尾场
        const wk = sampleWake(p.x, p.y);

        // 力 → 加速度 → 速度
        // depth 影响受力大小（近景受 curl 影响大，远景受 wind 主导）
        const curlWeight = p.style === 'wisp' ? 0.3 : p.style === 'layer' ? 0.8 : 1.2;
        const windWeight = p.depth < 0.5 ? 1.5 : 1.0;

        let ax = aw.x * windWeight + cl.x * curlWeight * 0.015 + wk.x * 2.5;
        let ay = aw.y * windWeight + cl.y * curlWeight * 0.015 + wk.y * 2.5;

        // 消散期：阻尼降低，让粒子飘得更远（散开）
        const damping = p.phase === 'dissipating' ? 0.965 : (p.phase === 'born' ? 0.88 : 0.93);
        const dampPerFrame = Math.pow(damping, dtFrames);

        p.vx += ax * dtFrames;
        p.vy += ay * dtFrames;
        p.vx *= dampPerFrame;
        p.vy *= dampPerFrame;

        // 速度上限（防止飞太快）
        const maxV = 8;
        const vlen = Math.hypot(p.vx, p.vy);
        if (vlen > maxV) { p.vx = p.vx / vlen * maxV; p.vy = p.vy / vlen * maxV; }

        // 位置积分
        p.x += p.vx * dtFrames;
        p.y += p.vy * dtFrames;

        // 旋转载入消散期加速
        const rotMul = p.phase === 'dissipating' ? 0.5 : 1.0;
        p.rot += p.rotSpeed * dtFrames * rotMul;

        // 消散期：沿运动方向拉伸（云丝拉长感）
        if (p.phase === 'dissipating' && vlen > 0.3) {
          p.stretchAngle = Math.atan2(p.vy, p.vx);
          const dissipateU = (u - 0.40) / 0.45; // 0→1
          p.stretchAmount = dissipateU * 0.4; // 最多拉伸 40%
        }

        // 尺寸：出生生长 + 消散扩散
        if (p.phase === 'born') {
          const growU = u / 0.12;
          p.curScale = p.initScale * (0.4 + 0.6 * growU);
        } else if (p.phase === 'dissipating') {
          const disU = (u - 0.40) / 0.45;
          p.curScale = p.initScale * (1.0 + disU * 0.8); // 扩散到 1.8x
        }
      } else {
        // settled：几乎不动，只做极低频微呼吸
        p.settlePhase += dt * 0.3;
        p.curScale = p.initScale * 1.8 * (1 + Math.sin(p.settlePhase) * 0.03);
        // 速度趋零
        p.vx *= 0.95; p.vy *= 0.95;
        p.x += p.vx * dtFrames * 0.1;
        p.y += p.vy * dtFrames * 0.1;
      }

      // === alpha 生命周期曲线 ===
      let lifeAlpha;
      if (p.phase === 'born') {
        lifeAlpha = Math.pow(u / 0.12, 1.25);
      } else if (p.phase === 'active') {
        lifeAlpha = 1.0;
      } else if (p.phase === 'dissipating') {
        // 1 → 0.3（消失 70%，留 30% 湿痕底）
        const disU = (u - 0.40) / 0.45;
        lifeAlpha = Math.pow(1 - disU, 1.5) * 0.7 + 0.3;
      } else {
        // settled：冻结在 0.3，加微呼吸
        lifeAlpha = 0.3 + Math.sin(p.settlePhase) * 0.02;
      }
      p.alpha = p.baseAlpha * lifeAlpha;

      // 屏幕外清理（给 settled 一个超远距离清理）
      if (p.x < -300 || p.x > viewW + 300 || p.y < -300 || p.y > viewH + 300) {
        particles.splice(i, 1);
      }
      // settled 超长寿命清理（湿痕留底便于叠加，90s 后清除）
      if (p.phase === 'settled' && p.life > p.lifespan + 75) {
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

    // 先画 settled（底密度湿痕，最底层）
    drawLayer('settled', particles);
    // 再画 dissipating（消散中层）
    drawLayer('dissipating', particles);
    // 再画 active + born（主体层）
    drawLayer('active', particles);

    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  function drawLayer(mode, list) {
    // settled 用 screen（湿痕底密度也用 screen，保证可见）
    // dissipating 用 screen（消散层通透）
    // active 用 screen（主体浓）
    ctx.globalCompositeOperation = 'screen';

    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      // 分层渲染：只画对应 phase 的粒子
      if (mode === 'settled' && p.phase !== 'settled') continue;
      if (mode === 'dissipating' && p.phase !== 'dissipating') continue;
      if (mode === 'active' && p.phase !== 'active' && p.phase !== 'born') continue;

      const a = p.alpha;
      if (a < 0.003) continue;

      const tw = p.tex.width * p.curScale;
      const th = p.tex.height * p.curScale * p.squishY;

      ctx.save();
      ctx.translate(p.x, p.y);

      // 消散期拉伸：沿运动方向拉长
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
