// src/i18n/I18nProvider.jsx
import React, { createContext, useContext, useMemo, useState, useEffect } from "react";
import { translations } from "./translations";

const I18nCtx = createContext(null);

const STORAGE_KEY = "enrgy_lang";

function safeGetInitialLang() {
  const saved = String(localStorage.getItem(STORAGE_KEY) || "").toLowerCase();
  if (saved === "es" || saved === "en") return saved;

  const nav = (navigator.language || "es").toLowerCase();
  if (nav.startsWith("en")) return "en";
  return "es";
}

function getLocaleByLang(lang) {
  return lang === "en" ? "en-US" : "es-CO";
}

// Resuelve "a.b.c" en objeto, devuelve undefined si no existe
function getPath(obj, path) {
  if (!obj || !path) return undefined;
  const parts = String(path).split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in cur) cur = cur[p];
    else return undefined;
  }
  return cur;
}

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(() => safeGetInitialLang());

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // ignore
    }
  }, [lang]);

  const locale = useMemo(() => getLocaleByLang(lang), [lang]);

  const t = useMemo(() => {
    return (key, fallback = "") => {
      const dict = translations?.[lang] || translations.es;
      const v = getPath(dict, key);
      if (typeof v === "string" && v.trim()) return v;
      return fallback || key;
    };
  }, [lang]);

  const api = useMemo(
    () => ({
      lang,
      locale,
      setLang: (next) => setLangState(next === "en" ? "en" : "es"),
      t,
    }),
    [lang, locale, t]
  );

  return <I18nCtx.Provider value={api}>{children}</I18nCtx.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nCtx);
  if (!ctx) {
    // fallback seguro (por si alguien usa hook fuera del provider)
    return { lang: "es", locale: "es-CO", setLang: () => {}, t: (k, fb = "") => fb || k };
  }
  return ctx;
}
