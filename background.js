const DEFAULTS = { enabled: true, muted: false, count: 0 };

async function init() {
  const current = await chrome.storage.local.get(DEFAULTS);
  await chrome.storage.local.set(current);
  updateBadge(current.enabled);
}

function updateBadge(enabled) {
  chrome.action.setBadgeText({ text: enabled ? '' : 'OFF' });
  chrome.action.setBadgeBackgroundColor({ color: '#6b6b6b' });
}

chrome.runtime.onInstalled.addListener(init);
chrome.runtime.onStartup.addListener(init);

chrome.commands.onCommand.addListener(async (command) => {
  const key = { 'toggle-enabled': 'enabled', 'toggle-mute': 'muted' }[command];
  if (!key) return;
  const current = await chrome.storage.local.get(DEFAULTS);
  await chrome.storage.local.set({ [key]: !current[key] });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.enabled) updateBadge(changes.enabled.newValue);
});
