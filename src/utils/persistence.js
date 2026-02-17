// src/utils/persistence.js
// Persistencia robusta en localStorage (anti-crash, versionada)

const KEY = "ENRGY_ONE_ENGINEER_EQUIPMENT_V1";

/* =========================================================
   Helpers internos
========================================================= */

function safeParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function safeString(v) {
  return String(v ?? "").trim();
}

function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function localStorageAvailable() {
  try {
    const k = "__ls_test__";
    localStorage.setItem(k, "1");
    localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

/* =========================================================
   API pública
========================================================= */

/**
 * Carga equipo personalizado del Ingeniero
 * @returns {{
 *   panelCustom: { brand: string, model: string },
 *   inverterCustom: { brand: string, model: string }
 * } | null}
 */
export function loadEngineerEquipment() {
  if (!localStorageAvailable()) return null;

  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;

    const obj = safeParse(raw);
    if (!isObject(obj)) return null;

    // shape esperado:
    // {
    //   panelCustom: { brand: "", model: "" },
    //   inverterCustom: { brand: "", model: "" }
    // }

    const panelCustom = isObject(obj.panelCustom) ? obj.panelCustom : {};
    const inverterCustom = isObject(obj.inverterCustom) ? obj.inverterCustom : {};

    return {
      panelCustom: {
        brand: safeString(panelCustom.brand),
        model: safeString(panelCustom.model),
      },
      inverterCustom: {
        brand: safeString(inverterCustom.brand),
        model: safeString(inverterCustom.model),
      },
    };
  } catch (err) {
    console.warn("[persistence] loadEngineerEquipment failed:", err);
    return null;
  }
}

/**
 * Guarda equipo personalizado del Ingeniero
 * @param {{
 *   panelCustom?: { brand?: string, model?: string },
 *   inverterCustom?: { brand?: string, model?: string }
 * }} obj
 */
export function saveEngineerEquipment(obj) {
  if (!localStorageAvailable()) return false;

  try {
    const payload = {
      panelCustom: {
        brand: safeString(obj?.panelCustom?.brand),
        model: safeString(obj?.panelCustom?.model),
      },
      inverterCustom: {
        brand: safeString(obj?.inverterCustom?.brand),
        model: safeString(obj?.inverterCustom?.model),
      },
      _meta: {
        version: 1,
        updatedAt: new Date().toISOString(),
      },
    };

    localStorage.setItem(KEY, JSON.stringify(payload));
    return true;
  } catch (err) {
    console.warn("[persistence] saveEngineerEquipment failed:", err);
    return false;
  }
}

/**
 * Borra equipo personalizado del Ingeniero
 */
export function clearEngineerEquipment() {
  if (!localStorageAvailable()) return false;

  try {
    localStorage.removeItem(KEY);
    return true;
  } catch (err) {
    console.warn("[persistence] clearEngineerEquipment failed:", err);
    return false;
  }
}

/**
 * Utilidad extra (opcional):
 * Permite resetear versiones viejas si cambias el KEY en el futuro
 */
export function clearEngineerEquipmentByKey(customKey) {
  if (!localStorageAvailable()) return false;

  try {
    localStorage.removeItem(customKey);
    return true;
  } catch {
    return false;
  }
}
