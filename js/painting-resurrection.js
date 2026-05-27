/**
 * painting-resurrection — seasonal video overlays on the Ruysch image target.
 *
 * Performance: videos are created and decoded only for the active season
 * (typically 2–3 clips), with the next season prefetched in the background.
 *
 * Narrative: intro still → season 1 (sound + flowers) → … → outro still → loop.
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

  function buildTimeline(cfg) {
    const seq = cfg.sequence || {};
    const intro = seq.introStillMs != null ? seq.introStillMs : 1500;
    const outro = seq.outroStillMs != null ? seq.outroStillMs : 2500;
    const between = seq.betweenMs != null ? seq.betweenMs : 600;
    const fade = seq.fadeMs != null ? seq.fadeMs : 900;
    const defaultHold = seq.audioMs != null ? seq.audioMs : 4000;
    const seasons = cfg.seasons || [];
    const segments = [];
    let t = 0;

    segments.push({ kind: 'intro', start: t, end: t + intro });
    t += intro;

    seasons.forEach((season, index) => {
      const hold = season.holdMs != null ? season.holdMs : defaultHold;
      segments.push({ kind: 'fadeIn', seasonIndex: index, start: t, end: t + fade });
      t += fade;
      segments.push({ kind: 'hold', seasonIndex: index, start: t, end: t + hold });
      t += hold;
      segments.push({ kind: 'fadeOut', seasonIndex: index, start: t, end: t + fade });
      t += fade;
      if (index < seasons.length - 1) {
        segments.push({ kind: 'between', start: t, end: t + between });
        t += between;
      }
    });

    segments.push({ kind: 'outro', start: t, end: t + outro });
    t += outro;

    return { segments, loopDurationMs: t, fadeMs: fade, defaultHold };
  }

  /** Ping-pong 0→1→0 over the hold window (synced to 4s audio). */
  function getBlossomPhase(clock, timeline, seasonIndex) {
    if (seasonIndex < 0) return 0;
    const loopMs = ((clock % timeline.loopDurationMs) + timeline.loopDurationMs) %
      timeline.loopDurationMs;
    const holdSeg = timeline.segments.find(
      (s) => s.kind === 'hold' && s.seasonIndex === seasonIndex
    );
    if (!holdSeg || loopMs < holdSeg.start || loopMs >= holdSeg.end) return 0;
    const elapsed = loopMs - holdSeg.start;
    const duration = holdSeg.end - holdSeg.start;
    const t = elapsed / duration;
    if (t < 0.5) return t * 2;
    return 1 - (t - 0.5) * 2;
  }

  function getTimelineState(clock, timeline) {
    const loopMs = ((clock % timeline.loopDurationMs) + timeline.loopDurationMs) % timeline.loopDurationMs;
    const seg = timeline.segments.find((s) => loopMs >= s.start && loopMs < s.end) ||
      timeline.segments[timeline.segments.length - 1];
    const elapsed = loopMs - seg.start;
    const duration = seg.end - seg.start;
    const fadeMs = timeline.fadeMs;

    if (seg.kind === 'intro' || seg.kind === 'between' || seg.kind === 'outro') {
      return {
        kind: seg.kind,
        seasonIndex: -1,
        layerOpacity: 0,
        label: seg.kind === 'intro' ? 'Nature morte' : seg.kind === 'outro' ? 'Returning…' : 'Pause',
      };
    }

    if (seg.kind === 'hold') {
      return {
        kind: seg.kind,
        seasonIndex: seg.seasonIndex,
        layerOpacity: 1,
        label: null,
      };
    }

    if (seg.kind === 'fadeIn') {
      return {
        kind: seg.kind,
        seasonIndex: seg.seasonIndex,
        layerOpacity: easeInOutCubic(clamp(elapsed / fadeMs, 0, 1)),
        label: null,
      };
    }

    return {
      kind: seg.kind,
      seasonIndex: seg.seasonIndex,
      layerOpacity: easeInOutCubic(1 - clamp(elapsed / fadeMs, 0, 1)),
      label: null,
    };
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

    createElement(layer) {
      if (this.byId.has(layer.videoId)) return this.byId.get(layer.videoId);

      const video = document.createElement('video');
      video.id = layer.videoId;
      video.loop = false;
      video.muted = true;
      video.playsInline = true;
      video.setAttribute('playsinline', '');
      video.setAttribute('webkit-playsinline', '');
      video.preload = 'none';

      if (layer.srcWebm) {
        const webm = document.createElement('source');
        webm.src = layer.srcWebm;
        webm.type = 'video/webm';
        video.appendChild(webm);
      }
      if (layer.src) {
        const mp4 = document.createElement('source');
        mp4.src = layer.src;
        mp4.type = 'video/mp4';
        video.appendChild(mp4);
      }

      this.poolEl.appendChild(video);
      this.byId.set(layer.videoId, video);
      return video;
    },

    async loadLayers(layerIds, layersById) {
      const tasks = layerIds.map(async (id) => {
        const layer = layersById.get(id);
        if (!layer) return null;
        const video = this.createElement(layer);
        if (this.loaded.has(layer.videoId)) return video;
        video.load();
        await waitForVideoEvent(video, 'loadedmetadata');
        await waitForVideoEvent(video, 'canplay');
        this.loaded.add(layer.videoId);
        window.dispatchEvent(new CustomEvent('flower-video-ready', {
          detail: { id: layer.videoId },
        }));
        return video;
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
      this.lastBlossomPhase = -1;
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

    /** Scrub video: 0 = nature morte, 1 = full bloom, then back to 0. */
    setBlossomPhase(phase) {
      if (!this.video || !this.bound) return;
      const p = clamp(phase, 0, 1);
      if (Math.abs(p - this.lastBlossomPhase) < 0.0005) return;
      this.lastBlossomPhase = p;
      if (!this.video.paused) this.video.pause();
      const duration = this.video.duration;
      if (duration && isFinite(duration)) {
        const t = p * Math.max(0, duration - 0.04);
        if (Math.abs(this.video.currentTime - t) > 0.02) {
          try {
            this.video.currentTime = t;
          } catch (err) {
            /* seek can fail while buffering */
          }
        }
      }
      if (this.texture) this.texture.needsUpdate = true;
    },

    resetBlossom() {
      this.lastBlossomPhase = -1;
      this.setBlossomPhase(0);
    },

    tick() {
      if (this.texture && this.bound && this.data.opacity > 0.001) {
        this.texture.needsUpdate = true;
      }
    },

    remove() {
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
      this.clock = 0;
      this.config = null;
      this.timeline = null;
      this.layers = [];
      this.layersById = new Map();
      this.targetFound = false;
      this.running = false;
      this.hudCounter = 0;
      this.activeSeasonIndex = -2;
      this.lastSeasonKey = null;
      this.lastAudioKey = null;
      this.seasonAudio = new Audio();
      this.seasonAudio.preload = 'auto';

      VideoPool.init();

      this.onFound = () => {
        this.targetFound = true;
        if (window.flowerGesturePrimed) this.startSequence();
      };
      this.onLost = () => {
        this.targetFound = false;
        this.running = false;
        this.activeSeasonIndex = -2;
        this.lastSeasonKey = null;
        this.lastAudioKey = null;
        this.seasonAudio.pause();
        VideoPool.pauseExcept([]);
        this.layers.forEach(({ el }) => {
          const c = el.components['flower-video'];
          if (c) c.setOpacity(0);
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
          this.timeline = buildTimeline(cfg);
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
      this.clock = 0;
      this.activeSeasonIndex = -2;
      this.lastSeasonKey = null;
      this.lastAudioKey = null;
      this.enterSeason(-1, []);
    },

    getActiveLayerIds(seasonIndex) {
      if (seasonIndex < 0) return [];
      const season = this.config.seasons[seasonIndex];
      return season && season.layers ? season.layers : [];
    },

    getVideoIdsForLayers(layerIds) {
      return layerIds
        .map((id) => this.layersById.get(id))
        .filter(Boolean)
        .map((layer) => layer.videoId);
    },

    enterSeason(seasonIndex, layerIds) {
      const videoIds = this.getVideoIdsForLayers(layerIds);

      VideoPool.pauseExcept(videoIds);

      if (layerIds.length) {
        VideoPool.playLayers(layerIds, this.layersById).then(() => {
          this.layers.forEach(({ id, el }) => {
            if (!layerIds.includes(id)) return;
            const c = el.components['flower-video'];
            if (c) c.resetBlossom();
          });
        });
      }

      const nextSeason = this.config.seasons[seasonIndex + 1];
      if (nextSeason && nextSeason.layers && nextSeason.layers.length) {
        VideoPool.prefetch(nextSeason.layers, this.layersById);
      }

      this.activeSeasonIndex = seasonIndex;
    },

    playSeasonSound(seasonIndex) {
      this.seasonAudio.pause();
      if (seasonIndex < 0) return;
      const season = this.config.seasons[seasonIndex];
      if (!season || !season.sound) return;
      this.seasonAudio.src = season.sound;
      this.seasonAudio.currentTime = 0;
      const attempt = this.seasonAudio.play();
      if (attempt && attempt.catch) {
        attempt.catch((err) => console.warn('[season-audio]', season.id, err && err.message));
      }
    },

    tick(_time, delta) {
      if (!this.config || !this.timeline || !this.layers.length) return;

      if (this.targetFound && this.running) {
        this.clock += delta;
        if (this.clock >= this.timeline.loopDurationMs) {
          this.clock = 0;
          this.lastSeasonKey = null;
          this.lastAudioKey = null;
        }
      }

      const state = this.running && this.targetFound
        ? getTimelineState(this.clock, this.timeline)
        : { kind: 'idle', seasonIndex: -1, layerOpacity: 0, label: 'Nature morte' };

      const activeLayerIds = this.getActiveLayerIds(state.seasonIndex);
      const shouldAnimate = state.layerOpacity > 0.001 && activeLayerIds.length > 0;

      if (this.running && this.targetFound) {
        const seasonKey = `${state.seasonIndex}:${activeLayerIds.join(',')}:${state.kind}`;
        if (seasonKey !== this.lastSeasonKey) {
          if (state.kind === 'fadeIn' || state.kind === 'hold') {
            this.enterSeason(state.seasonIndex, activeLayerIds);
            this.lastSeasonKey = seasonKey;
          } else if (state.layerOpacity <= 0.001 && state.kind !== 'hold') {
            this.enterSeason(-1, []);
            this.lastSeasonKey = seasonKey;
          }
        }

        if (state.kind === 'hold' && state.seasonIndex >= 0) {
          const audioKey = `audio:${state.seasonIndex}`;
          if (audioKey !== this.lastAudioKey) {
            this.lastAudioKey = audioKey;
            this.playSeasonSound(state.seasonIndex);
          }
        }
      }

      const blossomPhase = state.kind === 'hold' && state.seasonIndex >= 0
        ? getBlossomPhase(this.clock, this.timeline, state.seasonIndex)
        : 0;

      this.layers.forEach(({ id, el }) => {
        const c = el.components['flower-video'];
        if (!c) return;
        const inSeason = activeLayerIds.includes(id) && shouldAnimate;
        c.setOpacity(inSeason ? state.layerOpacity : 0);
        if (inSeason) {
          c.setBlossomPhase(state.kind === 'hold' ? blossomPhase : 0);
        } else {
          c.resetBlossom();
        }
      });

      this.hudCounter += delta;
      if (this.hudCounter < 400) return;
      this.hudCounter = 0;

      const pool = VideoPool.stats();
      const season = state.seasonIndex >= 0 ? this.config.seasons[state.seasonIndex] : null;
      const status = this.targetFound
        ? (season ? `${season.label} · ${state.kind}` : state.label || state.kind)
        : (window.flowerGesturePrimed ? 'Looking for painting' : 'Waiting for tap');

      const detail =
        `videos ${pool.loaded}/7 loaded · ${pool.playing} playing` +
        (this.running ? ` · loop ${Math.round(this.clock / 1000)}s` : '');

      setHud(status, detail);
    },

    remove() {
      this.el.sceneEl.removeEventListener('painting-target-found', this.onFound);
      this.el.sceneEl.removeEventListener('painting-target-lost', this.onLost);
      window.removeEventListener('flower-gesture-primed', this.onGesture);
      this.seasonAudio.pause();
    },
  });
})();
