/**
 * painting-resurrection — seasonal video overlays on the Ruysch image target.
 *
 * Performance: videos are created and decoded only for the active season
 * (typically 2–3 clips), with the next season prefetched in the background.
 *
 * Narrative: continuous seasonal loop — video forward+reverse sets the beat,
 * audio loops along, no pauses between seasons.
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

    let figCenter = null;
    let figWidth = null;
    let figHeight = null;
    if (layer.figmaFrame) {
      const [fx, fy, fw, fh] = layer.figmaFrame;
      figCenter = [fx + fw / 2, fy + fh / 2];
      figWidth = fw;
      figHeight = fh;
    } else if (layer.figmaCenter) {
      figCenter = layer.figmaCenter;
      figWidth = layer.figmaWidth;
    }

    const centerPx = layer.centerPx ||
      (figCenter ? [figCenter[0] * sx, figCenter[1] * sy] : [IMG_W / 2, IMG_H / 2]);

    let sizePx = layer.sizePx;
    if (!sizePx && figWidth != null && layer.videoSize) {
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

  function resolveChroma(global, layer) {
    return Object.assign({}, global || {}, layer && layer.chromaKey ? layer.chromaKey : {});
  }

  function waitForVideoEvent(video, eventName) {
    return new Promise((resolve) => {
      if (eventName === 'canplay' && video.readyState >= 3) {
        resolve();
        return;
      }
      const onReady = () => {
        video.removeEventListener(eventName, onReady);
        resolve();
      };
      video.addEventListener(eventName, onReady, { once: true });
    });
  }

  // ---------- lazy video pool ----------
  const VideoPool = {
    poolEl: null,
    byId: new Map(),
    layerByVideoId: new Map(),
    loaded: new Set(),
    playing: new Set(),

    init() {
      this.poolEl = document.getElementById('video-pool');
    },

    registerLayer(layer) {
      this.layerByVideoId.set(layer.videoId, layer);
    },

    reverseId(forwardId) {
      return forwardId + '-reverse';
    },

    createElement(layer, reverse) {
      const videoId = reverse ? this.reverseId(layer.videoId) : layer.videoId;
      if (this.byId.has(videoId)) return this.byId.get(videoId);

      const video = document.createElement('video');
      video.id = videoId;
      video.loop = false;
      video.muted = true;
      video.playsInline = true;
      video.setAttribute('playsinline', '');
      video.setAttribute('webkit-playsinline', '');
      video.preload = 'none';

      const srcWebm = reverse ? layer.srcWebmReverse : layer.srcWebm;
      const src = reverse ? layer.srcReverse : layer.src;

      if (srcWebm) {
        const webm = document.createElement('source');
        webm.src = srcWebm;
        webm.type = 'video/webm';
        video.appendChild(webm);
      }
      if (src) {
        const mp4 = document.createElement('source');
        mp4.src = src;
        mp4.type = 'video/mp4';
        video.appendChild(mp4);
      }

      this.poolEl.appendChild(video);
      this.byId.set(videoId, video);
      return video;
    },

    getReverseVideo(forwardVideoId) {
      return this.byId.get(this.reverseId(forwardVideoId)) || null;
    },

    async loadVideo(video, videoId) {
      if (this.loaded.has(videoId)) return video;
      video.load();
      await waitForVideoEvent(video, 'loadedmetadata');
      await waitForVideoEvent(video, 'canplay');
      this.loaded.add(videoId);
      if (!videoId.endsWith('-reverse')) {
        window.dispatchEvent(new CustomEvent('flower-video-ready', {
          detail: { id: videoId },
        }));
      }
      return video;
    },

    async loadLayers(layerIds, layersById) {
      const tasks = layerIds.map(async (id) => {
        const layer = layersById.get(id);
        if (!layer) return null;
        const forward = this.createElement(layer, false);
        const reverse = this.createElement(layer, true);
        await this.loadVideo(forward, layer.videoId);
        await this.loadVideo(reverse, this.reverseId(layer.videoId));
        return forward;
      });
      return Promise.all(tasks);
    },

    async playLayers(layerIds, layersById) {
      const videos = await this.loadLayers(layerIds, layersById);
      videos.filter(Boolean).forEach((video) => {
        video.pause();
        try {
          video.currentTime = 0;
        } catch (err) {
          /* ignore seek before metadata */
        }
        this.playing.add(video.id);
      });
    },

    pauseExcept(keepVideoIds) {
      const keep = new Set(keepVideoIds);
      this.byId.forEach((video, id) => {
        if (keep.has(id)) return;
        if (!video.paused) video.pause();
        this.playing.delete(id);
      });
    },

    prefetch(layerIds, layersById) {
      this.loadLayers(layerIds, layersById).catch((err) => {
        console.warn('[video-pool] prefetch failed', err);
      });
    },

    stats() {
      return {
        created: this.byId.size,
        loaded: this.loaded.size,
        playing: this.playing.size,
      };
    },
  };

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
      this.video = null;
      this.bound = false;
      this.errorCode = 0;
      this.errorMsg = null;
      this.cycleActive = false;
      this.cycleComplete = false;
      this.playMode = 'idle';
      this.reverseVideo = null;
      this.onForwardEnded = () => this.beginWilt();
      this.onReverseEnded = () => this.finishCycle();
      this.tryBind = this.tryBind.bind(this);
      this.onVideoReady = (e) => {
        if (e.detail.id !== this.data.videoId) return;
        this.attachVideo();
      };

      window.addEventListener('flower-video-ready', this.onVideoReady);
      this.attachVideo();
    },

    attachVideo() {
      if (this.bound) return;
      this.video = document.getElementById(this.data.videoId);
      if (!this.video) {
        this.errorMsg = 'pending';
        return;
      }

      this.errorMsg = null;
      this.video.addEventListener('loadedmetadata', this.tryBind);
      this.video.addEventListener('loadeddata', this.tryBind);
      this.video.addEventListener('canplay', this.tryBind);
      this.video.addEventListener('playing', this.tryBind);
      this.video.addEventListener('error', () => {
        const e = this.video.error;
        this.errorCode = e ? e.code : -1;
        this.errorMsg = e ? `code ${e.code}` : 'error';
      });
      this.tryBind();
    },

    tryBind() {
      if (this.bound || !this.video) return;
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

    beginCycle() {
      if (!this.video || !this.bound) return;
      this.clearCycleListeners();
      this.cycleActive = true;
      this.cycleComplete = false;
      this.playMode = 'forward';
      this.reverseVideo = VideoPool.getReverseVideo(this.data.videoId);

      if (this.texture) {
        this.texture.image = this.video;
      }

      try {
        this.video.currentTime = 0;
      } catch (err) {
        /* ignore */
      }

      this.video.addEventListener('ended', this.onForwardEnded);
      const attempt = this.video.play();
      if (attempt && attempt.catch) attempt.catch(() => {});
    },

    beginWilt() {
      if (!this.cycleActive || !this.reverseVideo) {
        this.finishCycle();
        return;
      }

      this.playMode = 'reverse';
      if (this.video) {
        this.video.removeEventListener('ended', this.onForwardEnded);
        this.video.pause();
      }

      const reverse = this.reverseVideo;
      const startReverse = () => {
        if (!this.cycleActive) return;
        if (this.texture) {
          this.texture.image = reverse;
          this.texture.needsUpdate = true;
        }
        try {
          reverse.currentTime = 0;
        } catch (err) {
          /* ignore */
        }
        reverse.addEventListener('ended', this.onReverseEnded);
        const attempt = reverse.play();
        if (attempt && attempt.catch) attempt.catch(() => {});
      };

      if (reverse.readyState >= 3) {
        startReverse();
      } else {
        reverse.addEventListener('canplay', startReverse, { once: true });
        if (reverse.readyState === 0) reverse.load();
      }
    },

    finishCycle() {
      this.playMode = 'idle';
      this.cycleComplete = true;
      if (this.reverseVideo) {
        this.reverseVideo.removeEventListener('ended', this.onReverseEnded);
        this.reverseVideo.pause();
      }
      if (this.texture && this.video) {
        this.texture.image = this.video;
      }
    },

    clearCycleListeners() {
      if (this.video) {
        this.video.removeEventListener('ended', this.onForwardEnded);
      }
      if (this.reverseVideo) {
        this.reverseVideo.removeEventListener('ended', this.onReverseEnded);
      }
    },

    stopCycle() {
      this.cycleActive = false;
      this.cycleComplete = false;
      this.playMode = 'idle';
      this.clearCycleListeners();
      if (this.reverseVideo) {
        this.reverseVideo.pause();
        try {
          this.reverseVideo.currentTime = 0;
        } catch (err) {
          /* ignore */
        }
      }
      if (!this.video) return;
      this.video.pause();
      try {
        this.video.currentTime = 0;
      } catch (err) {
        /* ignore */
      }
      if (this.texture) {
        this.texture.image = this.video;
      }
    },

    isCycleDone() {
      return this.cycleActive && this.cycleComplete;
    },

    getPlayMode() {
      return this.playMode;
    },

    tick() {
      if (!this.texture || !this.bound || this.data.opacity < 0.001) return;
      const active = this.playMode === 'forward' ? this.video : this.reverseVideo;
      if (active && !active.paused) {
        this.texture.needsUpdate = true;
      }
    },

    remove() {
      this.clearCycleListeners();
      window.removeEventListener('flower-video-ready', this.onVideoReady);
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

      this.el.sceneEl.addEventListener('xrimagefound', (e) => {
        if (e.detail.name !== TARGET_NAME) return;
        this.el.sceneEl.emit('painting-target-found');
      });
      this.el.sceneEl.addEventListener('xrimagelost', (e) => {
        if (e.detail.name !== TARGET_NAME) return;
        this.el.sceneEl.emit('painting-target-lost');
      });
    },
  });

  // ---------- orchestration ----------
  AFRAME.registerComponent('painting-resurrection', {
    schema: { config: { type: 'string', default: 'assets/meta/video-layers.json' } },

    init() {
      this.config = null;
      this.layers = [];
      this.layersById = new Map();
      this.targetFound = false;
      this.running = false;
      this.hudCounter = 0;
      this.elapsedMs = 0;
      this.currentSeasonIndex = -1;
      this.activeLayerIds = [];
      this.seasonReady = false;
      this.audioOnlySeason = false;
      this.seasonAudio = new Audio();
      this.seasonAudio.preload = 'auto';
      this.onAudioEnded = () => {
        if (this.audioOnlySeason && this.running) this.completeSeason();
      };

      VideoPool.init();

      this.onFound = () => {
        this.targetFound = true;
        if (window.flowerGesturePrimed) this.startSequence();
      };
      this.onLost = () => {
        this.targetFound = false;
        this.running = false;
        this.currentSeasonIndex = -1;
        this.activeLayerIds = [];
        this.seasonReady = false;
        this.audioOnlySeason = false;
        this.stopSeasonAudio();
        VideoPool.pauseExcept([]);
        this.layers.forEach(({ el }) => {
          const c = el.components['flower-video'];
          if (c) {
            c.stopCycle();
            c.setOpacity(0);
          }
        });
      };
      this.onGesture = () => {
        if (this.targetFound) this.startSequence();
      };

      this.el.sceneEl.addEventListener('painting-target-found', this.onFound);
      this.el.sceneEl.addEventListener('painting-target-lost', this.onLost);
      window.addEventListener('flower-gesture-primed', this.onGesture);

      configPromise
        .then((cfg) => {
          this.config = cfg;
          cfg.layers.forEach((layer) => {
            this.layersById.set(layer.id, layer);
            VideoPool.registerLayer(layer);
          });
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
        this.layers.push({ el: plane, id: layer.id, videoId: layer.videoId });
      });
    },

    startSequence() {
      if (!this.config || this.running) return;
      this.running = true;
      this.elapsedMs = 0;
      this.startSeason(0);
    },

    getLayerComponent(layerId) {
      const entry = this.layers.find((l) => l.id === layerId);
      return entry ? entry.el.components['flower-video'] : null;
    },

    stopSeasonAudio() {
      this.seasonAudio.onended = null;
      this.seasonAudio.loop = false;
      this.seasonAudio.pause();
    },

    startSeason(seasonIndex) {
      this.seasonReady = false;
      this.audioOnlySeason = false;
      this.activeLayerIds = [];
      this.currentSeasonIndex = seasonIndex;

      this.layers.forEach(({ el }) => {
        const c = el.components['flower-video'];
        if (c) {
          c.stopCycle();
          c.setOpacity(0);
        }
      });

      VideoPool.pauseExcept([]);

      const season = this.config.seasons[seasonIndex];
      const layerIds = (season && season.layers) ? season.layers.slice() : [];
      const nextSeason = this.config.seasons[(seasonIndex + 1) % this.config.seasons.length];
      if (nextSeason && nextSeason.layers && nextSeason.layers.length) {
        VideoPool.prefetch(nextSeason.layers, this.layersById);
      }

      if (!layerIds.length) {
        this.audioOnlySeason = true;
        this.seasonReady = true;
        this.playSeasonSound(seasonIndex, false);
        this.seasonAudio.onended = this.onAudioEnded;
        return;
      }

      this.activeLayerIds = layerIds;
      const videoIds = this.getVideoIdsForLayers(layerIds);
      VideoPool.pauseExcept(videoIds);
      this.playSeasonSound(seasonIndex, true);

      VideoPool.loadLayers(layerIds, this.layersById).then(() => {
        if (!this.running || this.currentSeasonIndex !== seasonIndex) return;
        layerIds.forEach((id) => {
          const c = this.getLayerComponent(id);
          if (!c) return;
          c.setOpacity(1);
          c.beginCycle();
        });
        this.seasonReady = true;
      }).catch((err) => console.warn('[startSeason]', err));
    },

    completeSeason() {
      if (!this.running || !this.targetFound) return;
      this.stopSeasonAudio();
      const next = (this.currentSeasonIndex + 1) % this.config.seasons.length;
      this.startSeason(next);
    },

    getVideoIdsForLayers(layerIds) {
      const ids = [];
      layerIds.forEach((id) => {
        const layer = this.layersById.get(id);
        if (!layer) return;
        ids.push(layer.videoId);
        ids.push(VideoPool.reverseId(layer.videoId));
      });
      return ids;
    },

    playSeasonSound(seasonIndex, loop) {
      this.stopSeasonAudio();
      if (seasonIndex < 0) return;
      const season = this.config.seasons[seasonIndex];
      if (!season || !season.sound) return;
      this.seasonAudio.loop = !!loop;
      this.seasonAudio.src = season.sound;
      this.seasonAudio.currentTime = 0;
      const attempt = this.seasonAudio.play();
      if (attempt && attempt.catch) {
        attempt.catch((err) => console.warn('[season-audio]', season.id, err && err.message));
      }
    },

    tick(_time, delta) {
      if (!this.config || !this.layers.length) return;

      if (this.targetFound && this.running) {
        this.elapsedMs += delta;
      }

      if (this.running && this.targetFound && this.seasonReady && !this.audioOnlySeason) {
        const allDone = this.activeLayerIds.length > 0 &&
          this.activeLayerIds.every((id) => {
            const c = this.getLayerComponent(id);
            return c && c.isCycleDone();
          });
        if (allDone) this.completeSeason();
      }

      this.hudCounter += delta;
      if (this.hudCounter < 400) return;
      this.hudCounter = 0;

      const pool = VideoPool.stats();
      const season = this.currentSeasonIndex >= 0
        ? this.config.seasons[this.currentSeasonIndex]
        : null;
      let phase = '';
      if (season && this.activeLayerIds.length) {
        const modes = this.activeLayerIds.map((id) => {
          const c = this.getLayerComponent(id);
          return c ? c.getPlayMode() : 'idle';
        });
        if (modes.includes('reverse')) phase = ' · wilt';
        else if (modes.includes('forward')) phase = ' · bloom';
      }

      const status = this.targetFound
        ? (season ? `${season.label}${phase}` : 'Nature morte')
        : (window.flowerGesturePrimed ? 'Looking for painting' : 'Waiting for tap');

      const detail =
        `videos ${pool.loaded}/7 loaded` +
        (this.running ? ` · ${Math.round(this.elapsedMs / 1000)}s` : '');

      setHud(status, detail);
    },

    remove() {
      this.el.sceneEl.removeEventListener('painting-target-found', this.onFound);
      this.el.sceneEl.removeEventListener('painting-target-lost', this.onLost);
      window.removeEventListener('flower-gesture-primed', this.onGesture);
      this.stopSeasonAudio();
    },
  });
})();
