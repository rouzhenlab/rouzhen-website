(() => {
  'use strict';
  const canvas = document.getElementById('mainCanvas');
  const ctx = canvas.getContext('2d');
  let viewW = 0, viewH = 0, dpr = Math.max(1, window.devicePixelRatio || 1), viewScale = 1;
  function resizeCanvas() {
    const w = window.innerWidth, h = window.innerHeight;
    viewW = w; viewH = h;
    viewScale = Math.min(w, h) / 1080;
    canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    rebuildWakeGrid();
    if(!_userHasInteracted) spawnPresetClouds(false);
  }
  window.addEventListener('resize', resizeCanvas);
  const TARGET_COUNT = 620, MAX_COUNT_HARD = 1800, MAX_SCALE_SPAN = 0.27;
  const samplingPoints = [];
  const cloudGroups = [];
  const groupById = new Map();
  let nextGroupId = 0;
  function makeInkTexture(seed) {
    const SZ = 256;
    const cc = document.createElement('canvas'); cc.width = SZ; cc.height = SZ;
    const cx = cc.getContext('2d');
    const cx0 = SZ/2 + (Math.random()-0.5)*18, cy0 = SZ/2 + (Math.random()-0.5)*18;
    const layers = 5 + (seed % 3); let radius;
    for (let l = 0; l < layers; l++) {
      radius = SZ*0.18 + l*(SZ*0.075) + Math.random()*10;
      const a = 0.34 - l*0.045;
      const g = cx.createRadialGradient(cx0, cy0, radius*0.08, cx0, cy0, radius);
      g.addColorStop(0, `rgba(240,240,240,${(0.9*a).toFixed(3)})`);
      g.addColorStop(0.35, `rgba(220,220,220,${(0.72*a).toFixed(3)})`);
      g.addColorStop(0.7, `rgba(180,180,180,${(0.38*a).toFixed(3)})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      cx.fillStyle = g;
      const ox = Math.cos(l*1.2+seed)*7*l*0.3, oy = Math.sin(l*1.7+seed*0.5)*7*l*0.3;
      cx.beginPath();
      if (seed % 3 === 2) cx.ellipse(cx0+ox, cy0+oy, radius*1.15, radius*0.72, (l+seed)*0.13, 0, Math.PI*2);
      else {
        for (let p = 0; p <= 48; p++) {
          const ang = p/48*Math.PI*2;
          const w = 1 + Math.sin(ang*3+l+seed)*0.06 + Math.sin(ang*5+l*2)*0.03 + Math.sin(ang*9+seed)*0.02;
          const rx = (radius + (seed&1)*4)*w, ry = radius*w*0.93;
          const x = cx0+ox+Math.cos(ang)*rx, y = cy0+oy+Math.sin(ang)*ry;
          if (p===0) cx.moveTo(x,y); else cx.lineTo(x,y);
        }
        cx.closePath();
      }
      cx.fill();
    }
    try {
      const d = cx.getImageData(0,0,SZ,SZ); const dd = d.data;
      for (let i = 0; i < dd.length; i += 4) {
        const a = dd[i+3]; if (a > 0 && a < 120) {
          const n = Math.random();
          if (n < 0.17) dd[i+3] = Math.max(0,a-28);
          else if (n < 0.28) dd[i+3] = Math.min(255,a+20);
        }
      }
      cx.putImageData(d,0,0);
    } catch(e) {}
    cx.globalCompositeOperation = 'lighter';
    const hl = cx.createRadialGradient(cx0-radius*0.25, cy0-radius*0.35, 0, cx0-radius*0.25, cy0-radius*0.35, radius*0.7);
    hl.addColorStop(0,'rgba(255,255,255,0.13)'); hl.addColorStop(1,'rgba(0,0,0,0)');
    cx.fillStyle = hl; cx.fillRect(0,0,SZ,SZ); cx.globalCompositeOperation = 'source-over';
    return cc;
  }
  const INK_TEXTURES = []; for (let i = 0; i < 8; i++) INK_TEXTURES.push(makeInkTexture(i));
  const bgImg = new Image(); let bgScale=1, bgX=0, bgY=0;
  window._bgSet = ({url,scale,dx,dy})=>{ if(url)bgImg.src=url; if(scale!=null)bgScale=scale; if(dx!=null)bgX=dx; if(dy!=null)bgY=dy; };
  let _userHasInteracted = false, _emptyFrames = 0;
  function spawnPresetClouds(skipResizeCheck){
    const vs = viewScale;
    const baseSp = CC.clickSpread * vs;
    if(_userHasInteracted && !skipResizeCheck) return;
    samplingPoints.length = 0;
    cloudGroups.length = 0;
    groupById.clear();
    // ── 预制云：6 朵，每朵一个 {x,y,c,sm,vx,vy} ──
    //   x, y : 屏幕位置 (0~1，0=左/顶，1=右/底)
    //     c  : 墨点数量 (越多越浓密 → 越实)
    //     sm : 扩散半径倍数 (CC.clickSpread=34 * sm = 散布范围，越大越散)
    //     vx,vy : 初始漂移速度 (正=右/下，负=左/上)
    const puffs = [
      {x:0.18,y:0.10,c:18,sm:1.5,vx:0.008,vy:-0.004},  // 上-左
      {x:0.35,y:0.30,c:7, sm:1.3,vx:-0.006,vy:-0.003}, // 上-中
      {x:0.68,y:0.20,c:12,sm:1.1,vx:-0.005,vy:-0.001}, // 上-右
      {x:0.23,y:0.54,c:7, sm:2.2,vx:0.005,vy:-0.012},  // 下-左
      {x:0.39,y:0.60,c:5, sm:1.9,vx:0.003,vy:-0.010},  // 下-中
      {x:0.46,y:0.52,c:10,sm:1.7,vx:-0.002,vy:-0.009}, // 下-右
    ];
    for(const p of puffs){
      const cx = viewW * p.x, cy = viewH * p.y, spread = baseSp * p.sm;
      injectCloudEvent(cx,cy,{count:p.c,spread,vx:p.vx,vy:p.vy,
        preset:true,
        // ── 以下只对预制云生效，不影响点击云 ──
        //   最终墨团缩放 = (presetBlobScaleBase + 随机×presetBlobScaleSpan) × viewScale
        //   值越大墨团越大。默认点击云：0.19 + 随机×0.24 = 0.19~0.43
        presetBlobScaleBase:0.35, presetBlobScaleSpan:0.20,
        //   最终透明度 = (presetAlphaMin + 随机×presetAlphaSpan) × 密度系数
        //   值越大越不透明。默认点击云：0.06~0.11（几乎不可见）
        presetAlphaMin:0.40, presetAlphaSpan:0.15,
        //   squishY 控制扁度：值越小越扁 (宽>高)
        //   默认 0.78~1.20 (随机；0.78=微扁，1.0=正圆，>1.0=竖长)
        //   预制云设为 0.55~0.75 → 明显宽扁，若太扁显棱角可调高
        presetSquishYMin:0.55, presetSquishYSpan:0.20,
      });
    }
  }
  function loadDefaultHero(){
    const img = new Image();
    img.onload = ()=>{
      const nsc = Math.min(viewW/img.naturalWidth, viewH/img.naturalHeight) * 1.15;
      window._bgSet({url:'hero_original.jpg', scale:nsc, dx:0, dy:0});
      spawnPresetClouds(true);
    };
    img.src = 'hero_original.jpg';
  }
  const WAKE_CELL = 36;
  const DIV_LOSS_SCALE = 1.5, SHEAR_LOSS_SCALE = 0.33, SHEAR_LOSS_CAP = 0.013, TOTAL_LOSS_CAP = 0.018;
  const CC = {
    clickCount: 6, clickSpread: 34,
    blobScaleBase: 0.19, blobScaleSpan: 0.24,
    baseAlphaMin: 0.06, baseAlphaSpan: 0.05,
    groupSpdMin: 0.001, groupSpdSpan: 0.057,
    groupVelMax: 1.1, groupDamping: 0.900,
    driftAngJitter: 0.190, driftSpdMul: 0.10,
    fieldVelMul: 0.800,
    pushRadius: 160, pushMagMax: 0.910, pushMagCoef: 0.155,
    wakeStrength: 1.000,
    passiveDecay: 0.001,
    densityDieAt: 0.005
  };
  let curlNoiseSeeds = []; for (let i=0;i<24;i++) curlNoiseSeeds.push(Math.random()*1000);
  let wakeCols=0, wakeRows=0, wakeVX=null, wakeVY=null, wakeAge=null;
  function rebuildWakeGrid() {
    wakeCols = Math.ceil(viewW/WAKE_CELL)+2; wakeRows = Math.ceil(viewH/WAKE_CELL)+2;
    wakeVX = new Float32Array(wakeCols*wakeRows); wakeVY = new Float32Array(wakeCols*wakeRows); wakeAge = new Float32Array(wakeCols*wakeRows);
  }
  function depositWake(x,y,vx,vy,strength) {
    const col = Math.floor(x/WAKE_CELL), row = Math.floor(y/WAKE_CELL);
    for (let dr=-1; dr<=1; dr++) for (let dc=-1; dc<=1; dc++) {
      const c=col+dc, r=row+dr; if (c<0||r<0||c>=wakeCols||r>=wakeRows) continue;
      const w = 1 - Math.hypot(dc,dr)/1.8; if (w<=0) continue;
      const idx = r*wakeCols+c;
      wakeVX[idx] = wakeVX[idx]*(1-w*0.5) + vx*strength*w*CC.wakeStrength;
      wakeVY[idx] = wakeVY[idx]*(1-w*0.5) + vy*strength*w*CC.wakeStrength;
      if (wakeAge[idx]>0) wakeAge[idx] = Math.min(wakeAge[idx],2);
    }
  }
  function sampleWake(x,y) {
    const fx = x/WAKE_CELL, fy = y/WAKE_CELL;
    const c0=Math.floor(fx), r0=Math.floor(fy), c1=c0+1, r1=r0+1;
    if (c0<0||r0<0||c1>=wakeCols||r1>=wakeRows) return {x:0,y:0};
    const tx=fx-c0, ty=fy-r0; let vx=0, vy=0, ws=0;
    const cells=[[c0,r0],[c1,r0],[c0,r1],[c1,r1]], wts=[(1-tx)*(1-ty),tx*(1-ty),(1-tx)*ty,tx*ty];
    for (let k=0;k<4;k++) { const [cx,ry]=cells[k], wt=wts[k]; const idx=ry*wakeCols+cx; const dec=Math.max(0,1-wakeAge[idx]/180); vx+=wakeVX[idx]*wt*dec; vy+=wakeVY[idx]*wt*dec; ws+=wt; }
    if (ws===0) return {x:0,y:0}; return {x:vx/ws,y:vy/ws};
  }
  function stepWake(dtF) { const d = Math.pow(0.994,dtF); for (let i=0;i<wakeVX.length;i++){wakeVX[i]*=d;wakeVY[i]*=d;wakeAge[i]+=dtF;} }
  function releaseSamplingPoint(i){ samplingPoints.splice(i,1); }
  let globalFrameCounter = 0;
  function m32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
  const srand = s => m32((s*2654435761)>>>0);
  function gauss(r,s){return Math.exp(-r*r/(2*s*s))}
  function injectCloudEvent(cx,cy,opt){
    const n = opt?.count??12, sp = opt?.spread??40, sb = opt?.scaleBias??1;
    const seed = (Date.now()^(cx*73856093)^(cy*19349663))>>>0; const rnd = srand(seed);
    const injectVx=opt?.vx??0, injectVy=opt?.vy??0;
    const hasInject=injectVx!==0||injectVy!==0;
    const groupAng=rnd()*Math.PI*2, groupSpd=CC.groupSpdMin+rnd()*CC.groupSpdSpan;
    const gvx=hasInject?injectVx:Math.cos(groupAng)*groupSpd;
    const gvy=hasInject?injectVy:Math.sin(groupAng)*groupSpd;
    const groupDriftAng=hasInject?Math.atan2(injectVy,injectVx):groupAng;
    const groupDriftSpd=hasInject?Math.hypot(injectVx,injectVy)*0.6:groupSpd*0.6;
    const gid = nextGroupId++;
    const grp={
      id:gid,cx,cy,vx:gvx,vy:gvy,
      driftAng:groupDriftAng,driftSpd:groupDriftSpd,
      birthFrame:globalFrameCounter,count:n
    };
    if(opt?.preset) grp._preset = true;
    cloudGroups.push(grp);
    groupById.set(gid,grp);
    const baseMul = viewScale * sb;
    for (let i=0;i<n;i++){
      const t1=rnd(),t2=rnd(),r=Math.sqrt(t1)*sp,th=t2*Math.PI*2,dx=Math.cos(th)*r,dy=Math.sin(th)*r;
      const sdensity = gauss(r,sp*0.55), x=cx+dx, y=cy+dy;
      const rScale=rnd(), rAlpha=rnd();
      const bs=(CC.blobScaleBase+rScale*CC.blobScaleSpan)*baseMul, ba=(CC.baseAlphaMin+rAlpha*CC.baseAlphaSpan)*(0.5+sdensity*0.5);
      samplingPoints.push({groupId:gid,relX:dx,relY:dy,x,y,rot:rnd()*Math.PI*2,rotSpeed:(rnd()-0.5)*0.004,scale:bs,curScale:bs,baseAlpha:ba,density:sdensity,tex:INK_TEXTURES[(seed+i)%8],depth:rnd(),stretchAmount:0,stretchAngle:0,breathSeed:rnd()*Math.PI*2,breathFreq:0.3+rnd()*0.8,squishY:0.78+rnd()*0.42,birthFrame:globalFrameCounter,rScale,rAlpha,_baseMul:baseMul,
        _presetScaleBase:(opt?.preset?((opt.presetBlobScaleBase??0.35)+rScale*(opt.presetBlobScaleSpan??0.20)):undefined),
        _presetAlphaBase:(opt?.preset?((opt.presetAlphaMin??0.40)+rAlpha*(opt.presetAlphaSpan??0.15)):undefined),
        _presetSquishY:(opt?.preset?(opt.presetSquishYMin??0.35)+rnd()*(opt.presetSquishYSpan??0.20):undefined)
      });
    }
    while(samplingPoints.length>MAX_COUNT_HARD){const i=((globalFrameCounter*13)>>>0)%samplingPoints.length;releaseSamplingPoint(i);}
  }
  let px=0,py=0,pvx=0,pvy=0,down=false;
  let clickWarmup=0;
  let holdT=0,holdDist=0,lastBirthT=0,lastHoldMoveT=0;
  let interactionMode='cloud';
  function getPos(e){const r=canvas.getBoundingClientRect();let cx,cy;if(e.touches&&e.touches[0]){cx=e.touches[0].clientX;cy=e.touches[0].clientY;}else{cx=e.clientX;cy=e.clientY;}return{x:(cx-r.left)*(canvas.width/dpr)/r.width,y:(cy-r.top)*(canvas.height/dpr)/r.height};}
  function pd(e){e.preventDefault();_userHasInteracted=true;const p=getPos(e);px=p.x;py=p.y;pvx=pvy=0;down=true;clickWarmup=5;holdT=0;holdDist=0;lastBirthT=0;lastHoldMoveT=0;if(expM===4&&stF===-1)stF=globalFrameCounter;injectCloudEvent(px,py,{count:CC.clickCount,spread:CC.clickSpread*viewScale});}
  function pm(e){e.preventDefault();const p=getPos(e);const ox=px,oy=py;px=p.x;py=p.y;const dx=px-ox,dy=py-oy;const maxStep=8;const step=Math.hypot(dx,dy);if(step>maxStep){const k=maxStep/step;pvx=0.6*pvx+0.4*dx*k;pvy=0.6*pvy+0.4*dy*k;}else{pvx=0.6*pvx+0.4*dx;pvy=0.6*pvy+0.4*dy;}if(down){holdDist+=Math.hypot(px-ox,py-oy);lastHoldMoveT=0;if(expM===4&&stF===-1)stF=globalFrameCounter;const wp=clickWarmup>0?Math.max(0,1-clickWarmup/5):1;const wa=Math.min(1.2,Math.hypot(pvx,pvy)*0.08)*wp;if(wa>0.04)depositWake(px,py,pvx*0.04,pvy*0.04,wa);const pushR=CC.pushRadius*viewScale,pushR2=pushR*pushR,pushMag=Math.min(CC.pushMagMax,Math.hypot(pvx,pvy)*CC.pushMagCoef)*wp;if(pushMag>0.0015){for(const grp of cloudGroups){const dxg=grp.cx-px,dyg=grp.cy-py,d2=dxg*dxg+dyg*dyg;if(d2>pushR2)continue;const d=Math.sqrt(d2)+1e-4,f=1-d/pushR,p=f*f;grp.vx+=pvx*pushMag*p;grp.vy+=pvy*pushMag*p;}}}}
  function pu(){down=false;holdT=0;holdDist=0;lastBirthT=0;lastHoldMoveT=0;}
  canvas.addEventListener('mousedown',pd);window.addEventListener('mousemove',pm);window.addEventListener('mouseup',pu);
  canvas.addEventListener('touchstart',pd,{passive:false});canvas.addEventListener('touchmove',pm,{passive:false});canvas.addEventListener('touchend',pu);
  function sCurl(x,y){
    if(expM!==0)return{x:0,y:0};
    const s=curlNoiseSeeds,sc=0.0012,t=wT*0.3;
    let a=0;
    for(let i=0;i<8;i++){
      const k1=0.4+i*0.22,k2=1.1+i*0.17;
      a+=Math.sin(x*sc*k1+s[i*3])*Math.cos(y*sc*k2+s[i*3+1])*(1.2+i*0.08)+Math.sin((x+y)*sc*0.23+t+s[i*3+2])*0.9;
    }
    return{x:Math.cos(a)*0.1,y:Math.sin(a)*0.1};
  }
  function sWind(x,y){if(expM!==0)return{x:0,y:0};const b=0.006,s=curlNoiseSeeds,t=wT*0.12;return{x:b*(0.5+Math.sin(x*0.0008+s[22]+t*0.3)*0.25+Math.cos(y*0.0006+s[23])*0.25),y:b*(0.35*Math.cos(x*0.0007+s[21]-t*0.2)+0.25*Math.sin(y*0.0009+s[20]))}}
  function sV(x,y,sf,dp){const wk=fC.wakeActive?sampleWake(x,y):{x:0,y:0};const cl=sCurl(x,y);const wd=sWind(x,y);const cw=fC.curlAmp*(0.7+dp*0.3+sf*0.1);return{x:(wd.x+cl.x*cw)*fC.windAmp+wk.x*1.8,y:(wd.y+cl.y*cw)*fC.windAmp+wk.y*1.8}}
  function sVG(x,y,sf,dp){const E=4;const c=sV(x,y,sf,dp);const rx=sV(x+E,y,sf,dp),lx=sV(x-E,y,sf,dp),ry=sV(x,y+E,sf,dp),ly=sV(x,y-E,sf,dp);const dxdx=(rx.x-lx.x)/(2*E),dydy=(ry.y-ly.y)/(2*E),dxdy=(ry.x-ly.x)/(2*E),dydx=(rx.y-lx.y)/(2*E);return{vx:c.x,vy:c.y,divergence:dxdx+dydy,shear:Math.abs(dxdy)+Math.abs(dydx)+Math.abs(dxdx-dydy)*0.5}}
  const ACC_N=600,ACC_S=30,ACC_AB=0.999,ACC_G=1e-5,ACC_CR=0.9;
  let expM=0,expF=0,baseDen=0;
  const defC={windAmp:0.07,curlAmp:1.0,wakeActive:true,impulseActive:true,impulseR:90,impulseMag:1.0};
  let fC={...defC};
  function aDen(){if(!samplingPoints.length)return 0;let s=0;for(const p of samplingPoints){const g=groupById.get(p.groupId);s+=(g?g.densityFactor:1)*p.density;}return s/samplingPoints.length}
  function aGr(){if(!samplingPoints.length)return{ad:0,as:0,ag:0};let d=0,sh=0,c=0;for(const s of samplingPoints){const sf=Math.min(1,Math.max(0,(s.curScale-0.05)/MAX_SCALE_SPAN));const g=sVG(s.x,s.y,sf,s.depth);d+=g.divergence;sh+=g.shear;c++}return{ad:d/c,as:sh/c,ag:(Math.abs(d)+sh)/c}}
  function aWk(){if(!samplingPoints.length)return 0;let s=0;for(const p of samplingPoints){const w=sampleWake(p.x,p.y);s+=Math.hypot(w.x,w.y)}return s/samplingPoints.length}
  function startE(m){expM=m;expF=0;baseDen=0;samplingPoints.length=0;cloudGroups.length=0;groupById.clear();fC={...defC,windAmp:0,curlAmp:0,wakeActive:false,impulseActive:false};stF=-1;dSub=0;dLog=[];const cx=viewW*0.5,cy=viewH*0.5;if(m===1){injectCloudEvent(cx,cy,{count:14,spread:80})}else if(m===2){injectCloudEvent(cx,cy,{count:14,spread:80});for(const gr of cloudGroups){gr.vx+=0.3;}}else if(m===3){injectCloudEvent(cx,cy,{count:18,spread:80});for(const gr of cloudGroups){gr.vy+=0.003*(gr.cx-cx);}}else if(m===4){injectCloudEvent(cx,cy,{count:20,spread:110})}}
  let stF=-1,dSub=0,dLog=[];
  function sD(m){if(expM!==4)startE(4);if(m===1){fC.wakeActive=true;fC.impulseActive=false;}else if(m===2){fC.wakeActive=false;fC.impulseActive=true;}else{fC.wakeActive=true;fC.impulseActive=true;}dSub=m;stF=-1;dLog=[]}
  function cD(){
    const F=stF;
    let oN=0,oD=0,oV=0,oG=0,oDi=0,oSh=0,oTL=0,nN=0,nD=0;
    for (const s of samplingPoints){
      const nw=F!==-1&&s.birthFrame>=F;
      const sf=Math.min(1,Math.max(0,(s.curScale-0.05)/0.22));
      const g=sVG(s.x,s.y,sf,s.depth);
      const vm=Math.hypot(g.vx,g.vy);
      const dl=Math.max(0,g.divergence)*DIV_LOSS_SCALE;
      const sl=Math.min(SHEAR_LOSS_CAP,g.shear*SHEAR_LOSS_SCALE);
      const tl=Math.min(TOTAL_LOSS_CAP,dl+sl);
      const grp=groupById.get(s.groupId);
      const pdv=(grp?(grp.densityFactor===undefined?1:grp.densityFactor):1)*s.density;
      if(nw){nN++;nD+=pdv;}
      else{oN++;oD+=pdv;oV+=vm;oG+=Math.abs(g.divergence)+g.shear;oDi+=Math.abs(g.divergence);oSh+=g.shear;oTL+=tl;}
    }
    let wc=0,wt=0;
    for(let i=0;i<wakeAge.length;i++){wt++;if(wakeAge[i]<60)wc++;}
    return{frame:globalFrameCounter,subMode:dSub,stimF:F===-1?-1:globalFrameCounter-F,pointerSpeed:Math.hypot(pvx,pvy),wakeMag:aWk(),wakeAgeCov:wt?wc/wt:0,velMag:oN?oV/oN:0,gradMag:oN?oG/oN:0,div:oN?oDi/oN:0,shear:oN?oSh/oN:0,totalLoss:oN?oTL/oN:0,countOld:oN,countNew:nN,dOld:oN?oD/oN:0,dNew:nN?nD/nN:0}
  }
  function wD(){dLog.push(cD())}
  function aD(m){
    if(expM!==4||dSub!==m)sD(m);
    const wo=m===1||m===3,io=m===2||m===3;
    const NB=30,NS=20,NO=120;
    const fx=viewW*0.1,fy=viewH*0.55,tx=viewW*0.9,ty=viewH*0.45;
    const pvx0=(tx-fx)/NS,pvy0=(ty-fy)/NS;
    stF=globalFrameCounter+NB;
    let step=0;
    const it=setInterval(()=>{
      if(step>=NB&&step<NB+NS){
        const t=(step-NB)/Math.max(1,NS-1);
        const x=fx+(tx-fx)*t,y=fy+(ty-fy)*t,di=Math.hypot(pvx0,pvy0);
        if(wo&&di>0.5)depositWake(x,y,pvx0*0.04,pvy0*0.04,1.0);
        if(io&&di>0.5){
          const r2=fC.impulseR*fC.impulseR,R=fC.impulseR,im=fC.impulseMag;
          for(const gr of cloudGroups){
            const dx=gr.cx-x,dy=gr.cy-y,d2=dx*dx+dy*dy;
            if(d2>r2)continue;
            const d=Math.sqrt(d2)+1e-4,f=1-d/R,p=f*f;
            gr.vx+=pvx0*im*p;gr.vy+=pvy0*im*p;
          }
        }
        if((step-NB)%2===0){
          const a=Math.random()*6.28,r=12+Math.random()*18;
          injectCloudEvent(x+Math.cos(a)*r,y+Math.sin(a)*r,{count:2+((Math.random()*2)|0),spread:20})
        }
        px=x;py=y;pvx=pvx0;pvy=pvy0;
      }else{pvx=0;pvy=0;}
      step++;
      if(step>=NB+NS+NO){clearInterval(it);setTimeout(eD,50);}
    },16);
  }
  function eD(){
    const h=['frame','subMode','stimF','pointerSpeed','wakeMag','wakeAgeCov','velMag','gradMag','div','shear','totalLoss','countOld','countNew','dOld','dNew'];
    const l=[h.join(',')];
    for(const m of dLog)l.push([m.frame,m.subMode,m.stimF,m.pointerSpeed,m.wakeMag.toFixed(6),m.wakeAgeCov.toFixed(4),m.velMag.toFixed(6),m.gradMag.toFixed(6),m.div.toFixed(6),m.shear.toFixed(6),m.totalLoss.toFixed(6),m.countOld,m.countNew,m.dOld.toFixed(6),m.dNew.toFixed(6)].join(','));
    window.__dbg_dCsv=l.join('\n')
  }
  function rE(){expM=0;expF=0;baseDen=0;fC={...defC};stF=-1;dSub=0;dLog=[];}
  window.addEventListener('keydown',e=>{
    switch(e.key){
      case'0':rE();break;
      case'1':startE(1);break;
      case'2':startE(2);break;
      case'3':startE(3);break;
      case'4':startE(4);break;
      case'6':sD(1);break;
      case'7':sD(2);break;
      case'8':sD(3);break;
      case'9':eD();break;
      case'R':case'r':if(e.shiftKey){if(dSub===0)break;aD(dSub);}break;
    }
  });
  const AT={A:null,B:null,C:null,D:null};
  function jE(){
    if(expF!==ACC_N)return;
    const fd=aDen();
    const rt=baseDen>0?fd/baseDen:1;
    const gr=aGr();
    let v=null;
    if(expM===1){v={passed:rt>=ACC_AB,retention:rt};AT.A=v;}
    else if(expM===2){v={passed:rt>=ACC_AB,retention:rt};AT.B=v;}
    else if(expM===3){const hg=gr.ag>=ACC_G,dd=rt<=ACC_CR;v={passed:hg&&dd,retention:rt};AT.C=v;}
  }
  function lE(){
    if(expM===0)return;
    expF++;
    if(expF===1&&baseDen===0)baseDen=aDen();
    if(expM>=1&&expM<=3){if(expF%ACC_S===0){aDen();aGr();}jE();return;}
    if(expM===4)wD();
  }
  let wT=0,cT=0,lTS=performance.now();
  function uR(ts){
    const dm=Math.min(50,ts-lTS);lTS=ts;
    const dt=dm/1000,dF=Math.max(0.3,dt*60);
    globalFrameCounter++;wT+=dt;cT+=dt*0.5;
    stepWake(dF);
    if(!down){pvx*=0.9;pvy*=0.9;}
    if(clickWarmup>0)clickWarmup=Math.max(0,clickWarmup-dF);
    if(down){
      holdT+=dt;lastHoldMoveT+=dt;
      const movedRecently=lastHoldMoveT<0.07;
      const triggerDist=16*viewScale;
      const baseSp=CC.clickSpread*viewScale;
      if(!movedRecently&&holdT>=0.15){
        const interval=holdT<1.5?0.08:0.12;
        if(lastBirthT===0||ts-lastBirthT>=interval*1000){
          const spFactor=holdT<1.5?(0.25+(holdT/1.5)*0.65):0.9;
          const spread=baseSp*spFactor;
          const ang=Math.random()*Math.PI*2;
          const r=spread*(0.3+Math.random()*0.7);
          const cx=px+Math.cos(ang)*r,cy=py+Math.sin(ang)*r;
          injectCloudEvent(cx,cy,{count:holdT<1.5?2:3,spread});
          lastBirthT=ts;holdDist=0;
        }
      }else if(movedRecently&&holdDist>=triggerDist){
        const spread=baseSp*0.35;
        const ang=Math.random()*Math.PI*2;
        const r=spread*(0.2+Math.random()*0.6);
        const cx=px+Math.cos(ang)*r,cy=py+Math.sin(ang)*r;
        injectCloudEvent(cx,cy,{count:2,spread});
        holdDist=0;lastBirthT=ts;
      }
    }else if(_userHasInteracted){
      _emptyFrames++;
      if(samplingPoints.length===0&&_emptyFrames>60){
        _emptyFrames=0;
        injectCloudEvent(viewW*0.5,viewH*0.5,{count:3,spread:CC.clickSpread*0.7*viewScale});
      }
    }
    const deadGids=new Set();
    const bMul=viewScale;
    for(let gi=cloudGroups.length-1;gi>=0;gi--){
      const gr=cloudGroups[gi];
      const gg=sVG(gr.cx,gr.cy,0.5,0.5);
      const dp=Math.pow(CC.groupDamping,dF);
      gr.driftAng+=(Math.random()-0.5)*CC.driftAngJitter;
      const sdx=Math.cos(gr.driftAng)*gr.driftSpd*CC.driftSpdMul;
      const sdy=Math.sin(gr.driftAng)*gr.driftSpd*CC.driftSpdMul;
      gr.vx=gr.vx*dp+(gg.vx*CC.fieldVelMul+sdx)*dF;
      gr.vy=gr.vy*dp+(gg.vy*CC.fieldVelMul+sdy)*dF;
      const mv=CC.groupVelMax,vl=Math.hypot(gr.vx,gr.vy);
      if(vl>mv){gr.vx=gr.vx/vl*mv;gr.vy=gr.vy/vl*mv;}
      gr.cx+=gr.vx*dF;gr.cy+=gr.vy*dF;
      const dl=Math.max(0,gg.divergence)*DIV_LOSS_SCALE;
      const sl=Math.min(SHEAR_LOSS_CAP,gg.shear*SHEAR_LOSS_SCALE);
      const tl=Math.min(TOTAL_LOSS_CAP,dl+sl);
      const passiveLoss=gr._preset?0:CC.passiveDecay;
      gr.densityFactor=(gr.densityFactor===undefined?1:gr.densityFactor)*(1-tl-passiveLoss);
      if(gr.densityFactor<CC.densityDieAt||gr.cx<-300||gr.cx>viewW+300||gr.cy<-300||gr.cy>viewH+300){deadGids.add(gr.id);groupById.delete(gr.id);cloudGroups.splice(gi,1);}
    }
    for(let i=samplingPoints.length-1;i>=0;i--){
      const s=samplingPoints[i];
      if(deadGids.has(s.groupId)){releaseSamplingPoint(i);continue;}
      const grp=groupById.get(s.groupId);
      if(!grp){releaseSamplingPoint(i);continue;}
      s.x=grp.cx+s.relX;s.y=grp.cy+s.relY;
      s.rot+=s.rotSpeed*dF;
      s.stretchAmount=0;
      const gvl=Math.hypot(grp.vx,grp.vy);
      if(gvl>0.02)s.stretchAngle=Math.atan2(grp.vy,grp.vx);
      s.curScale=(s._presetScaleBase??(CC.blobScaleBase+s.rScale*CC.blobScaleSpan))*bMul;
      const effDen=grp.densityFactor*s.density;
      const dFade=effDen<0.05?effDen/0.05:1;
      s.baseAlpha=(s._presetAlphaBase??(CC.baseAlphaMin+s.rAlpha*CC.baseAlphaSpan))*(0.5+effDen*0.5);
      s.alpha=s.baseAlpha*dFade*(1+Math.sin((s.x*0.00019+s.y*0.00021)+s.breathSeed+cT*s.breathFreq)*0.12);
    }
    lE();
    ctx.globalCompositeOperation='source-over';ctx.globalAlpha=1;
    ctx.fillStyle='#050706';ctx.fillRect(0,0,viewW,viewH);
    if(bgImg.complete&&bgImg.naturalWidth>0){
      const cw=bgImg.naturalWidth*bgScale,ch=bgImg.naturalHeight*bgScale;
      ctx.drawImage(bgImg,viewW/2+bgX-cw/2,viewH/2+bgY-ch/2,cw,ch);
    }
    dC(samplingPoints);
    ctx.globalCompositeOperation='source-over';ctx.globalAlpha=1;
  }
  function dC(list){
    ctx.globalCompositeOperation='screen';
    for(let i=0;i<list.length;i++){
      const s=list[i];
      if(s.alpha<0.0003)continue;
      const sq=s._presetSquishY??s.squishY;
      const tw=s.tex.width*s.curScale,th=s.tex.height*s.curScale*sq;
      ctx.save();
      ctx.translate(s.x,s.y);
      if(s.stretchAmount>0.01){ctx.rotate(s.stretchAngle);ctx.scale(1+s.stretchAmount,1-s.stretchAmount*0.3);}
      else ctx.rotate(s.rot);
      ctx.globalAlpha=s.alpha;
      ctx.drawImage(s.tex,-tw/2,-th/2,tw,th);
      ctx.restore();
    }
  }
  const tuneDefs = [
    {group:'生成', items:[
      {key:'clickCount', label:'粒子数量', min:3, max:30, step:1},
      {key:'clickSpread', label:'云团半径', min:20, max:150, step:1},
      {key:'blobScaleBase', label:'墨团最小', min:0.02, max:0.3, step:0.01},
      {key:'blobScaleSpan', label:'墨团变化', min:0.05, max:0.5, step:0.01},
      {key:'baseAlphaMin', label:'透明最小', min:0.05, max:0.6, step:0.01},
      {key:'baseAlphaSpan', label:'透明变化', min:0.05, max:0.6, step:0.01},
    ]},
    {group:'运动', items:[
      {key:'groupSpdMin', label:'初速最小', min:0, max:0.1, step:0.001},
      {key:'groupSpdSpan', label:'初速变化', min:0, max:0.1, step:0.001},
      {key:'groupVelMax', label:'最大速度', min:0.1, max:3, step:0.05},
      {key:'groupDamping', label:'阻尼系数', min:0.9, max:1, step:0.001},
      {key:'driftAngJitter', label:'漂移抖动', min:0, max:0.2, step:0.005},
      {key:'driftSpdMul', label:'漂移系数', min:0, max:1, step:0.05},
      {key:'fieldVelMul', label:'风场耦合', min:0, max:1, step:0.05},
    ]},
    {group:'手指推动', items:[
      {key:'pushRadius', label:'推力半径', min:50, max:400, step:10},
      {key:'pushMagMax', label:'推力上限', min:0.01, max:1, step:0.01},
      {key:'pushMagCoef', label:'推力系数', min:0.01, max:0.3, step:0.005},
      {key:'wakeStrength', label:'Wake强度', min:0, max:1, step:0.01},
    ]},
    {group:'消散', items:[
      {key:'passiveDecay', label:'自然消散', min:0, max:0.02, step:0.0005},
      {key:'densityDieAt', label:'消散阈值', min:0.005, max:0.3, step:0.005},
    ]},
  ];
  const tunePanel=document.getElementById('tunePanel'),tuneBody=document.getElementById('tuneBody');
  const tuneToggle=document.getElementById('tuneToggle'),tuneClose=document.getElementById('tuneClose');
  if(tuneToggle&&tunePanel)tuneToggle.addEventListener('click',()=>{tunePanel.classList.toggle('open')});
  if(tuneClose&&tunePanel)tuneClose.addEventListener('click',()=>{tunePanel.classList.remove('open')});
  if(tuneBody){
    for(const tg of tuneDefs){
      const gd=document.createElement('div');gd.className='tune-group';
      const gt=document.createElement('div');gt.className='tune-group-title';gt.textContent=tg.group;gd.appendChild(gt);
      for(const it of tg.items){
        const row=document.createElement('div');row.className='tune-row';
        const lb=document.createElement('label');lb.textContent=it.label;
        const sl=document.createElement('input');sl.type='range';sl.min=it.min;sl.max=it.max;sl.step=it.step;sl.value=CC[it.key];
        const va=document.createElement('span');va.className='tune-val';va.textContent=(+CC[it.key]).toFixed(it.step<0.1?3:2);
        sl.addEventListener('input',()=>{CC[it.key]=parseFloat(sl.value);va.textContent=(+CC[it.key]).toFixed(it.step<0.1?3:2);});
        row.appendChild(lb);row.appendChild(sl);row.appendChild(va);gd.appendChild(row);
      }
      tuneBody.appendChild(gd);
    }
  }
  window.__dbg={samplingPoints,canvas,sCurl,sWind,sV,sVG,fC,expM,CC,viewScale:()=>viewScale};
  function takeScreenshot(){
    const s=new Date(),y=s.getFullYear(),m=String(s.getMonth()+1).padStart(2,'0'),d=String(s.getDate()).padStart(2,'0'),
      h=String(s.getHours()).padStart(2,'0'),mi=String(s.getMinutes()).padStart(2,'0'),se=String(s.getSeconds()).padStart(2,'0'),
      fn=`云境留影_${y}${m}${d}_${h}${mi}${se}.png`;
    try{
      const u=canvas.toDataURL('image/png');
      // 方案1：<a download> 静默下载（本地浏览器有效，IDE 预览忽略）
      const a=document.createElement('a');a.href=u;a.download=fn;
      a.style.display='none';document.body.appendChild(a);a.click();document.body.removeChild(a);
      // 方案2：同时在新标签页打开，支持 IDE 预览且可右键保存
      window.open(u,'_blank');
    }catch(e){console.warn('[留影] 导出失败：',e);}
  }
  window.takeScreenshot=takeScreenshot;
  const btnCloud=document.getElementById('modeCloud');
  if(btnCloud)btnCloud.classList.add('active');
  const bgUploader=document.getElementById('bgUploader');
  if(bgUploader)bgUploader.addEventListener('change',(e)=>{const f=e.target.files[0];if(!f)return;_userHasInteracted=true;const url=URL.createObjectURL(f);const img=new Image();img.onload=()=>{const sc=Math.min(viewW/img.naturalWidth,viewH/img.naturalHeight)*0.92;window._bgSet({url,scale:sc,dx:0,dy:0});};img.src=url;});
  const clearBtn=document.getElementById('clearBtn');
  if(clearBtn)clearBtn.addEventListener('click',()=>{samplingPoints.length=0;cloudGroups.length=0;groupById.clear();});
  const snapBtn=document.getElementById('snapBtn');
  if(snapBtn)snapBtn.addEventListener('click',takeScreenshot);
  resizeCanvas();lTS=performance.now();
  loadDefaultHero();
  function f(ts){uR(ts);requestAnimationFrame(f);}
  requestAnimationFrame(f);
})();
