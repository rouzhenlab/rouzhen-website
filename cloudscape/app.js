(() => {
  'use strict';
  // ============================================================
  // Cloudscape — Field-first rebuild
  //
  // Cloud state = { density field D, residual-wind field U }
  // evolving continuously in time. There is no particle, no
  // sprite, no discrete "cloud object". Every pixel the user
  // sees is a bilinear sample of a coarse scalar/vector field.
  //
  // Infra kept from the previous version (per spec §31):
  // canvas element, resize handling, pointer input plumbing,
  // background-image upload, clear/snapshot buttons.
  // Everything else (particles, groups, wake grid, shear/div
  // loss model) is gone — not migrated, not "frozen".
  // ============================================================

  const canvas = document.getElementById('mainCanvas');
  const ctx = canvas.getContext('2d');
  let viewW = 0, viewH = 0, dpr = Math.max(1, window.devicePixelRatio || 1);

  // ---- Core visual parameters (kept intentionally small) ----
  const CFG = {
    seedAmount: 1.35,     // density injected per click, before diffusion spreads it
    decayRate: 0.0026,    // per-frame density decay (structure weakens -> dissolves)
    diffusion: 0.16,      // per-pass diffusion blend strength
    flowStrength: 0.85,   // ambient wind amplitude (field cells/frame)
    noiseScale: 0.11,     // ambient wind spatial frequency
    noiseSpeed: 0.35,     // ambient wind temporal evolution speed
    windStrength: 2.2,    // how strongly pointer motion injects residual wind
    windRadius: 5.5,      // pointer influence radius, in field cells
    memoryDecay: 0.965    // residual wind decay per frame (atmospheric memory)
  };

  // ---- Field (simulation) resolution: low-res on purpose ----
  let FW = 0, FH = 0, CELL = 9; // ~9 css px per field cell
  let D = null, D2 = null;      // density, ping-pong scratch
  let Ux = null, Uy = null;     // residual wind (memory)
  let Ux2 = null, Uy2 = null;   // scratch for light diffusion of wind

  // Offscreen low-res canvas the field is tone-mapped into,
  // then upscaled onto the main canvas with smoothing.
  let fieldCanvas = null, fieldCtx = null, fieldImg = null;

  function idx(i, j) { return j * FW + i; }

  function allocateField() {
    FW = Math.max(48, Math.min(220, Math.round(viewW / CELL)));
    FH = Math.max(32, Math.min(140, Math.round(viewH / CELL)));
    D = new Float32Array(FW * FH);
    D2 = new Float32Array(FW * FH);
    Ux = new Float32Array(FW * FH);
    Uy = new Float32Array(FW * FH);
    Ux2 = new Float32Array(FW * FH);
    Uy2 = new Float32Array(FW * FH);
    fieldCanvas = document.createElement('canvas');
    fieldCanvas.width = FW; fieldCanvas.height = FH;
    fieldCtx = fieldCanvas.getContext('2d');
    fieldImg = fieldCtx.createImageData(FW, FH);
  }

  function resizeCanvas() {
    const w = window.innerWidth, h = window.innerHeight;
    viewW = w; viewH = h;
    canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    allocateField(); // re-forming the cloud on resize is an accepted tradeoff
  }
  window.addEventListener('resize', resizeCanvas);

  // ---- Background image (kept feature) ----
  const bgImg = new Image(); let bgScale = 1, bgX = 0, bgY = 0;
  window._bgSet = ({ url, scale, dx, dy }) => {
    if (url) bgImg.src = url;
    if (scale != null) bgScale = scale;
    if (dx != null) bgX = dx; if (dy != null) bgY = dy;
  };

  // ---- Time-coherent noise helpers (no per-frame Math.random) ----
  const seeds = []; for (let i = 0; i < 6; i++) seeds.push(Math.random() * 1000);

  // Ambient wind: a smooth function of (cellX, cellY, time). Continuous
  // in time by construction -- advancing t slightly changes the field
  // slightly, never jumps.
  function ambientFlow(i, j, t) {
    const s = CFG.noiseScale, sp = CFG.noiseSpeed;
    const vx = Math.sin(j * s + t * sp + seeds[0]) * 0.6
             + Math.sin((i + j) * s * 0.5 - t * sp * 0.7 + seeds[1]) * 0.4;
    const vy = Math.cos(i * s - t * sp * 0.8 + seeds[2]) * 0.6
             + Math.cos((i - j) * s * 0.5 + t * sp * 0.5 + seeds[3]) * 0.4;
    return { x: vx * CFG.flowStrength, y: vy * CFG.flowStrength };
  }

  // High-frequency, still time-coherent, used only at render time to
  // give meso/micro-scale internal variation without touching the
  // stored density (purely a visual multiply, never fed back).
  function detailNoise(i, j, t) {
    return 0.5 + 0.5 * Math.sin(i * 0.35 + seeds[4] + t * 0.6)
                     * Math.cos(j * 0.31 - seeds[5] + t * 0.5);
  }

  function smoothstep(a, b, x) {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }

  function bilinear(field, x, y) {
    const c0 = Math.floor(x), r0 = Math.floor(y);
    const c1 = c0 + 1, r1 = r0 + 1;
    const cc0 = Math.max(0, Math.min(FW - 1, c0)), cc1 = Math.max(0, Math.min(FW - 1, c1));
    const rr0 = Math.max(0, Math.min(FH - 1, r0)), rr1 = Math.max(0, Math.min(FH - 1, r1));
    const tx = x - c0, ty = y - r0;
    const v00 = field[idx(cc0, rr0)], v10 = field[idx(cc1, rr0)];
    const v01 = field[idx(cc0, rr1)], v11 = field[idx(cc1, rr1)];
    const a = v00 * (1 - tx) + v10 * tx;
    const b = v01 * (1 - tx) + v11 * tx;
    return a * (1 - ty) + b * ty;
  }

  // ---- Growth: injects a soft gaussian bump into D, not "particles" ----
  function seedCloud(cx, cy, amount) {
    const fi = cx / CELL, fj = cy / CELL;
    const R = CFG.windRadius;
    const i0 = Math.max(0, Math.floor(fi - R)), i1 = Math.min(FW - 1, Math.ceil(fi + R));
    const j0 = Math.max(0, Math.floor(fj - R)), j1 = Math.min(FH - 1, Math.ceil(fj + R));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const d = Math.hypot(i - fi, j - fj);
        if (d > R) continue;
        const w = Math.exp(-(d * d) / (2 * (R * 0.55) * (R * 0.55)));
        D[idx(i, j)] += amount * w;
      }
    }
  }

  // ---- Pointer: represents wind/disturbance, not force on a cloud ----
  let px = 0, py = 0, pvx = 0, pvy = 0, down = false, interactionMode = 'cloud';

  function getPos(e) {
    const r = canvas.getBoundingClientRect();
    let cx, cy;
    if (e.touches && e.touches[0]) { cx = e.touches[0].clientX; cy = e.touches[0].clientY; }
    else { cx = e.clientX; cy = e.clientY; }
    return { x: (cx - r.left) * (canvas.width / dpr) / r.width, y: (cy - r.top) * (canvas.height / dpr) / r.height };
  }

  function injectWind(x, y, vx, vy, strength) {
    const fi = x / CELL, fj = y / CELL;
    const R = CFG.windRadius;
    const i0 = Math.max(0, Math.floor(fi - R)), i1 = Math.min(FW - 1, Math.ceil(fi + R));
    const j0 = Math.max(0, Math.floor(fj - R)), j1 = Math.min(FH - 1, Math.ceil(fj + R));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const d = Math.hypot(i - fi, j - fj);
        if (d > R) continue;
        const w = (1 - d / R);
        const k = idx(i, j);
        Ux[k] += vx * strength * w * CFG.windStrength;
        Uy[k] += vy * strength * w * CFG.windStrength;
      }
    }
  }

  function pd(e) {
    e.preventDefault();
    const p = getPos(e); px = p.x; py = p.y; pvx = pvy = 0; down = true;
    if (interactionMode === 'cloud') seedCloud(px, py, CFG.seedAmount);
  }
  function pm(e) {
    e.preventDefault();
    const p = getPos(e); const ox = px, oy = py; px = p.x; py = p.y;
    const dx = px - ox, dy = py - oy;
    pvx = 0.6 * pvx + 0.4 * dx; pvy = 0.6 * pvy + 0.4 * dy;
    if (down) {
      const speed = Math.hypot(pvx, pvy);
      if (speed > 0.3) injectWind(px, py, pvx / CELL, pvy / CELL, Math.min(1.4, speed * 0.03));
    }
  }
  function pu() { down = false; }
  canvas.addEventListener('mousedown', pd); window.addEventListener('mousemove', pm); window.addEventListener('mouseup', pu);
  canvas.addEventListener('touchstart', pd, { passive: false }); canvas.addEventListener('touchmove', pm, { passive: false }); canvas.addEventListener('touchend', pu);

  // ---- Simulation step ----
  let simT = 0;
  function stepSim(dF) {
    simT += dF / 60;

    // 1. Residual wind (atmospheric memory): light spatial diffusion
    //    so disturbance eddies aren't needle-thin, then temporal decay.
    for (let j = 0; j < FH; j++) {
      for (let i = 0; i < FW; i++) {
        const k = idx(i, j);
        const iL = Math.max(0, i - 1), iR = Math.min(FW - 1, i + 1);
        const jU = Math.max(0, j - 1), jB = Math.min(FH - 1, j + 1);
        const avgX = (Ux[k] + Ux[idx(iL, j)] + Ux[idx(iR, j)] + Ux[idx(i, jU)] + Ux[idx(i, jB)]) / 5;
        const avgY = (Uy[k] + Uy[idx(iL, j)] + Uy[idx(iR, j)] + Uy[idx(i, jU)] + Uy[idx(i, jB)]) / 5;
        Ux2[k] = (Ux[k] * (1 - 0.25) + avgX * 0.25) * Math.pow(CFG.memoryDecay, dF);
        Uy2[k] = (Uy[k] * (1 - 0.25) + avgY * 0.25) * Math.pow(CFG.memoryDecay, dF);
      }
    }
    [Ux, Ux2] = [Ux2, Ux]; [Uy, Uy2] = [Uy2, Uy];

    // 2. Advect density through (ambient flow + residual wind).
    //    This is the ONLY thing that moves the cloud -- a field
    //    flowing through itself, not an object translating.
    for (let j = 0; j < FH; j++) {
      for (let i = 0; i < FW; i++) {
        const k = idx(i, j);
        const amb = ambientFlow(i, j, simT);
        const fx = amb.x + Ux[k], fy = amb.y + Uy[k];
        const srcX = i - fx * dF * 0.35, srcY = j - fy * dF * 0.35;
        D2[k] = bilinear(D, srcX, srcY);
      }
    }
    [D, D2] = [D2, D];

    // 3. Diffusion -- spreads density to neighbors, closing gaps and
    //    softening structure at the SIMULATION level (not a render hack).
    for (let j = 0; j < FH; j++) {
      for (let i = 0; i < FW; i++) {
        const k = idx(i, j);
        const iL = Math.max(0, i - 1), iR = Math.min(FW - 1, i + 1);
        const jU = Math.max(0, j - 1), jB = Math.min(FH - 1, j + 1);
        const avg = (D[k] + D[idx(iL, j)] + D[idx(iR, j)] + D[idx(i, jU)] + D[idx(i, jB)]) / 5;
        D2[k] = D[k] * (1 - CFG.diffusion) + avg * CFG.diffusion;
      }
    }
    [D, D2] = [D2, D];

    // 4. Decay -- dissolves into air, no lifecycle/delete logic per entity.
    const decay = Math.pow(1 - CFG.decayRate, dF);
    for (let k = 0; k < D.length; k++) D[k] *= decay;
  }

  // ---- Render: tone-map the field, then upscale with smoothing ----
  function renderField() {
    const data = fieldImg.data;
    const lightX = 0.6, lightY = -0.8; // fake light direction for volume cue
    for (let j = 0; j < FH; j++) {
      for (let i = 0; i < FW; i++) {
        const k = idx(i, j);
        const iL = Math.max(0, i - 1), iR = Math.min(FW - 1, i + 1);
        const jU = Math.max(0, j - 1), jB = Math.min(FH - 1, j + 1);
        const gx = D[idx(iR, j)] - D[idx(iL, j)];
        const gy = D[idx(i, jB)] - D[idx(i, jU)];
        const shade = Math.max(0, Math.min(1, 0.5 + (gx * lightX + gy * lightY) * 6));

        const dn = detailNoise(i, j, simT);
        const dv = D[k] * (0.8 + 0.4 * dn); // micro/meso structure, render-only
        const tone = smoothstep(0.05, 0.42, dv); // soft threshold: keeps hollows hollow, cores solid

        const brightness = 205 + shade * 45;
        const o = k * 4;
        data[o] = brightness; data[o + 1] = brightness; data[o + 2] = brightness + 6;
        data[o + 3] = Math.max(0, Math.min(255, tone * 235));
      }
    }
    fieldCtx.putImageData(fieldImg, 0, 0);
  }

  // ---- Main loop ----
  let wT = 0, lTS = performance.now();
  function uR(ts) {
    const dm = Math.min(50, ts - lTS); lTS = ts;
    const dt = dm / 1000, dF = Math.max(0.3, dt * 60);
    wT += dt;
    if (!down) { pvx *= 0.9; pvy *= 0.9; }

    stepSim(dF);
    renderField();

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    ctx.fillStyle = '#050706'; ctx.fillRect(0, 0, viewW, viewH);
    if (bgImg.complete && bgImg.naturalWidth > 0) {
      const cw = bgImg.naturalWidth * bgScale, ch = bgImg.naturalHeight * bgScale;
      ctx.drawImage(bgImg, viewW / 2 + bgX - cw / 2, viewH / 2 + bgY - ch / 2, cw, ch);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.globalCompositeOperation = 'screen';
    ctx.drawImage(fieldCanvas, 0, 0, FW, FH, 0, 0, viewW, viewH);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;

    requestAnimationFrame(uR);
  }

  // ---- Kept UI hooks ----
  function takeScreenshot() {
    const s = new Date(), y = s.getFullYear(), m = String(s.getMonth() + 1).padStart(2, '0'), d = String(s.getDate()).padStart(2, '0'),
      h = String(s.getHours()).padStart(2, '0'), mi = String(s.getMinutes()).padStart(2, '0'), se = String(s.getSeconds()).padStart(2, '0'),
      fn = `云境留影_${y}${m}${d}_${h}${mi}${se}.png`;
    try {
      const u = canvas.toDataURL('image/png');
      const a = document.createElement('a'); a.href = u; a.download = fn;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    } catch (e) { console.warn('[留影] 导出失败：', e); }
  }
  window.takeScreenshot = takeScreenshot;

  const btnCloud = document.getElementById('modeCloud'), btnDrag = document.getElementById('modeDrag');
  if (btnCloud) btnCloud.addEventListener('click', () => { interactionMode = 'cloud'; btnCloud.classList.add('active'); if (btnDrag) btnDrag.classList.remove('active'); });
  if (btnDrag) btnDrag.addEventListener('click', () => { interactionMode = 'drag'; btnDrag.classList.add('active'); if (btnCloud) btnCloud.classList.remove('active'); });
  const bgUploader = document.getElementById('bgUploader');
  if (bgUploader) bgUploader.addEventListener('change', (e) => {
    const f = e.target.files[0]; if (!f) return;
    const url = URL.createObjectURL(f); const img = new Image();
    img.onload = () => { const sc = Math.min(viewW / img.naturalWidth, viewH / img.naturalHeight) * 0.92; window._bgSet({ url, scale: sc, dx: 0, dy: 0 }); };
    img.src = url;
  });
  const clearBtn = document.getElementById('clearBtn');
  if (clearBtn) clearBtn.addEventListener('click', () => { D.fill(0); Ux.fill(0); Uy.fill(0); });
  const snapBtn = document.getElementById('snapBtn');
  if (snapBtn) snapBtn.addEventListener('click', takeScreenshot);

  window.__dbg = { get D() { return D; }, get Ux() { return Ux; }, get Uy() { return Uy; }, FW: () => FW, FH: () => FH, CFG };

  resizeCanvas(); lTS = performance.now();
  requestAnimationFrame(uR);
})();
