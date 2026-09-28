// Persistence layer: local storage plus JSON import and export.

const STORAGE_KEY = 'mjVirtuel.state.v1';

function createDefaultState() {
  const defaultState = {
    campaign: { universe: 'Dark fantasy', tone: 'sombre', scene: '' },
    characters: [],
    log: [],
    diceHistory: [],
    initiative: { order: [], currentIndex: 0 },
    settings: { provider: 'local', model: 'gemini-2.5-flash', baseUrl: '', apiKey: '' }
  };
  return defaultState;
}

export function loadState() {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  let loaded = createDefaultState();

  if (raw !== null) {
    try {
      const parsed = JSON.parse(raw);
      loaded = Object.assign(createDefaultState(), parsed);
    } catch (error) {
      window.console.warn('Corrupted save, falling back to defaults', error);
    }
  }

  return loaded;
}

export function saveState(state) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function downloadState(state) {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
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
        resolve(Object.assign(createDefaultState(), JSON.parse(reader.result)));
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
  return promise;
}
