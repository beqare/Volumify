(() => {
  const slider = document.getElementById('volumeSlider');
  const valueLabel = document.getElementById('volumeValue');
  const powerButton = document.getElementById('powerButton');
  const resetButton = document.getElementById('resetButton');

  const DEFAULT_STATE = {
    gain: 1,
    enabled: true
  };

  let currentTabId = null;
  let state = { ...DEFAULT_STATE };

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function formatPercent(value) {
    return `${value}%`;
  }

  function updateSliderLabel() {
    valueLabel.textContent = formatPercent(slider.value);
  }

  function updateButtonView(isEnabled) {
    powerButton.classList.toggle('power--on', isEnabled);
    powerButton.classList.toggle('power--off', !isEnabled);
    powerButton.textContent = isEnabled ? 'On' : 'Off';
  }

  function pushState() {
    if (typeof currentTabId !== 'number') {
      return;
    }

    chrome.runtime.sendMessage(
      {
        type: 'volumify:updateSettings',
        tabId: currentTabId,
        gain: state.gain,
        enabled: state.enabled
      },
      () => {
        if (chrome.runtime.lastError) {
          // Nachricht konnte nicht zugestellt werden (z. B. kein zugaenglicher Tab).
        }
      }
    );
  }

  function handleSliderInput(event) {
    const numericValue = Number(event.target.value);
    state.gain = clamp(numericValue, 0, 1000) / 100;
    updateSliderLabel();
    pushState();
  }

  function handlePowerToggle() {
    state.enabled = !state.enabled;
    updateButtonView(state.enabled);
    pushState();
  }

  function handleReset() {
    state.gain = DEFAULT_STATE.gain;
    state.enabled = true;
    applyStateToUi();
    pushState();
  }

  async function resolveActiveTabId() {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        resolve(tabs?.[0]?.id ?? null);
      });
    });
  }

  async function restoreState() {
    try {
      currentTabId = await resolveActiveTabId();
      if (typeof currentTabId !== 'number') {
        return;
      }

      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            type: 'volumify:getSettings',
            tabId: currentTabId
          },
          (result) => {
            if (chrome.runtime.lastError) {
              resolve(null);
              return;
            }
            resolve(result);
          }
        );
      });

      if (response) {
        state = {
          gain: typeof response.gain === 'number' ? response.gain : DEFAULT_STATE.gain,
          enabled:
            typeof response.enabled === 'boolean' ? response.enabled : DEFAULT_STATE.enabled
        };
      }
    } catch (error) {
      state = { ...DEFAULT_STATE };
    }
  }

  function applyStateToUi() {
    const sliderValue = clamp(Math.round(state.gain * 100), 0, 1000);
    slider.value = String(sliderValue);
    updateSliderLabel();
    updateButtonView(state.enabled);
  }

  async function init() {
    await restoreState();
    applyStateToUi();

    slider.addEventListener('input', handleSliderInput);
    powerButton.addEventListener('click', handlePowerToggle);
    resetButton?.addEventListener('click', handleReset);
  }

  init();
})();
