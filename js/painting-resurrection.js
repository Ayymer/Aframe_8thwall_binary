/**
 * painting-resurrection — video overlay loop aligned to Figma-mapped positions.
 * Config: assets/meta/video-layers.json
 */
(function () {
  const IMG_W = 809;
  const IMG_H = 1024;

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

  const THREE = AFRAME.THREE;

  AFRAME.registerShader('chromakey', {
    schema: {
      src: { type: 'map', is: 'uniform' },
      color: { type: 'color', is: 'uniform', default: 'black' },
      threshold: { type: 'number', is: 'uniform', default: 0.08 },
      smoothness: { type: 'number', is: 'uniform', default: 0.12 },
      opacity: { type: 'number', is: 'uniform', default: 1 },
    },

    init(data) {
      this.material = new THREE.ShaderMaterial({
        uniforms: {
          src: { value: data.src },
          color: { value: new THREE.Color(data.color) },
          threshold: { value: data.threshold },
          smoothness: { value: data.smoothness },
          opacity: { value: data.opacity },
        },
        vertexShader: [
          'varying vec2 vUV;',
          'void main(void) {',
          '  vUV = uv;',
          '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
          '}',
        ].join('\n'),
        fragmentShader: [
          'uniform sampler2D src;',
          'uniform vec3 color;',
          'uniform float threshold;',
          'uniform float smoothness;',
          'uniform float opacity;',
          'varying vec2 vUV;',
          'void main(void) {',
          '  vec4 tex = texture2D(src, vUV);',
          '  float dist = length(tex.rgb - color);',
          '  float alpha = smoothstep(threshold, threshold + smoothness, dist);',
          '  gl_FragColor = vec4(tex.rgb, tex.a * alpha * opacity);',
          '}',
        ].join('\n'),
        transparent: true,
        depthWrite: false,
      });
    },

    update(data) {
      const uniforms = this.material.uniforms;
      uniforms.src.value = data.src;
      uniforms.color.value.set(data.color);
      uniforms.threshold.value = data.threshold;
      uniforms.smoothness.value = data.smoothness;
      uniforms.opacity.value = data.opacity;
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

      fetch(this.data.config)
        .then((res) => {
          if (!res.ok) throw new Error(`Config load failed: ${res.status}`);
          return res.json();
        })
        .then((cfg) => {
          this.config = cfg;
          this.createVideoLayers(cfg);
        })
        .catch((err) => console.error('[painting-resurrection]', err));
    },

    createVideoLayers(cfg) {
      const chroma = cfg.chromaKey || {};
      const assets = document.querySelector('a-assets');

      cfg.layers.forEach((layer, index) => {
        const { centerPx, sizePx } = resolveLayerGeometry(layer, cfg);
        const planeW = (sizePx[0] / IMG_W) * cfg.targetWidth;
        const planeH = (sizePx[1] / IMG_H) * cfg.targetHeight;
        const pos = pxToWorld(centerPx[0], centerPx[1], cfg);
        const z = 0.001 + (layer.zOrder || index) * 0.0005;
        const videoId = `video-${layer.id}`;

        const video = document.createElement('video');
        video.setAttribute('id', videoId);
        video.setAttribute('src', layer.src);
        video.setAttribute('crossorigin', 'anonymous');
        video.setAttribute('loop', '');
        video.setAttribute('playsinline', '');
        video.setAttribute('webkit-playsinline', '');
        video.setAttribute('preload', 'auto');
        video.muted = true;
        video.playsInline = true;
        if (assets) {
          assets.appendChild(video);
        } else {
          document.querySelector('a-scene').appendChild(video);
        }

        const plane = document.createElement('a-plane');
        plane.setAttribute('width', planeW);
        plane.setAttribute('height', planeH);
        plane.setAttribute('position', `${pos.x} ${pos.y} ${z}`);
        plane.setAttribute('material', {
          shader: 'chromakey',
          src: `#${videoId}`,
          color: chroma.color || '#000000',
          threshold: chroma.threshold != null ? chroma.threshold : 0.08,
          smoothness: chroma.smoothness != null ? chroma.smoothness : 0.12,
          opacity: 0,
          side: 'double',
        });

        this.el.appendChild(plane);

        this.layerStates.push({
          el: plane,
          video,
          layer,
          centerPx,
          sizePx,
        });
      });
    },

    setVideosPlaying(shouldPlay) {
      this.layerStates.forEach(({ video }) => {
        if (shouldPlay) {
          if (video.paused) {
            video.currentTime = 0;
            const playAttempt = video.play();
            if (playAttempt && playAttempt.catch) {
              playAttempt.catch(() => {});
            }
          }
        } else if (!video.paused) {
          video.pause();
          video.currentTime = 0;
        }
      });
    },

    updateLayerOpacity(state, opacity) {
      const mat = state.el.getAttribute('material') || {};
      state.el.setAttribute('material', {
        ...mat,
        shader: 'chromakey',
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
