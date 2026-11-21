export const THEME_STORAGE_KEY = 'smartStudyTheme';
export const DEFAULT_THEME_ID = 'tech-ocean';

export const SMART_STUDY_THEMES = [
  { id: 'tech-ocean', label: '🌊 Tech Ocean (Mặc định)' },
  { id: 'automation-slate', label: '🤖 Automation Slate' },
  { id: 'cyber-cobalt', label: '⚡ Cyber Cobalt' },
  { id: 'clean-daylight', label: '☀️ Clean Daylight' },
  { id: 'academic-ivory', label: '📜 Academic Ivory' },
  { id: 'neural-violet', label: '🧠 Neural Violet' }
];

const LEGACY_THEME_MAP = {
  'tech-midnight': 'tech-ocean',
  'emerald-matrix': 'automation-slate',
  'obsidian-amber': 'automation-slate',
  'crimson-carbon': 'neural-violet',
  'nordic-sky': 'clean-daylight',
  'mint-focus': 'clean-daylight',
  'sunrise-peach': 'academic-ivory',
  'lavender-mist': 'academic-ivory',
  'rose-quartz': 'clean-daylight'
};

const VALID_THEME_IDS = new Set(SMART_STUDY_THEMES.map((t) => t.id));

export function normalizeThemeId(themeId) {
  if (VALID_THEME_IDS.has(themeId)) return themeId;
  if (themeId && LEGACY_THEME_MAP[themeId]) return LEGACY_THEME_MAP[themeId];
  return DEFAULT_THEME_ID;
}

export function applyTheme(themeId) {
  const safeId = normalizeThemeId(themeId);
  document.documentElement.setAttribute('data-theme', safeId);
  return safeId;
}

export async function initThemeManager(selectIds = ['theme-selector', 'practice-theme-selector']) {
  let savedTheme = DEFAULT_THEME_ID;
  try {
    const stored = await chrome.storage.local.get(THEME_STORAGE_KEY);
    if (stored && stored[THEME_STORAGE_KEY]) {
      savedTheme = normalizeThemeId(stored[THEME_STORAGE_KEY]);
    }
  } catch (_) {
    // Fallback to default theme when storage is unavailable
  }

  applyTheme(savedTheme);

  const selects = selectIds
    .map((id) => document.getElementById(id))
    .filter(Boolean);

  selects.forEach((selectEl) => {
    selectEl.replaceChildren();
    SMART_STUDY_THEMES.forEach((theme) => {
      const opt = document.createElement('option');
      opt.value = theme.id;
      opt.textContent = theme.label;
      selectEl.appendChild(opt);
    });
    selectEl.value = savedTheme;

    selectEl.addEventListener('change', async () => {
      const chosen = applyTheme(selectEl.value);
      selects.forEach((other) => {
        if (other !== selectEl) other.value = chosen;
      });
      try {
        await chrome.storage.local.set({ [THEME_STORAGE_KEY]: chosen });
      } catch (_) {}
    });
  });

  if (chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local' || !changes[THEME_STORAGE_KEY]) return;
      const nextTheme = applyTheme(changes[THEME_STORAGE_KEY].newValue);
      selects.forEach((selectEl) => {
        if (selectEl.value !== nextTheme) selectEl.value = nextTheme;
      });
    });
  }
}
