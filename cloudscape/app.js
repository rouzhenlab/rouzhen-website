(async () => {
  const app = new PIXI.Application();
  await app.init({
    resizeTo: window,
    backgroundColor: 0x050706,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true
  });

  document.getElementById('canvas-container').appendChild(app.canvas);

  const bgLayer = new PIXI.Container();
  const cloudContainer = new PIXI.Container();
  app.stage.addChild(bgLayer);
  app.stage.addChild(cloudContainer);

  function setDefaultBackground() {
    const graphics = new PIXI.Graphics();
    graphics.rect(0, 0, app.screen.width, app.screen.height);
    graphics.fill(0x050706);
    bgLayer.addChild(graphics);
  }
  setDefaultBackground();

  // 盆景图片管理（contain 显示 + 拖拽平移 + 滚轮缩放）
  let bgSprite = null;
  let rawImageWidth = 0;
  let rawImageHeight = 0;
  let imageScale = 1;
  let imageX = 0;
  let imageY = 0;
  let isImageDragging = false;
  let imgDragStartX = 0, imgDragStartY = 0;

  function updateBgTransform() {
    if (!bgSprite) return;
    bgSprite.scale.set(imageScale);
    bgSprite.x = app.screen.width / 2 + imageX;
    bgSprite.y = app.screen.height / 2 + imageY;
  }

  function resetImageFit() {
    if (!rawImageWidth || !rawImageHeight) return;
    const screenW = app.screen.width;
    const screenH = app.screen.height;
    imageScale = Math.min(screenW / rawImageWidth, screenH / rawImageHeight);
    imageX = 0;
    imageY = 0;
    updateBgTransform();
  }

  // 修复上传没有反应的问题：使用标准 HTML Image 加载并构建 Pixi 纹理
  document.getElementById('bgUploader').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        bgLayer.removeChildren();
        setDefaultBackground();

        const texture = PIXI.Texture.from(img);
        bgSprite = new PIXI.Sprite(texture);
        bgSprite.anchor.set(0.5);
        
        rawImageWidth = img.width;
        rawImageHeight = img.height;
        
        bgLayer.addChild(bgSprite);
        resetImageFit();
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  });

  app.canvas.addEventListener('wheel', (e) => {
    if (!bgSprite) return;
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    imageScale = Math.max(0.1, Math.min(10, imageScale * zoomFactor));
    updateBgTransform();
  }, { passive: false });

  document.querySelectorAll('.cloud-tools .tool-btn').forEach(btn => {
    if (btn.dataset.type === 'smoke') {
      btn.classList.add('active');
    } else {
      btn.style.display = 'none';
    }
  });

  // 密度场 Shader 逻辑
  const densityFragShader = `
    precision highp float;
    varying vec2 vTextureCoord;
    uniform sampler2D uDensityMap;
    uniform sampler2D uVelocityMap;
    uniform vec2 uResolution;
    uniform vec2 uPointer;
    uniform float uPointerActive;
    uniform float uTime;
    uniform float uDeltaTime;

    vec2 hash22(vec2 p) {
      p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
      return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
    }

    float perlinNoise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(dot(hash22(i + vec2(0.0, 0.0)), f - vec2(0.0, 0.0)),
            dot(hash22(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0)), u.x),
        mix(dot(hash22(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0)),
            dot(hash22(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0)), u.x),
        u.y
      );
    }

    float fbm(vec2 p) {
      float sum = 0.0;
      float amp = 0.5;
      float freq = 1.0;
      for (int i = 0; i < 4; i++) {
        sum += amp * perlinNoise(p * freq);
        freq *= 2.0;
        amp *= 0.5;
      }
      return sum;
    }

    void main() {
      vec2 uv = vTextureCoord;
      vec2 st = uv * uResolution;

      float currentDensity = texture2D(uDensityMap, uv).r;
      vec2 velocity = texture2D(uVelocityMap, uv).rg;

      vec2 backUV = uv - velocity * uDeltaTime * 0.08;
      float advectedDensity = texture2D(uDensityMap, backUV).r;
      advectedDensity *= 0.992;

      vec2 flowSt = st * 0.003 + vec2(uTime * 0.02, -uTime * 0.03);
      vec2 warp = vec2(fbm(flowSt), fbm(flowSt + vec2(5.2, 1.3)));
      vec2 warpedSt = flowSt + warp * 0.6;
      
      float largeNoise = fbm(warpedSt * 1.5);
      float fineNoise = fbm(warpedSt * 5.0 + vec2(uTime * 0.05));
      float structuralNoise = clamp((largeNoise * 0.7 + fineNoise * 0.3 + 0.5), 0.0, 1.0);

      float dist = distance(st, uPointer);
      float brushRadius = 110.0;
      if (uPointerActive > 0.5 && dist < brushRadius) {
        float influence = smoothstep(brushRadius, 0.0, dist);
        float injection = influence * 0.035 * structuralNoise;
        advectedDensity += injection;
      }

      float finalDensity = clamp(advectedDensity, 0.0, 1.0);
      gl_FragColor = vec4(finalDensity, 0.0, 0.0, 1.0);
    }
  `;

  const renderFragShader = `
    precision highp float;
    varying vec2 vTextureCoord;
    uniform sampler2D uDensityMap;
    uniform vec2 uResolution;
    uniform float uTime;

    void main() {
      vec2 uv = vTextureCoord;
      float d = texture2D(uDensityMap, uv).r;

      if (d < 0.002) {
        gl_FragColor = vec4(0.0);
        return;
      }

      float opacity = 0.82 * (1.0 - exp(-d * 2.8));

      vec2 eps = vec2(1.0 / uResolution.x, 1.0 / uResolution.y);
      float dx = texture2D(uDensityMap, uv + vec2(eps.x, 0.0)).r - texture2D(uDensityMap, uv - vec2(eps.x, 0.0)).r;
      float dy = texture2D(uDensityMap, uv + vec2(0.0, eps.y)).r - texture2D(uDensityMap, uv - vec2(0.0, eps.y)).r;
      
      vec3 cloudBaseColor = vec3(0.91, 0.94, 0.92);
      vec3 cloudHighlight = vec3(1.0, 1.0, 1.0);
      
      float lighting = clamp(0.5 + (dx - dy) * 3.5, 0.3, 1.0);
      vec3 finalColor = mix(cloudBaseColor, cloudHighlight, lighting);

      gl_FragColor = vec4(finalColor * opacity, opacity);
    }
  `;

  const width = Math.floor(app.screen.width);
  const height = Math.floor(app.screen.height);

  let densityBufferA = PIXI.RenderTexture.create({ width, height, resolution: 1 });
  let densityBufferB = PIXI.RenderTexture.create({ width, height, resolution: 1 });
  let velocityBuffer = PIXI.RenderTexture.create({ width, height, resolution: 1 });

  const densityFilter = new PIXI.Filter({
    glShaderKey: 'densityShader',
    fragment: densityFragShader,
    resources: {
      uDensityMap: densityBufferA,
      uVelocityMap: velocityBuffer,
      uResolution: [width, height],
      uPointer: [-1000, -1000],
      uPointerActive: 0.0,
      uTime: 0.0,
      uDeltaTime: 0.016
    }
  });

  const screenQuad = new PIXI.Mesh({
    geometry: new PIXI.PlaneGeometry({ width: width, height: height, verticesX: 2, verticesY: 2 }),
    shader: new PIXI.Shader({
      glProgram: new PIXI.GlProgram({
        vertex: `
          attribute vec2 aPosition;
          attribute vec2 aUV;
          uniform mat3 uTransformMatrix;
          varying vec2 vTextureCoord;
          void main() {
            vTextureCoord = aUV;
            gl_Position = vec4((uTransformMatrix * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
          }
        `,
        fragment: renderFragShader
      }),
      resources: {
        uDensityMap: densityBufferA,
        uResolution: [width, height],
        uTime: 0.0
      }
    })
  });
  cloudContainer.addChild(screenQuad);

  let isPointerDown = false;
  let pointerX = -1000, pointerY = -1000;

  window.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.ui-overlay')) {
      if (bgSprite && e.target.closest('#canvas-container')) {
        isImageDragging = true;
        imgDragStartX = e.clientX - imageX;
        imgDragStartY = e.clientY - imageY;
      }
      return;
    }
    isPointerDown = true;
    pointerX = e.clientX;
    pointerY = e.clientY;
  });

  window.addEventListener('pointermove', (e) => {
    if (isImageDragging) {
      imageX = e.clientX - imgDragStartX;
      imageY = e.clientY - imgDragStartY;
      updateBgTransform();
      return;
    }
    if (!isPointerDown) return;
    pointerX = e.clientX;
    pointerY = e.clientY;
  });

  const releasePointer = () => {
    isPointerDown = false;
    isImageDragging = false;
    pointerX = -1000;
    pointerY = -1000;
  };

  window.addEventListener('pointerup', releasePointer);
  window.addEventListener('pointercancel', releasePointer);
  window.addEventListener('pointerleave', releasePointer);

  document.getElementById('clearBtn').addEventListener('click', () => {
    const clearGraphics = new PIXI.Graphics();
    clearGraphics.rect(0, 0, width, height);
    clearGraphics.fill(0x000000);
    app.renderer.render({ container: clearGraphics, target: densityBufferA });
    app.renderer.render({ container: clearGraphics, target: densityBufferB });
    clearGraphics.destroy();
  });

  document.getElementById('snapBtn').addEventListener('click', () => {
    const ui = document.querySelector('.ui-overlay');
    ui.style.display = 'none';
    setTimeout(() => {
      app.renderer.extract.canvas(app.stage).toBlob((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `cloudscape-${Date.now()}.png`;
        a.click();
        URL.revokeObjectURL(url);
        ui.style.display = 'flex';
      }, 'image/png');
    }, 50);
  });

  let totalTime = 0;
  app.ticker.add((ticker) => {
    const dt = ticker.deltaTime * 0.016;
    totalTime += dt;

    densityFilter.resources.uTime.value = totalTime;
    densityFilter.resources.uResolution.value = [width, height];
    densityFilter.resources.uPointer.value = [pointerX, pointerY];
    densityFilter.resources.uPointerActive.value = isPointerDown ? 1.0 : 0.0;
    densityFilter.resources.uDeltaTime.value = dt;
    densityFilter.resources.uDensityMap.value = densityBufferA;

    app.renderer.render({
      container: new PIXI.Sprite(densityBufferA),
      target: densityBufferB,
      clear: true
    });

    let temp = densityBufferA;
    densityBufferA = densityBufferB;
    densityBufferB = temp;

    screenQuad.shader.resources.uDensityMap.value = densityBufferA;
    screenQuad.shader.resources.uTime.value = totalTime;
  });
})();

  function updateBgTransform() {
    if (!bgSprite) return;
    bgSprite.scale.set(imageScale);
    bgSprite.x = app.screen.width / 2 + imageX;
    bgSprite.y = app.screen.height / 2 + imageY;
  }

  function resetImageFit() {
    if (!rawImageWidth || !rawImageHeight) return;
    const screenW = app.screen.width;
    const screenH = app.screen.height;
    imageScale = Math.min(screenW / rawImageWidth, screenH / rawImageHeight);
    imageX = 0;
    imageY = 0;
    updateBgTransform();
  }

  document.getElementById('bgUploader').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      PIXI.Assets.load(event.target.result).then((texture) => {
        bgLayer.removeChildren();
        setDefaultBackground();
        bgSprite = new PIXI.Sprite(texture);
        bgSprite.anchor.set(0.5);
        rawImageWidth = texture.width;
        rawImageHeight = texture.height;
        bgLayer.addChild(bgSprite);
        resetImageFit();
      });
    };
    reader.readAsDataURL(file);
  });

  // 图像交互：拖拽平移与滚轮缩放
  app.canvas.addEventListener('wheel', (e) => {
    if (!bgSprite) return;
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    imageScale = Math.max(0.1, Math.min(10, imageScale * zoomFactor));
    updateBgTransform();
  }, { passive: false });

  // 隐藏多余按钮
  document.querySelectorAll('.cloud-tools .tool-btn').forEach(btn => {
    if (btn.dataset.type === 'smoke') {
      btn.classList.add('active');
    } else {
      btn.style.display = 'none';
    }
  });

  // 3. 核心：GPU Ping-Pong 密度场 Shader (GLSL)
  // 实现了多尺度噪波 (Low/Mid/High)、Domain Warping、平流搬运 (Advection)、饱和映射与半透明光影
  const densityFragShader = `
    precision highp float;
    varying vec2 vTextureCoord;
    uniform sampler2D uDensityMap;
    uniform sampler2D uVelocityMap;
    uniform vec2 uResolution;
    uniform vec2 uPointer;
    uniform vec2 uPointerDelta;
    uniform float uPointerActive; // 1.0 表示正在按住
    uniform float uTime;
    uniform float uDeltaTime;

    // 伪随机与噪波函数
    vec2 hash22(vec2 p) {
      p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
      return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
    }

    float perlinNoise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(dot(hash22(i + vec2(0.0, 0.0)), f - vec2(0.0, 0.0)),
            dot(hash22(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0)), u.x),
        mix(dot(hash22(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0)),
            dot(hash22(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0)), u.x),
        u.y
      );
    }

    // 多尺度分形布朗运动 (FBM) 产生云团、翻滚与云丝
    float fbm(vec2 p) {
      float sum = 0.0;
      float amp = 0.5;
      float freq = 1.0;
      for (int i = 0; i < 4; i++) {
        sum += amp * perlinNoise(p * freq);
        freq *= 2.0;
        amp *= 0.5;
      }
      return sum;
    }

    void main() {
      vec2 uv = vTextureCoord;
      vec2 st = uv * uResolution;

      // 读取上一帧密度
      float currentDensity = texture2D(uDensityMap, uv).r;
      vec2 velocity = texture2D(uVelocityMap, uv).rg;

      // 平流搬运 (Advection)
      vec2 backUV = uv - velocity * uDeltaTime * 0.08;
      float advectedDensity = texture2D(uDensityMap, backUV).r;

      // 自然衰减与扩散
      advectedDensity *= 0.992;

      // 持续内部翻滚：Domain Warping
      vec2 flowSt = st * 0.003 + vec2(uTime * 0.02, -uTime * 0.03);
      vec2 warp = vec2(
        fbm(flowSt),
        fbm(flowSt + vec2(5.2, 1.3))
      );
      vec2 warpedSt = flowSt + warp * 0.6;
      
      // 多尺度密度扰动
      float largeNoise = fbm(warpedSt * 1.5);
      float fineNoise = fbm(warpedSt * 5.0 + vec2(uTime * 0.05));
      float structuralNoise = clamp((largeNoise * 0.7 + fineNoise * 0.3 + 0.5), 0.0, 1.0);

      // 用户按住时在触点附近注入密度（无上限爆白限制，采用非线性饱和曲线）
      float dist = distance(st, uPointer);
      float brushRadius = 110.0;
      if (uPointerActive > 0.5 && dist < brushRadius) {
        float influence = smoothstep(brushRadius, 0.0, dist);
        float injection = influence * 0.035 * structuralNoise;
        advectedDensity += injection;
      }

      // 密度上限饱和控制（永远不会变成刺眼白屏）
      float finalDensity = clamp(advectedDensity, 0.0, 1.0);

      // 输出最终密度到 Alpha 红色通道
      gl_FragColor = vec4(finalDensity, 0.0, 0.0, 1.0);
    }
  `;

  // 最终合成渲染 Shader（将密度场转化为肉眼可见、具有高级半透明光影质感的云层）
  const renderFragShader = `
    precision highp float;
    varying vec2 vTextureCoord;
    uniform sampler2D uDensityMap;
    uniform vec2 uResolution;
    uniform float uTime;

    vec2 hash22(vec2 p) {
      p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
      return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
    }

    float perlinNoise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(dot(hash22(i + vec2(0.0, 0.0)), f - vec2(0.0, 0.0)),
            dot(hash22(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0)), u.x),
        mix(dot(hash22(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0)),
            dot(hash22(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0)), u.x),
        u.y
      );
    }

    void main() {
      vec2 uv = vTextureCoord;
      float d = texture2D(uDensityMap, uv).r;

      if (d < 0.002) {
        gl_FragColor = vec4(0.0);
        return;
      }

      // 边缘侵蚀与非线性透明度映射 (opacity = 1 - exp(-d * strength))
      float opacity = 0.82 * (1.0 - exp(-d * 2.8));

      // 内部明暗光影立体感 (伪光照采样微小导数)
      vec2 eps = vec2(1.0 / uResolution.x, 1.0 / uResolution.y);
      float dx = texture2D(uDensityMap, uv + vec2(eps.x, 0.0)).r - texture2D(uDensityMap, uv - vec2(eps.x, 0.0)).r;
      float dy = texture2D(uDensityMap, uv + vec2(0.0, eps.y)).r - texture2D(uDensityMap, uv - vec2(0.0, eps.y)).r;
      
      // 柔和的云体色彩：山岚晨雾般的青白冷色调与高光
      vec3 cloudBaseColor = vec3(0.91, 0.94, 0.92);
      vec3 cloudHighlight = vec3(1.0, 1.0, 1.0);
      
      float lighting = clamp(0.5 + (dx - dy) * 3.5, 0.3, 1.0);
      vec3 finalColor = mix(cloudBaseColor, cloudHighlight, lighting);

      gl_FragColor = vec4(finalColor * opacity, opacity);
    }
  `;

  // 创建 Ping-Pong RenderTexture 缓冲
  const width = Math.floor(app.screen.width);
  const height = Math.floor(app.screen.height);

  let densityBufferA = PIXI.RenderTexture.create({ width, height, resolution: 1 });
  let densityBufferB = PIXI.RenderTexture.create({ width, height, resolution: 1 });
  let velocityBuffer = PIXI.RenderTexture.create({ width, height, resolution: 1 });

  const densityFilter = new PIXI.Filter({
    glShaderKey: 'densityShader',
    fragment: densityFragShader,
    resources: {
      uDensityMap: densityBufferA,
      uVelocityMap: velocityBuffer,
      uResolution: [width, height],
      uPointer: [-1000, -1000],
      uPointerDelta: [0, 0],
      uPointerActive: 0.0,
      uTime: 0.0,
      uDeltaTime: 0.016
    }
  });

  const renderFilter = new PIXI.Filter({
    glShaderKey: 'renderShader',
    fragment: renderFragShader,
    resources: {
      uDensityMap: densityBufferA,
      uResolution: [width, height],
      uTime: 0.0
    }
  });

  // 铺满全屏的底层网格矩形用于执行 GPU 渲染
  const screenQuad = new PIXI.Mesh({
    geometry: new PIXI.PlaneGeometry({ width: width, height: height, verticesX: 2, verticesY: 2 }),
    shader: new PIXI.Shader({
      glProgram: new PIXI.GlProgram({
        vertex: `
          attribute vec2 aPosition;
          attribute vec2 aUV;
          uniform mat3 uTransformMatrix;
          varying vec2 vTextureCoord;
          void main() {
            vTextureCoord = aUV;
            gl_Position = vec4((uTransformMatrix * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
          }
        `,
        fragment: renderFragShader
      }),
      resources: {
        uDensityMap: densityBufferA,
        uResolution: [width, height],
        uTime: 0.0
      }
    })
  });
  cloudContainer.addChild(screenQuad);

  // 4. 交互监听
  let isPointerDown = false;
  let pointerX = -1000, pointerY = -1000;
  let lastPointerX = -1000, lastPointerY = -1000;
  let pointerVX = 0, pointerVY = 0;

  window.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.ui-overlay')) {
      if (bgSprite && e.target.closest('#canvas-container')) {
        isImageDragging = true;
        imgDragStartX = e.clientX - imageX;
        imgDragStartY = e.clientY - imageY;
      }
      return;
    }
    isPointerDown = true;
    pointerX = e.clientX;
    pointerY = e.clientY;
    lastPointerX = e.clientX;
    lastPointerY = e.clientY;
  });

  window.addEventListener('pointermove', (e) => {
    if (isImageDragging) {
      imageX = e.clientX - imgDragStartX;
      imageY = e.clientY - imgDragStartY;
      updateBgTransform();
      return;
    }
    if (!isPointerDown) return;
    pointerVX = (e.clientX - lastPointerX) * 0.5;
    pointerVY = (e.clientY - lastPointerY) * 0.5;
    pointerX = e.clientX;
    pointerY = e.clientY;
    lastPointerX = e.clientX;
    lastPointerY = e.clientY;
  });

  const releasePointer = () => {
    isPointerDown = false;
    isImageDragging = false;
    pointerX = -1000;
    pointerY = -1000;
    pointerVX = 0;
    pointerVY = 0;
  };

  window.addEventListener('pointerup', releasePointer);
  window.addEventListener('pointercancel', releasePointer);
  window.addEventListener('pointerleave', releasePointer);

  // 清空按钮：重置密度场
  document.getElementById('clearBtn').addEventListener('click', () => {
    const clearGraphics = new PIXI.Graphics();
    clearGraphics.rect(0, 0, width, height);
    clearGraphics.fill(0x000000);
    app.renderer.render({ container: clearGraphics, target: densityBufferA });
    app.renderer.render({ container: clearGraphics, target: densityBufferB });
    clearGraphics.destroy();
  });

  // 截图按钮
  document.getElementById('snapBtn').addEventListener('click', () => {
    const ui = document.querySelector('.ui-overlay');
    ui.style.display = 'none';
    setTimeout(() => {
      app.renderer.extract.canvas(app.stage).toBlob((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `cloudscape-v0.2.1-gpu-${Date.now()}.png`;
        a.click();
        URL.revokeObjectURL(url);
        ui.style.display = 'flex';
      }, 'image/png');
    }, 50);
  });

  // 5. 每帧循环：GPU Ping-Pong 密度场演算
  let totalTime = 0;
  app.ticker.add((ticker) => {
    const dt = ticker.deltaTime * 0.016;
    totalTime += dt;

    densityFilter.resources.uTime.value = totalTime;
    densityFilter.resources.uResolution.value = [width, height];
    densityFilter.resources.uPointer.value = [pointerX, pointerY];
    densityFilter.resources.uPointerActive.value = isPointerDown ? 1.0 : 0.0;
    densityFilter.resources.uDeltaTime.value = dt;
    densityFilter.resources.uDensityMap.value = densityBufferA;

    // 执行 Ping-Pong 渲染：DensityA -> DensityFilter -> DensityB
    app.renderer.render({
      container: new PIXI.Sprite(densityBufferA), // 占位容器
      target: densityBufferB,
      clear: true
    });

    // 交换缓冲区
    let temp = densityBufferA;
    densityBufferA = densityBufferB;
    densityBufferB = temp;

    // 更新显示 Shader 材质
    screenQuad.shader.resources.uDensityMap.value = densityBufferA;
    screenQuad.shader.resources.uTime.value = totalTime;
  });

  window.addEventListener('resize', () => {
    // 窗口尺寸变化处理
  });
})();
