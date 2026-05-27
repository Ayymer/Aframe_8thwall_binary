/**
 * painting-resurrection — video overlays on the Ruysch image target.
 * iOS strategy: videos start playing on tap and never stop. Visibility
 * is controlled by shader opacity only — pausing breaks VideoTexture on iOS.
 */
(function () {
  const IMG_W = 809;
  const IMG_H = 1024;
  const TARGET_NAME = 'painting';
  const THREE = AFRAME.THREE;

  const hudState = { status: 'Loading…', detail: 'Initializing' };

  function setHud(status, detail) {
    if (status != null) hudState.status = status;
    if (detail != null) hudState.detail = detail;
    const el = document.getElementById('scan-hud');
    if (!el) return;
    el.querySelector('.status').textContent = hudState.status;
    el.querySelector('.detail').textContent = hudState.detail;
  }

  const configPromise = fetch('assets/meta/video-layers.json')
    .then((res) => {
      if (!res.ok) throw new Error(`Config load failed: ${res.status}`);
      return res.json();
    })
    .catch((err) => {
      setHud('Config error', String(err.message || err));
      throw err;
    });

  // ---------- math helpers ----------
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const easeInOutCubic = (t) =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

  function pxToWorld(px, py, cfg) {
    return {
      x: ((px - IMG_W / 2) / IMG_W) * cfg.targetWidth,
      y: ((IMG_H / 2 - py) / IMG_H) * cfg.targetHeight,
    };
  }

  function resolveLayerGeometry(layer, cfg) {
    const figmaPainting = cfg.figmaPaintingSize || [IMG_W, IMG_H];
    const sx = IMG_W / figmaPainting[0];
    const sy = IMG_H / figmaPainting[1];

    // Figma exports frames as top-left + size. Convert to center for placement.
    let figCenter = null;
    let figWidth = null;
    let figHeight = null;
    if (layer.figmaFrame) {
      const [fx, fy, fw, fh] = layer.figmaFrame;
      figCenter = [fx + fw / 2, fy + fh / 2];
      figWidth = fw;
      figHeight = fh;
    } else if (layer.figmaCenter) {
      // Legacy fields, kept for backwards compatibility.
      figCenter = layer.figmaCenter;
      figWidth = layer.figmaWidth;
    }

    const centerPx = layer.centerPx ||
      (figCenter ? [figCenter[0] * sx, figCenter[1] * sy] : [IMG_W / 2, IMG_H / 2]);

    let sizePx = layer.sizePx;
    if (!sizePx && figWidth != null && layer.videoSize) {
      // Lock to video's native aspect ratio anchored on Figma width — the
      // Figma frames in our file already match aspect, but this protects us
      // if someone resizes a frame asymmetrically by accident.
      const w = figWidth * sx;
      sizePx = [w, w * (layer.videoSize[1] / layer.videoSize[0])];
    }
    if (!sizePx && figWidth != null && figHeight != null) {
      sizePx = [figWidth * sx, figHeight * sy];
    }
    if (!sizePx && layer.videoSize) {
      sizePx = [layer.videoSize[0] * sx, layer.videoSize[1] * sy];
    }
    return { centerPx, sizePx };
  }

  function getPhase(loopMs, phases) {
    let t = loopMs;
    if (t < phases.stillMs) return { name: 'still', elapsed: t };
    t -= phases.stillMs;
    if (t < phases.animateMs) return { name: 'animate', elapsed: t, localT: t / phases.animateMs };
    t -= phases.animateMs;
    return { name: 'endStill', elapsed: t, localT: t / phases.endStillMs };
  }

  function phaseOpacity(phase, phases) {
    if (phase.name === 'still') return 0;
    if (phase.name === 'animate') {
      return easeInOutCubic(clamp(phase.elapsed / phases.fadeMs, 0, 1));
    }
    return easeInOutCubic(1 - clamp(phase.elapsed / phases.fadeMs, 0, 1));
  }

  function resolveChroma(global, layer) {
    return Object.assign({}, global || {}, layer && layer.chromaKey ? layer.chromaKey : {});
  }

  // ---------- chroma shader ----------
  function createChromaMaterial(texture, chroma, opacity) {
    const hasSecondary = !!chroma.secondaryColor;
    const hasSpill = chroma.spillThreshold != null;
    return new THREE.ShaderMaterial({
      uniforms: {
        map: { value: texture },
        keyColor: { value: new THREE.Color(chroma.color || '#000000') },
        threshold: { value: chroma.threshold != null ? chroma.threshold : 0.06 },
        smoothness: { value: chroma.smoothness != null ? chroma.smoothness : 0.14 },
        secondaryColor: {
          value: new THREE.Color(chroma.secondaryColor || chroma.color || '#000000'),
        },
        secondaryThreshold: {
          value: chroma.secondaryThreshold != null ? chroma.secondaryThreshold : 0.1,
        },
        secondarySmoothness: {
          value: chroma.secondarySmoothness != null ? chroma.secondarySmoothness : 0.16,
        },
        useSecondary: { value: hasSecondary ? 1.0 : 0.0 },
        spillThreshold: { value: chroma.spillThreshold != null ? chroma.spillThreshold : 0.07 },
        spillSmoothness: {
          value: chroma.spillSmoothness != null ? chroma.spillSmoothness : 0.1,
        },
        useSpill: { value: hasSpill ? 1.0 : 0.0 },
        opacity: { value: opacity },
      },
      vertexShader: [
        'varying vec2 vUV;',
        'void main(void) {',
        '  vUV = uv;',
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
        '}',
      ].join('\n'),
      fragmentShader: [
        'precision mediump float;',
        'uniform sampler2D map;',
        'uniform vec3 keyColor;',
        'uniform float threshold;',
        'uniform float smoothness;',
        'uniform vec3 secondaryColor;',
        'uniform float secondaryThreshold;',
        'uniform float secondarySmoothness;',
        'uniform float useSecondary;',
        'uniform float spillThreshold;',
        'uniform float spillSmoothness;',
        'uniform float useSpill;',
        'uniform float opacity;',
        'varying vec2 vUV;',
        'void main(void) {',
        '  vec4 tex = texture2D(map, vUV);',
        '  float dist = length(tex.rgb - keyColor);',
        '  float alpha = smoothstep(threshold, threshold + smoothness, dist);',
        '  if (useSecondary > 0.5) {',
        '    float dist2 = length(tex.rgb - secondaryColor);',
        '    float alpha2 = smoothstep(',
        '      secondaryThreshold, secondaryThreshold + secondarySmoothness, dist2);',
        '    alpha = min(alpha, alpha2);',
        '  }',
        '  if (useSpill > 0.5) {',
        '    float greenDelta = tex.g - max(tex.r, tex.b);',
        '    float spill = smoothstep(spillThreshold, spillThreshold + spillSmoothness, greenDelta);',
        '    alpha = min(alpha, 1.0 - spill);',
        '  }',
        '  if (alpha < 0.01) discard;',
        '  gl_FragColor = vec4(tex.rgb, alpha * opacity);',
        '}',
      ].join('\n'),
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }

  // ---------- per-layer video binding ----------
  AFRAME.registerComponent('flower-video', {
    schema: {
      videoId: { type: 'string' },
      chromaJson: { type: 'string', default: '{}' },
      opacity: { type: 'number', default: 0 },
    },

    init() {
      this.texture = null;
      this.material = null;
      this.chroma = {};
      try {
        this.chroma = JSON.parse(this.data.chromaJson || '{}');
      } catch (err) {
        this.chroma = {};
      }
      this.video = document.getElementById(this.data.videoId);
      this.bound = false;
      this.errorCode = 0;
      this.errorMsg = null;
      this.tryBind = this.tryBind.bind(this);

      if (!this.video) {
        this.errorMsg = 'no-element';
        return;
      }

      this.video.addEventListener('loadedmetadata', this.tryBind);
      this.video.addEventListener('loadeddata', this.tryBind);
      this.video.addEventListener('canplay', this.tryBind);
      this.video.addEventListener('playing', this.tryBind);
      this.video.addEventListener('error', () => {
        const e = this.video.error;
        this.errorCode = e ? e.code : -1;
        this.errorMsg = e ? `code ${e.code}` : 'error';
      });
    },

    tryBind() {
      if (this.bound || !this.video) return;

      // Need both dimensions and a frame ready
      if (this.video.videoWidth === 0 || this.video.videoHeight === 0) return;

      const mesh = this.el.getObject3D('mesh');
      if (!mesh) {
        this.el.addEventListener('loaded', this.tryBind, { once: true });
        return;
      }

      this.texture = new THREE.VideoTexture(this.video);
      this.texture.minFilter = THREE.LinearFilter;
      this.texture.magFilter = THREE.LinearFilter;
      this.texture.format = THREE.RGBAFormat;
      this.texture.generateMipmaps = false;

      this.material = createChromaMaterial(this.texture, this.chroma, this.data.opacity);
      mesh.material = this.material;
      this.bound = true;
      this.applyOpacity(this.data.opacity);
    },

    applyOpacity(opacity) {
      if (this.material) this.material.uniforms.opacity.value = opacity;
      this.el.object3D.visible = opacity > 0.001 && !!this.material;
    },

    setOpacity(opacity) {
      this.data.opacity = opacity;
      this.applyOpacity(opacity);
    },

    play() {
      if (!this.video) return;
      if (this.video.paused) {
        const a = this.video.play();
        if (a && a.catch) a.catch(() => {});
      }
    },

    tick() {
      if (this.texture && this.video && !this.video.paused) {
        this.texture.needsUpdate = true;
      }
    },

    remove() {
      if (this.video) {
        this.video.removeEventListener('loadedmetadata', this.tryBind);
        this.video.removeEventListener('loadeddata', this.tryBind);
        this.video.removeEventListener('canplay', this.tryBind);
        this.video.removeEventListener('playing', this.tryBind);
      }
      if (this.texture) this.texture.dispose();
      if (this.material) this.material.dispose();
    },
  });

  // ---------- HUD ----------
  AFRAME.registerComponent('scan-hud', {
    init() {
      configPromise
        .then(() => setHud('Ready', 'Tap Begin AR, then point camera at the painting'))
        .catch(() => {});

      this.targetFound = false;

      this.el.sceneEl.addEventListener('xrimagefound', (e) => {
        if (e.detail.name !== TARGET_NAME) return;
        this.targetFound = true;
        this.el.sceneEl.emit('painting-target-found');
      });
      this.el.sceneEl.addEventListener('xrimagelost', (e) => {
        if (e.detail.name !== TARGET_NAME) return;
        this.targetFound = false;
        this.el.sceneEl.emit('painting-target-lost');
      });
    },
  });

  // ---------- orchestration ----------
  AFRAME.registerComponent('painting-resurrection', {
    schema: { config: { type: 'string', default: 'assets/meta/video-layers.json' } },

    init() {
      this.clock = 0;
      this.config = null;
      this.layers = [];
      this.lastPhase = null;
      this.targetFound = false;
      this.hudCounter = 0;

      this.onFound = () => {
        this.targetFound = true;
        this.clock = 0;
        this.lastPhase = null;
        this.playAll();
      };
      this.onLost = () => {
        this.targetFound = false;
      };
      this.el.sceneEl.addEventListener('painting-target-found', this.onFound);
      this.el.sceneEl.addEventListener('painting-target-lost', this.onLost);

      configPromise
        .then((cfg) => {
          this.config = cfg;
          this.buildLayers(cfg);
        })
        .catch((err) => console.error('[painting-resurrection]', err));
    },

    buildLayers(cfg) {
      const globalChroma = cfg.chromaKey || {};
      cfg.layers.forEach((layer, index) => {
        const chroma = resolveChroma(globalChroma, layer);
        const { centerPx, sizePx } = resolveLayerGeometry(layer, cfg);
        const planeW = (sizePx[0] / IMG_W) * cfg.targetWidth;
        const planeH = (sizePx[1] / IMG_H) * cfg.targetHeight;
        const pos = pxToWorld(centerPx[0], centerPx[1], cfg);
        const z = 0.002 + (layer.zOrder || index) * 0.0005;

        const plane = document.createElement('a-plane');
        plane.setAttribute('width', planeW);
        plane.setAttribute('height', planeH);
        plane.setAttribute('position', `${pos.x} ${pos.y} ${z}`);
        plane.setAttribute('flower-video', {
          videoId: layer.videoId,
          chromaJson: JSON.stringify(chroma),
          opacity: 0,
        });
        this.el.appendChild(plane);
        this.layers.push({ el: plane });
      });
    },

    playAll() {
      this.layers.forEach(({ el }) => {
        const c = el.components['flower-video'];
        if (c) c.play();
      });
    },

    getOpacity() {
      if (!this.config || !this.targetFound) return 0;
      return phaseOpacity(getPhase(this.clock, this.config.phases), this.config.phases);
    },

    tick(_time, delta) {
      if (!this.config || !this.layers.length) return;

      if (this.targetFound) {
        this.clock = (this.clock + delta) % this.config.loopDurationMs;
      }
      const phase = this.targetFound ? getPhase(this.clock, this.config.phases) : null;
      const opacity = this.getOpacity();

      let bound = 0;
      let playing = 0;
      let withDims = 0;
      let readyState = 0;
      const errBuckets = { 1: 0, 2: 0, 3: 0, 4: 0, '-1': 0 };
      let totalErr = 0;

      this.layers.forEach(({ el }) => {
        const c = el.components['flower-video'];
        if (!c) return;
        c.setOpacity(opacity);
        if (c.bound) bound++;
        if (c.errorCode) {
          errBuckets[c.errorCode] = (errBuckets[c.errorCode] || 0) + 1;
          totalErr++;
        }
        if (c.video) {
          if (c.video.videoWidth > 0) withDims++;
          if (!c.video.paused) playing++;
          readyState = Math.max(readyState, c.video.readyState);
        }
        if (this.targetFound && opacity > 0.001 && c.video && c.video.paused) c.play();
      });

      this.hudCounter += delta;
      if (this.hudCounter < 300) return;
      this.hudCounter = 0;

      const stats = window.flowerVideoStats || {};
      const status = this.targetFound
        ? `Painting found · ${phase.name}`
        : (stats.tapped ? 'Looking for painting' : 'Waiting for tap');

      const errLabels = { 1: 'ABORT', 2: 'NET', 3: 'DEC', 4: 'SRC', '-1': 'UNK' };
      const errSummary = Object.keys(errBuckets)
        .filter((k) => errBuckets[k] > 0)
        .map((k) => `${errBuckets[k]}×${errLabels[k]}`)
        .join(',');

      const detail =
        `tap ${stats.primed || 0}/${stats.total || 7}` +
        ` · fail ${stats.failed || 0}` +
        ` · dims ${withDims}/${this.layers.length}` +
        ` · bound ${bound}/${this.layers.length}` +
        ` · play ${playing}/${this.layers.length}` +
        ` · rs ${readyState}` +
        (totalErr ? ` · err ${errSummary}` : '');
      setHud(status, detail);
    },

    remove() {
      this.el.sceneEl.removeEventListener('painting-target-found', this.onFound);
      this.el.sceneEl.removeEventListener('painting-target-lost', this.onLost);
    },
  });
})();
