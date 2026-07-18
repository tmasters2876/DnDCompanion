// Full functional suite: drives the built app in headless Chromium through every
// user flow. Run with `npm run test:e2e` (builds app + starts its own server).
// Exits non-zero on any failure.
import { chromium } from 'playwright';
import { spawn, execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5180;
const BASE = `http://localhost:${PORT}`;
const results = [];
let failed = 0;

async function step(name, fn) {
  try {
    await fn();
    results.push(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    results.push(`  ✖ ${name}\n      ${String(e).split('\n').slice(0, 4).join('\n      ')}`);
  }
}

// ---- boot ----
console.log('building app…');
execSync('npm run build -w app', { cwd: ROOT, stdio: 'ignore' });
const server = spawn('node', [join(ROOT, 'server', 'index.mjs')], {
  env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore',
});
for (let i = 0; i < 40; i++) {
  try { if ((await fetch(`${BASE}/api/compendium/types`)).ok) break; } catch { /* retry */ }
  await new Promise((r) => setTimeout(r, 250));
}

async function launch() {
  try { return await chromium.launch(); } catch { /* fall through to cached browser */ }
  const cache = join(process.env.HOME, 'Library', 'Caches', 'ms-playwright');
  const glob = (await import('node:fs')).readdirSync(cache).filter((d) => d.startsWith('chromium-')).sort().at(-1);
  const exe = join(cache, glob, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing');
  if (!existsSync(exe)) throw new Error('no chromium available; run: npx playwright install chromium');
  return chromium.launch({ executablePath: exe });
}

const browser = await launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
const pageErrors = [];
page.on('pageerror', (e) => {
  pageErrors.push(e.stack ?? String(e));
  console.error('PAGE ERROR', e.stack ?? String(e));
});
const cleanupIds = [];

// ---- dedupe + DM screen ----
console.log('dm screen…');
await step('dedupe: exactly one Fireball in the default view', async () => {
  const r = await (await fetch(`${BASE}/api/compendium/spell?q=fireball`)).json();
  const exact = r.results.filter((x) => x.name === 'Fireball');
  if (exact.length !== 1) throw new Error(`expected 1 Fireball, got ${exact.length}: ${exact.map((x) => x.source.key)}`);
  if (!exact[0].source?.key) throw new Error('Fireball winner has no source');
});
await step('usability gate removes the statless Vorga shell', async () => {
  const response = await fetch(`${BASE}/api/compendium/monster?q=the%20vorga&edition=2014`);
  const body = await response.json();
  if (body.results.some((entry) => entry.slug === 'the-vorga')) throw new Error('The Vorga is still browseable');
  if ((await fetch(`${BASE}/api/compendium/monster/the-vorga?edition=2014`)).status !== 404) throw new Error('The Vorga detail still resolves');
});
await step('dedupe: exactly one Goblin stat block wins', async () => {
  const r = await (await fetch(`${BASE}/api/compendium/monster?q=goblin`)).json();
  const exact = r.results.filter((x) => x.name === 'Goblin');
  if (exact.length > 1) throw new Error(`duplicate Goblins: ${exact.map((x) => x.source.key)}`);
});
await step('dm screen: pin a monster tab and roll its attack', async () => {
  await page.goto(`${BASE}/#/dm`);
  await page.waitForSelector('.dmscreen', { timeout: 20000 });
  await page.fill('.dm-search input', 'goblin warrior');
  await page.waitForSelector('.dm-results button');
  await page.locator('.dm-results button', { hasText: 'Goblin Warrior' }).first().click();
  await page.waitForSelector('.dm-tab.active');
  await page.waitForSelector('.dm-content .statblock');
  await page.click('.dm-content .statblock button.rollable:has-text("Scimitar")');
  await page.waitForSelector('.advquery');
  await page.getByRole('button', { name: 'Normal', exact: true }).click();
  await page.waitForSelector('.rollcard');
});
await step('dm screen: pin a spell tab alongside and switch between tabs', async () => {
  await page.click('.dm-kinds button:has-text("Spells")');
  await page.fill('.dm-search input', 'fireball');
  await page.waitForSelector('.dm-results button');
  await page.locator('.dm-results button', { hasText: /^Fireball/ }).first().click();
  await page.waitForSelector('.dm-content .spellcard');
  await page.click('.dm-content .spellcard button.rollable.dmg >> nth=0');
  await page.waitForFunction(() => document.querySelectorAll('.rollcard').length >= 2);
  await page.locator('.dm-tab-name', { hasText: 'Goblin Warrior' }).click();
  await page.waitForSelector('.dm-content .statblock');
  if ((await page.$$eval('.dm-tab', (els) => els.length)) !== 2) throw new Error('expected 2 tabs');
});
await step('dm screen: pin filters show one kind at a time and All restores', async () => {
  // two pins exist: Goblin Warrior (monster) + Fireball (spell)
  await page.waitForSelector('.dm-filters');
  await page.locator('.dm-filters button', { hasText: 'Spells' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.dm-tab').length === 1);
  const spellTab = await page.locator('.dm-tab-name').textContent();
  if (!spellTab.includes('Fireball')) throw new Error(`spell filter shows: ${spellTab}`);
  // active tab must follow the filter — content should now be the spell card
  await page.waitForSelector('.dm-content .spellcard');
  await page.locator('.dm-filters button', { hasText: 'Monsters' }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('.dm-tab-name')]
    .every((tab) => tab.textContent.includes('Goblin Warrior')));
  await page.locator('.dm-filters button', { hasText: /^All/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('.dm-tab').length === 2);
});
await step('dm screen: tabs survive reload', async () => {
  await page.reload();
  await page.waitForSelector('.dm-tab');
  if ((await page.$$eval('.dm-tab', (els) => els.length)) !== 2) throw new Error('tabs not persisted');
});
await step('campaign export/import preserves duplicate combatants and shares across browsers', async () => {
  await page.locator('.dm-tab', { hasText: 'Fireball' }).locator('.dm-tab-close').click();
  await page.locator('.dm-tab-name', { hasText: 'Goblin Warrior' }).click();
  await page.waitForSelector('.combat-tracker');
  const maxHp = Number((await page.locator('.combat-tracker strong').textContent()).match(/\/\s*(\d+)/)?.[1]);
  if (!maxHp) throw new Error('could not read Goblin Warrior max HP');
  await page.fill('.combat-tracker input[aria-label="HP adjustment"]', '2');
  await page.click('.combat-tracker .damage-button');
  await page.waitForSelector(`.dm-tab:has-text("${maxHp - 2}/${maxHp}")`);
  await page.fill('.dm-search input', 'goblin warrior');
  await page.waitForSelector('.dm-results button');
  await page.locator('.dm-results button', { hasText: 'Goblin Warrior' }).first().click();
  await page.waitForFunction(() => document.querySelectorAll('.dm-tab').length === 2);
  await page.fill('.combat-tracker input[aria-label="HP adjustment"]', '1');
  await page.click('.combat-tracker .damage-button');
  await page.waitForSelector(`.dm-tab:has-text("${maxHp - 1}/${maxHp}")`);
  await page.fill('input[aria-label="Campaign name"]', 'E2E Shared Campaign');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('.campaign-toolbar button:has-text("Export campaign")'),
  ]);
  const campaignBuffer = readFileSync(await download.path());
  const exported = JSON.parse(campaignBuffer.toString('utf8'));
  if (exported.format !== 'dnd-companion-campaign' || exported.schemaVersion !== 1) throw new Error('bad campaign envelope');
  if (exported.campaign.tabs.length !== 2) throw new Error('duplicate combatant was deduplicated');
  if (exported.campaign.tabs.map((tab) => tab.tracker.current).join(',') !== `${maxHp - 2},${maxHp - 1}`) throw new Error('independent HP was not exported');

  await page.locator('.dm-tab-close').first().click();
  await page.setInputFiles('.campaign-file-input', { name: 'shared.dnd-campaign.json', mimeType: 'application/json', buffer: campaignBuffer });
  await page.waitForSelector('.campaign-import-dialog');
  await page.click('.campaign-import-dialog button:has-text("Replace current")');
  await page.waitForFunction(() => document.querySelectorAll('.dm-tab').length === 2);
  const restoredTabs = await page.$$eval('.dm-tab-name', (nodes) => nodes.map((node) => node.textContent));
  if (!restoredTabs.some((text) => text.includes(`${maxHp - 2}/${maxHp}`)) || !restoredTabs.some((text) => text.includes(`${maxHp - 1}/${maxHp}`))) throw new Error(`bad restored HP: ${restoredTabs}`);
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.dm-tab').length === 2);
  if ((await page.inputValue('input[aria-label="Campaign name"]')) !== 'E2E Shared Campaign') throw new Error('campaign name did not persist');

  const beforeInvalid = await page.locator('.dm-tab').count();
  await page.setInputFiles('.campaign-file-input', { name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{broken') });
  await page.waitForSelector('.campaign-notice.error');
  if (await page.locator('.dm-tab').count() !== beforeInvalid) throw new Error('invalid import mutated the campaign');

  const sharedContext = await browser.newContext({ viewport: { width: 1200, height: 850 } });
  const sharedPage = await sharedContext.newPage();
  sharedPage.on('pageerror', (error) => pageErrors.push(error.stack ?? String(error)));
  await sharedPage.goto(`${BASE}/#/dm`);
  await sharedPage.waitForSelector('.dmscreen');
  await sharedPage.setInputFiles('.campaign-file-input', { name: 'shared.dnd-campaign.json', mimeType: 'application/json', buffer: campaignBuffer });
  await sharedPage.waitForSelector('.campaign-import-dialog');
  await sharedPage.click('.campaign-import-dialog button:has-text("Replace current")');
  await sharedPage.waitForFunction(() => document.querySelectorAll('.dm-tab').length === 2);
  await sharedPage.setInputFiles('.campaign-file-input', { name: 'shared.dnd-campaign.json', mimeType: 'application/json', buffer: campaignBuffer });
  await sharedPage.waitForSelector('.campaign-import-dialog');
  await sharedPage.click('.campaign-import-dialog button:has-text("Merge with current")');
  await sharedPage.waitForFunction(() => document.querySelectorAll('.dm-tab').length === 4);
  await sharedPage.reload();
  await sharedPage.waitForFunction(() => document.querySelectorAll('.dm-tab').length === 4);
  await sharedContext.close();

  const unavailable = structuredClone(exported);
  unavailable.campaign.tabs[unavailable.campaign.activeTab].entityId = 'monster/missing-campaign-entry/test';
  unavailable.campaign.tabs[unavailable.campaign.activeTab].slug = 'missing-campaign-entry';
  unavailable.campaign.tabs[unavailable.campaign.activeTab].name = 'Missing Campaign Entry';
  await page.setInputFiles('.campaign-file-input', {
    name: 'unavailable.dnd-campaign.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(unavailable)),
  });
  await page.waitForSelector('.campaign-import-dialog');
  await page.click('.campaign-import-dialog button:has-text("Replace current")');
  await page.waitForSelector('.campaign-notice.success:has-text("unavailable reference")');
  await page.waitForSelector('.campaign-unavailable:has-text("Missing Campaign Entry")');
  if (await page.locator('.dm-tab').count() !== 2) throw new Error('unavailable reference was silently discarded');
  const [recoveryDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.click('.campaign-toolbar button:has-text("Export campaign")'),
  ]);
  const recovered = JSON.parse(readFileSync(await recoveryDownload.path(), 'utf8'));
  if (!recovered.campaign.tabs.some((tab) => tab.slug === 'missing-campaign-entry')) throw new Error('unavailable reference could not be backed up again');

  while (await page.locator('.dm-tab-close').count()) await page.locator('.dm-tab-close').first().click();
});

// ---- compendium ----
console.log('compendium…');
await step('spell list loads and search finds Fireball', async () => {
  await page.goto(`${BASE}/#/spell`);
  await page.waitForSelector('.toolbar input', { timeout: 20000 });
  await page.fill('.toolbar input', 'fireball');
  await page.waitForSelector('a.rowlink:has-text("Fireball")', { timeout: 20000 });
});
await step('level filter narrows search results to level 3', async () => {
  await page.fill('.toolbar input', 'fire');
  await page.click('.levelpips button:has-text("3")');
  // name cells also hold damage chips now — match the row link text, not the cell
  await page.waitForFunction(() => [...document.querySelectorAll('table.listing a.rowlink')]
    .some((a) => a.textContent === 'Fireball'));
  const names = await page.$$eval('table.listing a.rowlink', (els) => els.map((e) => e.textContent));
  if (names.includes('Fire Bolt')) throw new Error('cantrip leaked into L3 filter');
});
await step('spell card renders with rollable damage', async () => {
  await page.locator('a.rowlink', { hasText: /^Fireball$/ }).first().click();
  await page.waitForSelector('.spellcard');
  await page.click('.spellcard button.rollable.dmg >> nth=0');
  await page.waitForSelector('.rollcard');
});
await step('legacy edition accessible from detail', async () => {
  await page.locator('a.rowlink.badge', { hasText: 'view 2014 version' }).first().click();
  await page.waitForSelector('.badge.legacy');
});
await step('monster stat block: attack with advantage lands in log', async () => {
  await page.goto(`${BASE}/#/monster`);
  await page.waitForSelector('.toolbar input');
  await page.fill('.toolbar input', 'goblin');
  await page.locator('a.rowlink', { hasText: /^Goblin Warrior$/ }).click();
  await page.waitForSelector('.statblock');
  await page.click('.statblock button.rollable.atk >> nth=0'); // explicit ⚔ attack chip
  await page.waitForSelector('.advquery');
  await page.getByRole('button', { name: 'Advantage', exact: true }).click();
  await page.waitForSelector('.rollcard .badge.adv');
});
await step('Fire Giant exposes described attacks/damage and becomes a tracked DM combatant', async () => {
  await page.goto(`${BASE}/#/monster`);
  await page.waitForSelector('.toolbar input');
  await page.fill('.toolbar input', 'fire giant');
  await page.locator('a.rowlink', { hasText: /^Fire Giant$/ }).first().click();
  await page.waitForSelector('.statblock');
  const attackCount = await page.locator('.statblock button.rollable.atk').count();
  const damageCount = await page.locator('.statblock button.rollable.dmg').count();
  if (attackCount < 2) throw new Error(`Fire Giant has only ${attackCount} attack controls`);
  if (damageCount < 4) throw new Error(`Fire Giant has only ${damageCount} damage controls`);
  await page.click('button.dm-add');
  await page.waitForSelector('.combat-tracker');
  await page.fill('.combat-tracker input[aria-label="HP adjustment"]', '10');
  await page.click('.combat-tracker .damage-button');
  await page.waitForSelector('.combat-tracker:has-text("152 / 162 HP")');
  await page.fill('.combat-tracker input[aria-label="HP adjustment"]', '3');
  await page.click('.combat-tracker .heal-button');
  await page.waitForSelector('.combat-tracker:has-text("155 / 162 HP")');
  await page.fill('.combat-tracker input[aria-label="HP adjustment"]', '5');
  await page.click('.combat-tracker button:has-text("Temp HP")');
  await page.click('.combat-tracker .tracker-conditions button:has-text("prone")');
  await page.fill('.combat-tracker input[aria-label="HP adjustment"]', '3');
  await page.click('.combat-tracker .damage-button');
  await page.waitForSelector('.combat-tracker:has-text("+2 temporary")');
  await page.reload();
  await page.waitForSelector('.combat-tracker:has-text("155 / 162 HP")');
  await page.waitForSelector('.combat-tracker:has-text("+2 temporary")');
  await page.waitForSelector('.combat-tracker .tracker-conditions button.active:has-text("prone")');
  await page.locator('.dm-tab-close').first().click();
});
await step('spell attack button rolls with adjustable modifier', async () => {
  await page.goto(`${BASE}/#/spell`);
  await page.waitForSelector('.toolbar input');
  await page.fill('.toolbar input', 'guiding bolt');
  await page.locator('a.rowlink', { hasText: /^Guiding Bolt$/ }).first().click();
  await page.waitForSelector('.spellcard button.rollable.atk');
  await page.fill('.spellcard .modinput input', '7');
  await page.click('.spellcard button.rollable.atk');
  await page.waitForSelector('.advquery');
  await page.getByRole('button', { name: 'Normal', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('.formula')].some((f) => f.textContent === '1d20+7'));
});
await step('native weapon cards expose adjustable attack and damage controls', async () => {
  await page.goto(`${BASE}/#/item`);
  await page.waitForSelector('.toolbar input');
  await page.fill('.toolbar input', 'quarterstaff');
  await page.locator('a.rowlink', { hasText: /^Quarterstaff$/ }).first().click();
  await page.waitForSelector('.genericcard button.rollable.atk');
  await page.waitForSelector('.genericcard button.rollable.dmg');
  await page.fill('.genericcard .modinput input', '6');
  await page.click('.genericcard button.rollable.atk');
  await page.waitForSelector('.advquery');
  await page.getByRole('button', { name: 'Normal', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('.formula')].some((formula) => formula.textContent === '1d20+6'));
});
await step('CR filter works', async () => {
  await page.goto(`${BASE}/#/monster`);
  await page.waitForSelector('.toolbar select >> nth=1');
  await page.locator('.toolbar select').nth(1).selectOption('10');
  await page.waitForFunction(() => [...document.querySelectorAll('table.listing tbody td')].some((t) => t.textContent === '10'));
});
await step('class page: progression table + feature popup', async () => {
  await page.goto(`${BASE}/#/spell`); // hash-nav quirk: land elsewhere first
  await page.click('nav.types button:has-text("class")');
  await page.locator('a.rowlink', { hasText: /^Wizard$/ }).click();
  await page.waitForSelector('table.progression');
  await page.click('table.progression button.rollable >> nth=0');
  await page.waitForSelector('.featurebox');
});

// ---- dice ----
console.log('dice…');
await step('roll rail is locked: stays visible after a long scroll', async () => {
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(200);
  const box = await page.locator('.rolllog').boundingBox();
  if (!box || box.y !== 0) throw new Error(`roll rail moved: y=${box?.y}`);
  await page.evaluate(() => window.scrollTo(0, 0));
});
await step('d20 quick button rolls without opening the tray', async () => {
  if (await page.locator('.dicetray').count()) throw new Error('tray should start collapsed');
  await page.click('.d20-quick');
  await page.waitForFunction(() => [...document.querySelectorAll('.rolllabel')].some((e) => e.textContent === 'd20'));
});
await step('tray expander reveals full dice set and formula input', async () => {
  await page.click('.tray-toggle');
  await page.waitForSelector('.dicetray');
  await page.click('.dicetray button:has-text("D12")');
  await page.waitForFunction(() => [...document.querySelectorAll('.rolllabel')].some((e) => e.textContent === 'd12'));
});
await step('typed formula with keep-highest', async () => {
  await page.fill('.rolllog form input', '4d6kh3');
  await page.press('.rolllog form input', 'Enter');
  await page.waitForFunction(() => [...document.querySelectorAll('.formula')].some((e) => e.textContent === '4d6kh3'));
});
await step('bad formula rejected without crash', async () => {
  await page.fill('.rolllog form input', 'banana');
  await page.press('.rolllog form input', 'Enter');
  await page.waitForTimeout(300);
  if ((await page.inputValue('.rolllog form input')) !== 'banana') throw new Error('input cleared on bad formula');
});

// ---- creation wizard ----
console.log('wizard…');
await step('wizard: full flow creates a correct druid', async () => {
  await page.goto(`${BASE}/#/characters`);
  await page.click('.bigbutton:has-text("New character")');
  await page.waitForSelector('.wizsteps');
  await page.click('.pickcard:has-text("Druid")');
  await page.waitForSelector('.wizhint');
  await page.click('.bigbutton:has-text("Next")');
  await page.click('.pickcard:has-text("Human")');
  await page.waitForSelector('.wizhint');
  await page.click('.bigbutton:has-text("Next")');
  await page.click('.pickcard:has-text("Acolyte")');
  await page.waitForSelector('.bonuspick');
  const picks = await page.$$('.bonuspick select');
  await picks[0].selectOption('2');
  await picks[1].selectOption('1');
  await page.click('.bigbutton:has-text("Next")');
  const inputs = await page.$$('.abilityassign input');
  for (const [i, v] of [8, 14, 14, 10, 15, 8].entries()) await inputs[i].fill(String(v));
  await page.click('.bigbutton:has-text("Next")');
  await page.waitForSelector('.pickgrid.small');
  for (const el of (await page.$$('.pickgrid.small .pickcard:not(.dim)')).slice(0, 2)) await el.click();
  await page.click('.bigbutton:has-text("Next")');
  await page.fill('.wizard input[placeholder="Search items…"]', 'quarterstaff');
  await page.waitForFunction(() => [...document.querySelectorAll('.pickgrid.small .pickcard')].some((c) => c.textContent.includes('Quarterstaff')));
  await page.click('.pickgrid.small .pickcard:has-text("Quarterstaff")');
  await page.click('.bigbutton:has-text("Next")');
  await page.waitForSelector('.pickgrid.small');
  const grids = await page.$$('.pickgrid.small');
  for (const el of (await grids[0].$$('.pickcard')).slice(0, 2)) await el.click();
  for (const el of (await grids[1].$$('.pickcard')).slice(0, 4)) await el.click();
  await page.click('.bigbutton:has-text("Next")');
  await page.fill('input.charname', 'E2E Druid');
  await page.waitForSelector('.wizhint strong');
  await page.click('.bigbutton:has-text("Create character")');
  await page.waitForSelector('.sheethead');
  const chars = await (await fetch(`${BASE}/api/characters`)).json();
  const me = chars.find((c) => c.name === 'E2E Druid');
  if (!me) throw new Error('character not persisted');
  cleanupIds.push(me.id);
  const full = await (await fetch(`${BASE}/api/characters/${me.id}`)).json();
  if (full.spells.known.length !== 6) throw new Error(`expected 6 known spells, got ${full.spells.known.length}`);
  if (!full.feats.includes('magic-initiate')) throw new Error('background feat missing');
});

await step('wizard: imported background without ability metadata cannot dead-end', async () => {
  // find a background lacking 2024 ability-score metadata (typical of imports)
  const list = (await (await fetch(`${BASE}/api/compendium/background?limit=200`)).json()).results;
  let target = null;
  for (const b of list) {
    const full = await (await fetch(`${BASE}/api/compendium/background/${b.slug}?edition=${b.edition}`)).json();
    if (!full.data?.abilityScores?.length) { target = full; break; }
  }
  if (!target) return; // corpus has none — nothing to regress
  await page.goto(`${BASE}/#/characters`);
  await page.click('.bigbutton:has-text("New character")');
  await page.waitForSelector('.wizsteps');
  await page.click('.pickcard:has-text("Fighter")');
  await page.waitForSelector('.wizhint');
  await page.click('.wiznext .bigbutton');
  await page.locator('.pickgrid .pickcard').first().click(); // any species
  await page.waitForSelector('.wizhint');
  await page.click('.wiznext .bigbutton');
  // search for the metadata-less background and select it
  await page.fill('.wizard input[placeholder^="Search"]', target.name.slice(0, 20));
  await page.locator('.pickcard', { hasText: target.name }).first().click();
  await page.waitForSelector('.bonuspick'); // generic +2/+1 pickers must render
  const picks = await page.$$('.bonuspick select');
  await picks[0].selectOption('2');
  await picks[1].selectOption('1');
  await page.waitForFunction(() => !document.querySelector('.wiznext .bigbutton').disabled);
  await page.click('.linkish:has-text("cancel")');
});

// ---- sheet ----
console.log('sheet…');
await step('sheet: combat tab, senses panel, skill roll with disadvantage', async () => {
  await page.goto(`${BASE}/#/characters/${cleanupIds[0]}`);
  await page.reload(); // hash-only goto doesn't remount; reload guarantees the sheet route
  await page.waitForSelector('.sheettabs button:has-text("combat")');
  await page.waitForSelector('.panel:has-text("Senses")');
  await page.locator('.skillrow button', { hasText: 'perception' }).click();
  await page.waitForSelector('.advquery');
  await page.getByRole('button', { name: 'Disadvantage', exact: true }).click();
  await page.waitForSelector('.rollcard .badge.dis');
});
await step('sheet: slot pip expend/restore persists', async () => {
  await page.click('.sheettabs button:has-text("spells")');
  await page.waitForSelector('.slotrow');
  await page.locator('.pip:not(.used)').first().click();
  await page.waitForSelector('.pip.used');
  await page.waitForTimeout(1100);
  const full = await (await fetch(`${BASE}/api/characters/${cleanupIds[0]}`)).json();
  if (full.slotsUsed[0] !== 1) throw new Error(`slotsUsed ${full.slotsUsed[0]}`);
  await page.locator('.pip.used').first().click();
});
await step('sheet: inventory equip toggle changes attacks', async () => {
  await page.click('.sheettabs button:has-text("inventory")');
  await page.waitForSelector('input[type="checkbox"]');
  await page.locator('input[type="checkbox"]').first().uncheck();
  await page.click('.sheettabs button:has-text("combat")');
  await page.waitForFunction(() => document.body.textContent.includes('No equipped weapons'));
  await page.click('.sheettabs button:has-text("inventory")');
  await page.locator('input[type="checkbox"]').first().check();
});
await step('sheet: level up to druid 2 with rolled HP', async () => {
  await page.click('button.linkish:has-text("level up")');
  await page.waitForSelector('.levelup');
  await page.getByRole('radio').nth(1).check(); // roll
  await page.waitForFunction(() => document.querySelector('.levelup').textContent.includes('rolled:'));
  await page.click('.advquery-buttons button.primary');
  await page.waitForSelector('.subtitle:has-text("druid 2")');
  await page.waitForTimeout(1100);
  const full = await (await fetch(`${BASE}/api/characters/${cleanupIds[0]}`)).json();
  if (full.classes[0].level !== 2) throw new Error('level not persisted');
  if (typeof full.classes[0].hpRolls[1] !== 'number') throw new Error('rolled HP not recorded');
});
await step('sheet: death saves at 0 HP, long rest recovers', async () => {
  const full = await (await fetch(`${BASE}/api/characters/${cleanupIds[0]}`)).json();
  await fetch(`${BASE}/api/characters/${cleanupIds[0]}`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...full, hp: { current: 1, temp: 0 } }),
  });
  await page.reload();
  await page.waitForSelector('.sheethead');
  await page.click('.hpbtn'); // − to 0
  await page.waitForSelector('.deathsaves');
  await page.locator('.deathsaves .pip.fail').first().click();
  await page.click('button.linkish:has-text("long rest")');
  await page.waitForFunction(() => !document.querySelector('.deathsaves'));
});
await step('sheet: print button exists (print view)', async () => {
  await page.waitForSelector('button.linkish:has-text("print")');
});

// ---- homebrew via UI ----
console.log('homebrew…');
await step('homebrew form creates a spell that joins the compendium', async () => {
  await page.click('nav.types button:has-text("homebrew")');
  await page.waitForSelector('.homebrew form');
  await page.fill('.homebrew form input[required]', 'E2E Test Bolt');
  await page.fill('.homebrew textarea', 'A bolt of pure testing.');
  await page.click('.homebrew .bigbutton');
  await page.waitForFunction(() => document.body.textContent.includes('live in the compendium'));
  const r = await fetch(`${BASE}/api/compendium/spell/e2e-test-bolt`);
  if (!r.ok) throw new Error('homebrew spell not queryable');
  await fetch(`${BASE}/api/homebrew/spell/e2e-test-bolt`, { method: 'DELETE' });
});

// ---- character list cleanup path ----
await step('character delete works from list', async () => {
  page.on('dialog', (d) => d.accept());
  await page.click('nav.types button:has-text("characters")');
  await page.waitForSelector('.charlist');
  await page.locator('tr', { hasText: 'E2E Druid' }).locator('button.linkish').click();
  // scope to the list — the roll log legitimately still shows the character's old rolls
  await page.waitForFunction(() => !document.querySelector('.charlist').textContent.includes('E2E Druid'));
  cleanupIds.length = 0;
});

await step('zero uncaught page errors across the whole run', async () => {
  if (pageErrors.length) throw new Error(pageErrors.join(' | '));
});

// ---- teardown + report ----
for (const id of cleanupIds) await fetch(`${BASE}/api/characters/${id}`, { method: 'DELETE' });
await browser.close();
server.kill();
console.log(results.join('\n'));
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
