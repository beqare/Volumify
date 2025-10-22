(function () {
  const SUPPORTED_SELECTORS = 'audio, video';

  class VolumeController {
    constructor() {
      this.audioContext = null;
      this.gainNode = null;
      this.mediaSources = new WeakMap();
      this.trackedElements = new WeakSet();
      this.gainValue = 1;
      this.enabled = true;
    }

    ensureContext() {
      if (this.audioContext) {
        return;
      }

      try {
        this.audioContext = new AudioContext();
        this.gainNode = this.audioContext.createGain();
        this.gainNode.gain.value = 1;
        this.gainNode.connect(this.audioContext.destination);
      } catch (error) {
        // AudioContext konnte nicht erstellt werden.
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

        const source = this.audioContext.createMediaElementSource(element);
        source.connect(this.gainNode);
        this.mediaSources.set(element, source);

        element.addEventListener(
          'play',
          () => {
            this.ensureResumed();
          },
          { once: false }
        );

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
      this.gainValue = value;
      this.applyGain();
    }

    setEnabled(isEnabled) {
      this.enabled = isEnabled;
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
      const { gain, enabled } = message.state;
      controller.setGain(gain);
      controller.setEnabled(enabled);
    }
  });

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
})();
