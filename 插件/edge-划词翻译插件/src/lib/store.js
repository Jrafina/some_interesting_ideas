import { DEFAULT_SETTINGS } from "./engines.js";

const KEY = "settings";

function merge(base, patch) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  if (!patch || typeof patch !== "object") return out;
  for (const k of Object.keys(patch)) {
    const v = patch[k];
    if (v && typeof v === "object" && !Array.isArray(v) && base[k] && typeof base[k] === "object") {
      out[k] = merge(base[k], v);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

export async function getSettings() {
  const got = await chrome.storage.sync.get(KEY);
  return merge(DEFAULT_SETTINGS, got[KEY] || {});
}

export async function saveSettings(settings) {
  await chrome.storage.sync.set({ [KEY]: settings });
  return settings;
}

export async function updateSettings(patch) {
  const cur = await getSettings();
  const next = merge(cur, patch);
  await chrome.storage.sync.set({ [KEY]: next });
  return next;
}
