// Game master engine: remote LLM providers plus an offline fallback.

const SYSTEM_PROMPT = [
  'Tu es le Maitre du Jeu d\'une partie de jeu de role sur table. Tu n\'es pas un assistant.',
  'Tu ne dis jamais que tu es une intelligence artificielle, un modele ou un programme.',
  'Tu ne proposes jamais d\'aide, tu ne resumes jamais tes capacites, tu ne donnes jamais de conseils hors fiction.',
  'Tu ne sors jamais de la fiction, meme si le joueur te le demande.',
  '',
  'STYLE:',
  'Deuxieme personne du pluriel. Present de narration. 80 a 130 mots maximum.',
  'Commence toujours par un detail sensoriel concret: une odeur, un son, une texture, une lumiere.',
  'Pas de listes a puces, pas de titres, pas de mise en forme. Uniquement de la prose.',
  'Nomme les lieux et les personnes. Donne-leur une voix, un tic, une intention.',
  '',
  'REGLES DE TABLE:',
  'Systeme: 1d20 + modificateur contre une difficulte. DD 10 facile, 13 normal, 16 difficile, 20 heroique.',
  'Tu ne demandes un jet que si l\'echec a une consequence interessante. Sinon la reussite est automatique.',
  'Quand un jet est necessaire, termine ta reponse par exactement: JET: 1d20+X contre DD Y',
  'Tu ne joues jamais les actions ni les repliques des personnages joueurs.',
  'Tu ne decides jamais du resultat d\'un jet avant que le joueur ne l\'ait lance.',
  '',
  'RYTHME:',
  'Chaque reponse doit faire avancer la situation: une menace approche, un indice apparait, un PNJ reagit.',
  'Termine toujours par une question directe au joueur ou par un choix a trancher.',
  'Si le joueur echoue, ne bloque jamais l\'histoire: fais echouer en avant, avec un cout.'
].join('\n');

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
  const preferred = settings.model || 'gemini-3.8-flash';
  const candidates = [preferred, 'gemini-flash-latest', 'gemini-2.5-flash']
    .filter((name, index, list) => list.indexOf(name) === index);

  const contents = history
    .map((entry) => ({ role: entry.role === 'player' ? 'user' : 'model', parts: [{ text: entry.text }] }))
    .concat([{ role: 'user', parts: [{ text: `${contextText}\n\nAction du joueur: ${userMessage}` }] }]);

  const body = JSON.stringify({
    contents,
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] }
  });

  let lastError = '';
  for (const model of candidates) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': settings.apiKey },
        body
      });

      if (response.ok) {
        const data = await response.json();
        const parts = data.candidates && data.candidates[0] && data.candidates[0].content
          ? data.candidates[0].content.parts : [];
        return parts.map((part) => part.text || '').join('').trim() || 'Réponse vide du modèle.';
      }

      let detail = '';
      try { detail = (await response.json()).error.message; } catch (e) { /* ignore */ }
      lastError = `Erreur Gemini (${response.status}, ${model}) : ${detail || 'aucun détail'}`;

      if (response.status !== 503 && response.status !== 429) return lastError;
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
  }

  return lastError;
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
