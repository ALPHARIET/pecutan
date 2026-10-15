const DEFAULTS = { enabled: true, muted: false, count: 0 };

const enabledEl = document.getElementById('enabled');
const soundEl = document.getElementById('sound');
const countEl = document.getElementById('count');

function render(v) {
  if ('enabled' in v) enabledEl.checked = v.enabled;
  if ('muted' in v) soundEl.checked = !v.muted;
  if ('count' in v) countEl.textContent = v.count.toLocaleString('id-ID');
}

chrome.storage.local.get(DEFAULTS, render);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  const v = {};
  for (const [k, c] of Object.entries(changes)) v[k] = c.newValue;
  render(v);
});

enabledEl.addEventListener('change', () => chrome.storage.local.set({ enabled: enabledEl.checked }));
soundEl.addEventListener('change', () => chrome.storage.local.set({ muted: !soundEl.checked }));
document.getElementById('reset').addEventListener('click', () => chrome.storage.local.set({ count: 0 }));
document.getElementById('shortcuts').addEventListener('click', () =>
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })
);
