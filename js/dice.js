// Dice engine: parses and evaluates standard RPG dice notation such as "2d6+3".

const TOKEN_PATTERN = /^([+-]?)(\d*)d(\d+)$|^([+-]?)(\d+)$/i;

function rollSingleDie(faces) {
  const value = Math.floor(Math.random() * faces) + 1;
  return value;
}

function tokenize(expression) {
  const cleaned = String(expression).toLowerCase().replace(/\s+/g, '');
  const spaced = cleaned.replace(/([+-])/g, ' $1');
  const tokens = spaced.split(' ').filter((token) => token.length > 0);
  return tokens;
}

function evaluateToken(token) {
  const match = TOKEN_PATTERN.exec(token);
  let result = null;

  if (match !== null) {
    const isDiceGroup = match[3] !== undefined;
    const sign = (isDiceGroup ? match[1] : match[4]) === '-' ? -1 : 1;

    if (isDiceGroup) {
      const count = match[2] === '' ? 1 : Number(match[2]);
      const faces = Number(match[3]);
      const rolls = Array.from({ length: count }, () => rollSingleDie(faces));
      const sum = rolls.reduce((accumulator, value) => accumulator + value, 0);
      result = { value: sign * sum, rolls, label: `${count}d${faces}` };
    } else {
      const constant = Number(match[5]);
      result = { value: sign * constant, rolls: [], label: String(constant) };
    }
  }

  return result;
}

// Returns { valid, total, detail } for a full dice expression.
export function rollExpression(expression) {
  const tokens = tokenize(expression);
  const evaluated = tokens.map((token) => evaluateToken(token));
  const isValid = tokens.length > 0 && evaluated.every((item) => item !== null);
  let outcome = { valid: false, total: 0, detail: 'Expression invalide' };

  if (isValid) {
    const total = evaluated.reduce((accumulator, item) => accumulator + item.value, 0);
    const detail = evaluated
      .map((item) => (item.rolls.length > 0 ? `${item.label}[${item.rolls.join(', ')}]` : item.label))
      .join(' + ');
    outcome = { valid: true, total, detail };
  }

  return outcome;
}

// Convenience helper used by the initiative tracker.
export function rollInitiativeScore(modifier) {
  const score = rollSingleDie(20) + Number(modifier || 0);
  return score;
}
