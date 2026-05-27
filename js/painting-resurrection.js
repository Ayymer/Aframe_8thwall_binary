/**
 * painting-resurrection — video overlay loop aligned to Figma-mapped positions.
 * Config: assets/meta/video-layers.json
 */
(function () {
  const IMG_W = 809;
  const IMG_H = 1024;
  const THREE = AFRAME.THREE;

  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }

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
    const sizePx = layer.sizePx || [
      layer.videoSize[0] * scaleX,
      layer.videoSize[1] * scaleY,
    ];
    return { centerPx, sizePx };
  }

  function getPhase(loopMs, phases) {
    let t = loopMs;
    if (t < phases.stillMs) {
      return { name: 'still', elapsed: t };
    }
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
      const fadeIn = clamp(phase.elapsed / phases.fadeMs, 0, 1);
      return easeInOutCubic(fadeIn);
    }
    const fadeOut = 1 - clamp(phase.elapsed / phases.fadeMs, 0, 1);
    return easeInOutCubic(fadeOut);
  }

  function createChromaMaterial(texture, chroma, opacity) {
    return new THREE.ShaderMaterial({
      uniforms: {
        map: { value: texture },
        keyColor: { value: new THREE.Color(chroma.color || '#000000') },
        threshold: { value: chroma.threshold != null ? chroma.threshold : 0.06 },
        smoothness: {
          value: chroma.smoothness != null ? chroma.smoothness : 0.14,
        },
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

  AFRAME.registerComponent('chromakey-video', {
    schema: {
      video: { type: 'selector', selector: 'video' },
      keyColor: { type: 'color', default: '#000000' },
      threshold: { type: 'number', default: 0.06 },
      smoothness: { type: 'number', default: 0.14 },
      opacity: { type: 'number', default: 0 },
    },

    init() {
      this.texture = null;
      this.material = null;
      this.video = this.data.video;
      this.bindVideo = this.bindVideo.bind(this);

      if (!this.video) {
        console.error('[chromakey-video] Missing video element', this.el);
        return;
      }

      this.video.muted = true;
      this.video.loop = true;
      this.video.playsInline = true;
      this.video.setAttribute('playsinline', '');
      this.video.setAttribute('webkit-playsinline', '');
      if (!this.video.getAttribute('crossorigin')) {
        this.video.crossOrigin = 'anonymous';
      }

      // Prime decode when a frame is ready — do not block scene load.
      this.video.addEventListener('loadeddata', this.bindVideo, { once: true });
      this.video.load();
    },

    bindVideo() {
      if (this.material) return;

      this.texture = new THREE.VideoTexture(this.video);
      this.texture.minFilter = THREE.LinearFilter;
      this.texture.magFilter = THREE.LinearFilter;
      if (THREE.SRGBColorSpace) {
        this.texture.colorSpace = THREE.SRGBColorSpace;
      }

      this.material = createChromaMaterial(this.texture, this.data, this.data.opacity);
      this.el.getObject3D('mesh').material = this.material;
      this.el.object3D.visible = this.data.opacity > 0.001;

      // Prime decode so the first visible frame is not blank.
      const prime = this.video.play();
      if (prime && prime.then) {
        prime
          .then(() => {
            if (this.data.opacity <= 0.001) {
              this.video.pause();
              this.video.currentTime = 0;
            }
          })
          .catch(() => {});
      }
    },

    update(oldData) {
      if (!this.material) return;
      this.material.uniforms.opacity.value = this.data.opacity;
      this.material.uniforms.threshold.value = this.data.threshold;
      this.material.uniforms.smoothness.value = this.data.smoothness;
      this.material.uniforms.keyColor.value.set(this.data.keyColor);
      this.el.object3D.visible = this.data.opacity > 0.001;
    },

    remove() {
      if (this.video) {
        this.video.removeEventListener('loadeddata', this.bindVideo);
      }
      if (this.texture) this.texture.dispose();
      if (this.material) this.material.dispose();
    },
  });

  AFRAME.registerComponent('painting-resurrection', {
    schema: {
      config: { type: 'string', default: 'assets/meta/video-layers.json' },
    },

    init() {
      this.clock = 0;
      this.config = null;
      this.layerStates = [];
      this.lastPhase = null;

      const scene = this.el.sceneEl;
      const start = () => {
        fetch(this.data.config)
          .then((res) => {
            if (!res.ok) throw new Error(`Config load failed: ${res.status}`);
            return res.json();
          })
          .then((cfg) => {
            this.config = cfg;
            this.createVideoElements(cfg);
            this.createVideoLayers(cfg);
          })
          .catch((err) => console.error('[painting-resurrection]', err));
      };

      if (scene.hasLoaded) {
        start();
      } else {
        scene.addEventListener('loaded', start, { once: true });
      }
    },

    createVideoElements(cfg) {
      let pool = document.getElementById('video-pool');
      if (!pool) {
        pool = document.createElement('div');
        pool.id = 'video-pool';
        pool.setAttribute('aria-hidden', 'true');
        pool.style.cssText = 'position:fixed;width:0;height:0;overflow:hidden;opacity:0;pointer-events:none';
        document.body.appendChild(pool);
      }

      cfg.layers.forEach((layer) => {
        if (document.getElementById(layer.videoId)) return;

        const video = document.createElement('video');
        video.id = layer.videoId;
        video.src = layer.src;
        video.crossOrigin = 'anonymous';
        video.muted = true;
        video.loop = true;
        video.playsInline = true;
        video.preload = 'metadata';
        video.setAttribute('playsinline', '');
        video.setAttribute('webkit-playsinline', '');
        pool.appendChild(video);
      });
    },

    createVideoLayers(cfg) {
      const chroma = cfg.chromaKey || {};

      cfg.layers.forEach((layer, index) => {
        const { centerPx, sizePx } = resolveLayerGeometry(layer, cfg);
        const planeW = (sizePx[0] / IMG_W) * cfg.targetWidth;
        const planeH = (sizePx[1] / IMG_H) * cfg.targetHeight;
        const pos = pxToWorld(centerPx[0], centerPx[1], cfg);
        const z = 0.001 + (layer.zOrder || index) * 0.0005;
        const videoSelector = `#${layer.videoId}`;

        const plane = document.createElement('a-plane');
        plane.setAttribute('width', planeW);
        plane.setAttribute('height', planeH);
        plane.setAttribute('position', `${pos.x} ${pos.y} ${z}`);
        plane.setAttribute('visible', false);
        plane.setAttribute('chromakey-video', {
          video: videoSelector,
          keyColor: chroma.color || '#000000',
          threshold: chroma.threshold != null ? chroma.threshold : 0.06,
          smoothness: chroma.smoothness != null ? chroma.smoothness : 0.14,
          opacity: 0,
        });

        this.el.appendChild(plane);

        const video = document.querySelector(videoSelector);
        this.layerStates.push({
          el: plane,
          video,
          layer,
        });
      });
    },

    setVideosPlaying(shouldPlay) {
      this.layerStates.forEach(({ video }) => {
        if (!video) return;
        if (shouldPlay) {
          video.currentTime = 0;
          const playAttempt = video.play();
          if (playAttempt && playAttempt.catch) {
            playAttempt.catch((err) => {
              console.warn('[painting-resurrection] video.play()', err);
            });
          }
        } else {
          video.pause();
          video.currentTime = 0;
        }
      });
    },

    updateLayerOpacity(state, opacity) {
      const current = state.el.getAttribute('chromakey-video') || {};
      state.el.setAttribute('chromakey-video', {
        video: current.video,
        keyColor: current.keyColor,
        threshold: current.threshold,
        smoothness: current.smoothness,
        opacity,
      });
    },

    tick(_time, delta) {
      if (!this.config) return;

      this.clock = (this.clock + delta) % this.config.loopDurationMs;
      const phase = getPhase(this.clock, this.config.phases);
      const opacity = phaseOpacity(phase, this.config.phases);

      if (phase.name !== this.lastPhase) {
        if (phase.name === 'animate') {
          this.setVideosPlaying(true);
        } else if (phase.name === 'still' || phase.name === 'endStill') {
          this.setVideosPlaying(false);
        }
        this.lastPhase = phase.name;
      }

      this.layerStates.forEach((state) => {
        this.updateLayerOpacity(state, opacity);
      });
    },
  });
})();
