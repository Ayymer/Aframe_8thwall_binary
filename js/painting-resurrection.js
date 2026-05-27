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
      this.onVideoEvent = this.onVideoEvent.bind(this);

      if (!this.video) {
        console.error('[chromakey-video] Missing video element', this.el);
        return;
      }

      this.video.muted = true;
      this.video.loop = true;
      this.video.playsInline = true;
      this.video.setAttribute('playsinline', '');
      this.video.setAttribute('webkit-playsinline', '');
      this.video.crossOrigin = 'anonymous';
      this.video.preload = 'auto';

      this.video.addEventListener('loadeddata', this.onVideoEvent);
      this.video.addEventListener('canplay', this.onVideoEvent);
      this.video.addEventListener('error', () => {
        console.error('[chromakey-video] Video error', this.video.src, this.video.error);
      });

      if (this.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        this.bindVideo();
      } else {
        this.video.load();
      }
    },

    onVideoEvent() {
      if (this.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        this.bindVideo();
      }
    },

    bindVideo() {
      if (this.material) return;

      const mesh = this.el.getObject3D('mesh');
      if (!mesh) {
        this.el.addEventListener('loaded', this.bindVideo, { once: true });
        return;
      }

      this.texture = new THREE.VideoTexture(this.video);
      this.texture.minFilter = THREE.LinearFilter;
      this.texture.magFilter = THREE.LinearFilter;
      if (THREE.SRGBColorSpace) {
        this.texture.colorSpace = THREE.SRGBColorSpace;
      }

      this.material = createChromaMaterial(this.texture, this.data, this.data.opacity);
      mesh.material = this.material;
      this.applyVisibility(this.data.opacity);
    },

    applyVisibility(opacity) {
      const show = opacity > 0.001 && !!this.material;
      this.el.object3D.visible = show;
      if (this.material) {
        this.material.uniforms.opacity.value = opacity;
      }
    },

    setOpacity(opacity) {
      this.data.opacity = opacity;
      this.applyVisibility(opacity);
    },

    playVideo() {
      if (!this.video) return;
      const attempt = this.video.play();
      if (attempt && attempt.catch) {
        attempt.catch((err) => {
          console.warn('[chromakey-video] play failed', this.video.id, err);
        });
      }
    },

    pauseVideo() {
      if (!this.video) return;
      this.video.pause();
      this.video.currentTime = 0;
    },

    update() {
      this.applyVisibility(this.data.opacity);
    },

    remove() {
      if (this.video) {
        this.video.removeEventListener('loadeddata', this.onVideoEvent);
        this.video.removeEventListener('canplay', this.onVideoEvent);
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
            this.ensureVideoElements(cfg);
            requestAnimationFrame(() => this.createVideoLayers(cfg));
          })
          .catch((err) => console.error('[painting-resurrection]', err));
      };

      if (scene.hasLoaded) {
        start();
      } else {
        scene.addEventListener('loaded', start, { once: true });
      }
    },

    ensureVideoElements(cfg) {
      cfg.layers.forEach((layer) => {
        const video = document.getElementById(layer.videoId);
        if (!video) {
          console.error('[painting-resurrection] Missing video in DOM', layer.videoId);
          return;
        }
        video.muted = true;
        video.loop = true;
        video.playsInline = true;
        video.crossOrigin = 'anonymous';
        video.preload = 'auto';
        if (!video.src) video.src = layer.src;
        video.load();
      });
    },

    createVideoLayers(cfg) {
      const chroma = cfg.chromaKey || {};

      cfg.layers.forEach((layer, index) => {
        const video = document.getElementById(layer.videoId);
        if (!video) {
          console.error('[painting-resurrection] Missing video', layer.videoId);
          return;
        }

        const { centerPx, sizePx } = resolveLayerGeometry(layer, cfg);
        const planeW = (sizePx[0] / IMG_W) * cfg.targetWidth;
        const planeH = (sizePx[1] / IMG_H) * cfg.targetHeight;
        const pos = pxToWorld(centerPx[0], centerPx[1], cfg);
        const z = 0.002 + (layer.zOrder || index) * 0.0005;

        const plane = document.createElement('a-plane');
        plane.setAttribute('width', planeW);
        plane.setAttribute('height', planeH);
        plane.setAttribute('position', `${pos.x} ${pos.y} ${z}`);
        plane.setAttribute('chromakey-video', {
          video: `#${layer.videoId}`,
          keyColor: chroma.color || '#000000',
          threshold: chroma.threshold != null ? chroma.threshold : 0.06,
          smoothness: chroma.smoothness != null ? chroma.smoothness : 0.14,
          opacity: 0,
        });

        this.el.appendChild(plane);

        this.layerStates.push({
          el: plane,
          video,
          layer,
        });
      });
    },

    getCurrentPhase() {
      return getPhase(this.clock, this.config.phases);
    },

    getCurrentOpacity() {
      return phaseOpacity(this.getCurrentPhase(), this.config.phases);
    },

    shouldPlayVideos() {
      const phase = this.getCurrentPhase();
      return phase.name === 'animate' || phase.name === 'endStill';
    },

    syncPlayback() {
      if (this.shouldPlayVideos()) {
        this.playAllVideos();
      } else {
        this.pauseAllVideos();
      }
    },

    playAllVideos() {
      this.layerStates.forEach(({ el }) => {
        const component = el.components['chromakey-video'];
        if (component) component.playVideo();
      });
    },

    pauseAllVideos() {
      this.layerStates.forEach(({ el }) => {
        const component = el.components['chromakey-video'];
        if (component) component.pauseVideo();
      });
    },

    updateLayerOpacity(state, opacity) {
      const component = state.el.components['chromakey-video'];
      if (component) {
        component.setOpacity(opacity);
      }
    },

    tick(_time, delta) {
      if (!this.config || !this.layerStates.length) return;

      this.clock = (this.clock + delta) % this.config.loopDurationMs;
      const phase = this.getCurrentPhase();
      const opacity = this.getCurrentOpacity();

      if (phase.name !== this.lastPhase) {
        this.syncPlayback();
        this.lastPhase = phase.name;
      }

      this.layerStates.forEach((state) => {
        this.updateLayerOpacity(state, opacity);
        const component = state.el.components['chromakey-video'];
        if (component && component.texture) {
          component.texture.needsUpdate = true;
        }
        if (opacity > 0.001 && state.video && state.video.paused) {
          component && component.playVideo();
        }
      });
    },
  });
})();
