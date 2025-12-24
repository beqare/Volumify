(() => {
  const slider = document.getElementById("volumeSlider");
  const valueLabel = document.getElementById("volumeValue");
  const powerButton = document.getElementById("powerButton");
  const resetButton = document.getElementById("resetButton");
  const presetSelect = document.getElementById("eqPreset");
  const eqSliders = {
    low: document.getElementById("eqLow"),
    mid: document.getElementById("eqMid"),
    high: document.getElementById("eqHigh"),
  };
  const eqValueLabels = {
    low: document.getElementById("eqLowValue"),
    mid: document.getElementById("eqMidValue"),
    high: document.getElementById("eqHighValue"),
  };

  const DEFAULT_STATE = {
    gain: 1,
    enabled: true,
    eq: {
      low: 0,
      mid: 0,
      high: 0,
    },
    preset: "default",
  };
  const EQ_RANGE = { min: -12, max: 12 };
  const EQ_KEYS = ["low", "mid", "high"];
  const PRESET_KEYS = ["default", "bassBoost", "vocalBoost"];
  const PRESET_SET = new Set([...PRESET_KEYS, "custom"]);
  const EQ_PRESETS = {
    default: { low: 0, mid: 0, high: 0 },
    bassBoost: { low: 8, mid: 2, high: 4 },
    vocalBoost: { low: -2, mid: 5, high: 6 },
  };

  let currentTabId = null;
  let state = createState();

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function clampEq(value) {
    if (!Number.isFinite(value)) {
      return 0;
    }
    return Math.round(clamp(value, EQ_RANGE.min, EQ_RANGE.max));
  }

  function computePresetForEq(eqState) {
    for (const key of PRESET_KEYS) {
      const preset = EQ_PRESETS[key];
      if (preset && EQ_KEYS.every((band) => preset[band] === eqState[band])) {
        return key;
      }
    }
    return "custom";
  }

  function createState(partial = {}) {
    const gainValue =
      typeof partial.gain === "number" ? partial.gain : DEFAULT_STATE.gain;

    const next = {
      gain: clamp(gainValue, 0, 10),
      enabled:
        typeof partial.enabled === "boolean"
          ? partial.enabled
          : DEFAULT_STATE.enabled,
      eq: {},
      preset:
        typeof partial.preset === "string"
          ? partial.preset
          : DEFAULT_STATE.preset,
    };

    for (const band of EQ_KEYS) {
      const rawValue = Number(partial.eq?.[band]);
      const fallback = DEFAULT_STATE.eq[band];
      next.eq[band] = clampEq(Number.isFinite(rawValue) ? rawValue : fallback);
    }

    const inferredPreset = computePresetForEq(next.eq);
    if (
      !PRESET_SET.has(next.preset) ||
      (next.preset !== "custom" && next.preset !== inferredPreset)
    ) {
      next.preset = inferredPreset;
    }

    return next;
  }

  function formatPercent(value) {
    return `${value}%`;
  }

  function formatEqValue(value) {
    const rounded = Math.round(value);
    const sign = rounded > 0 ? "+" : "";
    return `${sign}${rounded} dB`;
  }

  function updateSliderLabel() {
    const numericValue = clamp(Number(slider.value), 0, 1000);
    valueLabel.textContent = formatPercent(numericValue);
  }

  function updateVolumeSliderVisual() {
    const numericValue = clamp(Number(slider.value), 0, 1000);
    const percent = numericValue / 10;
    slider.style.setProperty("--slider-fill", `${percent}%`);
  }

  function updateButtonView(isEnabled) {
    powerButton.classList.toggle("power--on", isEnabled);
    powerButton.classList.toggle("power--off", !isEnabled);
    powerButton.textContent = isEnabled ? "On" : "Off";
  }

  function updatePresetSelect(presetKey) {
    if (!presetSelect) {
      return;
    }
    const normalized = PRESET_SET.has(presetKey) ? presetKey : "custom";
    presetSelect.value = normalized;
  }

  function updateEqBandUi(band, value) {
    const sliderElement = eqSliders[band];
    const labelElement = eqValueLabels[band];
    if (!sliderElement) {
      return;
    }

    const clamped = clampEq(value);
    sliderElement.value = String(clamped);
    const percent =
      ((clamped - EQ_RANGE.min) / (EQ_RANGE.max - EQ_RANGE.min)) * 100;
    sliderElement.style.setProperty("--slider-fill", `${percent}%`);

    if (labelElement) {
      labelElement.textContent = formatEqValue(clamped);
    }
  }

  function updateEqUi() {
    for (const band of EQ_KEYS) {
      updateEqBandUi(band, state.eq[band]);
    }
  }

  function buildEqPayload() {
    const payload = {};
    for (const band of EQ_KEYS) {
      const clamped = clampEq(state.eq[band]);
      state.eq[band] = clamped;
      payload[band] = clamped;
    }
    return payload;
  }

  function pushState() {
    if (typeof currentTabId !== "number") {
      return;
    }

    const eqPayload = buildEqPayload();
    if (state.preset !== "custom") {
      state.preset = computePresetForEq(state.eq);
    } else if (!PRESET_SET.has(state.preset)) {
      state.preset = computePresetForEq(state.eq);
    }

    chrome.runtime.sendMessage(
      {
        type: "volumify:updateSettings",
        tabId: currentTabId,
        gain: state.gain,
        enabled: state.enabled,
        eq: eqPayload,
        preset: state.preset,
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
    updateVolumeSliderVisual();
    pushState();
  }

  function handleEqSliderInput(band, event) {
    const numericValue = clampEq(Number(event.target.value));
    if (state.eq[band] === numericValue) {
      updateEqBandUi(band, numericValue);
    } else {
      state.eq[band] = numericValue;
      updateEqBandUi(band, numericValue);
    }

    state.preset = computePresetForEq(state.eq);
    updatePresetSelect(state.preset);
    pushState();
  }

  function handlePresetChange(event) {
    const selected = event.target.value;
    if (!PRESET_SET.has(selected)) {
      return;
    }

    if (selected === "custom") {
      state.preset = "custom";
      updatePresetSelect(state.preset);
      pushState();
      return;
    }

    const presetValues = EQ_PRESETS[selected];
    if (!presetValues) {
      return;
    }

    state.eq = { ...presetValues };
    state.preset = selected;
    updateEqUi();
    updatePresetSelect(state.preset);
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
    state.eq = { ...DEFAULT_STATE.eq };
    state.preset = "default";
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
      if (typeof currentTabId !== "number") {
        return;
      }

      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            type: "volumify:getSettings",
            tabId: currentTabId,
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
        state = createState(response);
      } else {
        state = createState();
      }
    } catch (error) {
      state = createState();
    }
  }

  function applyStateToUi() {
    const sliderValue = clamp(Math.round(state.gain * 100), 0, 1000);
    slider.value = String(sliderValue);
    updateSliderLabel();
    updateVolumeSliderVisual();
    updateButtonView(state.enabled);
    updateEqUi();
    updatePresetSelect(state.preset);
  }

  async function init() {
    await restoreState();
    applyStateToUi();

    slider.addEventListener("input", handleSliderInput);
    powerButton.addEventListener("click", handlePowerToggle);
    resetButton?.addEventListener("click", handleReset);
    presetSelect?.addEventListener("change", handlePresetChange);
    for (const band of EQ_KEYS) {
      eqSliders[band]?.addEventListener("input", (event) =>
        handleEqSliderInput(band, event)
      );
    }
  }

  init();
})();
