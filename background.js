const defaultState = {
  gain: 1,
  enabled: true
};

const tabStates = new Map();
const BADGE_COLOR_ENABLED = '#1f8a70';
const BADGE_COLOR_DISABLED = '#adb5bd';

chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR_ENABLED });

function getState(tabId) {
  if (typeof tabId !== 'number') {
    return { ...defaultState };
  }

  if (!tabStates.has(tabId)) {
    tabStates.set(tabId, { ...defaultState });
  }
  return tabStates.get(tabId);
}

function getBadgeText(state) {
  if (!state.enabled) {
    return 'Off';
  }
  const percentage = Math.round(state.gain * 100);
  return String(percentage);
}

function updateBadge(tabId, state) {
  if (typeof tabId !== 'number') {
    return;
  }

  const badgeText = getBadgeText(state);
  const badgeColor = state.enabled ? BADGE_COLOR_ENABLED : BADGE_COLOR_DISABLED;

  chrome.action.setBadgeText({ tabId, text: badgeText });
  chrome.action.setBadgeBackgroundColor({ tabId, color: badgeColor });
}

function applyStateToTab(tabId, state) {
  if (typeof tabId !== 'number') {
    return;
  }

  chrome.tabs.sendMessage(
    tabId,
    {
      type: 'volumify:apply',
      state
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

  if (type === 'volumify:getSettings') {
    const tabId = message.tabId;
    const state = getState(tabId);
    sendResponse(state);
    applyStateToTab(tabId, state);
    return;
  }

  if (type === 'volumify:updateSettings') {
    const { tabId, gain, enabled } = message;
    if (typeof tabId !== 'number') {
      sendResponse({ ok: false });
      return;
    }

    const nextState = {
      gain,
      enabled
    };

    tabStates.set(tabId, nextState);
    sendResponse({ ok: true });
    applyStateToTab(tabId, nextState);
    return;
  }

  if (type === 'volumify:contentReady') {
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
  if (changeInfo.status === 'complete' && tabStates.has(tabId)) {
    applyStateToTab(tabId, tabStates.get(tabId));
  }
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  const state = getState(tabId);
  updateBadge(tabId, state);
});
