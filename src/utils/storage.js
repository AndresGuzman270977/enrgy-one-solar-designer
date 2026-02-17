// src/utils/storage.js
// Utilidades seguras para localStorage (anti-crash)
// + Persistencia del estado global de la app (saveAppState/loadAppState/clearAppState)

export function loadString(key, fallback = "") {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : String(v);
  } catch {
    return fallback;
  }
}

export function saveString(key, value) {
  try {
    localStorage.setItem(key, String(value ?? ""));
    return true;
  } catch {
    return false;
  }
}

export function loadJson(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function saveJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeKey(key) {
  try {
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function safeLocalStorageAvailable() {
  try {
    const k = "__ls_test__";
    localStorage.setItem(k, "1");
    localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

/* =========================
   App State (A3)
   ========================= */

const APP_STATE_KEY = "enrgy_one_app_state_v1";
const APP_STATE_VERSION = 1;

/**
 * Guarda el estado global de la app.
 * @param {object} state - Objeto serializable (JSON).
 */
export function saveAppState(state) {
  try {
    if (!safeLocalStorageAvailable()) return false;

    const payload = {
      v: APP_STATE_VERSION,
      ts: Date.now(),
      state: state ?? null,
    };

    // Reusa tu helper (ya es anti-crash)
    return saveJson(APP_STATE_KEY, payload);
  } catch {
    return false;
  }
}

/**
 * Carga el estado global guardado.
 * @returns {object|null}
 */
export function loadAppState() {
  try {
    if (!safeLocalStorageAvailable()) return null;

    const payload = loadJson(APP_STATE_KEY, null);
    if (!payload || typeof payload !== "object") return null;

    const v = Number(payload.v ?? 0);
    const state = payload.state ?? null;

    // En el futuro puedes migrar por versión aquí
    if (!Number.isFinite(v)) return state;
    // v === 1 (actual) => devolvemos state tal cual
    return state;
  } catch {
    return null;
  }
}

/**
 * Borra el estado global guardado.
 */
export function clearAppState() {
  try {
    if (!safeLocalStorageAvailable()) return false;
    return removeKey(APP_STATE_KEY);
  } catch {
    return false;
  }
}

/**
 * (Opcional) Para debug: carga el payload completo (v/ts/state)
 */
export function loadAppStatePayload() {
  try {
    if (!safeLocalStorageAvailable()) return null;
    return loadJson(APP_STATE_KEY, null);
  } catch {
    return null;
  }
}
