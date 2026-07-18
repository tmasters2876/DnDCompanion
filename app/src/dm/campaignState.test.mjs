import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CAMPAIGN_FORMAT,
  CAMPAIGN_STORAGE_KEY,
  campaignFilename,
  createCampaignDocument,
  loadStoredCampaign,
  mergeCampaigns,
  parseCampaignDocument,
  replaceCampaign,
  saveStoredCampaign,
} from './campaignState.js';

const ids = (...values) => {
  let index = 0;
  return () => values[index++] ?? `generated-${index}`;
};
const tab = (instanceId, current = 162, conditions = []) => ({
  instanceId,
  entityId: 'monster/fire-giant/personal-md',
  type: 'monster', slug: 'fire-giant', edition: '2024', name: 'Fire Giant',
  tracker: { current, max: 162, temp: 2, conditions },
});
const storage = (initial = {}) => {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    values,
  };
};

test('campaign document round trip preserves order, active tab, and independent trackers', () => {
  const current = { name: 'Storm King', tabs: [tab('one', 120), tab('two', 41, ['prone'])], activeInstanceId: 'two' };
  const document = createCampaignDocument(current, '2026-07-18T12:00:00.000Z');
  assert.equal(document.format, CAMPAIGN_FORMAT);
  assert.equal(document.campaign.activeTab, 1);
  assert.equal(document.campaign.tabs[0].instanceId, undefined);
  const restored = parseCampaignDocument(JSON.stringify(document), ids('new-one', 'new-two'));
  assert.equal(restored.name, 'Storm King');
  assert.deepEqual(restored.tabs.map((value) => value.instanceId), ['new-one', 'new-two']);
  assert.deepEqual(restored.tabs.map((value) => value.tracker.current), [120, 41]);
  assert.deepEqual(restored.tabs[1].tracker.conditions, ['prone']);
  assert.equal(restored.activeInstanceId, 'new-two');
});

test('replace regenerates ids and keeps deliberate duplicate combatants', () => {
  const imported = { name: 'Giants', tabs: [tab('old-a', 100), tab('old-b', 20)], activeInstanceId: 'old-b' };
  const replaced = replaceCampaign(imported, ids('fresh-a', 'fresh-b'));
  assert.equal(replaced.tabs.length, 2);
  assert.deepEqual(replaced.tabs.map((value) => value.instanceId), ['fresh-a', 'fresh-b']);
  assert.deepEqual(replaced.tabs.map((value) => value.tracker.current), [100, 20]);
  assert.equal(replaced.activeInstanceId, 'fresh-b');
});

test('merge appends without deduplicating and does not mutate either input', () => {
  const current = { name: 'Current', tabs: [tab('current', 150)], activeInstanceId: 'current' };
  const imported = { name: 'Shared', tabs: [tab('import-a', 90), tab('import-b', 30)], activeInstanceId: 'import-a' };
  const before = JSON.stringify({ current, imported });
  const merged = mergeCampaigns(current, imported, ids('merged-a', 'merged-b'));
  assert.deepEqual(merged.tabs.map((value) => value.instanceId), ['current', 'merged-a', 'merged-b']);
  assert.deepEqual(merged.tabs.map((value) => value.tracker.current), [150, 90, 30]);
  assert.equal(merged.activeInstanceId, 'merged-a');
  assert.equal(JSON.stringify({ current, imported }), before);
});

test('invalid JSON, discriminator, future version, tabs, and references are rejected', () => {
  assert.throws(() => parseCampaignDocument('{nope'), /valid JSON/);
  assert.throws(() => parseCampaignDocument(JSON.stringify({ format: 'other', schemaVersion: 1 })), /not a Dungeon/);
  assert.throws(() => parseCampaignDocument(JSON.stringify({ format: CAMPAIGN_FORMAT, schemaVersion: 99, campaign: { tabs: [] } })), /not supported/);
  assert.throws(() => parseCampaignDocument(JSON.stringify({ format: CAMPAIGN_FORMAT, schemaVersion: 1, campaign: { tabs: {} } })), /tab list/);
  const invalid = createCampaignDocument({ name: '', tabs: [tab('one')], activeInstanceId: 'one' });
  invalid.campaign.tabs[0].slug = '../fire-giant';
  assert.throws(() => parseCampaignDocument(JSON.stringify(invalid)), /tab.slug is invalid/);
});

test('tracker values are bounded and conditions are allowlisted and unique', () => {
  const document = createCampaignDocument({ name: '', tabs: [tab('one')], activeInstanceId: 'one' });
  document.campaign.tabs[0].tracker = {
    current: 999, max: 100, temp: -4,
    conditions: ['Prone', 'prone', 'invented', 42],
  };
  const restored = parseCampaignDocument(JSON.stringify(document), ids('bounded'));
  assert.deepEqual(restored.tabs[0].tracker, { current: 100, max: 100, temp: 0, conditions: ['prone'] });
});

test('stored v2 tabs migrate into the new campaign key without losing trackers', () => {
  const fake = storage({ 'dnd-companion.dmtabs.v2': JSON.stringify([tab('legacy', 73, ['stunned'])]) });
  const loaded = loadStoredCampaign(fake, ids('unused'));
  assert.equal(loaded.tabs[0].tracker.current, 73);
  saveStoredCampaign(fake, loaded);
  assert.ok(fake.values.has(CAMPAIGN_STORAGE_KEY));
  assert.equal(fake.values.has('dnd-companion.dmtabs.v2'), false);
});

test('corrupt stored state fails safe to an empty campaign', () => {
  const fake = storage({ [CAMPAIGN_STORAGE_KEY]: '{broken' });
  assert.deepEqual(loadStoredCampaign(fake), { name: '', tabs: [], activeInstanceId: null });
});

test('campaign filename is portable and recognizable', () => {
  assert.equal(campaignFilename('Curse of Strahd!', new Date('2026-07-18T10:00:00Z')), 'curse-of-strahd-2026-07-18.dnd-campaign.json');
});
