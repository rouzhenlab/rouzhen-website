(() => {
  'use strict';

  // ==================================================================
  // V0.4-beta+4 · Visual Validation Baseline
  //
  // * 物理模型 = V0.4-beta 梯度模型（div + shear） （density 语义 LOCKED）
  // * releaseSamplingPoint() = 数值预算释放，不是 Cloud Death
  //
  // V0.4-beta+4 受控实验总览（严格单变量递进）：
  //   β+1 : WAKE_STRENGTH_SCALE = 0.25          （原 1.0 → ×0.25）
  //   β+2 : SHEAR_LOSS_SCALE    = 2.0           （原 3.5 → 2.0，脱离 CAP）
  //   β+3 : SHEAR_LOSS_SCALE    = 1.5           （2.0 → 1.5，收益恒定）
  //   β+4 : SHEAR_LOSS_SCALE    = 1.0           （1.5 → 1.0，dOld@30≥0.5 达成）
  //   其余全部：DIV / CAPs / decay / deposit / density / C-bug 全部 LOCKED
  //
  // 本版本线冻结：进入视觉验证阶段，不继续参数优化
  // ==================================================================
  // Continuous Cloud Field (Velocity Gradient Dissipation)
  //
  // 物理隐喻（核心）：
  //   点击/划过 = 手指扰动空气 → 局部 Cloud Field 被注入能量
  //               ↑ 释放点 = 采样粒子（数值代理，不是云团本身）
  //               ↑ 采样值 = density 标量 + 速度驱动的 advection
  //               ↑ 密度损失 ≠ 粒子释放；只有当采样 density 被 div + shear 梯度耗竭时才是“云散”
  //
  // 核心承诺（必须经过物理语义验收）：
  //   A. 静止时 V=0 且 ∇V=0 → density 10 秒变化 ≤ 0.1%
  //   B. 匀速平移时 V≠0 但 ∇V=0 → density 10 秒变化 ≤ 0.1%
  //   C. 有梯度时 ∇V≠0 → density 被重新分布（有升有降，总量不守恒但语义明确）
  //   D. Wake 产生时：Wake deposit → 局部 ∇V → div/shear loss → 新云/老云分别采样
  //
  // 版本线：V0.4-beta+4（本文件）  上版：V0.4-beta+3  下一刀：视觉验证后决定
  // ==================================================================

  // ================== 画布 & 视口 ==================
  const canvas = document.getElementById('cloudCanvas');
  const ctx = canvas.getContext('2d');
  let viewW = 0, viewH = 0, dpr = Math.max(1, window.devicePixelRatio || 1);

  function resizeCanvas() {
    const w = window.innerWidth, h = window.innerHeight;
    viewW = w; viewH = h;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // 重建 Wake grid
    rebuildWakeGrid();
  }
  window.addEventListener('resize', resizeCanvas);

  // ================== 全局云量限制 ==================
  const TARGET_COUNT = 620;
  const MAX_COUNT_HARD = 900;
  const MAX_SCALE_SPAN = 0.27;

  // ================== 采样点 ==================
  /** @type {Array<{x:number,y:number,vx:number,vy:number,scale:number,baseAlpha:number,density:number,
   * depth:number,seed:number,releaseDelay:number,curScale:number,alpha:number,birthFrame:number}>} */
  const samplingPoints = [];
  const releaseQueue = [];

  let globalFrameCounter = 0;

  // ================== 确定性密度核 ==================
  function buildDensityKernel(seed) {
    const rand = mulberry32(seed);
    const N = 256;
    const arr = new Float32Array(N);
    for (let i = 0; i < N; i++) arr[i] = 0.93 + rand() * 0.14;
    return arr;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const DENSITY_KERNEL_A = buildDensityKernel(1234);
  const DENSITY_KERNEL_B = buildDensityKernel(5678);

  // ================== Wake 拖尾风场（网格版） ==================
  const WAKE_CELL = 36;
  // V0.4-beta+1 受控实验：唯一变量 — Wake deposit 强度 ×0.25
  //   冻结项：wakeAge 衰减(0.994)、sampleTotalVelocity 耦合(1.8)、DIV/SHEAR_LOSS_SCALE、density 公式
  const WAKE_STRENGTH_SCALE = 0.25;
  //
  // V0.4-beta+2 受控实验：唯一变量 — shear 放大倍数 3.5 → 2.0
  //   锁定：WAKE_STRENGTH_SCALE=0.25（beta+1 基线）、DIV_LOSS_SCALE=4.5、
  //         SHEAR_LOSS_CAP=0.04、TOTAL_LOSS_CAP=0.055、density 公式
  //
  // V0.4-beta+3 受控实验：唯一变量 — shear 放大倍数 2.0 → 1.5
  //   锁定：WAKE_STRENGTH_SCALE=0.25（beta+1）、SHEAR_LOSS_SCALE 的 β+2=2.0 冻结于本条
  //         DIV_LOSS_SCALE=4.5、SHEAR_LOSS_CAP=0.04、TOTAL_LOSS_CAP=0.055、decay、C bug
  //
  // V0.4-beta+4 受控实验：唯一变量 — shear 放大倍数 1.5 → 1.0
  //   锁定：与 β+3 完全相同；C bug 不修；CAP / decay / divergence / WAKE / deposit 全锁
  //   β+4 判定：① dOld@60 ≥ 0.5？  ② totalLoss 整体 ≈ 0.01？  ③ 收益递减是否出现？
  const DIV_LOSS_SCALE   = 4.5;
  const SHEAR_LOSS_SCALE = 1.0;   // ← 本刀唯一变量：1.5 → 1.0（β+1=3.5, β+2=2.0, β+3=1.5, β+4=1.0）
  const SHEAR_LOSS_CAP   = 0.04;
  const TOTAL_LOSS_CAP   = 0.055;
  //
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
        wakeVX[idx] = wakeVX[idx] * (1 - w * 0.5) + vx * strength * w * WAKE_STRENGTH_SCALE;
        wakeVY[idx] = wakeVY[idx] * (1 - w * 0.5) + vy * strength * w * WAKE_STRENGTH_SCALE;
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
    r.onload = () => {
      const im = new Image();
      im.onload = () => { bgImage = im; bgImagePending = true; clearAllClouds(); };
      im.src = r.result;
    };
    r.readAsDataURL(f);
  });
  document.getElementById('bgUploadLabel').addEventListener('click', () => {
    document.getElementById('bgUploader').click();
  });
  document.getElementById('clearBtn').addEventListener('click', () => clearAllClouds());
  document.getElementById('screenshotBtn').addEventListener('click', () => takeScreenshot());
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    camScale = Math.max(0.4, Math.min(2.2, camScale * (1 - Math.sign(e.deltaY) * 0.08)));
  }, { passive: false });

  // ================== 背景 / 水墨渲染 ==================
  let bgImage = null, bgImagePending = false;
  let bgImageOffsetX = 0, bgImageOffsetY = 0, bgImageScale = 1;
  let camX = 0, camY = 0, camScale = 1;
  let inkCanvas = null, inkCtx = null, inkW = 0, inkWp = 0, inkH = 0;

  function ensureInkCanvas() {
    const w = Math.max(1, viewW), h = Math.max(1, viewH);
    const W = Math.ceil(w), H = Math.ceil(h);
    if (!inkCanvas || inkW !== W || inkH !== H) {
      inkCanvas = document.createElement('canvas');
      inkCanvas.width = W; inkCanvas.height = H;
      inkCtx = inkCanvas.getContext('2d');
      inkW = W; inkH = H; inkWp = W;
    }
  }

  function rebuildInkTexture() {
    ensureInkCanvas();
    // 1. 背景
    if (bgImage) {
      const bRatio = bgImage.width / bgImage.height;
      const vRatio = viewW / viewH;
      let dw, dh;
      if (bRatio > vRatio) {
        dh = viewH; dw = viewH * bRatio;
      } else {
        dw = viewW; dh = viewW / bRatio;
      }
      dw *= bgImageScale; dh *= bgImageScale;
      const dx = (viewW - dw) / 2 + bgImageOffsetX;
      const dy = (viewH - dh) / 2 + bgImageOffsetY;
      inkCtx.globalCompositeOperation = 'source-over';
      inkCtx.drawImage(bgImage, dx, dy, dw, dh);
    } else {
      inkCtx.globalCompositeOperation = 'source-over';
      const g = inkCtx.createLinearGradient(0, 0, 0, inkH);
      g.addColorStop(0, '#e8e3d7');
      g.addColorStop(1, '#c9bfa9');
      inkCtx.fillStyle = g;
      inkCtx.fillRect(0, 0, inkW, inkH);
      // 宣纸纹理（稳定版本）
      const imgData = inkCtx.getImageData(0, 0, inkW, inkH);
      const rand = mulberry32(42);
      const d = imgData.data;
      for (let i = 0; i < d.length; i += 4) {
        const n = (rand() - 0.5) * 18;
        d[i] = Math.max(0, Math.min(255, d[i] + n));
        d[i+1] = Math.max(0, Math.min(255, d[i+1] + n));
        d[i+2] = Math.max(0, Math.min(255, d[i+2] + n));
      }
      inkCtx.putImageData(imgData, 0, 0);
      // 四角阴影
      inkCtx.globalCompositeOperation = 'multiply';
      for (let i = 0; i < 3; i++) {
        const rg = inkCtx.createRadialGradient(inkW/2, inkH/2, Math.min(inkW,inkH)*0.25, inkW/2, inkH/2, Math.max(inkW,inkH)*0.75);
        rg.addColorStop(0, 'rgba(255,255,255,1)');
        rg.addColorStop(1, 'rgba(140,130,110,0.25)');
        inkCtx.fillStyle = rg;
        inkCtx.fillRect(0, 0, inkW, inkH);
      }
      inkCtx.globalCompositeOperation = 'source-over';
    }
    bgImagePending = false;
  }

  function renderClouds() {
    ensureInkCanvas();
    if (bgImagePending || !inkW) rebuildInkTexture();

    // 云渲染：用 multiply 在宣纸上叠加墨色
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(inkCanvas, 0, 0, viewW, viewH);
    ctx.globalCompositeOperation = 'multiply';

    // 摄像机
    ctx.translate(viewW/2, viewH/2);
    ctx.scale(camScale, camScale);
    ctx.translate(-viewW/2 - camX, -viewH/2 - camY);

    // 按 depth 从小到大渲染（近景后画 = 覆盖远景）
    samplingPoints.sort((a, b) => a.depth - b.depth);

    // 水墨墨色：近景 = 浓墨（接近纯黑），远景 = 淡墨（偏灰）
    // density 越低越淡，density=1 时完全按 baseAlpha 表达墨色浓度
    for (const s of samplingPoints) {
      if (s.alpha <= 0.002) continue;
      const baseInk = 18 + (1 - s.depth) * 22;         // 墨色 ~ [18,40]
      const r = baseInk, g = baseInk, b = baseInk + 2;   // 墨色稍偏蓝
      ctx.fillStyle = `rgba(${r},${g},${b},${s.alpha})`;

      const sz = s.curScale * 220;
      if (sz < 0.5) continue;

      ctx.beginPath();
      // 每粒子 = 几个稍错位置的椭圆叠加 = 不规则毛笔斑
      const n = 2 + Math.floor(s.seed * 2);
      for (let k = 0; k < n; k++) {
        const ang = s.seed * 6.283 + k * 2.094;
        const dx = Math.cos(ang) * sz * 0.12 * ((k % 2 === 0) ? 1 : 0.7);
        const dy = Math.sin(ang) * sz * 0.08 * ((k % 2 === 0) ? 1 : 0.7);
        const rx = sz * (0.55 + (k * 0.07));
        const ry = sz * (0.38 + (k * 0.05));
        ctx.moveTo(s.x + dx + rx, s.y + dy);
        ctx.ellipse(s.x + dx, s.y + dy, rx, ry, s.seed * 1.57 + k * 0.26, 0, Math.PI * 2);
      }
      ctx.fill();
    }
    ctx.restore();
  }

  // ================== 场景：手指划动轨迹 ==================
  let pointerX = viewW * 0.5, pointerY = viewH * 0.5;
  let pointerVX = 0, pointerVY = 0;
  let pointerActive = false;
  let lastPointerX = 0, lastPointerY = 0;

  function pointerDown(e) {
    pointerActive = true;
    updatePointerXY(e);
    lastPointerX = pointerX; lastPointerY = pointerY;
    pointerVX = 0; pointerVY = 0;
    if (interactionMode === 'cloud') {
      // 点击 = 直接在手指下释放一朵云
      injectCloudEvent(pointerX, pointerY, { count: 7 });
    }
  }
  function pointerMove(e) {
    if (!pointerActive) return;
    const prevX = pointerX, prevY = pointerY;
    updatePointerXY(e);
    pointerVX = pointerX - prevX;
    pointerVY = pointerY - prevY;
    const dist = Math.hypot(pointerVX, pointerVY);

    // 画云模式：新云沿路径生成
    if (interactionMode === 'cloud' && dist > 1.5) {
      const count = Math.min(3, Math.max(1, Math.floor(dist / 5)));
      for (let i = 0; i < count; i++) {
        const t = i / count;
        const ix = prevX + pointerVX * t + (Math.random() - 0.5) * 16;
        const iy = prevY + pointerVY * t + (Math.random() - 0.5) * 16;
        injectCloudEvent(ix, iy, { count: 4 + Math.floor(Math.random() * 3) });
      }
    }
    // D1/WakeOnly 或 Both：Wake 场 deposit 开启
    if (dist > 0.5 && fieldConfig.wakeActive) {
      depositWake(pointerX, pointerY, pointerVX * 0.04, pointerVY * 0.04, 1.0);
    }
    // ImpulseOnly 或 Both：直接给采样点动量
    if (fieldConfig.impulseActive && dist > 0.5) {
      const r2 = fieldConfig.impulseR * fieldConfig.impulseR;
      const R = fieldConfig.impulseR;
      const im = fieldConfig.impulseMag;
      for (let i = 0; i < samplingPoints.length; i++) {
        const s = samplingPoints[i];
        const dx = s.x - pointerX, dy = s.y - pointerY;
        const d2 = dx*dx + dy*dy;
        if (d2 > r2) continue;
        const d = Math.sqrt(d2) + 1e-4;
        const fall = 1 - d / R;
        const push = fall * fall;
        s.vx += pointerVX * im * push;
        s.vy += pointerVY * im * push;
      }
    }
    // D 因果实验手动交互的"刺激开始帧"标记
    if (window.__dbg_dExpMarkStimulus && dist >= 0.5) {
      if (dExpStimulusStartFrame === -1) dExpStimulusStartFrame = globalFrameCounter;
      window.__dbg_dExpMarkStimulus = false;
    }
  }
  function pointerUp() {
    pointerActive = false;
    pointerVX *= 0.4; pointerVY *= 0.4;
  }

  function updatePointerXY(e) {
    const rect = canvas.getBoundingClientRect();
    let cx = 0, cy = 0;
    if (e.touches && e.touches.length) {
      cx = e.touches[0].clientX; cy = e.touches[0].clientY;
    } else {
      cx = e.clientX; cy = e.clientY;
    }
    pointerX = (cx - rect.left) / rect.width * viewW;
    pointerY = (cy - rect.top) / rect.height * viewH;
  }
  canvas.addEventListener('mousedown', pointerDown);
  canvas.addEventListener('mousemove', pointerMove);
  window.addEventListener('mouseup', pointerUp);
  canvas.addEventListener('touchstart', (e) => { e.preventDefault(); pointerDown(e); }, { passive: false });
  canvas.addEventListener('touchmove', (e) => { e.preventDefault(); pointerMove(e); }, { passive: false });
  window.addEventListener('touchend', pointerUp);

  // ================== 场配置（A/B/C/D 自动切换） ==================
  const defaultFieldConfig = {
    windAmp: 0.4,            // 背景风
    curlAmp: 1.0,            // 大尺度 curl 扰流
    uniformVx: 0,            // B 匀速用：固定 vx
    shearVyKx: 0,            // C 剪切用：vy = shearVyKx * (x - cx)
    wakeActive: true,        // D1 WakeOnly / D2 ImpulseOnly / D3 Both
    impulseActive: true,     // 同上
    impulseR: 90,
    impulseMag: 1.0,
  };
  let fieldConfig = { ...defaultFieldConfig };

  // ================== 云注入 / 释放 ==================
  function injectCloudEvent(x, y, opt) {
    const count = opt?.count ?? 8;
    const spread = opt?.spread ?? 30;
    const scaleBias = opt?.scaleBias ?? 1.0;
    const uniformVelocity = !!opt?.uniformVelocity;
    const vx = opt?.vx ?? 0, vy = opt?.vy ?? 0;
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const r = Math.random() * spread;
      const px = x + Math.cos(ang) * r;
      const py = y + Math.sin(ang) * r;
      const seed = Math.random();
      const depth = 0.1 + Math.random() * 0.85;   // 近景=高 depthIndex
      const scale = (0.05 + Math.random() * MAX_SCALE_SPAN) * scaleBias;
      const baseAlpha = (0.09 + Math.random() * 0.12);
      // density 起点 = 1.0（V0.4-beta 语义：粒子释放 ≠ Cloud Death，death 只来自 div + shear）
      const s = {
        x: px, y: py,
        vx: uniformVelocity ? vx : (Math.random() - 0.5) * 0.06,
        vy: uniformVelocity ? vy : (Math.random() - 0.5) * 0.06,
        scale,
        baseAlpha,
        density: 1.0,
        depth,
        seed,
        releaseDelay: 0,
        curScale: scale,
        alpha: baseAlpha,
        birthFrame: globalFrameCounter,
      };
      samplingPoints.push(s);
    }
  }

  function releaseSamplingPoint(i) {
    // 数值预算释放。不是物理死亡，不做 density 任何计算。
    // 仅当外部调（例如超 MAX_COUNT_HARD 时）才会触发。
    samplingPoints.splice(i, 1);
  }

  function clearAllClouds() {
    samplingPoints.length = 0;
    releaseQueue.length = 0;
  }

  // ================== 云释放预算：保持 TARGET_COUNT 附近 ==================
  // V0.4-beta 冻结：density 语义绝对不动
  // releaseCount 只控制粒子池上限，density 完全由物理语义决定
  function manageCloudBudget() {
    // 当 cloud 数 > TARGET_COUNT 时，开始让最老 / 最偏的粒子进入 releaseQueue
    if (samplingPoints.length > MAX_COUNT_HARD) {
      // 按离画面中心距离 + 年龄排序，去掉最远 5%
      const cx = viewW / 2, cy = viewH / 2;
      const order = [];
      for (let i = 0; i < samplingPoints.length; i++) {
        const s = samplingPoints[i];
        const d2 = (s.x - cx) ** 2 + (s.y - cy) ** 2;
        order.push({ i, d2 });
      }
      order.sort((a, b) => b.d2 - a.d2);
      const targetRemove = samplingPoints.length - TARGET_COUNT;
      const remove = order.slice(0, targetRemove).map(o => o.i).sort((a, b) => b - a);
      for (const idx of remove) releaseSamplingPoint(idx);
    }
    // 每帧自然补充到大约 TARGET_COUNT 水平：画面外弱补
    const shortfall = TARGET_COUNT - samplingPoints.length;
    if (shortfall > 0) {
      const add = Math.min(16, Math.ceil(shortfall * 0.08));
      const cx = viewW / 2, cy = viewH / 2;
      for (let i = 0; i < add; i++) {
        const ang = Math.random() * Math.PI * 2;
        const r = viewW * (0.08 + Math.random() * 0.38);
        injectCloudEvent(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r, { count: 1 });
      }
    }
  }

  // V0.4-beta+4 Physical Semantics Acceptance Framework
  //
  // 验收硬阈值（来自物理语义，不来自“视觉好看”）：
  //   A & B 保持率 ≥ 0.999（浮点误差容忍度 0.1% 内）
  //   C：avgGradMag > 0 （确实出现了非零速度梯度）
  //      且 density 保持率 ≤ 0.90（梯度确实导致 density 重新分布）
  //   D：因果链按顺序发生（Wake→∇V→shear→density），新云/老云分别统计
  //
  const ACCEPT_N_FRAMES       = 600;   // A/B/C 自动跑的帧数（60fps ≈ 10s）
  const ACCEPT_LOG_STEP       = 30;    // 每 30 帧打印一次
  const ACCEPT_AB_RETENTION   = 0.999; // A/B 保留率阈值
  const ACCEPT_C_GRAD_MIN     = 1e-5;  // C: avgGradMag 下限（远小于实际 shear 水平）
  const ACCEPT_C_RETENTION    = 0.9;   // C: density 保留率上限（证明 shear→loss 链路工作）

  let experimentMode = 0; // 0=关闭, 1=A, 2=B, 3=C, 4=D
  let experimentFrame = 0;
  let baselineAvgDensity = 0;
  let acceptBaseline = null;

  function computeAvgDensity() {
    if (samplingPoints.length === 0) return 0;
    let sum = 0;
    for (const s of samplingPoints) sum += s.density;
    return sum / samplingPoints.length;
  }

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

      case 4: // 实验 D：Wake 因果链（需要用户交互 — 点击后快速划一下；或按 Shift+R 自动化）
        // 默认 Both=D3；用户按 6/7/8 切换 D1/D2/D3
        fieldConfig.windAmp = 0;
        fieldConfig.curlAmp = 0;
        fieldConfig.wakeActive = true;
        fieldConfig.impulseActive = true;
        dExpStimulusStartFrame = -1;
        dExpSubMode = 3;
        dCausalLog = [];
        injectCloudEvent(cx, cy, { count: 32, spread: 120, scaleBias: 1.0 });
        console.log('%c[Exp D] Wake 因果链', 'color:#4fc3f7;font-weight:bold');
        console.log('  目标：验证 Wake deposit → ∇V → div/shear → density ↓ 的顺序；新云/老云分别统计');
        console.log('  操作（两种）：');
        console.log('    · 手动：在本窗口先选 6=D1(WakeOnly)/7=D2(ImpulseOnly)/8=D3(Both)，');
        console.log('             然后手动划过画面刺激；每帧日志会按 newCloud/birthFrame 分组');
        console.log('    · 自动：先选 6/7/8 设定子模式，然后按 Shift+R 启动 autoDcausalRun 编程式划过');
        console.log('  数据：D1/D2/D3 对比表（按 stimF 对齐）；结束后按 9 导出 CSV');
        break;
    }
  }

  // ================== D 因果实验：采样 + 锚点 + 自动化 + CSV ==================
  let dCausalLogStep = 1;          // D: 每 N 帧打一次因果序列（=1 最密）
  let dCausalAnchors = [];         // D: 锚点粒子（固定索引，便于跟踪个体）
  let dExpStimulusStartFrame = -1; // D: 刺激开始帧（第一次 pointermove 非零或 autoDcausalRun 注入时）
  let dExpSubMode = 0;             // 0=未选  1=D1 WakeOnly  2=D2 ImpulseOnly  3=D3 Both
  let dLastPointerSpeed = 0;
  /** @type {Array<{frame:number,subMode:number,stimF:number,pointerSpeed:number,wakeMag:number,
   * wakeAgeCov:number,velMag:number,gradMag:number,div:number,shear:number,totalLoss:number,
   * countOld:number,countNew:number,dOld:number,dNew:number}>} */
  let dCausalLog = [];

  function startDSubExperiment(subMode) {
    // 1. 切回 experimentMode=4 （如果还不是），初始化采样点与 Wake
    if (experimentMode !== 4) startExperiment(4);
    // 2. 现在 startExperiment(4) 已经设 wakeActive=true/impulse=true；按子模式覆盖
    switch (subMode) {
      case 1:
        fieldConfig.wakeActive = true;
        fieldConfig.impulseActive = false;
        console.log('%c[D] D1 — WakeOnly', 'color:#ce93d8;font-weight:bold',
          'impulseActive=false, wakeActive=true。Wake only → ∇V → shear → density。');
        break;
      case 2:
        fieldConfig.wakeActive = false;
        fieldConfig.impulseActive = true;
        console.log('%c[D] D2 — ImpulseOnly', 'color:#ce93d8;font-weight:bold',
          'wakeActive=false, impulseActive=true。Impulse only → velocity magnitude? → ∇V? → density。');
        break;
      case 3:
        fieldConfig.wakeActive = true;
        fieldConfig.impulseActive = true;
        console.log('%c[D] D3 — Both', 'color:#ce93d8;font-weight:bold',
          'Wake + Impulse：检验是否“双重打击”→ 灾难性 shear。');
        break;
    }
    dExpSubMode = subMode;
    dExpStimulusStartFrame = -1;
    dCausalLog = [];
    // 刺激标记开（下一次 pointermove 或 autoDcausalRun）
    window.__dbg_dExpMarkStimulus = true;
  }

  function computeDcausalMetrics() {
    // 划分 oldCloud / newCloud
    const stimF = dExpStimulusStartFrame;
    let oN=0, oD=0, oV=0, oG=0, oDiv=0, oSh=0, oTL=0;
    let nN=0, nD=0;
    for (const s of samplingPoints) {
      const isNew = stimF !== -1 && s.birthFrame >= stimF;
      const sizeFactor = Math.min(1, Math.max(0, (s.curScale - 0.05) / 0.22));
      const g = sampleVelocityGradient(s.x, s.y, sizeFactor, s.depth);
      const vmag = Math.hypot(g.vx, g.vy);
      const dl = Math.max(0, g.divergence) * DIV_LOSS_SCALE;
      const sl = Math.min(SHEAR_LOSS_CAP, g.shear * SHEAR_LOSS_SCALE);
      const tl = Math.min(TOTAL_LOSS_CAP, dl + sl);

      if (isNew) {
        nN++;
        nD += s.density;
      } else {
        oN++;
        oD += s.density;
        oV += vmag;
        oG += (Math.abs(g.divergence) + g.shear);
        oDiv += Math.abs(g.divergence);
        oSh += g.shear;
        oTL += tl;
      }
    }
    const wakeMag = computeAvgWakeMag();
    // wakeAge coverage = % wake cells 年龄 < 60（即“被最近划过扰动过”的覆盖率）
    let wCov = 0, wTot = 0;
    for (let i = 0; i < wakeAge.length; i++) { wTot++; if (wakeAge[i] < 60) wCov++; }
    const wakeAgeCov = wTot ? wCov / wTot : 0;
    const countOld = oN, countNew = nN;
    return {
      frame: globalFrameCounter,
      subMode: dExpSubMode,
      stimF: stimF === -1 ? -1 : globalFrameCounter - stimF,
      pointerSpeed: Math.hypot(pointerVX, pointerVY),
      wakeMag, wakeAgeCov,
      velMag: oN ? oV/oN : 0,
      gradMag: oN ? oG/oN : 0,
      div: oN ? oDiv/oN : 0,
      shear: oN ? oSh/oN : 0,
      totalLoss: oN ? oTL/oN : 0,
      countOld, countNew,
      dOld: countOld ? oD/countOld : 0,
      dNew: countNew ? nD/countNew : 0,
    };
  }

  function writeDcausalRow() {
    const m = computeDcausalMetrics();
    dCausalLog.push(m);
    // 锚点观测：锚点个体 wakeMag / gradMag / density
    const anchorStats = dCausalAnchors.map((s, idx) => {
      const wk = sampleWake(s.x, s.y);
      const sizeFactor = Math.min(1, Math.max(0, (s.curScale - 0.05) / 0.22));
      const g = sampleVelocityGradient(s.x, s.y, sizeFactor, s.depth);
      const loss = Math.min(TOTAL_LOSS_CAP,
        Math.max(0,g.divergence)*DIV_LOSS_SCALE
        + Math.min(SHEAR_LOSS_CAP, g.shear*SHEAR_LOSS_SCALE));
      return `a${idx}{wk=${(Math.hypot(wk.x,wk.y)).toFixed(3)},gr=${((Math.abs(g.divergence)+g.shear)).toFixed(3)},tl=${loss.toFixed(3)},d=${s.density.toFixed(3)}}`;
    }).join(' ');
    console.log(
      `%c[D sub=${['','D1','D2','D3'][m.subMode]}] f=${m.frame.toString().padStart(4)} ` +
      `stimF=${(m.stimF===-1?'--':m.stimF.toString().padStart(3))}  ` +
      `wk=${m.wakeMag.toFixed(3)}  ` +
      `∇=${m.gradMag.toExponential(2)}  div=${m.div.toExponential(2)}  ` +
      `sh=${m.shear.toExponential(2)}  TL=${m.totalLoss.toFixed(3)}  ` +
      `Old=${m.countOld}(${m.dOld.toFixed(3)})  New=${m.countNew}(${m.dNew.toFixed(3)})  | ${anchorStats}`,
      m.stimF === -1 ? 'color:#90a4ae' :
        (m.stimF <= 5 ? 'color:#ffcc80' :
         (m.stimF <= 30 ? 'color:#ffab91' : 'color:#b0bec5')),
    );
  }

  // autoDcausalRun(subMode): 自动化"编程手指划过" + 输出 CSV
  //
  // 不碰 density 公式；只通过 depositWake() / 直接给采样点加 impulse / injectCloudEvent
  // 三条路径按 D1/D2/D3 开关，完全模拟真实 pointermove 的执行逻辑，
  // 但为了保证每次划过轨迹完全一致，使用恒定速度从 (0.1W, 0.55H) → (0.9W, 0.45H)
  // 在 ~20 帧中完成刺激。前 30 帧 baseline，后 120 帧观察；总 150+30 = 180 帧
  function autoDcausalRun(subMode) {
    // 1. 初始化 D 子实验（如果还没）
    if (experimentMode !== 4 || dExpSubMode !== subMode) {
      startDSubExperiment(subMode);
    }
    // 2. 基线 30 帧：不动 Wake / Impulse，只推进渲染 & 写 D row
    // 3. 第 31 帧开始：20 帧划过（恒定速度），按 wakeOn / impOn 注入
    // 4. 划过途中每帧 injectCloudEvent 几次，模拟手指画云 = 新云诞生
    // 5. 后 120 帧：自然演化，不再注入
    const wakeOn = subMode === 1 || subMode === 3;
    const impOn  = subMode === 2 || subMode === 3;
    const N_BASE = 30, N_STIM = 20, N_OBS = 120;
    const total = N_BASE + N_STIM + N_OBS;
    const fromX = viewW * 0.1,  fromY = viewH * 0.55;
    const toX   = viewW * 0.9,  toY   = viewH * 0.45;
    const pvx   = (toX - fromX) / N_STIM;
    const pvy   = (toY - fromY) / N_STIM;
    const cy = viewH / 2;
    // 标记刺激开始帧号 = 基线帧数
    dExpStimulusStartFrame = globalFrameCounter + N_BASE;
    // 关掉手动交互的标记（避免和手动路径混）
    window.__dbg_dExpMarkStimulus = false;
    let step = 0;
    const interval = setInterval(() => {
      // 每次 tick = 物理上"推进 ~1 帧"的等价（我们不在 tick 中写 stepFrame 的代码，
      // 只在下一帧主循环前把 Wake/Impulse 注入一次，然后交给 requestAnimationFrame 的主循环）
      // 我们在这里把 wake deposit / impulse / cloud 注入"提前提交"，
      // 让 requestAnimationFrame 的 step 在之后读到这些改动。
      if (step >= N_BASE && step < N_BASE + N_STIM) {
        const t = (step - N_BASE) / Math.max(1, N_STIM - 1);
        const x = fromX + (toX - fromX) * t;
        const y = fromY + (toY - fromY) * t;
        const dist = Math.hypot(pvx, pvy);
        // — 路径 1：depositWake（WakeOnly / Both 用）
        if (wakeOn && dist > 0.5) {
          depositWake(x, y, pvx * 0.04, pvy * 0.04, 1.0);
        }
        // — 路径 2：impulse 直接给采样点动量（ImpulseOnly / Both 用）
        if (impOn && dist > 0.5) {
          const r2 = fieldConfig.impulseR * fieldConfig.impulseR;
          const R = fieldConfig.impulseR;
          const im = fieldConfig.impulseMag;
          for (let i = 0; i < samplingPoints.length; i++) {
            const s = samplingPoints[i];
            const dx = s.x - x, dy = s.y - y;
            const d2 = dx*dx + dy*dy;
            if (d2 > r2) continue;
            const d = Math.sqrt(d2) + 1e-4;
            const fall = 1 - d / R;
            const push = fall * fall;
            s.vx += pvx * im * push;
            s.vy += pvy * im * push;
          }
        }
        // — 路径 3：注入新云（模拟手指在画云模式沿路径释放），用于"新云 vs 老云"分组
        const subT = (step - N_BASE);
        if (subT % 2 === 0) {
          const ang = Math.random() * Math.PI * 2;
          const rr = 12 + Math.random() * 18;
          const ix = x + Math.cos(ang) * rr;
          const iy = y + Math.sin(ang) * rr;
          injectCloudEvent(ix, iy, { count: 5 + Math.floor(Math.random() * 3), spread: 20 });
        }
        // 模拟 pointer 位置（便于 D row 打印 pointerSpeed）
        pointerX = x; pointerY = y;
        pointerVX = pvx; pointerVY = pvy;
      } else {
        // baseline / observation 期间：pointer speed = 0
        pointerVX = 0; pointerVY = 0;
      }
      step++;
      if (step >= total) {
        clearInterval(interval);
        // 跑完：导出 CSV
        setTimeout(exportDcausalCSV, 50);
      }
    }, 16); // ≈ 60fps tick
    console.log(`%c[D Auto] 启动 D${subMode} 自动化划过`,
      'color:#64b5f6;font-weight:bold',
      `基线${N_BASE}帧 → 刺激${N_STIM}帧(路径1/2/3 按子模式注入) → 观察${N_OBS}帧`);
  }

  function exportDcausalCSV() {
    const hdr = [
      'frame','subMode','stimF','pointerSpeed',
      'wakeMag','wakeAgeCov','velMag','gradMag','div','shear','totalLoss',
      'countOld','countNew','dOld','dNew'
    ];
    const lines = [hdr.join(',')];
    for (const m of dCausalLog) {
      lines.push([
        m.frame, m.subMode, m.stimF, m.pointerSpeed,
        m.wakeMag.toFixed(6), m.wakeAgeCov.toFixed(4),
        m.velMag.toFixed(6), m.gradMag.toFixed(6), m.div.toFixed(6),
        m.shear.toFixed(6), m.totalLoss.toFixed(6),
        m.countOld, m.countNew, m.dOld.toFixed(6), m.dNew.toFixed(6)
      ].join(','));
    }
    const csv = lines.join('\n');
    console.log('[D CSV] 总行数：' + dCausalLog.length + '。完整 CSV 已 console.log（变量 window.__dbg_dCsv 可拿到）');
    window.__dbg_dCsv = csv;
    try { console.log(csv); } catch {}
  }

  function resetExperiment() {
    experimentMode = 0;
    experimentFrame = 0;
    fieldConfig = { ...defaultFieldConfig };
    baselineAvgDensity = 0;
    acceptBaseline = null;
    dCausalAnchors = [];
    // D 子实验状态清理
    dExpStimulusStartFrame = -1;
    dExpSubMode = 0;
    dLastPointerSpeed = 0;
    dCausalLog = [];
    window.__dbg_dExpMarkStimulus = false;
    console.log('%c[Normal] 正常模式', 'color:#81c784;font-weight:bold');
  }

  window.addEventListener('keydown', (e) => {
    switch (e.key) {
      case '0': resetExperiment(); break;
      case '1': startExperiment(1); break;
      case '2': startExperiment(2); break;
      case '3': startExperiment(3); break;
      case '4': startExperiment(4); break;
      case '5': printAcceptanceTable(true); break;
      // ---- D 因果实验（真正可测量版） ----
      case '6': startDSubExperiment(1); break; // D1 WakeOnly
      case '7': startDSubExperiment(2); break; // D2 ImpulseOnly
      case '8': startDSubExperiment(3); break; // D3 Both
      case '9': exportDcausalCSV(); break;
      case 'R': case 'r':
        if (e.shiftKey) {
          // Shift+R：按 dExpSubMode 当前值自动化跑。
          //   若用户刚按 6/7/8 → dExpSubMode = 1/2/3 → 跑对应子实验
          //   若从未选过（dExpSubMode=0）→ 提示先选，不要偷偷 Both
          if (dExpSubMode === 0) {
            console.log('[Shift+R] 请先按 6=D1(WakeOnly) / 7=D2(ImpulseOnly) / 8=D3(Both) 选择子实验。');
          } else {
            const sm = dExpSubMode;
            const msg = (['','D1 WakeOnly','D2 ImpulseOnly','D3 Both'])[sm];
            console.log(`%c[Shift+R] 启动自动化 D 因果实验：${msg}`, 'color:#4fc3f7;font-weight:bold');
            autoDcausalRun(sm);
          }
        } else if (dExpSubMode === 0) {
          console.log('[D] 请先按 6=D1 / 7=D2 / 8=D3 启动子实验。要自动化跑则按 Shift+R。');
        }
        break;
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
      '%c V0.4-beta+4 Physical Semantics Acceptance Table ',
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

  // ================== 速度场采样 ==================
  //
  // V0.4-beta-2 核心：采样速度场 + 其空间梯度
  // 不再使用：|v| magnitude loss、curl amplitude loss、wake field magnitude loss
  //
  // loss 只由两项贡献：
  //   divLoss   = max(0, div(v)) * DIV_LOSS_SCALE      —— 扩散区云被"拉薄"
  //   shearLoss = shear(v) * SHEAR_LOSS_SCALE, cap     —— 剪切区云被"撕散"
  //   totalLoss = min(CAP, divLoss + shearLoss)
  //   s.density *= (1 - totalLoss)
  // 验收：
  //   实验 A 静止 → div=0, shear=0 → loss=0 → density 保持 ✓
  //   实验 B 匀速 → div=0, shear=0 → loss=0 → density 保持 ✓
  //   实验 C 剪切 → shear>0 → loss>0 → density ↓ ✓
  //   实验 D Wake → wake 速度场有空间梯度 → div/shear>0 → density ↓ ✓
  // ==================================================================

  function sampleTotalVelocity(x, y, sizeFactor, depth) {
    // V0.4-beta: 物理语义 velocity 场（只提供局部 V，不做 magnitude 衰减）
    let vx = 0, vy = 0;

    // 1) 背景风（B 用 uniform；C 用 shear；否则自然风 × windAmp）
    if (fieldConfig.uniformVx !== 0) {
      vx += fieldConfig.uniformVx;
    }
    if (fieldConfig.shearVyKx !== 0) {
      const cx = viewW / 2;
      vy += fieldConfig.shearVyKx * (x - cx);
    }
    if (fieldConfig.windAmp > 0 && fieldConfig.uniformVx === 0 && fieldConfig.shearVyKx === 0) {
      // 自然全局风（温和）：按时间轻微摆动
      const amp = fieldConfig.windAmp;
      const t = globalFrameCounter * 0.004;
      vx += Math.cos(t) * amp * 0.15;
      vy += Math.sin(t * 1.7) * amp * 0.08;
    }
    // 2) Curl 扰流（A/B/C 验收时 curlAmp=0；默认开启 curl=1.0）
    if (fieldConfig.curlAmp > 0) {
      const cx = viewW / 2, cy = viewH / 2;
      const nx = (x - cx) / Math.max(1, viewW);
      const ny = (y - cy) / Math.max(1, viewH);
      const t = globalFrameCounter * 0.0015;
      const ang = Math.sin(nx * 4.3 + t) * Math.cos(ny * 3.7 - t) * 6.28 + (nx + ny) * 5.2;
      const mag = 0.25 * fieldConfig.curlAmp;
      vx += Math.cos(ang) * mag;
      vy += Math.sin(ang) * mag;
    }
    // 3) 粒子自身动量（interactionMode = drag 时，粒子 vx/vy 会被 pointer impulse 影响）
    vx += 0;
    vy += 0;
    // 4) Wake 场（手指拖尾）耦合系数
    if (fieldConfig.wakeActive) {
      const w = sampleWake(x, y);
      vx += w.x * 1.8;
      vy += w.y * 1.8;
    }
    return { vx, vy };
  }

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
    // 2D shear magnitude ≈ 空间差分"最大方向变形率"的简单代理
    //   = |dvx/dx - dvy/dy|/2 + |dvx/dy| + |dvy/dx|
    const shear =
      Math.abs(dvxdx - dvydy) * 0.5 +
      Math.abs(dvxdy) +
      Math.abs(dvydx);

    return { vx: c.vx, vy: c.vy, divergence, shear };
  }

  // ================== 主循环 ==================
  let lastTs = performance.now();
  function stepFrame() {
    const ts = performance.now();
    let dt = Math.min(32, ts - lastTs);
    lastTs = ts;
    const dtFrames = Math.max(0.2, dt / 16.67);
    globalFrameCounter++;

    // Wake 老化
    stepWake(dtFrames);

    // A/B/C/D 日志 & 自动判定
    logExperimentStatus();
    // D 实验：每帧记一行到 CSV 缓冲
    if (experimentMode === 4) {
      // 前 10 帧先建立锚点
      if (dCausalAnchors.length === 0 && samplingPoints.length > 0) {
        const N = Math.min(4, samplingPoints.length);
        for (let i = 0; i < N; i++) {
          const idx = Math.floor((samplingPoints.length - 1) * i / Math.max(1, N - 1));
          dCausalAnchors.push(samplingPoints[idx]);
        }
      }
      writeDcausalRow();
    }

    // 采样步进：每采样点按 V(x,y) 做 advection；按 V 的梯度（div + shear）做 density 衰减
    for (let i = 0; i < samplingPoints.length; i++) {
      const s = samplingPoints[i];
      const sizeFactor = Math.min(1, Math.max(0, (s.curScale - 0.05) / MAX_SCALE_SPAN));
      const vel = sampleTotalVelocity(s.x, s.y, sizeFactor, s.depth);
      // 粒子速度 = 场 + 自身动量（drag 模式下有剩余动量）
      s.vx *= Math.pow(0.94, dtFrames);
      s.vy *= Math.pow(0.94, dtFrames);
      s.x += (vel.vx + s.vx) * dtFrames;
      s.y += (vel.vy + s.vy) * dtFrames;

      // scale 呼吸（微小）
      const breathe = 0.996 + 0.008 * (
        Math.sin(globalFrameCounter * 0.04 + s.seed * 9.3) * 0.5 +
        Math.sin(globalFrameCounter * 0.017 + s.seed * 4.1) * 0.5
      );
      s.curScale = s.scale * breathe;

      // V0.4-beta-2 核心：密度衰减 = 散度 + 剪切（纯梯度驱动）
      //   divLoss = 散度为正（云被拉开变薄）时产生 loss，散度为负时不获益
      //   shearLoss = shear * scale，被截断到 cap
      //   totalLoss = min(TOTAL_LOSS_CAP, divLoss + shearLoss)
      const grad = sampleVelocityGradient(s.x, s.y, sizeFactor, s.depth);

      const divLoss   = Math.max(0, grad.divergence) * DIV_LOSS_SCALE;
      const shearLoss = Math.min(SHEAR_LOSS_CAP, grad.shear * SHEAR_LOSS_SCALE);

      const totalLoss = Math.min(TOTAL_LOSS_CAP, divLoss + shearLoss);
      s.density *= (1 - totalLoss);

      // 最终 alpha = 每单位 density 的视觉浓度 × 当前 density × 呼吸
      s.alpha = s.baseAlpha * s.density;
      // 额外 alpha 的 scale 起伏（模拟毛笔斑边缘）：density 低时边缘更碎
      s.alpha *= (0.9 + 0.1 * Math.sin(globalFrameCounter * 0.03 + s.seed * 11.2));

      // 画面边界：环绕（柔和 wrap）
      const margin = 20;
      if (s.x < -margin) s.x += viewW + margin * 2;
      if (s.x > viewW + margin) s.x -= viewW + margin * 2;
      if (s.y < -margin) s.y += viewH + margin * 2;
      if (s.y > viewH + margin) s.y -= viewH + margin * 2;

      // density 接近 0 的粒子：给它一个 releaseDelay 准备回收，但不等于立刻 death
      if (s.density < 0.02) {
        s.releaseDelay += dtFrames;
      } else if (s.density > 0.1) {
        s.releaseDelay = 0;
      }
    }
    // 回收 density < 0.02 且持续 30+ 帧的粒子（真正"云散"后不再占预算）
    // 注意：这是 releaseSamplingPoint（数值清理），不计算 density。
    // 若 density 语义错，回收就会错；但回收本身不制造新语义。
    for (let i = samplingPoints.length - 1; i >= 0; i--) {
      if (samplingPoints[i].releaseDelay > 45) releaseSamplingPoint(i);
    }
    // 云数量预算管理（自然补 / 硬上限回收）
    manageCloudBudget();

    // ====== 渲染 ======
    renderClouds();

    requestAnimationFrame(stepFrame);
  }

  // —— 启动 ——
  (function startLoop() {
    resizeCanvas();
    lastTs = performance.now();
    console.log('%cCloudscape V0.4-beta+4 · Visual Validation Baseline',
      'color:#4fc3f7;font-weight:bold;font-size:14px');
    console.log(
      '%c  β+1 WAKE×0.25 → β+2 SHEAR 3.5→2.0 → β+3 2.0→1.5 → β+4 1.5→1.0  ' +
      '| WAKE=0.25 SHEAR=1.0 DIV=4.5 CAPs=0.04/0.055 decay=0.994 · ALL LOCKED  ',
      'background:#1a1a2e;color:#b3e5fc;padding:3px 8px;border-radius:3px',
    );

    // ================================================================
    // 静态代码审计结果（构建时打印）
    // 验证：s.density 的写路径只有两处（无 baseLoss/speedLoss/curlLoss/wakeLoss 残留）
    // 1. releaseSamplingPoint → splice（不碰 density）
    // 2. s.density *= (1 - totalLoss)  ← 唯一物理衰减（div + shear 梯度）
    // ================================================================
    console.log('%c[Static Audit] s.density 写路径审计：',
      'color:#fbc02d;font-weight:bold');
    console.log('  1) injectCloudEvent():  density ← 1.0 （释放时初始化）');
    console.log('  2) stepFrame() 主循环:  s.density *= (1 - totalLoss)');
    console.log('        totalLoss = min(0.055, max(0,div)*4.5 + min(0.04, shear*1.0))');
    console.log('     — 没有 baseLoss / speedLoss / stretchLoss / curlLoss / wakeLoss / lifespan');
    console.log('     — releaseSamplingPoint 只 splice 数组，不写 density');
    printAcceptanceTable(true);

    // 启动
    requestAnimationFrame(stepFrame);
  })();

  // ================== 截图 ==================
  function takeScreenshot() {
    const stamp = new Date();
    const yyyy = stamp.getFullYear();
    const mm = String(stamp.getMonth() + 1).padStart(2, '0');
    const dd = String(stamp.getDate()).padStart(2, '0');
    const hh = String(stamp.getHours()).padStart(2, '0');
    const mi = String(stamp.getMinutes()).padStart(2, '0');
    const ss = String(stamp.getSeconds()).padStart(2, '0');
    const filename = `云境留影_${yyyy}${mm}${dd}_${hh}${mi}${ss}.png`;
    try {
      const dataURL = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = dataURL;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      console.log('[留影] 已下载：' + filename);
    } catch (e) {
      console.warn('[留影] 导出失败：', e);
    }
  }
})();
