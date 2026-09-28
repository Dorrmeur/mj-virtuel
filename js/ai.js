// Game master engine: remote LLM providers plus an offline fallback.

const SYSTEM_PROMPT = [
  'Tu es le Maitre du Jeu d\'une partie de jeu de role sur table.',
  'Tu decris les scenes en 120 mots maximum, a la deuxieme personne du pluriel.',
  'Tu ne joues jamais a la place des joueurs et tu termines toujours par une question ou un choix.',
  'Le systeme de regles est: 1d20 + modificateur contre une difficulte (10 facile, 15 normal, 20 difficile).',
  'Quand un jet est necessaire, demande-le explicitement au format: JET: 1d20+X contre DD Y.'
].join(' ');

const LOCAL_TABLES = {
  npc: ['un contrebandier borgne au rire nerveux', 'une archiviste pale qui parle aux livres',
    'un mercenaire repenti couvert de cicatrices rituelles', 'un enfant messager trop bien informe'],
  place: ['une chapelle noyee dont les cloches sonnent sous l\'eau', 'un marche couvert eclaire au gaz vert',
    'une passerelle de fer suspendue au-dessus du vide', 'une bibliotheque envahie par la mousse'],
  twist: ['un allie du groupe a deja vendu l\'information', 'la porte se referme et le sol s\'incline',
    'la cible recherchee est deja morte depuis trois jours', 'une seconde faction arrive au pire moment']
};

function pickRandom(entries) {
  const chosen = entries[Math.floor(Math.random() * entries.length)];
  return chosen;
}

export function generateLocalIdea(kind) {
  const table = LOCAL_TABLES[kind] || LOCAL_TABLES.twist;
  const idea = pickRandom(table);
  return idea;
}

function buildLocalNarration(userMessage) {
  const narration = [
    `Vous tentez: ${userMessage}.`,
    `L'ambiance change: ${generateLocalIdea('place')}.`,
    `Vous croisez ${generateLocalIdea('npc')}.`,
    `Complication: ${generateLocalIdea('twist')}.`,
    'JET: 1d20+2 contre DD 13. Que faites-vous ensuite ?'
  ].join(' ');
  return narration;
}

async function callGemini(settings, contextText, history, userMessage) {
  const model = settings.model || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(settings.apiKey)}`;
  const contents = history
    .map((entry) => ({ role: entry.role === 'player' ? 'user' : 'model', parts: [{ text: entry.text }] }))
    .concat([{ role: 'user', parts: [{ text: `${contextText}\n\nAction du joueur: ${userMessage}` }] }]);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents, systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] } })
  });

  let output = '';
  if (response.ok === false) {
    output = `Erreur API Gemini (${response.status}). Vérifie la clé ou le modèle.`;
  } else {
    const data = await response.json();
    const parts = data.candidates && data.candidates[0] ? data.candidates[0].content.parts : [];
    output = parts.map((part) => part.text || '').join('').trim() || 'Réponse vide du modèle.';
  }

  return output;
}

async function callOpenAiCompatible(settings, contextText, history, userMessage) {
  const baseUrl = (settings.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }]
    .concat(history.map((entry) => ({
      role: entry.role === 'player' ? 'user' : 'assistant',
      content: entry.text
    })))
    .concat([{ role: 'user', content: `${contextText}\n\nAction du joueur: ${userMessage}` }]);

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey}` },
    body: JSON.stringify({ model: settings.model || 'gpt-4o-mini', messages, temperature: 0.9 })
  });

  let output = '';
  if (response.ok === false) {
    output = `Erreur API (${response.status}). Vérifie la clé, l'URL ou le modèle.`;
  } else {
    const data = await response.json();
    output = (data.choices && data.choices[0] ? data.choices[0].message.content : '').trim()
      || 'Réponse vide du modèle.';
  }

  return output;
}

// Single entry point used by the application layer.
export async function askGameMaster(settings, contextText, history, userMessage) {
  const hasKey = Boolean(settings.apiKey);
  let narration = '';

  if (settings.provider === 'gemini' && hasKey) {
    narration = await callGemini(settings, contextText, history, userMessage);
  } else if (settings.provider === 'openai' && hasKey) {
    narration = await callOpenAiCompatible(settings, contextText, history, userMessage);
  } else {
    narration = buildLocalNarration(userMessage);
  }

  return narration;
}
