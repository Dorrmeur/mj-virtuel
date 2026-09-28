// Application layer: state binding, rendering and user interactions.

import { rollExpression, rollInitiativeScore, extractRollRequest, resolveCheck } from './dice.js';
import { loadState, saveState, downloadState, readStateFile } from './store.js';
import { askGameMaster, generateLocalIdea } from './ai.js';

const MAX_HISTORY_ENTRIES = 12;
const appState = loadState();

const dom = {
  universe: document.getElementById('inputUniverse'),
  tone: document.getElementById('inputTone'),
  scene: document.getElementById('inputScene'),
  characterList: document.getElementById('characterList'),
  storyLog: document.getElementById('storyLog'),
  diceHistory: document.getElementById('diceHistory'),
  initiativeList: document.getElementById('initiativeList'),
  modeBadge: document.getElementById('modeBadge'),
  settingsDialog: document.getElementById('settingsDialog'),
  fileImport: document.getElementById('fileImport'),
  actionInput: document.getElementById('inputAction'),
  sendButton: document.getElementById('btnSend')
};

function persist() {
  saveState(appState);
}

function createId() {
  const id = `id${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return id;
}

function appendLog(role, text) {
  appState.log.push({ role, text, at: new Date().toISOString() });
  persist();
  renderLog();
}

let m_lastTypedIndex = -1;

function renderLog() {
  dom.storyLog.innerHTML = '';

  appState.log.forEach((entry, index) => {
    const authorLabel = entry.role === 'player' ? 'Joueur' : (entry.role === 'system' ? 'Les des' : 'Le MJ');
    const node = document.createElement('div');
    node.className = `entry ${entry.role}`;
    node.innerHTML = `<span class="author">${authorLabel}</span>`;

    const body = document.createElement('span');
    body.className = 'entryBody';
    node.appendChild(body);

    const isFreshGmEntry = entry.role === 'gm'
      && index === appState.log.length - 1
      && index > m_lastTypedIndex
      && appState.settings.typewriter;

    if (isFreshGmEntry) {
      m_lastTypedIndex = index;
      typewriteInto(body, entry.text);
    } else {
      body.textContent = entry.text;
    }

    const request = entry.role === 'gm' ? extractRollRequest(entry.text) : null;
    if (request !== null) {
      const rollButton = document.createElement('button');
      rollButton.type = 'button';
      rollButton.className = 'rollPrompt';
      rollButton.textContent = `Lancer ${request.formula} contre DD ${request.difficulty}`;
      rollButton.addEventListener('click', () => resolveRollRequest(request, rollButton));
      node.appendChild(rollButton);
    }

    dom.storyLog.appendChild(node);
  });

  dom.storyLog.scrollTop = dom.storyLog.scrollHeight;
}

function renderCharacters() {
  dom.characterList.innerHTML = '';
  appState.characters.forEach((character) => {
    const item = document.createElement('li');
    item.textContent = `${character.name} - ${character.role || 'aventurier'} - ${character.hp} PV`;
    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.textContent = 'x';
    removeButton.addEventListener('click', () => removeCharacter(character.id));
    item.appendChild(removeButton);
    dom.characterList.appendChild(item);
  });
}

function renderDiceHistory() {
  dom.diceHistory.innerHTML = '';
  appState.diceHistory.slice(0, 8).forEach((roll) => {
    const item = document.createElement('li');
    item.textContent = `${roll.formula} = ${roll.total} (${roll.detail})`;
    dom.diceHistory.appendChild(item);
  });
}

function renderInitiative() {
  dom.initiativeList.innerHTML = '';
  appState.initiative.order.forEach((slot, index) => {
    const item = document.createElement('li');
    item.textContent = `${slot.name} : ${slot.score}`;
    if (index === appState.initiative.currentIndex) {
      item.classList.add('activeTurn');
    }
    dom.initiativeList.appendChild(item);
  });
}

function renderModeBadge() {
  const provider = appState.settings.provider;
  const isRemote = provider !== 'local' && Boolean(appState.settings.apiKey);
  dom.modeBadge.textContent = isRemote ? `Mode IA (${provider})` : 'Mode local';
}

function renderAll() {
  dom.universe.value = appState.campaign.universe;
  dom.tone.value = appState.campaign.tone;
  dom.scene.value = appState.campaign.scene;
  renderCharacters();
  renderLog();
  renderDiceHistory();
  renderInitiative();
  renderModeBadge();
}

function addCharacter(name, role, hp) {
  appState.characters.push({ id: createId(), name, role, hp: Number(hp) || 10 });
  persist();
  renderCharacters();
}

function removeCharacter(characterId) {
  appState.characters = appState.characters.filter((character) => character.id !== characterId);
  appState.initiative.order = appState.initiative.order.filter((slot) => slot.id !== characterId);
  persist();
  renderCharacters();
  renderInitiative();
}

function performRoll(formula) {
  const result = rollExpression(formula);
  if (result.valid) {
    appState.diceHistory.unshift({ formula, total: result.total, detail: result.detail });
    appState.diceHistory = appState.diceHistory.slice(0, 20);
    persist();
    renderDiceHistory();
    appendLog('system', `Jet ${formula} : ${result.total} (${result.detail})`);
  } else {
    appendLog('system', `Expression de dés invalide : ${formula}`);
  }
}

function rollInitiative() {
  appState.initiative.order = appState.characters
    .map((character) => ({ id: character.id, name: character.name, score: rollInitiativeScore(0) }))
    .sort((left, right) => right.score - left.score);
  appState.initiative.currentIndex = 0;
  persist();
  renderInitiative();
}

function nextTurn() {
  const total = appState.initiative.order.length;
  if (total > 0) {
    appState.initiative.currentIndex = (appState.initiative.currentIndex + 1) % total;
    persist();
    renderInitiative();
  }
}

function buildContext() {
  const roster = appState.characters
    .map((character) => `${character.name} (${character.role || 'aventurier'}, ${character.hp} PV)`)
    .join(' ; ') || 'aucun personnage enregistré';
  const context = [
    `Univers: ${appState.campaign.universe || 'non défini'}`,
    `Ton: ${appState.campaign.tone}`,
    `Scène actuelle: ${appState.campaign.scene || 'début de session'}`,
    `Groupe: ${roster}`
  ].join('\n');
  return context;
}

// Reveals the game master narration character by character.
function typewriteInto(targetNode, text) {
  const characters = Array.from(text);
  let cursor = 0;

  targetNode.textContent = '';
  const timer = window.setInterval(() => {
    if (cursor >= characters.length) {
      window.clearInterval(timer);
    } else {
      targetNode.textContent += characters[cursor];
      cursor += 1;
      dom.storyLog.scrollTop = dom.storyLog.scrollHeight;
    }
  }, 18);
}

// Rolls a game master request and feeds the qualified result back into the story.
function resolveRollRequest(request, sourceButton) {
  const outcome = resolveCheck(request.formula, request.difficulty);

  if (outcome.valid) {
    sourceButton.disabled = true;
    sourceButton.textContent = `${outcome.total} contre ${request.difficulty} : ${outcome.tier}`;

    appState.diceHistory.unshift({
      formula: request.formula,
      total: outcome.total,
      detail: outcome.detail
    });
    appState.diceHistory = appState.diceHistory.slice(0, 20);
    persist();
    renderDiceHistory();

    const summary = `${request.formula} = ${outcome.total} contre DD ${request.difficulty}`
      + ` (${outcome.detail}) : ${outcome.tier}.`;
    appState.log.push({ role: 'system', text: summary, at: new Date().toISOString() });
    persist();

    if (appState.settings.autoRoll) {
      submitPlayerAction(`Resultat du jet: ${summary} Decris la consequence immediate.`, true);
    } else {
      renderLog();
    }
  }
}

async function submitPlayerAction(text, isSystemDriven) {
  if (isSystemDriven !== true) {
    appendLog('player', text);
  } else {
    renderLog();
  }

  dom.sendButton.disabled = true;
  dom.actionInput.disabled = true;
  dom.sendButton.textContent = 'Le MJ prepare la suite';

  const history = appState.log
    .filter((entry) => entry.role !== 'system')
    .slice(-MAX_HISTORY_ENTRIES);

  try {
    const narration = await askGameMaster(appState.settings, buildContext(), history, text);
    appendLog('gm', narration);
  } catch (error) {
    appendLog('system', `La liaison avec le MJ est rompue : ${error.message}`);
  }

  dom.sendButton.disabled = false;
  dom.actionInput.disabled = false;
  dom.sendButton.textContent = 'Agir';
  dom.actionInput.focus();
}

function openSettings() {
  document.getElementById('inputProvider').value = appState.settings.provider;
  document.getElementById('inputModel').value = appState.settings.model;
  document.getElementById('inputBaseUrl').value = appState.settings.baseUrl;
  document.getElementById('inputApiKey').value = appState.settings.apiKey;
  dom.settingsDialog.showModal();
}

function bindEvents() {
  dom.universe.addEventListener('change', () => {
    appState.campaign.universe = dom.universe.value;
    persist();
  });

  dom.tone.addEventListener('change', () => {
    appState.campaign.tone = dom.tone.value;
    persist();
  });

  dom.scene.addEventListener('change', () => {
    appState.campaign.scene = dom.scene.value;
    persist();
  });

  document.getElementById('formCharacter').addEventListener('submit', (event) => {
    event.preventDefault();
    addCharacter(
      document.getElementById('inputCharName').value.trim(),
      document.getElementById('inputCharRole').value.trim(),
      document.getElementById('inputCharHp').value
    );
    event.target.reset();
  });

  document.getElementById('formDice').addEventListener('submit', (event) => {
    event.preventDefault();
    performRoll(document.getElementById('inputDice').value);
  });

  document.querySelectorAll('.diceShortcut').forEach((button) => {
    button.addEventListener('click', () => performRoll(button.dataset.formula));
  });

  document.querySelectorAll('.generatorButton').forEach((button) => {
    button.addEventListener('click', () => appendLog('system', generateLocalIdea(button.dataset.kind)));
  });

  document.getElementById('formAction').addEventListener('submit', (event) => {
    event.preventDefault();
    const text = dom.actionInput.value.trim();
    if (text.length > 0) {
      dom.actionInput.value = '';
      submitPlayerAction(text);
    }
  });

  document.getElementById('btnRollInitiative').addEventListener('click', rollInitiative);
  document.getElementById('btnNextTurn').addEventListener('click', nextTurn);
  document.getElementById('btnSettings').addEventListener('click', openSettings);
  document.getElementById('btnExport').addEventListener('click', () => downloadState(appState));
  document.getElementById('btnImport').addEventListener('click', () => dom.fileImport.click());

  document.getElementById('btnSaveSettings').addEventListener('click', () => {
    appState.settings.provider = document.getElementById('inputProvider').value;
    appState.settings.model = document.getElementById('inputModel').value.trim();
    appState.settings.baseUrl = document.getElementById('inputBaseUrl').value.trim();
    appState.settings.apiKey = document.getElementById('inputApiKey').value.trim();
    persist();
    renderModeBadge();
  });

  dom.fileImport.addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (file) {
      try {
        const imported = await readStateFile(file);
        Object.assign(appState, imported);
        persist();
        renderAll();
      } catch (error) {
        appendLog('system', `Import impossible : ${error.message}`);
      }
    }
  });
}

// Reveals the game master narration character by character.
function typewriteInto(targetNode, text) {
  const characters = Array.from(text);
  let cursor = 0;

  targetNode.textContent = '';
  const timer = window.setInterval(() => {
    if (cursor >= characters.length) {
      window.clearInterval(timer);
    } else {
      targetNode.textContent += characters[cursor];
      cursor += 1;
      dom.storyLog.scrollTop = dom.storyLog.scrollHeight;
    }
  }, 18);
}
bindEvents();
renderAll();
