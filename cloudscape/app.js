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

  // ================== 伪随机 + 值噪声 + FBM + 扭曲FBM ==================
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

    // curl 幅度再减半（22 → 11），运动极缓慢
    return { x: cx * 11, y: cy * 11 };
  }

  // ================== 全局风场（大尺度流动，curl 的底层） ==================
  const windNoiseA = makeNoise2D(777);
  const windNoiseB = makeNoise2D(888);
  let windTime = 0;
  function sampleAmbientWind(x, y) {
    const t = windTime;
    // 环境风再减半，且去掉恒定向右偏置（避免点击静止时云朝右上角飘）
    // 只保留双向弱扰动（有正有负，平均为零）
    const wx = fbm(windNoiseA, x * 0.0012 + t * 0.02, y * 0.0012, 3, 2, 0.5) * 0.006;
    const wy = fbm(windNoiseB, x * 0.0012, y * 0.0012 + t * 0.015, 3, 2, 0.5) * 0.003;
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
  const MAX_PARTICLES = 1700; // 密度降低 1/3：2600 → 1700

  function spawnParticle(x, y, opts) {
    opts = opts || {};
    // 满了拒绝新增（不 shift，避免最老粒子突然消失造成抖动）
    if (particles.length >= MAX_PARTICLES) return;

    const r = Math.random();
    let style, depth;
    // wisp 58%（更多纤丝牵丝）、layer 34%（中景主体）、puff 8%（少团块）
    if (r < 0.58) { style = 'wisp'; depth = 0.35 + Math.random() * 0.15; }
    else if (r < 0.92) { style = 'layer'; depth = 0.65 + Math.random() * 0.15; }
    else { style = 'puff'; depth = 1.05 + Math.random() * 0.15; }
    style = opts.style || style;
    depth = opts.depth || depth;

    const tex = randTexture(style);

    const baseScale = style === 'puff'
      ? (0.15 + Math.random() * 0.18)
      : style === 'layer'
        ? (0.11 + Math.random() * 0.13)
        : (0.06 + Math.random() * 0.12); // wisp 更细更扁（牵丝感）
    const initScale = baseScale * (0.8 + depth * 0.4);

    const spread = opts.spread !== undefined ? opts.spread : 14;
    const sx = x + (Math.random() - 0.5) * spread;
    const sy = y + (Math.random() - 0.5) * spread;

    // wisp 更扁（0.60 → 0.48），强化牵丝形态
    const squishY = style === 'wisp' ? 0.48 : style === 'layer' ? 0.82 : 0.95;

    // 消失加快 1/3：32-56s → 22-37s（均值 ~30s）
    const lifespan = 22 + Math.random() * 15;

    // 初始速度：继承指针速度（跟随手指），去掉随机发散（减少羽绒飞溅感）
    const initVX = (opts.vx || 0) + (Math.random() - 0.5) * 0.08;
    const initVY = (opts.vy || 0) + (Math.random() - 0.5) * 0.06;

    // 虚实层次：baseAlpha 随机倍率（0.55-1.25），有些粒子天生淡（虚），有些浓（实）
    const alphaMul = 0.55 + Math.random() * 0.7;

    particles.push({
      tex, style, depth,
      x: sx, y: sy,
      vx: initVX, vy: initVY,
      // 翻滚参数
      rot: (Math.random() - 0.5) * 0.25,
      rotSpeed: (Math.random() - 0.5) * 0.0018 * (style === 'wisp' ? 0.3 : 1),
      // 拉伸参数：wisp 全程沿运动方向拉长（牵丝），layer/puff 仅消散期轻拉
      stretchAngle: 0,
      stretchAmount: 0,
      // 尺寸
      initScale,
      curScale: initScale * 0.4,  // 出生时小
      // 生命周期
      life: 0,
      lifespan,
      phase: 'born', // born → active → dissipating → dead
      // 透明度：baseAlpha 乘随机倍率，产生虚实层次（非均匀一团）
      baseAlpha: (style === 'puff'
        ? (depth > 1 ? 0.25 : 0.19)
        : style === 'layer'
          ? 0.18
          : 0.14) * alphaMul,
      alpha: 0,
      squishY,
      // 虚实呼吸：每个粒子独立的慢周期浓淡起伏（避免均匀"团毛"感）
      breathSeed: Math.random() * Math.PI * 2,
      breathFreq: 0.4 + Math.random() * 0.5, // 周期 ~10-15s
      // spawn 时先置 non-zero alpha 标记，避免首帧就被 alpha<0.004 误清理
      _born: true,
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
    // 点击生成 8-13 个（密度降低 1/3），spread 极小（点哪里在哪里）
    const burst = 8 + ((Math.random() * 6) | 0);
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

    // 沉积 Wake 场
    if (dist > 0.5) {
      depositWake(pointerX, pointerY, pointerVX * 0.04, pointerVY * 0.04, 1.0);
    }

    // 对附近已有粒子施加轻柔冲量（跟随手指，不向外发散避免羽绒飞溅）
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
        // 纯跟随手指方向（去掉向外发散，消除飞溅）
        p.vx += pointerVX * 0.045 * falloff * impulseStrength;
        p.vy += pointerVY * 0.045 * falloff * impulseStrength;
      }
    }

    // 沿轨迹生成新粒子（密度降低 1/3：STEP 6→9，每步 3-4 个）
    const densityScale = Math.min(1.1, 0.5 + dist * 0.015);
    spawnAccumulator += dist * densityScale;
    const STEP = 9; // 步长加大 1/3，密度降低
    while (spawnAccumulator >= STEP) {
      spawnAccumulator -= STEP;
      const t = 1 - (spawnAccumulator / STEP);
      const ix = lastPX - dx * t;
      const iy = lastPY - dy * t;
      const n = 3 + ((Math.random() * 2) | 0); // 每步 3-4 个（降低 1/3）
      for (let i = 0; i < n; i++)
        spawnParticle(ix, iy, {
          vx: pointerVX * 0.045, // 继承手指速度，跟随移动
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

    // 按住不放：持续生成新粒子（密度降低 1/3：0.045s → 0.068s 生成 1 个）
    if (isPointerDown) {
      holdTimer += dt;
      if (holdTimer > 0.068) { // 每 ~0.068s 生成 1 个（频率降低 1/3）
        holdTimer = 0;
        spawnParticle(pointerX, pointerY, { spread: 15, vx: pointerVX * 0.03, vy: pointerVY * 0.03 });
      }
    }

    // ===== 粒子更新（纯力积分，无锚点无回弹，无湿痕固化） =====
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life += dt;
      const u = p.life / p.lifespan;

      // 三阶段：born(0~8%) → active(8~55%) → dissipating(55~100%)
      // 注意：phase 仅用于力/尺寸分支，alpha 用全程 smoothstep 无拐点
      if (u < 0.08) p.phase = 'born';
      else if (u < 0.55) p.phase = 'active';
      else p.phase = 'dissipating';

      // === 力积分（全阶段持续受力，无固化阶段） ===
      // 大尺度环境风
      const aw = sampleAmbientWind(p.x, p.y);
      // curl 涡旋（弱翻滚）
      const cl = sampleCurl(p.x, p.y);
      // wake 拖尾场（跟随手指延迟感）
      const wk = sampleWake(p.x, p.y);

      // 力 → 加速度 → 速度
      const curlWeight = p.style === 'wisp' ? 0.25 : p.style === 'layer' ? 0.65 : 1.0;
      const windWeight = p.depth < 0.5 ? 1.3 : 1.0;

      let ax = aw.x * windWeight + cl.x * curlWeight * 0.012 + wk.x * 1.8;
      let ay = aw.y * windWeight + cl.y * curlWeight * 0.012 + wk.y * 1.8;

      // 关键修复：静止粒子力衰减（点击不动时云停在原地聚集，不飘走）
      // 只有 wake 场强（手指滑动过的残影）才让力恢复，保证滑动跟随
      const curVlen = Math.hypot(p.vx, p.vy);
      const wakeMag = Math.hypot(wk.x, wk.y);
      // 静止且无 wake 时，力衰减到 8%（几乎停在原地，只做极弱呼吸）
      const staticFactor = (curVlen < 0.15 && wakeMag < 0.05) ? 0.08 : 1.0;
      ax *= staticFactor;
      ay *= staticFactor;

      // 高阻尼（再提高）：消除抖动，运动更缓慢
      const damping = p.phase === 'dissipating' ? 0.992 : (p.phase === 'born' ? 0.96 : 0.985);
      const dampPerFrame = Math.pow(damping, dtFrames);

      p.vx += ax * dtFrames;
      p.vy += ay * dtFrames;
      p.vx *= dampPerFrame;
      p.vy *= dampPerFrame;

      // 低速度上限（1.6 → 0.8）：运动再减半
      const maxV = 0.8;
      const vlen = Math.hypot(p.vx, p.vy);
      if (vlen > maxV) { p.vx = p.vx / vlen * maxV; p.vy = p.vy / vlen * maxV; }

      // 位置积分
      p.x += p.vx * dtFrames;
      p.y += p.vy * dtFrames;

      // 极慢旋转（柔和翻滚）
      const rotMul = p.phase === 'dissipating' ? 0.7 : 1.0;
      p.rot += p.rotSpeed * dtFrames * rotMul;

      // === 拉伸：wisp 全程沿运动方向拉长（牵丝），layer/puff 仅消散期轻拉 ===
      // 解决"椭圆团毛"问题：wisp 是丝状，应始终被运动拉成牵丝
      if (vlen > 0.08) {
        p.stretchAngle = Math.atan2(p.vy, p.vx);
        if (p.style === 'wisp') {
          // wisp：active 开始就拉伸（0.30），消散期更拉长（0.55），形成牵丝飘带
          const baseStretch = p.phase === 'dissipating' ? 0.55 : 0.30;
          // 拉伸量随速度增强（运动越快丝越长）
          const speedFactor = Math.min(1, vlen / 0.5);
          p.stretchAmount = baseStretch * speedFactor;
        } else if (p.phase === 'dissipating' && vlen > 0.15) {
          // layer/puff 仅消散期轻拉
          const disU = (u - 0.55) / 0.45;
          p.stretchAmount = disU * 0.22;
        } else {
          p.stretchAmount = 0;
        }
      } else {
        // 速度过低：wisp 保持轻微拉伸（维持丝状），其他归零
        p.stretchAmount = p.style === 'wisp' ? 0.12 : 0;
      }

      // 尺寸：全程连续生长（无拐点），born 缓慢生长 → active 极缓聚集 → dissipating 轻微扩散
      if (u < 0.08) {
        // 出生：0.5 → 1.0（smoothstep）
        const t = u / 0.08;
        const s = t * t * (3 - 2 * t);
        p.curScale = p.initScale * (0.5 + 0.5 * s);
      } else if (u < 0.55) {
        // active：1.0 → 1.15（极缓聚集）
        const t = (u - 0.08) / (0.55 - 0.08);
        p.curScale = p.initScale * (1.0 + t * 0.15);
      } else {
        // dissipating：1.15 → 1.7（连续扩散，从 active 末端 1.15 接续）
        const t = (u - 0.55) / 0.45;
        p.curScale = p.initScale * (1.15 + t * 0.55);
      }

      // === alpha：全程 smoothstep 曲线，无恒定段，无拐点（根治气泡破裂感） ===
      // 出生段(0~8%)平滑上升，平台段(8~55%)接近 1 但用极缓弧线过渡（避免 active→dissipating 拐点）
      // 消散段(55~100%)平滑下降到 0
      let lifeAlpha;
      if (u < 0.08) {
        // 出生淡入：smoothstep 0→1
        const t = u / 0.08;
        lifeAlpha = t * t * (3 - 2 * t);
      } else if (u < 0.55) {
        // 平台段：从 1 极缓下降到 0.96（避免恒定 1.0 造成拐点）
        const t = (u - 0.08) / (0.55 - 0.08);
        lifeAlpha = 1.0 - t * 0.04;
      } else {
        // 消散段：从 0.96 平滑下降到 0（smoothstep，与平台段末端连续）
        // 不做任何硬切，让 smoothstep 在 u=1.0 自然归零（remain=0 → lifeAlpha=0）
        const t = (u - 0.55) / 0.45;
        const remain = 1 - t;
        lifeAlpha = 0.96 * remain * remain * (3 - 2 * remain);
      }
      p.alpha = p.baseAlpha * lifeAlpha;
      // 虚实呼吸：active/dissipating 段加入慢周期浓淡起伏（±15%）
      // 解决"一团毛"均匀感：让云团局部有浓有淡，似云有实有虚
      if (p.phase !== 'born') {
        const breath = Math.sin(p.life * p.breathFreq + p.breathSeed) * 0.15;
        p.alpha *= (1 + breath);
      }
      // _born 保护期：直到 born 阶段结束（u>=0.08）才允许 alpha 阈值清理
      // 避免 born 早期 alpha 接近 0 时被误删
      if (p._born && u >= 0.08) p._born = false;

      // 屏幕外软切（超出边界才清理，且只在 alpha 已经很低时清理，避免可见时被剪）
      const offEdge = (p.x < -250 || p.x > viewW + 250 || p.y < -250 || p.y > viewH + 250);
      if (offEdge && p.alpha < 0.02) {
        particles.splice(i, 1);
        continue;
      }
      // 寿命结束彻底清理（u>=1 时 smoothstep 已自然归零，无视觉跳变）
      // 关键修复：清理阈值必须 < 渲染阈值(0.0003)，否则粒子在仍可见时被移除→气泡破裂
      // 现在阈值 0.00005 远低于渲染阈值，粒子先淡出不可见，再被清理
      if (u >= 1.0 || (!p._born && p.alpha < 0.00005)) {
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

    // 先画 dissipating（消散层，最底层，最通透）
    drawLayer('dissipating', particles);
    // 再画 active + born（主体层）
    drawLayer('active', particles);

    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  function drawLayer(mode, list) {
    // 消散层和主体层统一用 screen 混合（通透、云感自然）
    ctx.globalCompositeOperation = 'screen';

    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      // 分层渲染：只画对应 phase 的粒子
      if (mode === 'dissipating' && p.phase !== 'dissipating') continue;
      if (mode === 'active' && p.phase !== 'active' && p.phase !== 'born') continue;

      const a = p.alpha;
      if (a < 0.0003) continue; // 阈值再降，根治可见粒子被跳过造成的气泡破裂感

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
