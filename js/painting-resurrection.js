/**
 * painting-resurrection — video overlays on the Ruysch image target.
 * iOS-safe: waits for tap-to-prime before binding video textures.
 */
(function () {
  const IMG_W = 809;
  const IMG_H = 1024;
  const TARGET_NAME = 'painting';
  const THREE = AFRAME.THREE;

  const hudState = {
    status: 'Loading…',
    detail: 'Initializing',
  };

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

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }
  function pxToWorld(px, py, config) {
    return {
      x: ((px - IMG_W / 2) / IMG_W) * config.targetWidth,
      y: ((IMG_H / 2 - py) / IMG_H) * config.targetHeight,
    };
  }
  function resolveLayerGeometry(layer, config) {
    const figmaSize = config.figmaPaintingSize || [IMG_W, IMG_H];
    const scaleX = IMG_W / figmaSize[0];
    const scaleY = IMG_H / figmaSize[1];
    const centerPx = layer.centerPx || [
      layer.figmaCenter[0] * scaleX,
      layer.figmaCenter[1] * scaleY,
    ];
    let sizePx = layer.sizePx;
    if (!sizePx && layer.figmaWidth != null && layer.videoSize) {
      const widthPx = layer.figmaWidth * scaleX;
      const aspect = layer.videoSize[1] / layer.videoSize[0];
      sizePx = [widthPx, widthPx * aspect];
    }
    if (!sizePx && layer.videoSize) {
      sizePx = [layer.videoSize[0] * scaleX, layer.videoSize[1] * scaleY];
    }
    return { centerPx, sizePx };
  }
  function getPhase(loopMs, phases) {
    let t = loopMs;
    if (t < phases.stillMs) return { name: 'still', elapsed: t };
    t -= phases.stillMs;
    if (t < phases.animateMs) {
      return { name: 'animate', elapsed: t, localT: t / phases.animateMs };
    }
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

  // ---------- chroma shader ----------

  function createChromaMaterial(texture, chroma, opacity) {
    return new THREE.ShaderMaterial({
      uniforms: {
        map: { value: texture },
        keyColor: { value: new THREE.Color(chroma.color || '#000000') },
        threshold: { value: chroma.threshold != null ? chroma.threshold : 0.06 },
        smoothness: { value: chroma.smoothness != null ? chroma.smoothness : 0.14 },
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
        'uniform float opacity;',
        'varying vec2 vUV;',
        'void main(void) {',
        '  vec4 tex = texture2D(map, vUV);',
        '  float dist = length(tex.rgb - keyColor);',
        '  float alpha = smoothstep(threshold, threshold + smoothness, dist);',
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
      keyColor: { type: 'color', default: '#000000' },
      threshold: { type: 'number', default: 0.06 },
      smoothness: { type: 'number', default: 0.14 },
      opacity: { type: 'number', default: 0 },
    },

    init() {
      this.texture = null;
      this.material = null;
      this.video = document.getElementById(this.data.videoId);
      this.primed = false;
      this.tryBind = this.tryBind.bind(this);
      this.onPrimed = this.onPrimed.bind(this);

      if (!this.video) return;

      this.video.muted = true;
      this.video.loop = true;
      this.video.playsInline = true;
      this.video.crossOrigin = 'anonymous';
      this.video.preload = 'auto';
      this.video.setAttribute('playsinline', '');
      this.video.setAttribute('webkit-playsinline', '');

      this.video.addEventListener('loadeddata', this.tryBind);
      this.video.addEventListener('canplay', this.tryBind);
      this.video.addEventListener('error', () => {
        console.error('[flower-video] error', this.data.videoId, this.video.error);
      });

      // Wait for the tap-to-start gesture to prime decoding.
      window.addEventListener('flower-video-primed', this.onPrimed);
      window.addEventListener('flower-videos-primed', () => {
        this.primed = true;
        this.tryBind();
      });

      this.video.load();
    },

    onPrimed(e) {
      if (e.detail && e.detail.id === this.data.videoId) {
        this.primed = true;
        this.tryBind();
      }
    },

    tryBind() {
      if (this.material || !this.video) return;
      if (this.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;

      const mesh = this.el.getObject3D('mesh');
      if (!mesh) {
        this.el.addEventListener('loaded', this.tryBind, { once: true });
        return;
      }

      this.texture = new THREE.VideoTexture(this.video);
      this.texture.minFilter = THREE.LinearFilter;
      this.texture.magFilter = THREE.LinearFilter;
      this.texture.format = THREE.RGBAFormat;

      this.material = createChromaMaterial(this.texture, this.data, this.data.opacity);
      mesh.material = this.material;
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
      if (!this.video) return null;
      const attempt = this.video.play();
      if (attempt && attempt.catch) {
        attempt.catch((err) => {
          console.warn('[flower-video] play()', this.data.videoId, err && err.message);
        });
      }
      return attempt;
    },

    pause() {
      if (!this.video) return;
      this.video.pause();
      this.video.currentTime = 0;
    },

    tick() {
      if (this.texture && this.video && !this.video.paused) {
        this.texture.needsUpdate = true;
      }
    },

    remove() {
      window.removeEventListener('flower-video-primed', this.onPrimed);
      if (this.video) {
        this.video.removeEventListener('loadeddata', this.tryBind);
        this.video.removeEventListener('canplay', this.tryBind);
      }
      if (this.texture) this.texture.dispose();
      if (this.material) this.material.dispose();
    },
  });

  // ---------- HUD on scene ----------

  AFRAME.registerComponent('scan-hud', {
    init() {
      configPromise
        .then(() => setHud('Tap to begin', 'Then point camera at the printed painting'))
        .catch(() => {});

      this.bound = 0;
      this.playing = 0;
      this.targetFound = false;

      window.addEventListener('flower-video-primed', (e) => {
        const { count, total } = e.detail || {};
        setHud('Look for the painting', `Videos primed: ${count}/${total}`);
      });

      this.el.sceneEl.addEventListener('xrimagefound', (e) => {
        if (e.detail.name !== TARGET_NAME) return;
        this.targetFound = true;
        setHud('Painting recognized', 'Playing animation');
        this.el.sceneEl.emit('painting-target-found');
      });
      this.el.sceneEl.addEventListener('xrimagelost', (e) => {
        if (e.detail.name !== TARGET_NAME) return;
        this.targetFound = false;
        setHud('Lost target', 'Re-aim at the painting');
        this.el.sceneEl.emit('painting-target-lost');
      });
    },
  });

  // ---------- orchestration ----------

  AFRAME.registerComponent('painting-resurrection', {
    schema: {
      config: { type: 'string', default: 'assets/meta/video-layers.json' },
    },

    init() {
      this.clock = 0;
      this.config = null;
      this.layers = [];
      this.lastPhase = null;
      this.targetFound = false;
      this.primed = false;

      this.onPrimed = () => { this.primed = true; this.syncPlayback(); };
      this.onFound = () => {
        this.targetFound = true;
        this.clock = 0;
        this.lastPhase = null;
        this.syncPlayback();
      };
      this.onLost = () => {
        this.targetFound = false;
        this.pauseAll();
      };

      window.addEventListener('flower-videos-primed', this.onPrimed);
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
      const chroma = cfg.chromaKey || {};
      cfg.layers.forEach((layer, index) => {
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
          keyColor: chroma.color || '#000000',
          threshold: chroma.threshold != null ? chroma.threshold : 0.06,
          smoothness: chroma.smoothness != null ? chroma.smoothness : 0.14,
          opacity: 0,
        });

        this.el.appendChild(plane);
        this.layers.push({ el: plane });
      });
    },

    getCurrentPhase() {
      return getPhase(this.clock, this.config.phases);
    },

    getCurrentOpacity() {
      if (!this.config || !this.targetFound) return 0;
      return phaseOpacity(this.getCurrentPhase(), this.config.phases);
    },

    shouldPlay() {
      if (!this.targetFound || !this.config) return false;
      const phase = this.getCurrentPhase();
      return phase.name === 'animate' || phase.name === 'endStill';
    },

    syncPlayback() {
      if (this.shouldPlay()) this.playAll();
      else this.pauseAll();
    },

    playAll() {
      this.layers.forEach(({ el }) => {
        const c = el.components['flower-video'];
        if (c) c.play();
      });
    },

    pauseAll() {
      this.layers.forEach(({ el }) => {
        const c = el.components['flower-video'];
        if (c) c.pause();
      });
    },

    tick(_time, delta) {
      if (!this.config || !this.layers.length) return;
      if (!this.targetFound) return;

      this.clock = (this.clock + delta) % this.config.loopDurationMs;
      const phase = this.getCurrentPhase();
      const opacity = this.getCurrentOpacity();

      if (phase.name !== this.lastPhase) {
        this.syncPlayback();
        this.lastPhase = phase.name;
      }

      let ready = 0;
      let playing = 0;
      this.layers.forEach(({ el }) => {
        const c = el.components['flower-video'];
        if (!c) return;
        c.setOpacity(opacity);
        if (c.material) ready++;
        if (c.video && !c.video.paused) playing++;
        if (opacity > 0.001 && c.video && c.video.paused) c.play();
      });

      // Surface state in HUD while tracking
      if (this.targetFound) {
        setHud(null, `Phase: ${phase.name} · ready: ${ready}/${this.layers.length} · playing: ${playing}`);
      }
    },

    remove() {
      window.removeEventListener('flower-videos-primed', this.onPrimed);
      this.el.sceneEl.removeEventListener('painting-target-found', this.onFound);
      this.el.sceneEl.removeEventListener('painting-target-lost', this.onLost);
    },
  });
})();
