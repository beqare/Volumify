const defaultState = {
  gain: 1,
  enabled: true,
  eq: {
    low: 0,
    mid: 0,
    high: 0,
  },
  preset: "default",
};

const EQ_LIMITS = { min: -12, max: 12 };
const EQ_KEYS = ["low", "mid", "high"];
const EQ_PRESETS = {
  default: { low: 0, mid: 0, high: 0 },
  bassBoost: { low: 8, mid: 2, high: 4 },
  vocalBoost: { low: -2, mid: 5, high: 6 },
};
const ALLOWED_PRESETS = new Set([...Object.keys(EQ_PRESETS), "custom"]);

const tabStates = new Map();
const BADGE_COLOR_ENABLED = "#399c83ff";
const BADGE_COLOR_DISABLED = "#181a1bff";

function clampValue(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function presetMatches(eq, presetKey) {
  const preset = EQ_PRESETS[presetKey];
  if (!preset) {
    return false;
  }

  return EQ_KEYS.every((band) => preset[band] === eq[band]);
}

function findMatchingPreset(eq) {
  for (const [key, values] of Object.entries(EQ_PRESETS)) {
    if (EQ_KEYS.every((band) => values[band] === eq[band])) {
      return key;
    }
  }
  return "custom";
}

function normalizeState(partialState = {}) {
  const state = {
    gain: (() => {
      const numericGain = Number(partialState.gain);
      return Number.isFinite(numericGain)
        ? clampValue(numericGain, 0, 10)
        : defaultState.gain;
    })(),
    enabled:
      typeof partialState.enabled === "boolean" ? partialState.enabled : defaultState.enabled,
    preset:
      typeof partialState.preset === "string" ? partialState.preset : defaultState.preset,
  };

  const eq = partialState.eq ?? {};
  state.eq = {
    low: (() => {
      const value = Number(eq.low);
      const fallback = defaultState.eq.low;
      return clampValue(Number.isFinite(value) ? value : fallback, EQ_LIMITS.min, EQ_LIMITS.max);
    })(),
    mid: (() => {
      const value = Number(eq.mid);
      const fallback = defaultState.eq.mid;
      return clampValue(Number.isFinite(value) ? value : fallback, EQ_LIMITS.min, EQ_LIMITS.max);
    })(),
    high: (() => {
      const value = Number(eq.high);
      const fallback = defaultState.eq.high;
      return clampValue(Number.isFinite(value) ? value : fallback, EQ_LIMITS.min, EQ_LIMITS.max);
    })(),
  };

  const matchedPreset = findMatchingPreset(state.eq);
  let candidatePreset = state.preset;
  if (!ALLOWED_PRESETS.has(candidatePreset)) {
    candidatePreset = defaultState.preset;
  }

  if (candidatePreset === "custom") {
    candidatePreset = matchedPreset;
  } else if (!presetMatches(state.eq, candidatePreset)) {
    candidatePreset = matchedPreset;
  }

  state.preset = candidatePreset;

  return state;
}

chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR_ENABLED });

function getState(tabId) {
  if (typeof tabId !== "number") {
    return normalizeState();
  }

  if (!tabStates.has(tabId)) {
    tabStates.set(tabId, normalizeState());
  }
  const state = normalizeState(tabStates.get(tabId));
  tabStates.set(tabId, state);
  return state;
}

function getBadgeText(state) {
  if (!state.enabled) {
    return "Off";
  }
  const percentage = Math.round(state.gain * 100);
  return String(percentage);
}

function updateBadge(tabId, state) {
  if (typeof tabId !== "number") {
    return;
  }

  const badgeText = getBadgeText(state);
  const badgeColor = state.enabled ? BADGE_COLOR_ENABLED : BADGE_COLOR_DISABLED;

  chrome.action.setBadgeText({ tabId, text: badgeText });
  chrome.action.setBadgeBackgroundColor({ tabId, color: badgeColor });
}

function applyStateToTab(tabId, state) {
  if (typeof tabId !== "number") {
    return;
  }

  chrome.tabs.sendMessage(
    tabId,
    {
      type: "volumify:apply",
      state,
    },
    () => {
      if (chrome.runtime.lastError) {
        // Content script ist noch nicht verfuegbar (z. B. auf chrome:// URLs)
      }
    }
  );

  updateBadge(tabId, state);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type } = message;

  if (type === "volumify:getSettings") {
    const tabId = message.tabId;
    const state = getState(tabId);
    sendResponse(state);
    applyStateToTab(tabId, state);
    return;
  }

  if (type === "volumify:updateSettings") {
    const { tabId, gain, enabled, eq, preset } = message;
    if (typeof tabId !== "number") {
      sendResponse({ ok: false });
      return;
    }

    const nextState = normalizeState({
      gain,
      enabled,
      eq,
      preset,
    });

    tabStates.set(tabId, nextState);
    sendResponse({ ok: true });
    applyStateToTab(tabId, nextState);
    return;
  }

  if (type === "volumify:contentReady") {
    const tabId = sender.tab?.id ?? message.tabId;
    const state = getState(tabId);
    sendResponse(state);
    applyStateToTab(tabId, state);
    return;
  }

  return;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabStates.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "complete" && tabStates.has(tabId)) {
    applyStateToTab(tabId, tabStates.get(tabId));
  }
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  const state = getState(tabId);
  updateBadge(tabId, state);
});
