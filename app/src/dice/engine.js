// Dice engine. Speaks Roll20-style formula syntax so sheet buttons, stat blocks,
// and typed rolls share one roller: "1d20+5", "2d20kh1+3", "8d6", "1d8+2+1d6".
// Keep/drop: kh<n>, kl<n>, dh<n>, dl<n>.

const TERM = /([+-])?\s*(?:(\d*)d(\d+)(?:(kh|kl|dh|dl)(\d*))?|(\d+))/gy;

export function parse(formula) {
  const terms = [];
  const src = String(formula).trim();
  TERM.lastIndex = 0;
  let last = 0;
  while (last < src.length) {
    TERM.lastIndex = last;
    const m = TERM.exec(src);
    if (!m) throw new Error(`Bad dice formula at "${src.slice(last)}"`);
    const sign = m[1] === '-' ? -1 : 1;
    if (m[6] != null) {
      terms.push({ kind: 'mod', sign, value: Number(m[6]) });
    } else {
      const count = m[2] === '' ? 1 : Number(m[2]);
      const sides = Number(m[3]);
      if (count < 1 || count > 100 || sides < 2 || sides > 1000) throw new Error('Dice out of range');
      terms.push({
        kind: 'dice', sign, count, sides,
        keep: m[4] ? { mode: m[4], n: m[5] === '' ? 1 : Number(m[5]) } : null,
      });
    }
    last = TERM.lastIndex;
    while (src[last] === ' ') last++;
  }
  if (!terms.length) throw new Error('Empty dice formula');
  return terms;
}

export function roll(formula, rng = Math.random) {
  const terms = parse(formula);
  let total = 0;
  const detail = terms.map((t) => {
    if (t.kind === 'mod') {
      total += t.sign * t.value;
      return { ...t };
    }
    const rolls = Array.from({ length: t.count }, () => ({
      value: 1 + Math.floor(rng() * t.sides),
      kept: true,
    }));
    if (t.keep) {
      const order = [...rolls].sort((a, b) => b.value - a.value); // high → low
      const { mode, n } = t.keep;
      const dropped = mode === 'kh' ? order.slice(n)
        : mode === 'kl' ? order.slice(0, order.length - n)
        : mode === 'dh' ? order.slice(0, n)
        : order.slice(order.length - n); // dl
      for (const r of dropped) r.kept = false;
    }
    const subtotal = rolls.filter((r) => r.kept).reduce((s, r) => s + r.value, 0);
    total += t.sign * subtotal;
    return { ...t, rolls, subtotal };
  });

  // d20 metadata for crit/fumble styling: the first d20 term's deciding die.
  const d20term = detail.find((t) => t.kind === 'dice' && t.sides === 20);
  let d20 = null;
  if (d20term) {
    const deciding = d20term.rolls.find((r) => r.kept);
    d20 = { natural: deciding.value, crit: deciding.value === 20, fumble: deciding.value === 1 };
  }
  return { formula: String(formula).trim(), terms: detail, total, d20 };
}

// Advantage/disadvantage rewrite: first 1d20 term becomes 2d20kh1 / 2d20kl1.
export function withAdvantage(formula, mode) {
  if (mode !== 'adv' && mode !== 'dis') return formula;
  const kept = mode === 'adv' ? 'kh1' : 'kl1';
  return String(formula).replace(/(^|[+-]\s*)1?d20(?!\d)/, (m, pre) => `${pre}2d20${kept}`);
}

export const fmtMod = (n) => (n >= 0 ? `+${n}` : `${n}`);
export const abilityMod = (score) => Math.floor((score - 10) / 2);
