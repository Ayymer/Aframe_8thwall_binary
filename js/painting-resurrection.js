/**
 * painting-resurrection — grow / bloom / wilt loop for Ruysch AR layers.
 * Config: assets/meta/layers.json
 */
(function () {
  const IMG_W = 809;
  const IMG_H = 1024;
  const EMERGE_LAYER_MS = 2800;
  const WILT_LAYER_MS = 3200;
  const PETAL_HEROES = ['rose-pink', 'poppy', 'sunflower'];
  const PETAL_COLORS = {
    'rose-pink': '#c47888',
    poppy: '#b84a18',
    sunflower: '#c49a18',
  };

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function pxToWorld(px, py, config) {
    return {
      x: ((px - IMG_W / 2) / IMG_W) * config.targetWidth,
      y: ((IMG_H / 2 - py) / IMG_H) * config.targetHeight,
    };
  }

  function warmColor(t) {
    const warm = easeInOutCubic(Math.sin(t * Math.PI));
    const r = Math.round(lerp(255, 255, warm));
    const g = Math.round(lerp(255, 232, warm));
    const b = Math.round(lerp(255, 204, warm));
    return `rgb(${r}, ${g}, ${b})`;
  }

  function desaturateColor(t) {
    const d = easeInOutCubic(t);
    const grey = Math.round(lerp(255, 136, d));
    return `rgb(${grey}, ${grey}, ${grey})`;
  }

  function getPhase(loopMs, phases) {
    let t = loopMs;
    if (t < phases.stillMs) {
      return { name: 'still', elapsed: t, localT: t / phases.stillMs };
    }
    t -= phases.stillMs;
    if (t < phases.emergeMs) {
      return { name: 'emerge', elapsed: t, localT: t / phases.emergeMs };
    }
    t -= phases.emergeMs;
    if (t < phases.bloomMs) {
      return { name: 'bloom', elapsed: t, localT: t / phases.bloomMs };
    }
    t -= phases.bloomMs;
    return { name: 'wilt', elapsed: t, localT: t / phases.wiltMs };
  }

  AFRAME.registerComponent('painting-resurrection', {
    schema: {
      config: { type: 'string', default: 'assets/meta/layers.json' },
    },

    init() {
      this.clock = 0;
      this.config = null;
      this.layerStates = [];
      this.petals = [];
      this.lastPhase = null;

      fetch(this.data.config)
        .then((res) => {
          if (!res.ok) throw new Error(`Config load failed: ${res.status}`);
          return res.json();
        })
        .then((cfg) => {
          this.config = cfg;
          this.createLayers(cfg);
        })
        .catch((err) => console.error('[painting-resurrection]', err));
    },

    createLayers(cfg) {
      const container = this.el;
      cfg.layers.forEach((layer) => {
        const planeW = (layer.sizePx[0] / IMG_W) * cfg.targetWidth;
        const planeH = (layer.sizePx[1] / IMG_H) * cfg.targetHeight;
        const pos = pxToWorld(layer.centerPx[0], layer.centerPx[1], cfg);
        const z = 0.001 + layer.zOrder * 0.0005;

        const anchorLocalX =
          ((layer.anchorPx[0] - layer.centerPx[0]) / layer.sizePx[0]) * planeW;
        const anchorLocalY =
          (-(layer.anchorPx[1] - layer.centerPx[1]) / layer.sizePx[1]) * planeH;

        const img = document.createElement('a-image');
        img.setAttribute('src', layer.src);
        img.setAttribute('width', planeW);
        img.setAttribute('height', planeH);
        img.setAttribute('position', `${pos.x} ${pos.y} ${z}`);
        img.setAttribute(
          'material',
          'shader: flat; transparent: true; alphaTest: 0.01; side: double; opacity: 0'
        );

        container.appendChild(img);

        this.layerStates.push({
          el: img,
          layer,
          basePos: { x: pos.x, y: pos.y, z },
          planeW,
          planeH,
          anchorLocalX,
          anchorLocalY,
        });
      });
    },

    spawnPetals(cfg) {
      this.clearPetals();
      const heroes = this.layerStates.filter((s) =>
        PETAL_HEROES.includes(s.layer.id)
      );

      heroes.forEach((state) => {
        const color = PETAL_COLORS[state.layer.id] || '#cc9966';
        for (let i = 0; i < 3; i++) {
          const petal = document.createElement('a-plane');
          const size = 0.008 + Math.random() * 0.006;
          const offsetX = (Math.random() - 0.5) * state.planeW * 0.6;
          const offsetY = (Math.random() - 0.3) * state.planeH * 0.4;
          petal.setAttribute('width', size);
          petal.setAttribute('height', size * 1.4);
          petal.setAttribute(
            'position',
            `${state.basePos.x + offsetX} ${state.basePos.y + offsetY} ${state.basePos.z + 0.002}`
          );
          petal.setAttribute('rotation', `0 0 ${Math.random() * 40 - 20}`);
          petal.setAttribute(
            'material',
            `shader: flat; color: ${color}; transparent: true; opacity: 0.85; side: double`
          );
          this.el.appendChild(petal);
          this.petals.push({
            el: petal,
            vy: 0.00008 + Math.random() * 0.00006,
            vx: (Math.random() - 0.5) * 0.00003,
            vr: (Math.random() - 0.5) * 0.4,
            life: 1,
          });
        }
      });
    },

    clearPetals() {
      this.petals.forEach((p) => p.el.parentNode && p.el.parentNode.removeChild(p.el));
      this.petals = [];
    },

    applyPivotScale(state, scaleX, scaleY, liftZ) {
      const { basePos, anchorLocalX, anchorLocalY } = state;
      const ox = anchorLocalX * (1 - scaleX);
      const oy = anchorLocalY * (1 - scaleY);
      state.el.setAttribute(
        'position',
        `${basePos.x + ox} ${basePos.y + oy} ${basePos.z + liftZ}`
      );
      state.el.setAttribute('scale', `${scaleX} ${scaleY} 1`);
    },

    updateLayer(state, phase, loopMs, cfg) {
      const { layer } = state;
      const mat = state.el.getAttribute('material') || {};
      let opacity = 0;
      let scaleX = 1;
      let scaleY = 1;
      let rotZ = 0;
      let liftZ = 0;
      let color = '#ffffff';

      if (phase.name === 'still') {
        opacity = 0;
        scaleY = 0;
      } else if (phase.name === 'emerge') {
        if (layer.bloomOnly) {
          opacity = 0;
          scaleY = 0;
        } else {
          const raw = clamp(
            (phase.elapsed - layer.emergeDelayMs) / EMERGE_LAYER_MS,
            0,
            1
          );
          const eased = easeInOutCubic(raw);
          opacity = eased;
          scaleY = eased;
          liftZ = eased * 0.008;
        }
      } else if (phase.name === 'bloom') {
        const breathe = 1 + 0.04 * Math.sin(phase.localT * Math.PI);
        const sway =
          layer.swayAmp *
          Math.sin((loopMs / 1000) * layer.swayFreq * Math.PI * 2);

        if (layer.bloomOnly) {
          const fadeIn = clamp((phase.localT - 0.45) / 0.25, 0, 1);
          opacity = easeInOutCubic(fadeIn);
          scaleY = opacity;
          scaleX = 1 + 0.08 * Math.sin((loopMs / 1000) * layer.swayFreq * Math.PI * 2);
          rotZ = sway * 0.5;
        } else {
          opacity = 1;
          scaleY = breathe;
          scaleX = breathe;
          rotZ = sway;
          color = warmColor(phase.localT);
        }
      } else if (phase.name === 'wilt') {
        if (layer.bloomOnly) {
          const fadeOut = 1 - clamp(phase.localT / 0.15, 0, 1);
          opacity = fadeOut;
          scaleY = fadeOut;
        } else {
          const raw = clamp(
            (phase.elapsed - layer.wiltDelayMs) / WILT_LAYER_MS,
            0,
            1
          );
          const eased = easeInOutCubic(raw);
          opacity = 1 - eased;
          scaleY = 1 - eased * 0.85;
          rotZ = eased * (layer.swayAmp + 4);
          liftZ = (1 - eased) * 0.008;
          color = desaturateColor(eased);
        }
      }

      this.applyPivotScale(state, scaleX, scaleY, liftZ);
      state.el.setAttribute('rotation', `0 0 ${rotZ}`);
      state.el.setAttribute('material', {
        ...mat,
        shader: 'flat',
        transparent: true,
        alphaTest: 0.01,
        side: 'double',
        opacity,
        color,
      });
    },

    updatePetals(delta) {
      this.petals = this.petals.filter((p) => {
        p.life -= delta * 0.00012;
        if (p.life <= 0) {
          p.el.parentNode && p.el.parentNode.removeChild(p.el);
          return false;
        }
        const pos = p.el.getAttribute('position');
        const rot = p.el.getAttribute('rotation');
        p.el.setAttribute('position', {
          x: pos.x + p.vx * delta,
          y: pos.y - p.vy * delta,
          z: pos.z,
        });
        p.el.setAttribute('rotation', {
          x: rot.x,
          y: rot.y,
          z: rot.z + p.vr * delta * 0.05,
        });
        const mat = p.el.getAttribute('material') || {};
        p.el.setAttribute('material', { ...mat, opacity: p.life * 0.85 });
        return true;
      });
    },

    tick(_time, delta) {
      if (!this.config) return;

      this.clock = (this.clock + delta) % this.config.loopDurationMs;
      const phase = getPhase(this.clock, this.config.phases);

      if (phase.name !== this.lastPhase) {
        if (phase.name === 'wilt' && this.lastPhase === 'bloom') {
          this.spawnPetals(this.config);
        }
        if (phase.name === 'still') {
          this.clearPetals();
        }
        this.lastPhase = phase.name;
      }

      this.layerStates.forEach((state) => {
        this.updateLayer(state, phase, this.clock, this.config);
      });

      if (phase.name === 'wilt' && this.petals.length) {
        this.updatePetals(delta);
      }
    },
  });
})();
