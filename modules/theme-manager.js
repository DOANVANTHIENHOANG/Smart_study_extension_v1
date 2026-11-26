export const THEME_STORAGE_KEY = 'smartStudyTheme';
export const DEFAULT_THEME_ID = 'tech-ocean';

export const SMART_STUDY_THEMES = [
  // Nhóm Tối (Dark — 8 chủ đề)
  { id: 'tech-ocean', label: 'Tech Ocean (Mặc định)', group: 'dark' },
  { id: 'tech-midnight', label: 'Tech Midnight', group: 'dark' },
  { id: 'cyber-cobalt', label: 'Cyber Cobalt', group: 'dark' },
  { id: 'automation-slate', label: 'Automation Slate', group: 'dark' },
  { id: 'neural-violet', label: 'Neural Violet', group: 'dark' },
  { id: 'emerald-matrix', label: 'Emerald Matrix', group: 'dark' },
  { id: 'obsidian-amber', label: 'Obsidian Amber', group: 'dark' },
  { id: 'crimson-carbon', label: 'Crimson Carbon', group: 'dark' },
  // Nhóm Sáng (Light — 7 chủ đề)
  { id: 'clean-daylight', label: 'Clean Daylight', group: 'light' },
  { id: 'nordic-sky', label: 'Nordic Sky', group: 'light' },
  { id: 'academic-ivory', label: 'Academic Ivory', group: 'light' },
  { id: 'mint-focus', label: 'Mint Focus', group: 'light' },
  { id: 'sunrise-peach', label: 'Sunrise Peach', group: 'light' },
  { id: 'lavender-mist', label: 'Lavender Mist', group: 'light' },
  { id: 'rose-quartz', label: 'Rose Quartz', group: 'light' }
];

const VALID_THEME_IDS = new Set(SMART_STUDY_THEMES.map((t) => t.id));

export function normalizeThemeId(themeId) {
  if (VALID_THEME_IDS.has(themeId)) return themeId;
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
    const darkGroup = document.createElement('optgroup');
    darkGroup.label = 'Chế độ Tối (Dark — 8 chủ đề)';
    const lightGroup = document.createElement('optgroup');
    lightGroup.label = 'Chế độ Sáng (Light — 7 chủ đề)';

    SMART_STUDY_THEMES.forEach((theme) => {
      const opt = document.createElement('option');
      opt.value = theme.id;
      opt.textContent = theme.label;
      if (theme.group === 'light') {
        lightGroup.appendChild(opt);
      } else {
        darkGroup.appendChild(opt);
      }
    });
    selectEl.append(darkGroup, lightGroup);
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
