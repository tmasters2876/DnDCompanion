// Extract rollable mechanics from normalized prose. Importers preserve source
// wording, so this is also the last-mile safety net for emphasis/punctuation
// variants that did not become structured fields.

const normalize = (text) => String(text ?? '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/[*_`]/g, '')
  .replace(/−/g, '-')
  .replace(/\s+/g, ' ')
  .trim();

const dice = (value) => String(value).replace(/\s+/g, '');
const uniqueRolls = (rolls) => [...new Map(rolls.map((roll) => [`${roll.formula}/${roll.type}/${roll.kind}`, roll])).values()];

export function extractDamageRolls(text) {
  const source = normalize(text);
  const rolls = [];
  for (const match of source.matchAll(/(?:\d+\s*)?\((\d+d\d+(?:\s*[+-]\s*\d+)?)\)\s+([A-Za-z]+)\s+damage/gi)) {
    rolls.push({ kind: 'damage', formula: dice(match[1]), type: match[2].toLowerCase() });
  }
  for (const match of source.matchAll(/\b(\d+d\d+(?:\s*[+-]\s*\d+)?)\s+([A-Za-z]+)\s+damage/gi)) {
    rolls.push({ kind: 'damage', formula: dice(match[1]), type: match[2].toLowerCase() });
  }
  for (const match of source.matchAll(/(?:takes|Hit:)\s+(\d+)\s+([A-Za-z]+)\s+damage/gi)) {
    rolls.push({ kind: 'damage', formula: match[1], type: match[2].toLowerCase() });
  }
  return uniqueRolls(rolls);
}

export function extractHealingRolls(text) {
  const source = normalize(text);
  const rolls = [];
  for (const match of source.matchAll(/(?:regains?|restore(?:s)?)\s+(?:\d+\s*)?\(?(\d+d\d+(?:\s*[+-]\s*\d+)?)\)?\s+(?:Hit Points|HP)/gi)) {
    rolls.push({ kind: 'healing', formula: dice(match[1]), type: 'healing' });
  }
  return uniqueRolls(rolls);
}

export function extractSave(text) {
  const source = normalize(text);
  let match = /DC\s*(\d+)\s+(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\s+Sav(?:e|ing Throw)/i.exec(source);
  if (match) return { dc: Number(match[1]), ability: match[2].slice(0, 3).toLowerCase() };
  match = /(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\s+Sav(?:e|ing Throw)\s*:?\s*DC\s*(\d+)/i.exec(source);
  return match ? { dc: Number(match[2]), ability: match[1].slice(0, 3).toLowerCase() } : null;
}

export function extractActionMechanics(text) {
  const source = normalize(text);
  const hit = /(?:Attack Roll|Weapon Attack|Spell Attack)\s*:?\s*([+-]\d+)/i.exec(source)
    ?? /([+-]\d+)\s+to hit/i.exec(source);
  const reach = /reach\s+(\d+)\s*ft/i.exec(source);
  const range = /range\s+(\d+)(?:\s*\/\s*(\d+))?\s*ft/i.exec(source);
  const lower = source.toLowerCase();
  const attackType = lower.includes('melee') && lower.includes('ranged') ? 'melee or ranged'
    : lower.includes('melee') ? 'melee' : lower.includes('ranged') ? 'ranged' : null;
  return {
    attack: hit ? {
      bonus: Number(hit[1]), attackType,
      reach: reach ? Number(reach[1]) : null,
      range: range ? { normal: Number(range[1]), long: range[2] ? Number(range[2]) : null } : null,
      damage: extractDamageRolls(source).map(({ formula, type }) => ({ dice: formula, type })),
    } : null,
    damage: extractDamageRolls(source),
    healing: extractHealingRolls(source),
    save: extractSave(source),
  };
}

export function actionMechanics(entry) {
  const parsed = extractActionMechanics(entry?.text);
  const structured = entry?.attack;
  if (!structured) return parsed;
  return {
    ...parsed,
    attack: {
      ...parsed.attack,
      ...structured,
      damage: structured.damage?.length
        ? structured.damage
        : parsed.damage.map((roll) => ({ dice: roll.formula, type: roll.type })),
    },
    damage: structured.damage?.length
      ? structured.damage.map((roll) => ({ kind: 'damage', formula: roll.dice, type: roll.type }))
      : parsed.damage,
  };
}

export function entryRolls(entry) {
  const d = entry?.data ?? {};
  const prose = extractActionMechanics(entry?.text);
  const structured = [];
  if (d.weapon?.damage) structured.push({ kind: 'damage', formula: d.weapon.damage, type: d.weapon.damageType ?? 'damage' });
  if (d.damage?.dice) structured.push({ kind: 'damage', formula: d.damage.dice, type: d.damage.type ?? 'damage' });
  return {
    ...prose,
    damage: uniqueRolls([...structured, ...prose.damage]),
  };
}
