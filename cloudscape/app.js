(() => {
  'use strict';

  // ==================================================================
  // V0.4-beta Physical Semantics Acceptance Build
  //
  // * 物理模型 = V0.4-beta 梯度模型（div + shear）
  //   （不提前加 symmetric strain / rotation 分解；如果验收发现旋转被误当 shear，再针对性修）
  // * releaseSamplingPoint() = 数值预算释放，不是 Cloud Death
  //
  // 本 Build 核心改动：只加自动化验收框架 + 可证伪的 PASS/FAIL 判定器
  // ==================================================================
  // Continuous Cloud Field (Velocity Gradient Dissipation)
  //
  // 物理隐喻（核心）：
  //   点击/划过 = 手指扰动空气 → 局部 Cloud Field 被注入能量
  //   → 形成连续高密度区域
  //   → Curl / Wind / Wake 搬运这个区域（Advection）
  //   → 速度场的空间梯度（散度 ∇·v / 剪切 ∂v/∂x）拉长、撕裂云体
  //   → 密度重新分布、稀释 → 低于可见阈值
  //   → 视觉上"回到空气"
  //
  // Particle 不是"东西"。Particle = Cloud Field 的 Lagrangian 采样点。
  //
  // No Birth · No Death · No Bubble 的真正验收标准：
  //   [时间本身] 不能独立导致"云消失"。
  //   [速度大小] 不能独立导致"云消失"（Advection ≠ Dissipation）。
  //   只有速度场的空间梯度（散度 / 剪切）才能让 density ↓。
  //   → 匀速平移的云可以一直被搬运而不消散。
  //   → 静止的云可以一直存在。
  //   → 只有被剪切/拉伸/膨胀才会稀释。
  //
  // 四组物理语义验收实验（键盘 1-4 切换）：
  //   A 静止云：关闭所有场 → density 应保持不变
  //   B 匀速平移：恒定速度无梯度 → density 应保持不变
  //   C 剪切流场：速度梯度 ≠ 0 → 拉伸 → 变薄 → density ↓
  //   D Wake：手指扰动 → 先改速度场 → 产生梯度 → density ↓
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

  // ================== Curl 涡旋场（翻滚 + 撕裂） ==================
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
    return { x: cx * 11, y: cy * 11 };
  }

  // ================== 全局风场（大尺度流动） ==================
  const windNoiseA = makeNoise2D(777);
  const windNoiseB = makeNoise2D(888);
  let windTime = 0;
  function sampleAmbientWind(x, y) {
    const t = windTime;
    const wx = fbm(windNoiseA, x * 0.0012 + t * 0.02, y * 0.0012, 3, 2, 0.5) * 0.006;
    const wy = fbm(windNoiseB, x * 0.0012, y * 0.0012 + t * 0.015, 3, 2, 0.5) * 0.003;
    return { x: wx, y: wy };
  }

  // ==================================================================
  // 场配置（实验用：可独立开关 / 调节各速度源）
  // ==================================================================
  const defaultFieldConfig = {
    windAmp: 1.0,       // Ambient Wind 振幅
    curlAmp: 1.0,       // Curl 涡旋振幅
    wakeActive: true,   // Wake 拖尾是否生效
    uniformVx: 0,       // 匀速平移（实验 B）
    uniformVy: 0,
    shearVyKx: 0,       // 剪切流场 vy = k*(x - cx)（实验 C）
    shearVxKy: 0,       // 剪切流场 vx = k*(y - cy)（实验 C 变体）
  };
  let fieldConfig = { ...defaultFieldConfig };

  // ==================================================================
  // sampleTotalVelocity(x, y, sizeFactor, depth)
  //
  // 合成所有速度源 → 返回该位置的 Cloud Field 速度。
  // 这是 advection 的驱动力。
  //
  // 关键：这个函数本身不消耗 density。
  //   匀速场（uniformVx）的梯度 = 0 → 不产生 dissipation。
  //   只有 Wind / Curl / Wake / Shear 等空间变化的场才有梯度。
  // ==================================================================
  function sampleTotalVelocity(x, y, sizeFactor, depth) {
    let vx = fieldConfig.uniformVx;
    let vy = fieldConfig.uniformVy;

    // 剪切流场（实验 C）
    if (fieldConfig.shearVyKx !== 0) {
      vy += (x - viewW * 0.5) * fieldConfig.shearVyKx;
    }
    if (fieldConfig.shearVxKy !== 0) {
      vx += (y - viewH * 0.5) * fieldConfig.shearVxKy;
    }

    // Ambient Wind
    if (fieldConfig.windAmp > 0) {
      const aw = sampleAmbientWind(x, y);
      const windWeight = depth < 0.5 ? 1.32 : 1.0;
      vx += aw.x * windWeight * fieldConfig.windAmp;
      vy += aw.y * windWeight * fieldConfig.windAmp;
    }

    // Curl 涡旋
    if (fieldConfig.curlAmp > 0) {
      const cl = sampleCurl(x, y);
      const curlWeight = 0.22 + sizeFactor * 0.78;
      vx += cl.x * curlWeight * 0.012 * fieldConfig.curlAmp;
      vy += cl.y * curlWeight * 0.012 * fieldConfig.curlAmp;
    }

    // Wake 拖尾
    if (fieldConfig.wakeActive) {
      const wk = sampleWake(x, y);
      vx += wk.x * 1.8;
      vy += wk.y * 1.8;
    }

    return { vx, vy };
  }

  // ==================================================================
  // sampleVelocityGradient(x, y, sizeFactor, depth)
  //
  // 用前向差分计算局部速度场梯度：
  //   divergence = ∂vx/∂x + ∂vy/∂y   （正=膨胀→稀释；负=压缩→增浓）
  //   shear      = |∂vx/∂y| + |∂vy/∂x| （剪切→撕裂→混合→稀释）
  //
  // 匀速平移（uniform field）→ gradient = 0 → 不消散 ✓
  // 静止 → gradient = 0 → 不消散 ✓
  // 剪切流场 → shear > 0 → 消散 ✓
  // 膨胀流场 → div > 0 → 消散 ✓
  //
  // 性能：3 次 sampleTotalVelocity 调用（中心 + x+eps + y+eps）
  // ==================================================================
  const GRAD_EPS = 12; // 空间差分步长（像素）
  function sampleVelocityGradient(x, y, sizeFactor, depth) {
    const c  = sampleTotalVelocity(x,            y,            sizeFactor, depth);
    const xp = sampleTotalVelocity(x + GRAD_EPS, y,            sizeFactor, depth);
    const yp = sampleTotalVelocity(x,            y + GRAD_EPS, sizeFactor, depth);

    const dvxdx = (xp.vx - c.vx) / GRAD_EPS;
    const dvydy = (yp.vy - c.vy) / GRAD_EPS;
    const dvxdy = (yp.vx - c.vx) / GRAD_EPS;
    const dvydx = (xp.vy - c.vy) / GRAD_EPS;

    const divergence = dvxdx + dvydy;
    const shear = Math.abs(dvxdy) + Math.abs(dvydx);

    return { vx: c.vx, vy: c.vy, divergence, shear };
  }

  // ==================================================================
  // 密度核纹理（2 张中性核，云形由 scale/squish/stretch 涌现）
  // ==================================================================
  function buildDensityKernel(seed) {
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
        const qx = fbm(noise, nx * 2.8 + seed * 0.01, ny * 2.8 + 3.2, 3, 2, 0.5);
        const qy = fbm(noise, nx * 2.8 + 5.1, ny * 2.8 + 1.7, 3, 2, 0.5);
        const n = fbm(noise, nx * 5 + qx * 1.5, ny * 4.6 + qy * 1.5, 5, 2, 0.5);

        const dx = (x - cx) / (maxR * 0.93);
        const dy = (y - cy) / (maxR * 0.86);
        const r2 = dx * dx + dy * dy;
        let mask = Math.max(0, 1 - r2);
        mask = Math.pow(mask, 1.6);
        const edgeNoise = fbm(noise, nx * 10 + seed * 0.02, ny * 10, 3, 2.2, 0.55);
        const edgeErode = Math.max(0, edgeNoise * 1.3 + (r2 > 0.5 ? (r2 - 0.5) * 2.6 : 0));
        mask = Math.max(0, mask - edgeErode * 0.9);
        let dens = (n + 1) * 0.5;
        dens = Math.pow(Math.max(0.02, dens), 1.55) * 1.02;
        const alpha = Math.min(1, dens * mask);
        d[i] = Math.floor(237 + alpha * 15);
        d[i + 1] = Math.floor(242 + alpha * 12);
        d[i + 2] = Math.floor(245 + alpha * 10);
        d[i + 3] = Math.floor(alpha * 255);
      }
    }
    tx.putImageData(imgData, 0, 0);
    return tc;
  }
  const DENSITY_KERNEL_A = buildDensityKernel(1234);
  const DENSITY_KERNEL_B = buildDensityKernel(5678);

  // ================== Wake 拖尾风场（网格版） ==================
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
  // Cloud Field 的 Lagrangian 采样点数组
  // ==================================================================
  const samplingPoints = [];
  const MAX_SAMPLING_POINTS = 1200;

  // ==================================================================
  // releaseSamplingPoint(idx)
  //
  // 语义：Cloud Field 不消失，只是该采样点已经低于数值/视觉分辨率，
  //       因此释放计算预算。不是"云死亡"。
  // ==================================================================
  function releaseSamplingPoint(idx) {
    samplingPoints.splice(idx, 1);
  }

  // ==================================================================
  // injectCloudEvent(x, y, opts)
  //
  // 语义：向 Cloud Field 在 (x,y) 周围注入一次局部扰动。
  //       不是"生成一堆粒子"，而是"在这片区域里提高空气场的云密度"。
  // ==================================================================
  function injectCloudEvent(x, y, opts) {
    opts = opts || {};
    if (samplingPoints.length >= MAX_SAMPLING_POINTS) return;

    const slots = MAX_SAMPLING_POINTS - samplingPoints.length;
    const wantCount = Math.min(slots, opts.count || (11 + ((Math.random() * 8) | 0)));
    if (wantCount <= 0) return;

    const clusterRadius = opts.spread !== undefined ? opts.spread : 26;
    const clusterVX = opts.vx || 0;
    const clusterVY = opts.vy || 0;
    const uniformVel = opts.uniformVelocity || false;
    const scaleBias = opts.scaleBias || 1.0;

    for (let i = 0; i < wantCount; i++) {
      let gx = 0, gy = 0;
      for (let k = 0; k < 2; k++) {
        const u1 = Math.random() || 1e-9;
        const u2 = Math.random();
        const r = Math.sqrt(-2 * Math.log(u1));
        const theta = 2 * Math.PI * u2;
        gx += r * Math.cos(theta);
        gy += r * Math.sin(theta);
      }
      gx *= 0.5; gy *= 0.5;

      const sx = x + gx * clusterRadius;
      const sy = y + gy * clusterRadius;

      const distNorm = Math.min(1, Math.hypot(gx, gy) / 2.2);
      const gaussianEnvelope = Math.max(0.25, 1 - distNorm * distNorm);

      const u1s = Math.random() || 1e-9;
      const u2s = Math.random();
      const logScaleSample = Math.sqrt(-2 * Math.log(u1s)) * Math.cos(2 * Math.PI * u2s);
      const rawScale = Math.exp(-2.25 + Math.log(scaleBias) + logScaleSample * 0.42);
      const kernelScale = Math.max(0.038, Math.min(0.33, rawScale));

      const sizeFactor = Math.min(1, Math.max(0, (kernelScale - 0.05) / 0.22));
      const squishBase = 0.45 + sizeFactor * 0.47;
      const squishJitter = (Math.random() - 0.5) * 0.14;
      const squishY = Math.max(0.42, Math.min(1.0, squishBase + squishJitter));

      const depth = 0.4 + Math.random() * 0.8;
      const kernelTex = (i & 1) ? DENSITY_KERNEL_A : DENSITY_KERNEL_B;

      // 初始速度：实验模式下可强制统一（消除初始散度 → 纯粹验证 advection）
      let initVX, initVY;
      if (uniformVel) {
        initVX = clusterVX;
        initVY = clusterVY;
      } else {
        const divergence = 0.018;
        initVX = clusterVX + (gx * divergence) + (Math.random() - 0.5) * 0.035;
        initVY = clusterVY + (gy * divergence) + (Math.random() - 0.5) * 0.026;
      }

      const depthMul = depth < 0.65
        ? (depth < 0.48 ? 0.135 : 0.17)
        : (depth > 1 ? 0.24 : 0.20);
      const jitterMul = 0.78 + Math.random() * 0.44;
      const baseAlpha = depthMul * jitterMul;

      samplingPoints.push({
        tex: kernelTex,
        x: sx, y: sy,
        vx: initVX, vy: initVY,
        rot: (Math.random() - 0.5) * 0.3,
        rotSpeed: (Math.random() - 0.5) * 0.0016 * sizeFactor,
        stretchAngle: 0,
        stretchAmount: 0,
        curScale: kernelScale,
        squishY,
        density: gaussianEnvelope,
        baseAlpha,
        alpha: 0,
        depth,
        breathSeed: Math.random() * Math.PI * 2,
        breathFreq: 0.38 + Math.random() * 0.46,
      });
    }
  }

  // ================== 指针交互：注入场扰动 ==================
  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  let isPointerDown = false;
  let pointerX = -9999, pointerY = -9999;
  let lastPX = -9999, lastPY = -9999;
  let pointerVX = 0, pointerVY = 0;
  let injectAccumulator = 0;
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
    injectAccumulator = 0;
    holdTimer = 0;
    injectCloudEvent(pointerX, pointerY, {
      count: 11 + ((Math.random() * 9) | 0),
      spread: 26,
      scaleBias: 1.0,
      vx: 0, vy: 0,
    });
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

    if (dist > 0.5) {
      depositWake(pointerX, pointerY, pointerVX * 0.04, pointerVY * 0.04, 1.0);
    }

    const impulseR = 90;
    const impulseR2 = impulseR * impulseR;
    const impulseStrength = Math.min(1.6, dist * 0.032);
    for (let i = 0; i < samplingPoints.length; i++) {
      const s = samplingPoints[i];
      const sdx = s.x - pointerX;
      const sdy = s.y - pointerY;
      const sd2 = sdx * sdx + sdy * sdy;
      if (sd2 < impulseR2 && sd2 > 1) {
        const falloff = 1 - Math.sqrt(sd2) / impulseR;
        s.vx += pointerVX * 0.045 * falloff * impulseStrength;
        s.vy += pointerVY * 0.045 * falloff * impulseStrength;
      }
    }

    const densityScale = Math.min(1.1, 0.5 + dist * 0.015);
    injectAccumulator += dist * densityScale;
    const STEP = 19;
    while (injectAccumulator >= STEP) {
      injectAccumulator -= STEP;
      const t = 1 - (injectAccumulator / STEP);
      const ix = lastPX - dx * t;
      const iy = lastPY - dy * t;
      const dynSpread = 18 + Math.min(22, dist * 0.18);
      const speedBias = Math.max(0.78, 1.18 - dist * 0.012);
      injectCloudEvent(ix, iy, {
        count: 5 + ((Math.random() * 5) | 0),
        spread: dynSpread,
        scaleBias: speedBias,
        vx: pointerVX * 0.045,
        vy: pointerVY * 0.045,
      });
    }
  });

  const releasePointer = () => {
    isPointerDown = false;
    isImageDragging = false;
    injectAccumulator = 0;
    holdTimer = 0;
  };
  window.addEventListener('pointerup', releasePointer);
  window.addEventListener('pointercancel', releasePointer);

  // ================== 清空 & 截图 ==================
  document.getElementById('clearBtn').addEventListener('click', () => { samplingPoints.length = 0; });
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
  // V0.4-beta Physical Semantics Acceptance Framework
  //
  // 验收硬阈值（来自物理语义，不来自"视觉好看"）：
  //   A & B 保持率 ≥ 0.999（浮点误差容忍度 0.1% 内）
  //   C：avgGradMag > 0 （确实出现了非零速度梯度）
  //      且 density 保持率 ≤ 0.90（梯度确实导致 density 重新分布）
  //   D：因果顺序：wakeMag↑ → gradMag↑ → density↓（有先有后，可观察）
  // ==================================================================
  const ACCEPT_N_FRAMES       = 600;   // A/B/C 自动跑的帧数（60fps ≈ 10s）
  const ACCEPT_AB_RETENTION   = 0.999; // A/B：密度保持率 ≥ 此值 = PASS
  const ACCEPT_C_GRAD_MIN     = 1e-5;  // C：平均梯度模 ≥ 此值 = 确实有梯度
  const ACCEPT_C_RETENTION    = 0.90;  // C：密度保持率 ≤ 此值 = 梯度起作用
  const ACCEPT_LOG_STEP       = 30;    // 日志间隔帧

  let experimentMode = 0;      // 0=normal, 1=A, 2=B, 3=C, 4=D
  let experimentFrame = 0;
  // 实验基线：第 1 帧的 avgDensity，用来算保持率
  let baselineAvgDensity = 0;
  // 验收结论缓存，最后在第 600 帧打表
  let acceptBaseline = null;
  // D 实验因果锚点：3 个采样点（第 0/50/99 百分位的 x 位置），持续跟踪 wake/grad/density 时间序列
  let dCausalAnchors = [];
  let dCausalLogStep = 1; // D 实验每一帧都记录因果序列

  function computeAvgDensity() {
    let totalDensity = 0, count = 0;
    for (let i = 0; i < samplingPoints.length; i++) {
      totalDensity += samplingPoints[i].density;
      count++;
    }
    return count > 0 ? totalDensity / count : 0;
  }

  // 平均速度梯度模：用于 C 验收"确实出现了梯度"
  function computeAvgGradMag() {
    let sumDiv = 0, sumShear = 0, sum = 0;
    for (let i = 0; i < samplingPoints.length; i++) {
      const s = samplingPoints[i];
      const sizeFactor = Math.min(1, Math.max(0, (s.curScale - 0.05) / 0.22));
      const g = sampleVelocityGradient(s.x, s.y, sizeFactor, s.depth);
      sumDiv += Math.abs(g.divergence);
      sumShear += g.shear;
      sum++;
    }
    if (sum === 0) return { avgDiv: 0, avgShear: 0, avgGrad: 0 };
    return { avgDiv: sumDiv / sum, avgShear: sumShear / sum, avgGrad: (sumDiv + sumShear) / sum };
  }

  // 平均 wake 场模：用于 D 实验因果观测
  function computeAvgWakeMag() {
    let sum = 0, count = 0;
    for (let i = 0; i < samplingPoints.length; i++) {
      const s = samplingPoints[i];
      const wk = sampleWake(s.x, s.y);
      sum += Math.hypot(wk.x, wk.y);
      count++;
    }
    return count > 0 ? sum / count : 0;
  }

  function startExperiment(mode) {
    experimentMode = mode;
    experimentFrame = 0;
    samplingPoints.length = 0;
    rebuildWakeGrid();
    fieldConfig = { ...defaultFieldConfig };
    baselineAvgDensity = 0;
    acceptBaseline = null;
    dCausalAnchors = [];

    const cx = viewW / 2, cy = viewH / 2;

    switch (mode) {
      case 1: // 实验 A：静止云
        fieldConfig.windAmp = 0;
        fieldConfig.curlAmp = 0;
        fieldConfig.wakeActive = false;
        injectCloudEvent(cx, cy, { count: 24, spread: 30, scaleBias: 1.0, uniformVelocity: true, vx: 0, vy: 0 });
        console.log('%c[Exp A] 静止云', 'color:#4fc3f7;font-weight:bold',
          `wind=0, curl=0, wake=off。自动跑 ${ACCEPT_N_FRAMES} 帧。`);
        console.log(`  PASS 标准：density 保持率 ≥ ${ACCEPT_AB_RETENTION}（10s 不掉超过 0.1%）`);
        console.log('  FAIL 原因：存在隐藏的 magnitude / 时间驱动 loss（等价于 lifespan）');
        break;

      case 2: // 实验 B：匀速平移
        fieldConfig.windAmp = 0;
        fieldConfig.curlAmp = 0;
        fieldConfig.wakeActive = false;
        fieldConfig.uniformVx = 0.3;
        injectCloudEvent(cx, cy, { count: 24, spread: 30, scaleBias: 1.0, uniformVelocity: true, vx: 0.3, vy: 0 });
        console.log('%c[Exp B] 匀速平移', 'color:#4fc3f7;font-weight:bold',
          `vx=0.3（|v| 非零，但 ∇v=0）。自动跑 ${ACCEPT_N_FRAMES} 帧。`);
        console.log(`  PASS 标准：density 保持率 ≥ ${ACCEPT_AB_RETENTION}`);
        console.log('  FAIL 原因：Advection 被等同成 Dissipation（speedLoss / stretchAmount 基于 |v|）');
        break;

      case 3: // 实验 C：剪切
        fieldConfig.windAmp = 0;
        fieldConfig.curlAmp = 0;
        fieldConfig.wakeActive = false;
        fieldConfig.shearVyKx = 0.003;
        injectCloudEvent(cx, cy, { count: 24, spread: 30, scaleBias: 1.0, uniformVelocity: true, vx: 0, vy: 0 });
        console.log('%c[Exp C] 剪切', 'color:#4fc3f7;font-weight:bold',
          `vy = 0.003*(x-cx)（|v| 变化 + ∇v ≠ 0）。自动跑 ${ACCEPT_N_FRAMES} 帧。`);
        console.log(`  PASS 标准：avgGradMag ≥ ${ACCEPT_C_GRAD_MIN} 且 density 保持率 ≤ ${ACCEPT_C_RETENTION}`);
        console.log('  FAIL 原因（可能两种）：');
        console.log('    a) shear 项为 0，但 density 仍下降 → 隐藏 magnitude loss');
        console.log('    b) shear 非零但 density 不降 → shear→density 链路断');
        break;

      case 4: // 实验 D：Wake（需要用户交互划过云）
        injectCloudEvent(cx, cy, { count: 24, spread: 30, scaleBias: 1.0 });
        // 锚定 3 个采样点（按 x 位置排序，取 0/50/99 百分位）做因果序列跟踪
        const sorted = samplingPoints.slice().sort((a, b) => a.x - b.x);
        const idxs = [0, Math.floor(sorted.length * 0.5), sorted.length - 1];
        dCausalAnchors = idxs.map(i => sorted[i]).filter(Boolean);
        console.log('%c[Exp D] Wake 因果序列', 'color:#4fc3f7;font-weight:bold',
          `锚点 ${dCausalAnchors.length} 个。请用手指快速划过云团。`);
        console.log('  每帧记录：frame / wakeMag(avg) / gradMag(avg) / avgDensity');
        console.log('  PASS 观察：wakeMag↑ → 下一帧 gradMag↑ → 随后几帧 density↓（可分离因果）');
        console.log('  FAIL 观察：wake 出现时 density 立刻同步下降 → 隐藏 wakeLoss 直接扣 density');
        break;
    }

    // 等第一帧（frame=0）时采基线
  }

  function resetExperiment() {
    experimentMode = 0;
    experimentFrame = 0;
    fieldConfig = { ...defaultFieldConfig };
    baselineAvgDensity = 0;
    acceptBaseline = null;
    dCausalAnchors = [];
    console.log('%c[Normal] 正常模式', 'color:#81c784;font-weight:bold');
  }

  window.addEventListener('keydown', (e) => {
    switch (e.key) {
      case '0': resetExperiment(); break;
      case '1': startExperiment(1); break;
      case '2': startExperiment(2); break;
      case '3': startExperiment(3); break;
      case '4': startExperiment(4); break;
      case '5': printAcceptanceTable(true); break; // 手工打印当前积累到的验收表
    }
  });

  // PASS/FAIL 判定器（A/B/C 跑完 ACCEPT_N_FRAMES 帧后自动输出）
  let acceptanceTable = {
    A: null, // {passed, retention, reason, evidence}
    B: null,
    C: null,
    D: null, // 需要用户交互，无法自动判定，但会输出因果观察
  };

  function judgeExperiment() {
    if (experimentFrame !== ACCEPT_N_FRAMES) return; // 只在终点判定一次

    const finalDensity = computeAvgDensity();
    const retention = baselineAvgDensity > 0 ? finalDensity / baselineAvgDensity : 1;
    const grad = computeAvgGradMag();

    let verdict = null;
    switch (experimentMode) {
      case 1: { // A 静止
        const passed = retention >= ACCEPT_AB_RETENTION;
        verdict = {
          passed,
          retention,
          avgDensity0: baselineAvgDensity,
          avgDensityN: finalDensity,
          avgGrad: grad.avgGrad,
          reason: passed ? 'density 保持率 ≥ 阈值：静止不消散 ✓'
                         : `density 下降 ${((1 - retention) * 100).toFixed(2)}%，存在隐藏 lifespan ✗`,
        };
        acceptanceTable.A = verdict;
        break;
      }
      case 2: { // B 匀速
        const passed = retention >= ACCEPT_AB_RETENTION;
        verdict = {
          passed,
          retention,
          avgDensity0: baselineAvgDensity,
          avgDensityN: finalDensity,
          avgGrad: grad.avgGrad,
          reason: passed ? 'density 保持率 ≥ 阈值：Advection ≠ Dissipation ✓'
                         : `density 下降 ${((1 - retention) * 100).toFixed(2)}%，velocity magnitude 被当成 dissipation ✗`,
        };
        acceptanceTable.B = verdict;
        break;
      }
      case 3: { // C 剪切
        const hasGrad = grad.avgGrad >= ACCEPT_C_GRAD_MIN;
        const densityDropped = retention <= ACCEPT_C_RETENTION;
        const passed = hasGrad && densityDropped;
        let reason;
        if (passed) {
          reason = `avgGrad=${grad.avgGrad.toExponential(2)} ≥ ${ACCEPT_C_GRAD_MIN}，` +
                   `retention=${retention.toFixed(3)} ≤ ${ACCEPT_C_RETENTION}：梯度→density 链路连通 ✓`;
        } else if (!hasGrad && !densityDropped) {
          reason = `avgGrad=${grad.avgGrad.toExponential(2)} < ${ACCEPT_C_GRAD_MIN}，` +
                   `且 retention=${retention.toFixed(3)} > ${ACCEPT_C_RETENTION}：剪切流场没产生梯度 ✗`;
        } else if (!hasGrad) {
          reason = `avgGrad=${grad.avgGrad.toExponential(2)} < ${ACCEPT_C_GRAD_MIN}，` +
                   `但 retention=${retention.toFixed(3)} ≤ ${ACCEPT_C_RETENTION}：density 降了，但不是由 shear 引起（隐藏 magnitude loss） ✗`;
        } else {
          reason = `avgGrad=${grad.avgGrad.toExponential(2)} ≥ ${ACCEPT_C_GRAD_MIN}，` +
                   `但 retention=${retention.toFixed(3)} > ${ACCEPT_C_RETENTION}：shear→density 链路断了 ✗`;
        }
        verdict = {
          passed,
          retention,
          avgGrad: grad.avgGrad,
          avgDiv: grad.avgDiv,
          avgShear: grad.avgShear,
          avgDensity0: baselineAvgDensity,
          avgDensityN: finalDensity,
          reason,
        };
        acceptanceTable.C = verdict;
        break;
      }
    }

    // 打印本次实验的判定
    if (verdict) {
      const tag = ['', 'A', 'B', 'C', 'D'][experimentMode];
      const p = verdict.passed;
      console.log(
        '%c' + (p ? '✅ PASS' : '❌ FAIL') + ` [Exp ${tag}]`,
        'color:' + (p ? '#81c784' : '#e57373') + ';font-weight:bold;font-size:13px',
      );
      console.log('  ' + verdict.reason);
      console.log('  证据：', verdict);
      printAcceptanceTable();
    }
  }

  function printAcceptanceTable(hint) {
    const header = [
      '%c V0.4-beta Physical Semantics Acceptance Table ',
      'background:#1a1a2e;color:#e0e0e0;padding:4px 8px;border-radius:4px;font-weight:bold',
    ];
    console.log(...header);
    const rows = [
      { exp: 'A 静止云', test: 'V=0, ∇V=0 → density 保持', v: acceptanceTable.A },
      { exp: 'B 匀速平移', test: 'V≠0, ∇V=0 → density 保持', v: acceptanceTable.B },
      { exp: 'C 剪切',    test: '∇V≠0 → density 重新分布', v: acceptanceTable.C },
      { exp: 'D Wake',    test: 'Wake → ∇V → density （人工观察因果顺序）', v: acceptanceTable.D },
    ];
    for (const r of rows) {
      let status, color;
      if (r.v === null) {
        status = 'PENDING'; color = '#ffb74d';
      } else if (r.v.passed === undefined) {
        status = 'OBSERVE'; color = '#64b5f6'; // D 用
      } else if (r.v.passed) {
        status = 'PASS'; color = '#81c784';
      } else {
        status = 'FAIL'; color = '#e57373';
      }
      console.log(
        `  [${r.exp}] %c${status}%c — ${r.test}` + (r.v && r.v.reason ? ` | 原因：${r.v.reason}` : ''),
        `color:${color};font-weight:bold`,
        'color:inherit;font-weight:normal',
      );
    }
    if (hint) {
      console.log('%c[提示] 按 1/2/3/4 启动对应实验；按 5 随时查看累积表；按 0 清空', 'color:#b0bec5');
    }
  }

  function logExperimentStatus() {
    if (experimentMode === 0) return;
    experimentFrame++;

    // 基线：帧 0 的 avgDensity + grad
    if (experimentFrame === 1 && baselineAvgDensity === 0) {
      baselineAvgDensity = computeAvgDensity();
      acceptBaseline = {
        avgDensity0: baselineAvgDensity,
        grad0: computeAvgGradMag(),
      };
      const tag = ['Normal', 'A-静止', 'B-匀速', 'C-剪切', 'D-Wake'][experimentMode];
      console.log(`[Exp ${tag}] baseline avgDensity0=${baselineAvgDensity.toFixed(4)}`);
    }

    // A/B/C 日志：帧 ACCEPT_LOG_STEP * N
    if (experimentMode >= 1 && experimentMode <= 3) {
      if (experimentFrame % ACCEPT_LOG_STEP === 0) {
        const density = computeAvgDensity();
        const grad = computeAvgGradMag();
        const retention = baselineAvgDensity > 0 ? density / baselineAvgDensity : 1;
        const tag = ['Normal', 'A', 'B', 'C', 'D'][experimentMode];
        console.log(
          `[Exp ${tag}] frame=${experimentFrame}/${ACCEPT_N_FRAMES} ` +
          `avgDensity=${density.toFixed(4)} retention=${retention.toFixed(4)} ` +
          `avgDiv=${grad.avgDiv.toExponential(2)} avgShear=${grad.avgShear.toExponential(2)}`
        );
      }
      // 终点自动判定
      judgeExperiment();
      return;
    }

    // D 日志：因果序列每帧（dCausalLogStep）打印
    if (experimentMode === 4 && experimentFrame % dCausalLogStep === 0) {
      const wakeMag = computeAvgWakeMag();
      const grad = computeAvgGradMag();
      const density = computeAvgDensity();
      // 锚点个体值
      const anchors = dCausalAnchors.map((s, idx) => {
        const wk = sampleWake(s.x, s.y);
        const sizeFactor = Math.min(1, Math.max(0, (s.curScale - 0.05) / 0.22));
        const g = sampleVelocityGradient(s.x, s.y, sizeFactor, s.depth);
        return `a${idx}{wk=${(Math.hypot(wk.x, wk.y)).toFixed(3)},gr=${(Math.abs(g.divergence)+g.shear).toFixed(3)},d=${s.density.toFixed(3)}}`;
      }).join(' ');
      console.log(
        `[Exp D causality] f=${experimentFrame.toString().padStart(4)} ` +
        `wakeMag=${wakeMag.toFixed(3)} gradMag=${grad.avgGrad.toFixed(3)} avgDensity=${density.toFixed(4)} | ${anchors}`
      );
    }
  }

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

    // 按住持续注入（非实验模式下）
    if (isPointerDown && experimentMode === 0) {
      holdTimer += dt;
      if (holdTimer > 0.145) {
        holdTimer = 0;
        injectCloudEvent(pointerX, pointerY, {
          count: 4 + ((Math.random() * 4) | 0),
          spread: 20,
          scaleBias: 0.94,
          vx: pointerVX * 0.03,
          vy: pointerVY * 0.03,
        });
      }
    }

    // ===== 场演化：每个采样点被风搬运 + 速度梯度稀释 =====
    for (let i = samplingPoints.length - 1; i >= 0; i--) {
      const s = samplingPoints[i];

      const sizeFactor = Math.min(1, Math.max(0, (s.curScale - 0.05) / 0.22));

      // ==================================================================
      // V0.4-beta-2 核心：采样速度场 + 其空间梯度
      //
      // 一次调用同时获得：
      //   vx, vy        → 该位置的 Cloud Field 速度（用于 advection）
      //   divergence    → ∇·v（正=膨胀→稀释；负=压缩→增浓）
      //   shear         → |∂vx/∂y| + |∂vy/∂x|（剪切→撕裂→混合→稀释）
      //
      // 匀速平移 / 静止 → divergence=0, shear=0 → 不消散
      // ==================================================================
      const grad = sampleVelocityGradient(s.x, s.y, sizeFactor, s.depth);

      // —— 阻尼 + 速度积分 ——
      const damping = 0.985;
      const dampPerFrame = Math.pow(damping, dtFrames);

      s.vx = s.vx * dampPerFrame + grad.vx * dtFrames;
      s.vy = s.vy * dampPerFrame + grad.vy * dtFrames;

      const maxV = 0.8;
      const vlen = Math.hypot(s.vx, s.vy);
      if (vlen > maxV) { s.vx = s.vx / vlen * maxV; s.vy = s.vy / vlen * maxV; }

      s.x += s.vx * dtFrames;
      s.y += s.vy * dtFrames;
      s.rot += s.rotSpeed * dtFrames;

      // ==================================================================
      // 拉伸（stretchAmount）：只由剪切驱动，不由速度大小驱动
      //
      //   静止 → shear=0 → stretchAmount=0 → 无拉伸无衰减
      //   匀速平移 → shear=0 → stretchAmount=0 → 无拉伸无衰减
      //   剪切流场 → shear>0 → stretchAmount>0 → 视觉拉长
      //
      // 视觉扁率（squishY）是采样点的固有属性，不随运动变化。
      // 拉伸（stretchAmount）是运动的结果，只由剪切产生。
      // ==================================================================
      const STRETCH_SCALE = 55;
      s.stretchAmount = Math.min(0.5, grad.shear * STRETCH_SCALE);
      if (vlen > 0.02) {
        s.stretchAngle = Math.atan2(s.vy, s.vx);
      }

      // ==================================================================
      // V0.4-beta-2 核心：密度衰减 = 散度 + 剪切（纯梯度驱动）
      //
      // ① divLoss（正散度 → 膨胀 → 稀释）
      //   云被速度场"撑开" → 同样的密度摊到更大面积 → 浓度下降
      //   只取正散度（负散度=压缩，理论上应增浓，但视觉上不做增浓
      //   避免密度无限增长。只做 max(0, div) 单向衰减）
      //
      // ② shearLoss（剪切 → 撕裂 → 混合 → 稀释）
      //   速度场的交叉梯度把云撕开 → 结构断裂 → 视觉密度下降
      //   这是"云被风拉开 → 变薄 → 断裂"的物理根源
      //
      // 没有 baseLoss（时间不独立致死）
      // 没有 speedLoss（速度大小不独立致死）
      // 没有 curlLoss（curl 幅度不独立致死；curl 的效果通过速度梯度自然体现）
      // 没有 wakeLoss（wake 幅度不独立致死；wake 的效果通过速度梯度自然体现）
      //
      // 验收：
      //   实验 A 静止 → div=0, shear=0 → loss=0 → density 保持 ✓
      //   实验 B 匀速 → div=0, shear=0 → loss=0 → density 保持 ✓
      //   实验 C 剪切 → shear>0 → loss>0 → density ↓ ✓
      //   实验 D Wake → wake 速度场有空间梯度 → div/shear>0 → density ↓ ✓
      // ==================================================================
      const DIV_LOSS_SCALE   = 4.5;
      const SHEAR_LOSS_SCALE = 3.5;
      const SHEAR_LOSS_CAP   = 0.04;

      const divLoss   = Math.max(0, grad.divergence) * DIV_LOSS_SCALE;
      const shearLoss = Math.min(SHEAR_LOSS_CAP, grad.shear * SHEAR_LOSS_SCALE);

      const totalLoss = Math.min(0.055, divLoss + shearLoss);
      s.density *= (1 - totalLoss);

      // 最终 alpha = 每单位 density 的视觉浓度 × 当前 density × 呼吸
      s.alpha = s.baseAlpha * s.density;
      const breath = Math.sin(
        (s.x * 0.00019 + s.y * 0.00021) + s.breathSeed + curlTime * s.breathFreq
      ) * 0.12;
      s.alpha *= (1 + breath);

      // ==================================================================
      // 释放采样点（不是 Death，是数值预算回收）
      // ==================================================================
      if (s.density < 0.0022) {
        releaseSamplingPoint(i);
        continue;
      }
      const offEdge = (s.x < -250 || s.x > viewW + 250 || s.y < -250 || s.y > viewH + 250);
      if (offEdge && s.alpha < 0.014) {
        releaseSamplingPoint(i);
      }
    }

    // 实验监控
    logExperimentStatus();

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

    drawCloudField(samplingPoints);

    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  function drawCloudField(list) {
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      const a = s.alpha;
      if (a < 0.0003) continue;

      const tex = s.tex;
      const tw = tex.width * s.curScale;
      const th = tex.height * s.curScale * s.squishY;

      ctx.save();
      ctx.translate(s.x, s.y);

      if (s.stretchAmount > 0.01) {
        ctx.rotate(s.stretchAngle);
        ctx.scale(1 + s.stretchAmount, 1 - s.stretchAmount * 0.3);
      } else {
        ctx.rotate(s.rot);
      }

      ctx.globalAlpha = a;
      ctx.drawImage(tex, -tw / 2, -th / 2, tw, th);
      ctx.restore();
    }
  }

  window.__dbg = { samplingPoints, canvas, getPos, sampleCurl, sampleAmbientWind,
    sampleTotalVelocity, sampleVelocityGradient, fieldConfig, experimentMode };

  // —— 启动 ——
  (function startLoop() {
    resizeCanvas();
    lastTs = performance.now();
    console.log('%cCloudscape V0.4-beta Physical Semantics Acceptance Build',
      'color:#4fc3f7;font-weight:bold;font-size:14px');

    // ================================================================
    // 静态代码审计结果（构建时打印）
    // 验证：s.density 的写路径只有两处（无 baseLoss/speedLoss/curlLoss/wakeLoss 残留）
    // ================================================================
    console.log('%c[静态代码审计] s.density 写路径（grep 结果）', 'color:#ce93d8;font-weight:bold');
    console.log('  ① 初始化赋值（injectCloudEvent 内）：density = gaussianEnvelope');
    console.log('  ② 演化循环内一处乘法：s.density *= (1 - totalLoss)');
    console.log('  其中 totalLoss 只包含 divLoss（散度）+ shearLoss（剪切）两项，都是速度梯度的函数。');
    console.log('  已确认：无 baseLoss / speedLoss / curlLoss / wakeLoss / lifespan / lifeAlpha / texSeq 残留。');
    console.log('  已确认：splice 统一封装为 releaseSamplingPoint()，语义为"释放数值预算"而非"Cloud Death"。');
    console.log('%c[操作] 按 1/2/3/4 启动实验；按 5 查看累积表；按 0 清空', 'color:#b0bec5');
    console.log('  1=静止云  2=匀速平移  3=剪切  4=Wake因果  5=打印验收表');

    function frame(ts) {
      updateAndRender(ts);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  })();
})();
