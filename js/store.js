// Persistence layer: local storage plus JSON import and export.

const STORAGE_KEY = 'mjVirtuel.state.v1';

function createDefaultState() {
  const defaultState = {
    campaign: { universe: 'Dark fantasy', tone: 'sombre', scene: '' },
    characters: [],
    log: [],
    diceHistory: [],
    initiative: { order: [], currentIndex: 0 },
    settings: {
      provider: 'local',
      model: 'gemini-3.8-flash',
      baseUrl: '',
      apiKey: '',
      typewriter: true,
      autoRoll: true
    }
  };

  return defaultState;
}

// Merges a saved payload over the default state without losing newly introduced keys.
function mergeState(base, parsed) {
  const merged = Object.assign(base, parsed);

  // Nested objects need their own merge because Object.assign is shallow.
  merged.settings = Object.assign(base.settings, parsed.settings || {});
  merged.campaign = Object.assign(base.campaign, parsed.campaign || {});
  merged.initiative = Object.assign(base.initiative, parsed.initiative || {});

  // Defensive typing: a corrupted save must never break the rendering loop.
  merged.characters = Array.isArray(merged.characters) ? merged.characters : [];
  merged.log = Array.isArray(merged.log) ? merged.log : [];
  merged.diceHistory = Array.isArray(merged.diceHistory) ? merged.diceHistory : [];
  merged.initiative.order = Array.isArray(merged.initiative.order) ? merged.initiative.order : [];

  return merged;
}

export function loadState() {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  let loaded = createDefaultState();

  if (raw !== null) {
    try {
      loaded = mergeState(loaded, JSON.parse(raw));
    } catch (error) {
      window.console.warn('Corrupted save, falling back to defaults', error);
      loaded = createDefaultState();
    }
  }

  return loaded;
}

export function saveState(state) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    // Quota exceeded or private browsing mode: the session stays usable in memory.
    window.console.warn('Unable to persist state', error);
  }
}

export function downloadState(state) {
  const payload = JSON.stringify(state, null, 2);
  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = `mj-virtuel-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export function readStateFile(file) {
  const promise = new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      try {
        resolve(mergeState(createDefaultState(), JSON.parse(reader.result)));
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });

  return promise;
}

// Clears the persisted campaign. The caller is responsible for reloading the page.
export function resetState() {
  window.localStorage.removeItem(STORAGE_KEY);
}
