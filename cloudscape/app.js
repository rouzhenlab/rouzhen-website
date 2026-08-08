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
  //               ↑ 密度损失 ≠ 粒子释放；只有当采样 density 被 div + shear 梯度耗竭时才是"云散"
  //
  // 核心承诺（必须经过物理语义验收）：
  //   A. 静止时 V=0 且 ∇V=0 → density 10 秒变化 ≤ 0.1%
  //   B. 匀速平移时 V≠0 但 ∇V=0 → density 10 秒变化 ≤ 0.1%
  //   C. 有梯度时 ∇V≠0 → density 被重新分布（有升有降，总量不守恒但语义明确）
  //   D. Wake 产生时：Wake deposit → 局部 ∇V → div/shear loss → 新云/老云分别采样
  //
  // 版本线：V0.4-beta+4（本文件）  上版：V0.4-beta+3  下一刀：视觉验证后决定
  // ==================================================================

  const canvas = document.getElementById('cloudCanvas');
  const ctx = canvas.getContext('2d');
  let viewW = 0, viewH = 0, dpr = Math.max(1, window.devicePixelRatio || 1);
  function resizeCanvas() {
    const w = window.innerWidth, h = window.innerHeight;
    viewW = w; viewH = h;
    canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    rebuildWakeGrid();
  }
  window.addEventListener('resize', resizeCanvas);

  const TARGET_COUNT = 620;
  const MAX_COUNT_HARD = 900;
  const MAX_SCALE_SPAN = 0.27;

  /** @type {Array<{x:number,y:number,vx:number,vy:number,rot:number,rotSpeed:number,scale:number,curScale:number,
   * baseAlpha:number,alpha:number,density:number,tex:any,depth:number,stretchAmount:number,
   * stretchAngle:number,breathSeed:number,breathFreq:number,squishY:number,birthFrame:number}>} */
  const samplingPoints = [];
  const releaseQueue = [];

  function makeInkTexture(shapeIdx) {
    const SZ = 256;
    const cc = document.createElement('canvas'); cc.width = SZ; cc.height = SZ;
    const cx = cc.getContext('2d'); cx.clearRect(0, 0, SZ, SZ);
    const centerX = SZ/2 + (Math.random() - 0.5) * 18;
    const centerY = SZ/2 + (Math.random() - 0.5) * 18;
    const layers = 5 + (shapeIdx % 3);
    for (let l = 0; l < layers; l++) {
      const radius = (SZ * 0.18) + l * (SZ * 0.075) + Math.random() * 10;
      const alphaF = 0.34 - l * 0.045;
      const grad = cx.createRadialGradient(centerX, centerY, radius * 0.08, centerX, centerY, radius);
      grad.addColorStop(0, `rgba(240,240,240,${(0.9 * alphaF).toFixed(3)})`);
      grad.addColorStop(0.35, `rgba(220,220,220,${(0.72 * alphaF).toFixed(3)})`);
      grad.addColorStop(0.7, `rgba(180,180,180,${(0.38 * alphaF).toFixed(3)})`);
      grad.addColorStop(1, `rgba(0,0,0,0)`);
      cx.fillStyle = grad;
      const ox = Math.cos(l * 1.2 + shapeIdx) * 7 * l * 0.3;
      const oy = Math.sin(l * 1.7 + shapeIdx * 0.5) * 7 * l * 0.3;
      cx.beginPath();
      if (shapeIdx % 3 === 2) {
        cx.ellipse(centerX + ox, centerY + oy, radius * 1.15, radius * 0.72, (l + shapeIdx) * 0.13, 0, Math.PI * 2);
      } else {
        const nPts = 48;
        for (let p = 0; p <= nPts; p++) {
          const ang = (p / nPts) * Math.PI * 2;
          const wob = 1 + Math.sin(ang * 3 + l + shapeIdx) * 0.06 + Math.sin(ang * 5 + l * 2) * 0.03 + Math.sin(ang * 9 + shapeIdx) * 0.02;
          const rx = (radius + (shapeIdx & 1) * 4) * wob;
          const ry = radius * wob * 0.93;
          const x = centerX + ox + Math.cos(ang) * rx;
          const y = centerY + oy + Math.sin(ang) * ry;
          if (p === 0) cx.moveTo(x, y); else cx.lineTo(x, y);
        }
        cx.closePath();
      }
      cx.fill();
    }
    const imgData = cx.getImageData(0, 0, SZ, SZ);
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      if (a > 0 && a < 120) {
        const n = Math.random();
        if (n < 0.17) data[i + 3] = Math.max(0, a - 28);
        else if (n < 0.28) data[i + 3] = Math.min(255, a + 20);
      }
    }
    cx.putImageData(imgData, 0, 0);
    cx.globalCompositeOperation = 'lighter';
    const hl = cx.createRadialGradient(centerX - radius * 0.25, centerY - radius * 0.35, 0, centerX - radius * 0.25, centerY - radius * 0.35, radius * 0.7);
    hl.addColorStop(0, 'rgba(255,255,255,0.13)'); hl.addColorStop(1, 'rgba(0,0,0,0)');
    cx.fillStyle = hl; cx.fillRect(0, 0, SZ, SZ);
    cx.globalCompositeOperation = 'source-over';
    return cc;
  }
  let INK_TEXTURES = [];
  function buildInkTextures(n) { INK_TEXTURES = new Array(n); for (let i = 0; i < n; i++) INK_TEXTURES[i] = makeInkTexture(i); }
  buildInkTextures(8);

  const bgImg = new Image();
  let bgScale = 1, bgX = 0, bgY = 0;
  window._bgSet = function({url,scale,dx,dy}) {
    if (url) bgImg.src = url;
    if (scale != null) bgScale = scale;
    if (dx != null) bgX = dx;
    if (dy != null) bgY = dy;
  };

  const WAKE_CELL = 36;
  const WAKE_STRENGTH_SCALE = 0.25;
  const DIV_LOSS_SCALE   = 4.5;
  const SHEAR_LOSS_SCALE = 1.0;
  const SHEAR_LOSS_CAP   = 0.04;
  const TOTAL_LOSS_CAP   = 0.055;
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
    const col = Math.floor(x / WAKE_CELL), row = Math.floor(y / WAKE_CELL);
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const c = col + dc, r = row + dr;
      if (c < 0 || r < 0 || c >= wakeCols || r >= wakeRows) continue;
      const w = 1 - Math.hypot(dc, dr) / 1.8; if (w <= 0) continue;
      const idx = r * wakeCols + c;
      wakeVX[idx] = wakeVX[idx] * (1 - w * 0.5) + vx * strength * w * WAKE_STRENGTH_SCALE;
      wakeVY[idx] = wakeVY[idx] * (1 - w * 0.5) + vy * strength * w * WAKE_STRENGTH_SCALE;
      if (wakeAge[idx] > 0) wakeAge[idx] = Math.min(wakeAge[idx], 2);
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
      vx += wakeVX[idx] * wt * decay; vy += wakeVY[idx] * wt * decay; wsum += wt;
    }
    if (wsum === 0) return { x: 0, y: 0 };
    return { x: vx / wsum, y: vy / wsum };
  }
  function stepWake(dtFrames) {
    const decay = Math.pow(0.994, dtFrames);
    for (let i = 0; i < wakeVX.length; i++) { wakeVX[i] *= decay; wakeVY[i] *= decay; wakeAge[i] += dtFrames; }
  }

  function releaseSamplingPoint(idx) { samplingPoints.splice(idx, 1); }
  let globalFrameCounter = 0;
  const seeded_rand = (seed) => {
    const mulberry32 = function(a) {
      return function() {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
      };
    };
    return mulberry32((seed * 2654435761) >>> 0);
  };
  function gaussianEnvelope(r, sigma) { return Math.exp(-(r * r) / (2 * sigma * sigma)); }
  function injectCloudEvent(cx, cy, opt) {
    const count = opt?.count ?? 12;
    const spread = opt?.spread ?? 40;
    const scaleBias = opt?.scaleBias ?? 1;
    const shapeSeed = (Date.now() ^ (cx * 73856093) ^ (cy * 19349663)) >>> 0;
    const rnd = seeded_rand(shapeSeed);
    for (let i = 0; i < count; i++) {
      const t1 = rnd(), t2 = rnd();
      const r = Math.sqrt(t1) * spread;
      const theta = t2 * Math.PI * 2;
      const dx = Math.cos(theta) * r, dy = Math.sin(theta) * r;
      const density = gaussianEnvelope(r, spread * 0.55);
      const x = cx + dx, y = cy + dy;
      const baseScale = (0.05 + rnd() * MAX_SCALE_SPAN) * scaleBias;
      const baseAlpha = (0.06 + rnd() * 0.10) * (0.3 + density * 0.7);
      samplingPoints.push({
        x, y,
        vx: (rnd() - 0.5) * 0.02 + (opt?.vx ?? 0),
        vy: (rnd() - 0.5) * 0.02 + (opt?.vy ?? 0),
        rot: rnd() * Math.PI * 2,
        rotSpeed: (rnd() - 0.5) * 0.004,
        scale: baseScale, curScale: baseScale,
        baseAlpha, alpha: baseAlpha, density,
        tex: INK_TEXTURES[(shapeSeed + i) % INK_TEXTURES.length],
        depth: rnd(), stretchAmount: 0, stretchAngle: 0,
        breathSeed: rnd() * Math.PI * 2,
        breathFreq: 0.3 + rnd() * 0.8,
        squishY: 0.78 + rnd() * 0.42,
        birthFrame: globalFrameCounter,
      });
    }
    while (samplingPoints.length > MAX_COUNT_HARD) {
      const idx = ((globalFrameCounter * 13) >>> 0) % samplingPoints.length;
      releaseSamplingPoint(idx);
    }
  }
  let frameSinceReleaseTrigger = 0;
  function autoReleaseTick() {
    frameSinceReleaseTrigger++;
    if (frameSinceReleaseTrigger < 60) return;
    frameSinceReleaseTrigger = 0;
    const overshoot = samplingPoints.length - TARGET_COUNT;
    if (overshoot <= 0) return;
    const toRelease = Math.min(overshoot, 60);
    for (let i = 0; i < toRelease; i++) {
      if (samplingPoints.length <= TARGET_COUNT) break;
      const idx = ((globalFrameCounter * 13 + i * 17) >>> 0) % samplingPoints.length;
      releaseSamplingPoint(idx);
    }
  }

  let pointerX = 0, pointerY = 0, pointerVX = 0, pointerVY = 0, isPointerDown = false, holdTimer = 0;
  function getPos(ev) {
    const rect = canvas.getBoundingClientRect();
    let clientX, clientY;
    if (ev.touches && ev.touches[0]) { clientX = ev.touches[0].clientX; clientY = ev.touches[0].clientY; }
    else { clientX = ev.clientX; clientY = ev.clientY; }
    const x = (clientX - rect.left) * (canvas.width / dpr) / rect.width;
    const y = (clientY - rect.top) * (canvas.height / dpr) / rect.height;
    return { x, y };
  }
  function ptrDown(ev) {
    ev.preventDefault();
    const p = getPos(ev);
    pointerX = p.x; pointerY = p.y; pointerVX = pointerVY = 0; isPointerDown = true; holdTimer = 0;
    if (experimentMode === 4) { if (dExpStimulusStartFrame === -1) dExpStimulusStartFrame = globalFrameCounter; }
    injectCloudEvent(pointerX, pointerY, { count: 10 });
  }
  function ptrMove(ev) {
    ev.preventDefault();
    const p = getPos(ev);
    const oldX = pointerX, oldY = pointerY;
    pointerX = p.x; pointerY = p.y;
    const speedX = pointerX - oldX, speedY = pointerY - oldY;
    pointerVX = 0.6 * pointerVX + 0.4 * speedX; pointerVY = 0.6 * pointerVY + 0.4 * speedY;
    if (isPointerDown) {
      if (experimentMode === 4) { if (dExpStimulusStartFrame === -1) dExpStimulusStartFrame = globalFrameCounter; }
      injectCloudEvent(pointerX, pointerY, { count: 4, spread: 20 });
      const pvx = pointerVX, pvy = pointerVY;
      const wakeAmount = Math.min(1.2, Math.hypot(pvx, pvy) * 0.08);
      if (wakeAmount > 0.04) depositWake(pointerX, pointerY, pvx * 0.04, pvy * 0.04, wakeAmount);
      autoReleaseTick();
    }
  }
  function ptrUp(ev) { isPointerDown = false; }
  canvas.addEventListener('mousedown', ptrDown);
  window.addEventListener('mousemove', ptrMove);
  window.addEventListener('mouseup', ptrUp);
  canvas.addEventListener('touchstart', ptrDown, { passive: false });
  canvas.addEventListener('touchmove', ptrMove, { passive: false });
  canvas.addEventListener('touchend', ptrUp);

  function sampleCurl(x, y) {
    const scale = 0.0019;
    const ang = Math.sin(x * scale) * Math.cos(y * scale * 1.4) * Math.PI * 2.0
              + Math.sin(x * scale * 0.5 + 3.1) * Math.cos(y * scale * 0.8 + 1.7) * 2.4
              + Math.sin((x + y) * scale * 0.3) * 4.7;
    return { x: Math.cos(ang) * 0.28, y: Math.sin(ang) * 0.28 };
  }
  function sampleAmbientWind(x, y) {
    if (experimentMode !== 0) return { x: 0, y: 0 };
    const base = 0.025;
    const wx = base * (0.9 + Math.sin(x * 0.0022) * 0.2 + Math.cos(y * 0.0017 + 0.8) * 0.25);
    const wy = base * (0.3 * Math.cos(x * 0.0013 - 1.1) + 0.2 * Math.sin(y * 0.0021 + 0.5));
    return { x: wx, y: wy };
  }
  function sampleTotalVelocity(x, y, sizeFactor, depth) {
    const wake = fieldConfig.wakeActive ? sampleWake(x, y) : { x: 0, y: 0 };
    const curl = sampleCurl(x, y);
    const wind = sampleAmbientWind(x, y);
    const curlWeight = fieldConfig.curlAmp * (0.7 + depth * 0.3 + sizeFactor * 0.1);
    return {
      x: (wind.x + curl.x * curlWeight) * fieldConfig.windAmp + wake.x * 1.8,
      y: (wind.y + curl.y * curlWeight) * fieldConfig.windAmp + wake.y * 1.8,
    };
  }
  function sampleVelocityGradient(x, y, sizeFactor, depth) {
    const EPS = 4;
    const c  = sampleTotalVelocity(x,       y,       sizeFactor, depth);
    const rx = sampleTotalVelocity(x + EPS, y,       sizeFactor, depth);
    const lx = sampleTotalVelocity(x - EPS, y,       sizeFactor, depth);
    const ry = sampleTotalVelocity(x,       y + EPS, sizeFactor, depth);
    const ly = sampleTotalVelocity(x,       y - EPS, sizeFactor, depth);
    const dvx_dx = (rx.x - lx.x) / (2 * EPS);
    const dvy_dy = (ry.y - ly.y) / (2 * EPS);
    const dvx_dy = (ry.x - ly.x) / (2 * EPS);
    const dvy_dx = (rx.y - lx.y) / (2 * EPS);
    const divergence = dvx_dx + dvy_dy;
    const shear = Math.abs(dvx_dy) + Math.abs(dvy_dx) + Math.abs(dvx_dx - dvy_dy) * 0.5;
    return { vx: c.x, vy: c.y, divergence, shear };
  }

  const ACCEPT_N_FRAMES     = 600;
  const ACCEPT_LOG_STEP     = 30;
  const ACCEPT_AB_RETENTION = 0.999;
  const ACCEPT_C_GRAD_MIN   = 1e-5;
  const ACCEPT_C_RETENTION  = 0.9;
  let experimentMode = 0, experimentFrame = 0, experimentBaselineDensity = 0;
  const defaultFieldConfig = { windAmp: 0.07, curlAmp: 1.0, wakeActive: true, impulseActive: true, impulseR: 90, impulseMag: 1.0 };
  let fieldConfig = { ...defaultFieldConfig };

  function computeAvgDensity() { if (!samplingPoints.length) return 0; let s=0; for (const p of samplingPoints) s += p.density; return s / samplingPoints.length; }
  function computeAvgGradMetrics() {
    if (!samplingPoints.length) return { avgDiv:0, avgShear:0, avgGrad:0, count:0 };
    let d=0, sh=0, c=0;
    for (const s of samplingPoints) {
      const sizeFactor = Math.min(1, Math.max(0, (s.curScale - 0.05) / MAX_SCALE_SPAN));
      const g = sampleVelocityGradient(s.x, s.y, sizeFactor, s.depth);
      d += g.divergence; sh += g.shear; c++;
    }
    return { avgDiv: d/c, avgShear: sh/c, avgGrad: (Math.abs(d)+sh)/c, count: c };
  }
  function computeAvgWakeMag() { if (!samplingPoints.length) return 0; let s=0; for (const p of samplingPoints) { const w=sampleWake(p.x,p.y); s+=Math.hypot(w.x,w.y); } return s/samplingPoints.length; }

  function startExperiment(mode) {
    experimentMode = mode; experimentFrame = 0; experimentBaselineDensity = 0;
    samplingPoints.length = 0; releaseQueue.length = 0;
    fieldConfig = { ...defaultFieldConfig, windAmp: 0, curlAmp: 0, wakeActive: false, impulseActive: false };
    dExpStimulusStartFrame = -1; dExpSubMode = 0; dCausalLog = []; window.__dbg_dExpMarkStimulus = false;
    const cx = viewW * 0.5, cy = viewH * 0.5;
    switch (mode) {
      case 1:
        injectCloudEvent(cx, cy, { count: 14, spread: 80 });
        console.log('%c[Exp A] 静止云 (A-ACC-01)', 'color:#4fc3f7;font-weight:bold', `共注入 ${samplingPoints.length} 采样点。自动跑 ${ACCEPT_N_FRAMES} 帧。`);
        console.log(`  PASS 标准：density 保留率 ≥ ${ACCEPT_AB_RETENTION}（10s 不掉超过 0.1%）`);
        console.log('  FAIL 原因：存在隐藏的 magnitude / 时间驱动 loss（等价于 lifespan）');
        break;
      case 2:
        injectCloudEvent(cx, cy, { count: 14, spread: 80 });
        for (const p of samplingPoints) { p.vx += 0.3; }
        console.log('%c[Exp B] 匀速平移 (B-ACC-01)', 'color:#4fc3f7;font-weight:bold', `共注入 ${samplingPoints.length} 采样点。`);
        console.log(`  PASS 标准：density 保留率 ≥ ${ACCEPT_AB_RETENTION}`);
        console.log('  FAIL 原因：Advection 被等同成 Dissipation（speedLoss / stretchAmount 基于 |v|）');
        break;
      case 3:
        injectCloudEvent(cx, cy, { count: 18, spread: 80 });
        for (const p of samplingPoints) { const dx = p.x - cx; p.vy += 0.003 * dx; }
        console.log('%c[Exp C] 剪切 (C-ACC-01)', 'color:#4fc3f7;font-weight:bold', `共注入 ${samplingPoints.length} 采样点。vy = 0.003*(x-cx)`);
        console.log(`  PASS 标准：avgGradMag ≥ ${ACCEPT_C_GRAD_MIN} 且 density 保留率 ≤ ${ACCEPT_C_RETENTION}`);
        console.log('  FAIL 原因（可能两种）：a) shear 项为 0，但 density 仍下降 → 隐藏 magnitude loss');
        console.log('    b) shear 非零但 density 不降 → shear→density 链路断');
        break;
      case 4:
        injectCloudEvent(cx, cy, { count: 20, spread: 110 });
        console.log('%c[Exp D] Wake 因果链', 'color:#4fc3f7;font-weight:bold');
        console.log('  操作：先按 6=D1(WakeOnly) / 7=D2(ImpulseOnly) / 8=D3(Both) 设定子模式；');
        console.log('        然后手动划过 或 按 Shift+R 执行自动化划过；每帧写入 dCausalLog。');
        console.log('  结束后按 9 导出 CSV。');
        break;
    }
  }

  let dCausalLogStep = 1, dCausalAnchors = [], dExpStimulusStartFrame = -1, dExpSubMode = 0, dLastPointerSpeed = 0, dCausalLog = [];

  function startDSubExperiment(subMode) {
    if (experimentMode !== 4) startExperiment(4);
    switch (subMode) {
      case 1: fieldConfig.wakeActive=true; fieldConfig.impulseActive=false;
        console.log('%c[D] D1 — WakeOnly', 'color:#ce93d8;font-weight:bold', 'impulseActive=false, wakeActive=true。Wake only → ∇V → shear → density。'); break;
      case 2: fieldConfig.wakeActive=false; fieldConfig.impulseActive=true;
        console.log('%c[D] D2 — ImpulseOnly', 'color:#ce93d8;font-weight:bold', 'wakeActive=false, impulseActive=true。Impulse only → velocity magnitude? → ∇V? → density。'); break;
      case 3: fieldConfig.wakeActive=true; fieldConfig.impulseActive=true;
        console.log('%c[D] D3 — Both', 'color:#ce93d8;font-weight:bold', 'Wake + Impulse：检验是否"双重打击"→ 灾难性 shear。'); break;
    }
    dExpSubMode = subMode; dExpStimulusStartFrame = -1; dCausalLog = []; window.__dbg_dExpMarkStimulus = true;
  }
  function computeDcausalMetrics() {
    const stimF = dExpStimulusStartFrame;
    let oN=0, oD=0, oV=0, oG=0, oDiv=0, oSh=0, oTL=0, nN=0, nD=0;
    for (const s of samplingPoints) {
      const isNew = stimF !== -1 && s.birthFrame >= stimF;
      const sizeFactor = Math.min(1, Math.max(0, (s.curScale - 0.05) / 0.22));
      const g = sampleVelocityGradient(s.x, s.y, sizeFactor, s.depth);
      const vmag = Math.hypot(g.vx, g.vy);
      const dl = Math.max(0, g.divergence) * DIV_LOSS_SCALE;
      const sl = Math.min(SHEAR_LOSS_CAP, g.shear * SHEAR_LOSS_SCALE);
      const tl = Math.min(TOTAL_LOSS_CAP, dl + sl);
      if (isNew) { nN++; nD += s.density; }
      else { oN++; oD += s.density; oV += vmag; oG += (Math.abs(g.divergence)+g.shear); oDiv += Math.abs(g.divergence); oSh += g.shear; oTL += tl; }
    }
    const wakeMag = computeAvgWakeMag();
    let wCov = 0, wTot = 0;
    for (let i = 0; i < wakeAge.length; i++) { wTot++; if (wakeAge[i] < 60) wCov++; }
    const wakeAgeCov = wTot ? wCov / wTot : 0;
    return {
      frame: globalFrameCounter, subMode: dExpSubMode,
      stimF: stimF === -1 ? -1 : globalFrameCounter - stimF,
      pointerSpeed: Math.hypot(pointerVX, pointerVY),
      wakeMag, wakeAgeCov,
      velMag: oN ? oV/oN : 0, gradMag: oN ? oG/oN : 0, div: oN ? oDiv/oN : 0,
      shear: oN ? oSh/oN : 0, totalLoss: oN ? oTL/oN : 0,
      countOld: oN, countNew: nN,
      dOld: oN ? oD/oN : 0, dNew: nN ? nD/nN : 0,
    };
  }
  function writeDcausalRow() {
    const m = computeDcausalMetrics();
    dCausalLog.push(m);
    const anchorStats = dCausalAnchors.map((s, idx) => {
      const wk = sampleWake(s.x, s.y);
      const sizeFactor = Math.min(1, Math.max(0, (s.curScale - 0.05) / 0.22));
      const g = sampleVelocityGradient(s.x, s.y, sizeFactor, s.depth);
      const loss = Math.min(TOTAL_LOSS_CAP, Math.max(0,g.divergence)*DIV_LOSS_SCALE + Math.min(SHEAR_LOSS_CAP, g.shear*SHEAR_LOSS_SCALE));
      return `a${idx}{wk=${(Math.hypot(wk.x,wk.y)).toFixed(3)},gr=${((Math.abs(g.divergence)+g.shear)).toFixed(3)},tl=${loss.toFixed(3)},d=${s.density.toFixed(3)}}`;
    }).join(' ');
    console.log(
      `%c[D sub=${['','D1','D2','D3'][m.subMode]}] f=${m.frame.toString().padStart(4)} ` +
      `stimF=${(m.stimF===-1?'--':m.stimF.toString().padStart(3))}  wk=${m.wakeMag.toFixed(3)}  ∇=${m.gradMag.toExponential(2)}  ` +
      `div=${m.div.toExponential(2)}  sh=${m.shear.toExponential(2)}  TL=${m.totalLoss.toFixed(3)}  ` +
      `Old=${m.countOld}(${m.dOld.toFixed(3)})  New=${m.countNew}(${m.dNew.toFixed(3)})  | ${anchorStats}`,
      m.stimF === -1 ? 'color:#90a4ae' : (m.stimF <= 5 ? 'color:#ffcc80' : (m.stimF <= 30 ? 'color:#ffab91' : 'color:#b0bec5')),
    );
  }
  function autoDcausalRun(subMode) {
    if (experimentMode !== 4 || dExpSubMode !== subMode) startDSubExperiment(subMode);
    const wakeOn = subMode === 1 || subMode === 3;
    const impOn  = subMode === 2 || subMode === 3;
    const N_BASE = 30, N_STIM = 20, N_OBS = 120;
    const total = N_BASE + N_STIM + N_OBS;
    const fromX = viewW * 0.1, fromY = viewH * 0.55, toX = viewW * 0.9, toY = viewH * 0.45;
    const pvx = (toX - fromX) / N_STIM, pvy = (toY - fromY) / N_STIM;
    dExpStimulusStartFrame = globalFrameCounter + N_BASE;
    window.__dbg_dExpMarkStimulus = false;
    let step = 0;
    const interval = setInterval(() => {
      if (step >= N_BASE && step < N_BASE + N_STIM) {
        const t = (step - N_BASE) / Math.max(1, N_STIM - 1);
        const x = fromX + (toX - fromX) * t;
        const y = fromY + (toY - fromY) * t;
        const dist = Math.hypot(pvx, pvy);
        if (wakeOn && dist > 0.5) depositWake(x, y, pvx * 0.04, pvy * 0.04, 1.0);
        if (impOn && dist > 0.5) {
          const r2 = fieldConfig.impulseR * fieldConfig.impulseR;
          const R = fieldConfig.impulseR, im = fieldConfig.impulseMag;
          for (let i = 0; i < samplingPoints.length; i++) {
            const s = samplingPoints[i];
            const dx = s.x - x, dy = s.y - y; const d2 = dx*dx + dy*dy;
            if (d2 > r2) continue;
            const d = Math.sqrt(d2) + 1e-4;
            const fall = 1 - d / R; const push = fall * fall;
            s.vx += pvx * im * push; s.vy += pvy * im * push;
          }
        }
        const subT = (step - N_BASE);
        if (subT % 2 === 0) {
          const ang = Math.random() * Math.PI * 2; const rr = 12 + Math.random() * 18;
          const ix = x + Math.cos(ang) * rr, iy = y + Math.sin(ang) * rr;
          injectCloudEvent(ix, iy, { count: 5 + Math.floor(Math.random() * 3), spread: 20 });
        }
        pointerX = x; pointerY = y; pointerVX = pvx; pointerVY = pvy;
      } else { pointerVX = 0; pointerVY = 0; }
      step++;
      if (step >= total) { clearInterval(interval); setTimeout(exportDcausalCSV, 50); }
    }, 16);
    console.log(`%c[D Auto] 启动 D${subMode} 自动化划过`, 'color:#64b5f6;font-weight:bold', `基线${N_BASE}帧 → 刺激${N_STIM}帧 → 观察${N_OBS}帧`);
  }
  function exportDcausalCSV() {
    const hdr = ['frame','subMode','stimF','pointerSpeed','wakeMag','wakeAgeCov','velMag','gradMag','div','shear','totalLoss','countOld','countNew','dOld','dNew'];
    const lines = [hdr.join(',')];
    for (const m of dCausalLog) lines.push([m.frame,m.subMode,m.stimF,m.pointerSpeed,m.wakeMag.toFixed(6),m.wakeAgeCov.toFixed(4),m.velMag.toFixed(6),m.gradMag.toFixed(6),m.div.toFixed(6),m.shear.toFixed(6),m.totalLoss.toFixed(6),m.countOld,m.countNew,m.dOld.toFixed(6),m.dNew.toFixed(6)].join(','));
    const csv = lines.join('\n');
    console.log('[D CSV] 总行数：' + dCausalLog.length + '。完整 CSV 存 window.__dbg_dCsv。');
    window.__dbg_dCsv = csv;
    try { console.log(csv); } catch {}
  }
  function resetExperiment() {
    experimentMode = 0; experimentFrame = 0; experimentBaselineDensity = 0;
    fieldConfig = { ...defaultFieldConfig };
    dCausalAnchors = []; dExpStimulusStartFrame = -1; dExpSubMode = 0; dLastPointerSpeed = 0; dCausalLog = [];
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
      case '6': startDSubExperiment(1); break;
      case '7': startDSubExperiment(2); break;
      case '8': startDSubExperiment(3); break;
      case '9': exportDcausalCSV(); break;
      case 'R': case 'r':
        if (e.shiftKey) {
          if (dExpSubMode === 0) console.log('[Shift+R] 请先按 6=D1(WakeOnly) / 7=D2(ImpulseOnly) / 8=D3(Both) 选择子实验。');
          else { const sm=dExpSubMode; const msg=(['','D1 WakeOnly','D2 ImpulseOnly','D3 Both'])[sm];
            console.log(`%c[Shift+R] 启动自动化 D 因果实验：${msg}`, 'color:#4fc3f7;font-weight:bold'); autoDcausalRun(sm); }
        } else if (dExpSubMode === 0) console.log('[D] 请先按 6=D1 / 7=D2 / 8=D3 启动子实验。要自动化跑则按 Shift+R。');
        break;
      case '5': printAcceptanceTable(true); break;
    }
  });

  let acceptanceTable = { A: null, B: null, C: null, D: null };
  function judgeExperiment() {
    if (experimentFrame !== ACCEPT_N_FRAMES) return;
    const finalDensity = computeAvgDensity();
    const retention = experimentBaselineDensity > 0 ? finalDensity / experimentBaselineDensity : 1;
    const grad = computeAvgGradMetrics();
    let verdict = null;
    switch (experimentMode) {
      case 1: {
        const passed = retention >= ACCEPT_AB_RETENTION;
        verdict = { passed, retention,
          reason: passed ? 'density 保持率 ≥ 阈值：静止不消散 ✓' : `density 下降 ${((1 - retention) * 100).toFixed(2)}%，存在隐藏 lifespan ✗`,
        }; acceptanceTable.A = verdict; break;
      }
      case 2: {
        const passed = retention >= ACCEPT_AB_RETENTION;
        verdict = { passed, retention,
          reason: passed ? 'density 保持率 ≥ 阈值：Advection ≠ Dissipation ✓' : `density 下降 ${((1 - retention) * 100).toFixed(2)}%，velocity magnitude 被当成 dissipation ✗`,
        }; acceptanceTable.B = verdict; break;
      }
      case 3: {
        const hasGrad = grad.avgGrad >= ACCEPT_C_GRAD_MIN;
        const densityDropped = retention <= ACCEPT_C_RETENTION;
        const passed = hasGrad && densityDropped;
        let reason;
        if (passed) reason = `avgGrad=${grad.avgGrad.toExponential(2)} ≥ ${ACCEPT_C_GRAD_MIN}，retention=${retention.toFixed(3)} ≤ ${ACCEPT_C_RETENTION}：梯度→density 链路连通 ✓`;
        else if (!hasGrad && !densityDropped) reason = `avgGrad=${grad.avgGrad.toExponential(2)} < ${ACCEPT_C_GRAD_MIN}，且 retention=${retention.toFixed(3)} > ${ACCEPT_C_RETENTION}：剪切流场没产生梯度 ✗`;
        else if (!hasGrad) reason = `avgGrad=${grad.avgGrad.toExponential(2)} < ${ACCEPT_C_GRAD_MIN}，但 retention=${retention.toFixed(3)} ≤ ${ACCEPT_C_RETENTION}：density 降了，但不是由 shear 引起（隐藏 magnitude loss） ✗`;
        else reason = `avgGrad=${grad.avgGrad.toExponential(2)} ≥ ${ACCEPT_C_GRAD_MIN}，但 retention=${retention.toFixed(3)} > ${ACCEPT_C_RETENTION}：shear→density 链路断了 ✗`;
        verdict = { passed, retention, avgGrad: grad.avgGrad, reason };
        acceptanceTable.C = verdict; break;
      }
    }
    if (verdict) {
      const tag = ['', 'A', 'B', 'C', 'D'][experimentMode];
      const p = verdict.passed;
      console.log('%c' + (p ? '✅ PASS' : '❌ FAIL') + ` [Exp ${tag}]`, 'color:' + (p ? '#81c784' : '#e57373') + ';font-weight:bold;font-size:13px');
      console.log('  ' + verdict.reason);
      console.log('  证据：', verdict);
      printAcceptanceTable();
    }
  }
  function printAcceptanceTable(hint) {
    console.log(...['%c V0.4-beta+4 Physical Semantics Acceptance Table ', 'background:#1a1a2e;color:#e0e0e0;padding:4px 8px;border-radius:4px;font-weight:bold']);
    const rows = [
      { exp: 'A 静止云', test: 'V=0, ∇V=0 → density 保持', v: acceptanceTable.A },
      { exp: 'B 匀速平移', test: 'V≠0, ∇V=0 → density 保持', v: acceptanceTable.B },
      { exp: 'C 剪切',    test: '∇V≠0 → density 重新分布', v: acceptanceTable.C },
      { exp: 'D Wake',    test: 'Wake → ∇V → density （人工观察因果顺序）', v: acceptanceTable.D },
    ];
    for (const r of rows) {
      let status, color;
      if (r.v === null) { status = 'PENDING'; color = '#ffb74d'; }
      else if (r.v.passed === undefined) { status = 'OBSERVE'; color = '#64b5f6'; }
      else if (r.v.passed) { status = 'PASS'; color = '#81c784'; }
      else { status = 'FAIL'; color = '#e57373'; }
      console.log(`  [${r.exp}] %c${status}%c — ${r.test}` + (r.v && r.v.reason ? ` | 原因：${r.v.reason}` : ''),
        `color:${color};font-weight:bold`, 'color:inherit;font-weight:normal');
    }
    if (hint) console.log('%c[提示] 按 1/2/3/4 启动对应实验；按 5 随时查看累积表；按 0 清空', 'color:#b0bec5');
  }
  function logExperimentStatus() {
    if (experimentMode === 0) return;
    experimentFrame++;
    if (experimentFrame === 1 && experimentBaselineDensity === 0) {
      experimentBaselineDensity = computeAvgDensity();
      const tag = ['Normal','A-静止','B-匀速','C-剪切','D-Wake'][experimentMode];
      console.log(`[Exp ${tag}] baseline avgDensity0=${experimentBaselineDensity.toFixed(4)}`);
    }
    if (experimentMode >= 1 && experimentMode <= 3) {
      if (experimentFrame % ACCEPT_LOG_STEP === 0) {
        const density = computeAvgDensity();
        const grad = computeAvgGradMetrics();
        const retention = experimentBaselineDensity > 0 ? density / experimentBaselineDensity : 1;
        const tag = ['Normal','A','B','C','D'][experimentMode];
        console.log(`[Exp ${tag}] frame=${experimentFrame}/${ACCEPT_N_FRAMES} avgDensity=${density.toFixed(4)} retention=${retention.toFixed(4)} avgDiv=${grad.avgDiv.toExponential(2)} avgShear=${grad.avgShear.toExponential(2)}`);
      }
      judgeExperiment();
      return;
    }
    if (experimentMode === 4 && experimentFrame % dCausalLogStep === 0) {
      if (dCausalAnchors.length === 0 && samplingPoints.length > 0) {
        const N = Math.min(4, samplingPoints.length);
        for (let i = 0; i < N; i++) {
          const idx = Math.floor((samplingPoints.length - 1) * i / Math.max(1, N - 1));
          dCausalAnchors.push(samplingPoints[idx]);
        }
      }
      writeDcausalRow();
    }
  }

  let windTime = 0, curlTime = 0, lastTs = performance.now();
  function updateAndRender(ts) {
    const dtMs = Math.min(50, ts - lastTs); lastTs = ts;
    const dt = dtMs / 1000; const dtFrames = Math.max(0.3, dt * 60);
    globalFrameCounter++;
    windTime += dt * 1.0; curlTime += dt * 0.5; stepWake(dtFrames);
    if (!isPointerDown) { pointerVX *= 0.9; pointerVY *= 0.9; }
    if (isPointerDown && experimentMode === 0) {
      holdTimer += dt;
      if (holdTimer > 0.145) {
        holdTimer = 0;
        injectCloudEvent(pointerX, pointerY, {
          count: 4 + ((Math.random() * 4) | 0), spread: 20, scaleBias: 0.94,
          vx: pointerVX * 0.03, vy: pointerVY * 0.03,
        });
      }
    }
    for (let i = samplingPoints.length - 1; i >= 0; i--) {
      const s = samplingPoints[i];
      const sizeFactor = Math.min(1, Math.max(0, (s.curScale - 0.05) / 0.22));
      const grad = sampleVelocityGradient(s.x, s.y, sizeFactor, s.depth);
      const damping = 0.985;
      const dampPerFrame = Math.pow(damping, dtFrames);
      s.vx = s.vx * dampPerFrame + grad.vx * dtFrames;
      s.vy = s.vy * dampPerFrame + grad.vy * dtFrames;
      const maxV = 0.8; const vlen = Math.hypot(s.vx, s.vy);
      if (vlen > maxV) { s.vx = s.vx / vlen * maxV; s.vy = s.vy / vlen * maxV; }
      s.x += s.vx * dtFrames; s.y += s.vy * dtFrames; s.rot += s.rotSpeed * dtFrames;
      const STRETCH_SCALE = 55;
      s.stretchAmount = Math.min(0.5, grad.shear * STRETCH_SCALE);
      if (vlen > 0.02) s.stretchAngle = Math.atan2(s.vy, s.vx);
      const divLoss   = Math.max(0, grad.divergence) * DIV_LOSS_SCALE;
      const shearLoss = Math.min(SHEAR_LOSS_CAP, grad.shear * SHEAR_LOSS_SCALE);
      const totalLoss = Math.min(TOTAL_LOSS_CAP, divLoss + shearLoss);
      s.density *= (1 - totalLoss);
      s.alpha = s.baseAlpha * s.density;
      const breath = Math.sin((s.x * 0.00019 + s.y * 0.00021) + s.breathSeed + curlTime * s.breathFreq) * 0.12;
      s.alpha *= (1 + breath);
      if (s.density < 0.0022) { releaseSamplingPoint(i); continue; }
      const offEdge = (s.x < -250 || s.x > viewW + 250 || s.y < -250 || s.y > viewH + 250);
      if (offEdge && s.alpha < 0.014) { releaseSamplingPoint(i); }
    }
    logExperimentStatus();
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    ctx.fillStyle = '#050706'; ctx.fillRect(0, 0, viewW, viewH);
    if (bgImg.complete && bgImg.naturalWidth > 0) {
      const cw = bgImg.naturalWidth * bgScale, ch = bgImg.naturalHeight * bgScale;
      ctx.drawImage(bgImg, viewW / 2 + bgX - cw / 2, viewH / 2 + bgY - ch / 2, cw, ch);
    }
    drawCloudField(samplingPoints);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  }
  function drawCloudField(list) {
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < list.length; i++) {
      const s = list[i]; const a = s.alpha;
      if (a < 0.0003) continue;
      const tex = s.tex; const tw = tex.width * s.curScale; const th = tex.height * s.curScale * s.squishY;
      ctx.save(); ctx.translate(s.x, s.y);
      if (s.stretchAmount > 0.01) { ctx.rotate(s.stretchAngle); ctx.scale(1 + s.stretchAmount, 1 - s.stretchAmount * 0.3); }
      else ctx.rotate(s.rot);
      ctx.globalAlpha = a; ctx.drawImage(tex, -tw / 2, -th / 2, tw, th); ctx.restore();
    }
  }
  window.__dbg = { samplingPoints, canvas, getPos, sampleCurl, sampleAmbientWind, sampleTotalVelocity, sampleVelocityGradient, fieldConfig, experimentMode };

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
      const a = document.createElement('a'); a.href = dataURL; a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      console.log('[留影] 已下载：' + filename);
    } catch (e) { console.warn('[留影] 导出失败：', e); }
  }
  window.takeScreenshot = takeScreenshot;

  (function startLoop() {
    resizeCanvas(); lastTs = performance.now();
    console.log('%cCloudscape V0.4-beta+4 · Visual Validation Baseline', 'color:#4fc3f7;font-weight:bold;font-size:14px');
    console.log('%c  β+1 WAKE×0.25 → β+2 SHEAR 3.5→2.0 → β+3 2.0→1.5 → β+4 1.5→1.0  | WAKE=0.25 SHEAR=1.0 DIV=4.5 CAPs=0.04/0.055 decay=0.994 · ALL LOCKED  ', 'background:#1a1a2e;color:#b3e5fc;padding:3px 8px;border-radius:3px');
    console.log('%c[静态代码审计] s.density 写路径（grep 结果）', 'color:#ce93d8;font-weight:bold');
    console.log('  ① 初始化赋值（injectCloudEvent 内）：density = gaussianEnvelope');
    console.log('  ② 演化循环内一处乘法：s.density *= (1 - totalLoss)');
    console.log('     totalLoss = min(0.055, max(0,div)*4.5 + min(0.04, shear*1.0))');
    console.log('  已确认：无 baseLoss / speedLoss / curlLoss / wakeLoss / lifespan / lifeAlpha / texSeq 残留。');
    console.log('  已确认：splice 统一封装为 releaseSamplingPoint()，语义为"释放数值预算"而非"Cloud Death"。');
    console.log('%c[操作] 按 1/2/3/4 启动实验；按 5 查看累积表；按 0 清空', 'color:#b0bec5');
    console.log('  1=静止云  2=匀速平移  3=剪切  4=Wake因果  5=打印验收表  takeScreenshot()=留影');
    function frame(ts) { updateAndRender(ts); requestAnimationFrame(frame); }
    requestAnimationFrame(frame);
  })();
})();
