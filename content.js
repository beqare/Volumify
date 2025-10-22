(function () {
  const SUPPORTED_SELECTORS = 'audio, video';
  const EQ_LIMITS = { min: -12, max: 12 };
  const EQ_KEYS = ['low', 'mid', 'high'];
  const DEFAULT_EQ = { low: 0, mid: 0, high: 0 };

  function clampEq(value) {
    if (!Number.isFinite(value)) {
      return 0;
    }
    const clamped = Math.min(Math.max(value, EQ_LIMITS.min), EQ_LIMITS.max);
    return Math.round(clamped);
  }

  class VolumeController {
    constructor() {
      this.audioContext = null;
      this.gainNode = null;
      this.filters = null;
      this.mediaSources = new WeakMap();
      this.trackedElements = new WeakSet();
      this.gainValue = 1;
      this.enabled = true;
      this.eqValues = { ...DEFAULT_EQ };
    }

    ensureContext() {
      if (this.audioContext) {
        this.ensureFilters();
        return;
      }

      try {
        this.audioContext = new AudioContext();
        this.gainNode = this.audioContext.createGain();
        this.gainNode.gain.value = 1;
        this.gainNode.connect(this.audioContext.destination);
        this.ensureFilters();
      } catch (error) {
        // AudioContext konnte nicht erstellt werden.
      }
    }

    ensureFilters() {
      if (!this.audioContext || this.filters) {
        return;
      }

      try {
        const low = this.audioContext.createBiquadFilter();
        low.type = 'lowshelf';
        low.frequency.value = 120;

        const mid = this.audioContext.createBiquadFilter();
        mid.type = 'peaking';
        mid.frequency.value = 1000;
        mid.Q.value = 1.1;

        const high = this.audioContext.createBiquadFilter();
        high.type = 'highshelf';
        high.frequency.value = 4500;

        low.connect(mid);
        mid.connect(high);
        high.connect(this.gainNode);

        this.filters = { low, mid, high };
        this.applyEq();
      } catch (error) {
        // EQ-Filter konnten nicht erstellt werden.
        this.filters = null;
      }
    }

    ensureResumed() {
      if (!this.audioContext) {
        return;
      }

      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume().catch(() => {
          // Resume kann fehlschlagen, wenn keine Interaktion erfolgt ist.
        });
      }
    }

    attachToElement(element) {
      if (!(element instanceof HTMLMediaElement)) {
        return;
      }

      if (this.trackedElements.has(element)) {
        return;
      }

      this.trackedElements.add(element);

      try {
        this.ensureContext();
        if (!this.audioContext || !this.gainNode) {
          return;
        }

        this.ensureFilters();
        const destination = this.filters?.low ?? this.gainNode;

        const source = this.audioContext.createMediaElementSource(element);
        source.connect(destination);
        this.mediaSources.set(element, source);

        element.addEventListener(
          'play',
          () => {
            this.ensureResumed();
          },
          { once: false }
        );

        this.applyEq();
        this.applyGain();
      } catch (error) {
        // Manche Medien (z. B. mit fehlenden CORS-Headern) lassen sich nicht einhaengen.
        this.mediaSources.set(element, null);
      }
    }

    attachExisting() {
      document.querySelectorAll(SUPPORTED_SELECTORS).forEach((element) => {
        this.attachToElement(element);
      });
    }

    observeNewElements() {
      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          mutation.addedNodes.forEach((node) => {
            if (node instanceof HTMLMediaElement) {
              this.attachToElement(node);
              return;
            }

            if (node instanceof HTMLElement) {
              node.querySelectorAll?.(SUPPORTED_SELECTORS).forEach((element) => {
                this.attachToElement(element);
              });
            }
          });
        });
      });

      observer.observe(document.documentElement, {
        childList: true,
        subtree: true
      });
    }

    setGain(value) {
      const numericValue = Number(value);
      this.gainValue = Number.isFinite(numericValue)
        ? Math.min(Math.max(numericValue, 0), 10)
        : 1;
      this.applyGain();
    }

    setEq(values) {
      const nextValues = values && typeof values === 'object' ? values : DEFAULT_EQ;
      let changed = false;

      for (const band of EQ_KEYS) {
        const rawValue = Number(nextValues[band]);
        const fallback = DEFAULT_EQ[band];
        const clamped = Number.isFinite(rawValue) ? clampEq(rawValue) : fallback;
        if (this.eqValues[band] !== clamped) {
          this.eqValues[band] = clamped;
          changed = true;
        }
      }

      if (changed || !this.filters) {
        this.ensureFilters();
        this.applyEq();
      }
    }

    setEnabled(isEnabled) {
      this.enabled = Boolean(isEnabled);
      this.applyEq();
      this.applyGain();
    }

    applyGain() {
      if (!this.gainNode) {
        return;
      }

      const targetGain = this.enabled ? this.gainValue : 1;
      this.gainNode.gain.value = targetGain;
      this.ensureResumed();
    }

    applyEq() {
      if (!this.filters || !this.audioContext) {
        return;
      }

      const time = this.audioContext.currentTime;
      for (const band of EQ_KEYS) {
        const node = this.filters[band];
        if (!node || !node.gain) {
          continue;
        }

        const target = this.enabled ? this.eqValues[band] : 0;
        try {
          node.gain.setTargetAtTime(target, time, 0.05);
        } catch (error) {
          node.gain.value = target;
        }
      }

      this.ensureResumed();
    }
  }

  const controller = new VolumeController();

  function initialize() {
    controller.attachExisting();
    controller.observeNewElements();
    try {
      chrome.runtime.sendMessage(
        { type: 'volumify:contentReady' },
        () => {
          if (chrome.runtime.lastError) {
            // Ignorieren, z. B. auf eingeschraenkten Seiten.
          }
        }
      );
    } catch (error) {
      // Ignorieren, falls sendMessage nicht verfuegbar ist.
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'volumify:apply') {
      const nextState = message.state ?? {};
      if (typeof nextState.gain === 'number') {
        controller.setGain(nextState.gain);
      }

      controller.setEq(nextState.eq);

      if (typeof nextState.enabled === 'boolean') {
        controller.setEnabled(nextState.enabled);
      }
    }
  });

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
})();
