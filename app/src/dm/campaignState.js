// Portable, versioned DM-console state. Campaign files contain references to
// server entries plus per-browser combat state; they deliberately do not embed
// compendium records, character files, homebrew, roll history, or UI preferences.

export const CAMPAIGN_STORAGE_KEY = 'dnd-companion.campaign.v1';
export const LEGACY_TABS_KEYS = ['dnd-companion.dmtabs.v2', 'dnd-companion.dmtabs.v1'];
export const CAMPAIGN_FORMAT = 'dnd-companion-campaign';
export const CAMPAIGN_SCHEMA_VERSION = 1;
export const MAX_CAMPAIGN_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_CAMPAIGN_TABS = 500;

export const TRACKED_CONDITIONS = [
  'blinded', 'charmed', 'frightened', 'grappled', 'incapacitated', 'invisible',
  'paralyzed', 'poisoned', 'prone', 'restrained', 'stunned', 'unconscious',
];
const CONDITION_SET = new Set(TRACKED_CONDITIONS);

const plainObject = (value) => value != null && typeof value === 'object'
  && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const cleanString = (value, field, max, pattern) => {
  if (typeof value !== 'string') throw new Error(`${field} must be text`);
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > max || (pattern && !pattern.test(cleaned))) {
    throw new Error(`${field} is invalid`);
  }
  return cleaned;
};
const finite = (value, field, max = 1_000_000_000) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${field} must be a number`);
  return Math.min(max, Math.max(0, value));
};
const defaultInstanceId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

function normalizeTracker(value) {
  if (value == null) return null;
  if (!plainObject(value)) throw new Error('tracker must be an object or null');
  const max = finite(value.max, 'tracker.max');
  if (max <= 0) throw new Error('tracker.max must be greater than zero');
  const current = Math.min(max, finite(value.current, 'tracker.current'));
  const temp = finite(value.temp ?? 0, 'tracker.temp');
  if (value.conditions != null && !Array.isArray(value.conditions)) throw new Error('tracker.conditions must be a list');
  const conditions = [...new Set((value.conditions ?? [])
    .filter((condition) => typeof condition === 'string')
    .map((condition) => condition.trim().toLowerCase())
    .filter((condition) => CONDITION_SET.has(condition)))];
  return { current, max, temp, conditions };
}

function normalizeTab(value, instanceId) {
  if (!plainObject(value)) throw new Error('every campaign tab must be an object');
  const type = cleanString(value.type, 'tab.type', 50, /^[a-z][a-z0-9-]*$/);
  const slug = cleanString(value.slug, 'tab.slug', 200, /^[a-z0-9][a-z0-9-]*$/);
  const entityId = cleanString(value.entityId ?? value.id, 'tab.entityId', 300, /^[^\u0000-\u001f]+$/);
  const name = cleanString(value.name, 'tab.name', 200);
  const edition = value.edition == null || value.edition === ''
    ? null
    : cleanString(value.edition, 'tab.edition', 12, /^[a-zA-Z0-9.-]+$/);
  return { instanceId, entityId, type, slug, edition, name, tracker: normalizeTracker(value.tracker) };
}

function uniqueInstanceId(candidate, used, idFactory) {
  let next = typeof candidate === 'string' && candidate.trim() && candidate.length <= 400
    ? candidate.trim() : idFactory();
  while (used.has(next)) next = idFactory();
  used.add(next);
  return next;
}

export function normalizeStoredCampaign(value, idFactory = defaultInstanceId) {
  if (!plainObject(value)) throw new Error('stored campaign must be an object');
  if (!Array.isArray(value.tabs)) throw new Error('stored campaign tabs must be a list');
  if (value.tabs.length > MAX_CAMPAIGN_TABS) throw new Error(`campaigns are limited to ${MAX_CAMPAIGN_TABS} tabs`);
  const used = new Set();
  const tabs = value.tabs.map((tab) => normalizeTab(tab, uniqueInstanceId(tab?.instanceId, used, idFactory)));
  const requestedActive = typeof value.activeInstanceId === 'string' ? value.activeInstanceId : null;
  const activeInstanceId = tabs.some((tab) => tab.instanceId === requestedActive)
    ? requestedActive : tabs[0]?.instanceId ?? null;
  const name = typeof value.name === 'string' ? value.name.trim().slice(0, 120) : '';
  return { name, tabs, activeInstanceId };
}

export function loadStoredCampaign(storage, idFactory = defaultInstanceId) {
  try {
    const current = storage.getItem(CAMPAIGN_STORAGE_KEY);
    if (current) return normalizeStoredCampaign(JSON.parse(current), idFactory);
    for (const key of LEGACY_TABS_KEYS) {
      const legacy = storage.getItem(key);
      if (legacy) return normalizeStoredCampaign({ name: '', tabs: JSON.parse(legacy) }, idFactory);
    }
  } catch { /* A corrupt browser value should not prevent the DM screen loading. */ }
  return { name: '', tabs: [], activeInstanceId: null };
}

export function saveStoredCampaign(storage, campaign) {
  const normalized = normalizeStoredCampaign(campaign);
  storage.setItem(CAMPAIGN_STORAGE_KEY, JSON.stringify(normalized));
  for (const key of LEGACY_TABS_KEYS) storage.removeItem(key);
  return normalized;
}

export function createCampaignDocument(campaign, exportedAt = new Date().toISOString()) {
  const normalized = normalizeStoredCampaign(campaign);
  const activeTab = Math.max(0, normalized.tabs.findIndex((tab) => tab.instanceId === normalized.activeInstanceId));
  return {
    format: CAMPAIGN_FORMAT,
    schemaVersion: CAMPAIGN_SCHEMA_VERSION,
    exportedAt,
    campaign: {
      name: normalized.name,
      activeTab,
      tabs: normalized.tabs.map(({ entityId, type, slug, edition, name, tracker }) => ({
        entityId, type, slug, edition, name, tracker,
      })),
    },
  };
}

export function parseCampaignDocument(text, idFactory = defaultInstanceId) {
  let document;
  try { document = JSON.parse(text); } catch { throw new Error('This is not valid JSON.'); }
  if (!plainObject(document) || document.format !== CAMPAIGN_FORMAT) {
    throw new Error('This is not a Dungeon Master’s Companion campaign file.');
  }
  if (document.schemaVersion !== CAMPAIGN_SCHEMA_VERSION) {
    throw new Error(`Campaign version ${document.schemaVersion ?? 'unknown'} is not supported.`);
  }
  if (!plainObject(document.campaign) || !Array.isArray(document.campaign.tabs)) {
    throw new Error('The campaign file has no valid tab list.');
  }
  if (document.campaign.tabs.length > MAX_CAMPAIGN_TABS) {
    throw new Error(`Campaigns are limited to ${MAX_CAMPAIGN_TABS} tabs.`);
  }
  const used = new Set();
  const tabs = document.campaign.tabs.map((tab) => normalizeTab(tab, uniqueInstanceId(null, used, idFactory)));
  const activeIndex = Number.isInteger(document.campaign.activeTab)
    ? Math.min(Math.max(document.campaign.activeTab, 0), Math.max(0, tabs.length - 1)) : 0;
  const name = typeof document.campaign.name === 'string'
    ? document.campaign.name.trim().slice(0, 120) : '';
  return { name, tabs, activeInstanceId: tabs[activeIndex]?.instanceId ?? null };
}

export function mergeCampaigns(current, imported, idFactory = defaultInstanceId) {
  const base = normalizeStoredCampaign(current, idFactory);
  if (base.tabs.length + imported.tabs.length > MAX_CAMPAIGN_TABS) {
    throw new Error(`Merged campaigns are limited to ${MAX_CAMPAIGN_TABS} tabs.`);
  }
  const used = new Set(base.tabs.map((tab) => tab.instanceId));
  const appended = imported.tabs.map((tab) => normalizeTab(tab, uniqueInstanceId(null, used, idFactory)));
  return {
    name: base.name || imported.name,
    tabs: [...base.tabs, ...appended],
    activeInstanceId: appended[0]?.instanceId ?? base.activeInstanceId,
  };
}

export function replaceCampaign(imported, idFactory = defaultInstanceId) {
  const used = new Set();
  const oldActiveIndex = Math.max(0, imported.tabs.findIndex((tab) => tab.instanceId === imported.activeInstanceId));
  const tabs = imported.tabs.map((tab) => normalizeTab(tab, uniqueInstanceId(null, used, idFactory)));
  return { name: imported.name, tabs, activeInstanceId: tabs[oldActiveIndex]?.instanceId ?? null };
}

export function campaignFilename(name, date = new Date()) {
  const base = String(name || 'untitled-campaign').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'untitled-campaign';
  return `${base}-${date.toISOString().slice(0, 10)}.dnd-campaign.json`;
}
