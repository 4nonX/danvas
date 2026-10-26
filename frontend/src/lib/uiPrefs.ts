// Interface preferences kept with the account (GET/PUT /v1/me/ui-prefs), so
// they follow a person to every browser and device. All of them load once per
// page; a change shows at once and is saved shortly after (several quick
// changes become one request). A copy in this browser paints the last known
// state before the server answers, and stands in when the server cannot be
// reached (an older server without the endpoint, offline).

import { useEffect, useState } from "react";
import { oc } from "@/lib/sdk";

const LOCAL = "oc-ui-pref:";
const SAVE_DELAY = 600;

let loaded: Record<string, unknown> | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function readLocal(key: string): unknown {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(LOCAL + key);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

function writeLocal(key: string, value: unknown) {
  try { localStorage.setItem(LOCAL + key, JSON.stringify(value)); } catch { /* private mode: the account copy still holds it */ }
}

function load(): Promise<void> {
  if (!loading) {
    loading = oc.uiPrefs().then(
      (all) => { loaded = { ...(all ?? {}), ...(loaded ?? {}) }; },
      () => { loaded = loaded ?? {}; },
    ).then(() => listeners.forEach((l) => l()));
  }
  return loading;
}

function current(key: string): unknown {
  if (loaded && key in loaded) return loaded[key];
  return readLocal(key);
}

/** Store a preference: shown at once, saved to the account shortly after. */
export function setUiPref(key: string, value: unknown) {
  loaded = { ...(loaded ?? {}), [key]: value };
  writeLocal(key, value);
  listeners.forEach((l) => l());
  const t = timers.get(key);
  if (t) clearTimeout(t);
  timers.set(key, setTimeout(() => {
    timers.delete(key);
    oc.setUiPref(key, value).catch(() => { /* kept in this browser; the next change tries again */ });
  }, SAVE_DELAY));
}

/** A preference, normalized for the caller, and its setter. */
export function useUiPref<T>(key: string, normalize: (raw: unknown) => T): [T, (next: T) => void] {
  const [, bump] = useState(0);
  useEffect(() => {
    const l = () => bump((n) => n + 1);
    listeners.add(l);
    void load();
    return () => { listeners.delete(l); };
  }, []);
  return [normalize(current(key)), (next: T) => setUiPref(key, next)];
}
