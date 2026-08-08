(() => {
  'use strict';
  const canvas = document.getElementById('mainCanvas');
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
  const TARGET_COUNT = 620, MAX_COUNT_HARD = 900, MAX_SCALE_SPAN = 0.27;
  const samplingPoints = [];
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
  const WAKE_CELL = 36;
  const WAKE_STRENGTH_SCALE = 0.25;
  const DIV_LOSS_SCALE = 1.5, SHEAR_LOSS_SCALE = 0.33, SHEAR_LOSS_CAP = 0.013, TOTAL_LOSS_CAP = 0.018;
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
      wakeVX[idx] = wakeVX[idx]*(1-w*0.5) + vx*strength*w*WAKE_STRENGTH_SCALE;
      wakeVY[idx] = wakeVY[idx]*(1-w*0.5) + vy*strength*w*WAKE_STRENGTH_SCALE;
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
    for (let i=0;i<n;i++){
      const t1=rnd(),t2=rnd(),r=Math.sqrt(t1)*sp,th=t2*Math.PI*2,dx=Math.cos(th)*r,dy=Math.sin(th)*r;
      const density = gauss(r,sp*0.55), x=cx+dx, y=cy+dy;
      const bs=(0.05+rnd()*MAX_SCALE_SPAN)*sb, ba=(0.06+rnd()*0.10)*(0.3+density*0.7);
      const randAng=rnd()*Math.PI*2,randSpd=0.05+rnd()*0.08;
      samplingPoints.push({x,y,vx:Math.cos(randAng)*randSpd+(opt?.vx??0),vy:Math.sin(randAng)*randSpd+(opt?.vy??0),selfDrift:randAng,selfDriftSpd:randSpd*0.6,rot:rnd()*Math.PI*2,rotSpeed:(rnd()-0.5)*0.004,scale:bs,curScale:bs,baseAlpha:ba,alpha:ba,density,tex:INK_TEXTURES[(seed+i)%8],depth:rnd(),stretchAmount:0,stretchAngle:0,breathSeed:rnd()*Math.PI*2,breathFreq:0.3+rnd()*0.8,squishY:0.78+rnd()*0.42,birthFrame:globalFrameCounter});
    }
    while(samplingPoints.length>MAX_COUNT_HARD){const i=((globalFrameCounter*13)>>>0)%samplingPoints.length;releaseSamplingPoint(i);}
  }
  let relT=0;
  function autoRelTick(){relT++;if(relT<60)return;relT=0;const ov=samplingPoints.length-TARGET_COUNT;if(ov<=0)return;const tr=Math.min(ov,60);for(let i=0;i<tr;i++){if(samplingPoints.length<=TARGET_COUNT)break;const idx=((globalFrameCounter*13+i*17)>>>0)%samplingPoints.length;releaseSamplingPoint(idx);}}
  let px=0,py=0,pvx=0,pvy=0,down=false,holdT=0;
  let interactionMode='cloud';
  function getPos(e){const r=canvas.getBoundingClientRect();let cx,cy;if(e.touches&&e.touches[0]){cx=e.touches[0].clientX;cy=e.touches[0].clientY;}else{cx=e.clientX;cy=e.clientY;}return{x:(cx-r.left)*(canvas.width/dpr)/r.width,y:(cy-r.top)*(canvas.height/dpr)/r.height};}
  function pd(e){e.preventDefault();const p=getPos(e);px=p.x;py=p.y;pvx=pvy=0;down=true;holdT=0;if(expM===4&&stF===-1)stF=globalFrameCounter;if(interactionMode==='cloud')injectCloudEvent(px,py,{count:10});}
  function pm(e){e.preventDefault();const p=getPos(e);const ox=px,oy=py;px=p.x;py=p.y;pvx=0.6*pvx+0.4*(px-ox);pvy=0.6*pvy+0.4*(py-oy);if(down){if(expM===4&&stF===-1)stF=globalFrameCounter;if(interactionMode==='cloud'){injectCloudEvent(px,py,{count:4,spread:20});autoRelTick();}const wa=Math.min(1.2,Math.hypot(pvx,pvy)*0.08);if(wa>0.04)depositWake(px,py,pvx*0.04,pvy*0.04,wa);}}
  function pu(){down=false;}
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
  function aDen(){if(!samplingPoints.length)return 0;let s=0;for(const p of samplingPoints)s+=p.density;return s/samplingPoints.length}
  function aGr(){if(!samplingPoints.length)return{ad:0,as:0,ag:0};let d=0,sh=0,c=0;for(const s of samplingPoints){const sf=Math.min(1,Math.max(0,(s.curScale-0.05)/MAX_SCALE_SPAN));const g=sVG(s.x,s.y,sf,s.depth);d+=g.divergence;sh+=g.shear;c++}return{ad:d/c,as:sh/c,ag:(Math.abs(d)+sh)/c}}
  function aWk(){if(!samplingPoints.length)return 0;let s=0;for(const p of samplingPoints){const w=sampleWake(p.x,p.y);s+=Math.hypot(w.x,w.y)}return s/samplingPoints.length}
  function startE(m){expM=m;expF=0;baseDen=0;samplingPoints.length=0;fC={...defC,windAmp:0,curlAmp:0,wakeActive:false,impulseActive:false};stF=-1;dSub=0;dLog=[];const cx=viewW*0.5,cy=viewH*0.5;if(m===1){injectCloudEvent(cx,cy,{count:14,spread:80})}else if(m===2){injectCloudEvent(cx,cy,{count:14,spread:80});for(const p of samplingPoints)p.vx+=0.3;}else if(m===3){injectCloudEvent(cx,cy,{count:18,spread:80});for(const p of samplingPoints)p.vy+=0.003*(p.x-cx);}else if(m===4){injectCloudEvent(cx,cy,{count:20,spread:110})}}
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
      if(nw){nN++;nD+=s.density;}
      else{oN++;oD+=s.density;oV+=vm;oG+=Math.abs(g.divergence)+g.shear;oDi+=Math.abs(g.divergence);oSh+=g.shear;oTL+=tl;}
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
          for(let i=0;i<samplingPoints.length;i++){
            const s=samplingPoints[i],dx=s.x-x,dy=s.y-y,d2=dx*dx+dy*dy;
            if(d2>r2)continue;
            const d=Math.sqrt(d2)+1e-4,f=1-d/R,p=f*f;
            s.vx+=pvx0*im*p;s.vy+=pvy0*im*p;
          }
        }
        if((step-NB)%2===0){
          const a=Math.random()*6.28,r=12+Math.random()*18;
          injectCloudEvent(x+Math.cos(a)*r,y+Math.sin(a)*r,{count:5+((Math.random()*3)|0),spread:20})
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
    if(down&&expM===0){
      holdT+=dt;
      if(holdT>0.145){holdT=0;injectCloudEvent(px,py,{count:4+((Math.random()*4)|0),spread:20,scaleBias:0.94,vx:pvx*0.03,vy:pvy*0.03});}
    }
    for(let i=samplingPoints.length-1;i>=0;i--){
      const s=samplingPoints[i];
      const sf=Math.min(1,Math.max(0,(s.curScale-0.05)/0.22));
      const g=sVG(s.x,s.y,sf,s.depth);
      const dp=Math.pow(0.985,dF);
      s.selfDrift+=(Math.random()-0.5)*0.12;
      const sdx=Math.cos(s.selfDrift)*s.selfDriftSpd*0.35;
      const sdy=Math.sin(s.selfDrift)*s.selfDriftSpd*0.35;
      s.vx=s.vx*dp+(g.vx*0.35+sdx)*dF;
      s.vy=s.vy*dp+(g.vy*0.35+sdy)*dF;
      const mv=0.1,vl=Math.hypot(s.vx,s.vy);
      if(vl>mv){s.vx=s.vx/vl*mv;s.vy=s.vy/vl*mv;}
      s.x+=s.vx*dF;s.y+=s.vy*dF;
      s.rot+=s.rotSpeed*dF;
      s.stretchAmount=Math.min(0.5,g.shear*55);
      if(vl>0.02)s.stretchAngle=Math.atan2(s.vy,s.vx);
      const dl=Math.max(0,g.divergence)*DIV_LOSS_SCALE;
      const sl=Math.min(SHEAR_LOSS_CAP,g.shear*SHEAR_LOSS_SCALE);
      const tl=Math.min(TOTAL_LOSS_CAP,dl+sl);
      s.density*=(1-tl);
      s.alpha=s.baseAlpha*s.density*(1+Math.sin((s.x*0.00019+s.y*0.00021)+s.breathSeed+cT*s.breathFreq)*0.12);
      if(s.density<0.0022){releaseSamplingPoint(i);continue;}
      if((s.x<-250||s.x>viewW+250||s.y<-250||s.y>viewH+250)&&s.alpha<0.014)releaseSamplingPoint(i);
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
      const tw=s.tex.width*s.curScale,th=s.tex.height*s.curScale*s.squishY;
      ctx.save();
      ctx.translate(s.x,s.y);
      if(s.stretchAmount>0.01){ctx.rotate(s.stretchAngle);ctx.scale(1+s.stretchAmount,1-s.stretchAmount*0.3);}
      else ctx.rotate(s.rot);
      ctx.globalAlpha=s.alpha;
      ctx.drawImage(s.tex,-tw/2,-th/2,tw,th);
      ctx.restore();
    }
  }
  window.__dbg={samplingPoints,canvas,sCurl,sWind,sV,sVG,fC,expM};
  function takeScreenshot(){
    const s=new Date(),y=s.getFullYear(),m=String(s.getMonth()+1).padStart(2,'0'),d=String(s.getDate()).padStart(2,'0'),
      h=String(s.getHours()).padStart(2,'0'),mi=String(s.getMinutes()).padStart(2,'0'),se=String(s.getSeconds()).padStart(2,'0'),
      fn=`云境留影_${y}${m}${d}_${h}${mi}${se}.png`;
    try{
      const u=canvas.toDataURL('image/png');
      const a=document.createElement('a');a.href=u;a.download=fn;
      document.body.appendChild(a);a.click();document.body.removeChild(a);
    }catch(e){console.warn('[留影] 导出失败：',e);}
  }
  window.takeScreenshot=takeScreenshot;
  const btnCloud=document.getElementById('modeCloud'),btnDrag=document.getElementById('modeDrag');
  if(btnCloud)btnCloud.addEventListener('click',()=>{interactionMode='cloud';btnCloud.classList.add('active');if(btnDrag)btnDrag.classList.remove('active');});
  if(btnDrag)btnDrag.addEventListener('click',()=>{interactionMode='drag';btnDrag.classList.add('active');if(btnCloud)btnCloud.classList.remove('active');});
  const bgUploader=document.getElementById('bgUploader');
  if(bgUploader)bgUploader.addEventListener('change',(e)=>{const f=e.target.files[0];if(!f)return;const url=URL.createObjectURL(f);const img=new Image();img.onload=()=>{const sc=Math.min(viewW/img.naturalWidth,viewH/img.naturalHeight)*0.92;window._bgSet({url,scale:sc,dx:0,dy:0});};img.src=url;});
  const clearBtn=document.getElementById('clearBtn');
  if(clearBtn)clearBtn.addEventListener('click',()=>{samplingPoints.length=0;});
  const snapBtn=document.getElementById('snapBtn');
  if(snapBtn)snapBtn.addEventListener('click',takeScreenshot);
  resizeCanvas();lTS=performance.now();
  function f(ts){uR(ts);requestAnimationFrame(f);}
  requestAnimationFrame(f);
})();
