// Device-held DM identity for homebrew privacy tiers. The key is an unguessable
// token stored in this browser; pairing to another device = pasting the code
// there. Spoiler-level scoping by design — not cryptographic security.
import { uid } from '../dice/engine.js';

const KEY = 'dnd-companion.dmprofile.v1';

export function loadProfile(storage = localStorage) {
  try {
    const parsed = JSON.parse(storage.getItem(KEY));
    if (parsed && typeof parsed.name === 'string' && typeof parsed.key === 'string' && parsed.key.length >= 8) {
      return parsed;
    }
  } catch { /* fall through */ }
  return null;
}

export function createProfile(name, storage = localStorage) {
  const profile = { name: String(name).slice(0, 60) || 'DM', key: `${uid()}-${uid()}`.slice(0, 60) };
  storage.setItem(KEY, JSON.stringify(profile));
  return profile;
}

export function pairProfile(name, key, storage = localStorage) {
  const trimmed = String(key).trim();
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(trimmed)) throw new Error('That pairing code does not look valid.');
  const profile = { name: String(name).slice(0, 60) || 'DM', key: trimmed };
  storage.setItem(KEY, JSON.stringify(profile));
  return profile;
}

export function clearProfile(storage = localStorage) {
  storage.removeItem(KEY);
}

// Header helper for every request that may touch private homebrew.
export function dmHeaders(storage = localStorage) {
  const profile = loadProfile(storage);
  return profile ? { 'x-dm-key': profile.key } : {};
}
