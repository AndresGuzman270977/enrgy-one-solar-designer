// src/components/EngineerForm.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import EquipmentPicker from "./EquipmentPicker";
import { loadEngineerEquipment, saveEngineerEquipment, clearEngineerEquipment } from "../utils/persistence";

/**
 * ✅ PRO SAFE + CONTROLLED:
 * - Controlled/uncontrolled bridge (state/onStateChange)
 * - No pierde inputs al cambiar de modo
 * - Defaults (finance + pricing) siempre
 * - Custom equipment se preserva siempre, incluso si EquipmentPicker mete patch
 *
 * FIXES v2 (Feb-2026):
 * ✅ Normaliza panelId/inverterId (compat: selectedPanelId/selectedInverterId)
 * ✅ Infere wantBattery desde batteryId/autonomyDays/autonomyHours
 * ✅ Evita overflow: minWidth:0 en wrappers flex/grid
 *
 * FIXES v3:
 * ✅ Si viene `state` (controlled), sincroniza el JSON avanzado (text) cuando state cambie
 * ✅ Alinea alias de batería: wantBattery/useBattery/hasBattery
 *
 * FIXES v4 (BATERÍA + CONSERVADOR):
 * ✅ UI completa de batería (wantBattery, autonomy, DoD, eff, reserva, carga crítica)
 * ✅ Botón "Preset conservador" para supuestos típicos y consistentes
 * ✅ Pricing: agrega batería + BOS batería opcional
 *
 * FIXES v5 (COMPLETAR UI + ANTI-CRASH):
 * ✅ Secciones faltantes: consumo/pérdidas, área, panel & stringing inputs, inversor/MPPT, distancias, límites de caída, exportación
 * ✅ ensureDefaults ahora completa TODOS los campos críticos del modo Ingeniero (no solo finanzas/batería)
 * ✅ Botones utilitarios: autocalcular consumo diario desde factura, reset técnico, reset todo
 *
 * FIXES v6:
 * ✅ Quita duplicado de "Eficiencia inversor" (estaba repetido en 2 secciones)
 * ✅ Al cambiar RES/CI, si acPhase no fue personalizado, se ajusta a 1P/3P automáticamente
 * ✅ Preset conservador: no pisa reserveFraction si el usuario lo dejó en 0 a propósito
 * ✅ Si llega `state` sin `onStateChange`, cae a local para evitar freeze
 */
export default function EngineerForm({ preset, onCalculate, state, onStateChange }) {
  const seed = useMemo(() => preset || makeEmptyPreset(), [preset]);

  // =========================
  // Controlled/uncontrolled bridge
  // =========================
  const [localModel, setLocalModel] = useState(() => ensureDefaults(seed));

  const isControlled = Boolean(state && typeof state === "object" && typeof onStateChange === "function");
  const model = isControlled ? state : localModel;

  const setModel = (updater) => {
    const prev = model;
    const next = typeof updater === "function" ? updater(prev) : updater;

    if (isControlled) onStateChange(next);
    else setLocalModel(next);
  };

  // JSON avanzado (texto)
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [text, setText] = useState(() => JSON.stringify(ensureDefaults(seed), null, 2));

  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");

  // =========================
  // Persistencia de custom equipment (A3)
  // =========================
  const savedRef = useRef(null);
  if (savedRef.current === null) savedRef.current = loadEngineerEquipment() || null;

  const [custom, setCustom] = useState(() => {
    const saved = savedRef.current;
    return (
      saved || {
        panelCustom: { brand: "", model: "" },
        inverterCustom: { brand: "", model: "" },
      }
    );
  });

  // ✅ helper: aplica custom al model
  const applyCustomToModel = (baseModel, customState) => {
    const next = clone(baseModel || {});
    if (!next.form) next.form = {};

    if (!next.form.finance || typeof next.form.finance !== "object") next.form.finance = defaultFinance();
    if (!next.form.pricing || typeof next.form.pricing !== "object") next.form.pricing = defaultPricing();

    const panelBrand = String(customState?.panelCustom?.brand || "").trim();
    const panelModel = String(customState?.panelCustom?.model || "").trim();
    const invBrand = String(customState?.inverterCustom?.brand || "").trim();
    const invModel = String(customState?.inverterCustom?.model || "").trim();

    next.form.customPanelBrand = panelBrand;
    next.form.customPanelModel = panelModel;
    next.form.customInverterBrand = invBrand;
    next.form.customInverterModel = invModel;

    return next;
  };

  // ✅ Normalizador extra:
  // - panelId/inverterId coherentes
  // - wantBattery inferido si Amateur no lo mandó
  // - alinea alias de batería para motores/compat
  const normalizeEngineerPreset = (p) => {
    const next = clone(p || {});
    if (!next.form || typeof next.form !== "object") next.form = {};

    // compat: selectedPanelId/selectedInverterId -> panelId/inverterId
    const panelId = next.form.panelId || next.form.selectedPanelId || "";
    const inverterId = next.form.inverterId || next.form.selectedInverterId || "";
    if (panelId) {
      next.form.panelId = panelId;
      next.form.selectedPanelId = panelId; // alias
    }
    if (inverterId) {
      next.form.inverterId = inverterId;
      next.form.selectedInverterId = inverterId; // alias
    }

    // compat batería: si no existe wantBattery, inferir desde batteryId/autonomyDays/autonomyHours
    const battId = String(next.form.batteryId || "").trim();
    const autonomyDays = num(next.form.autonomyDays);
    const autonomyHours = num(next.form.autonomyHours);
    const wantBatteryExplicit = typeof next.form.wantBattery === "boolean" ? next.form.wantBattery : null;

    if (wantBatteryExplicit === null) {
      const inferred = (battId && battId !== "bat_none") || autonomyDays > 0 || autonomyHours > 0;
      next.form.wantBattery = Boolean(inferred);
    }

    // ✅ alinear aliases siempre (evita que un motor lea otro flag distinto)
    next.form.useBattery = Boolean(next.form.wantBattery);
    next.form.hasBattery = Boolean(next.form.wantBattery);

    // defaults mínimos para motor Ingeniero (no pisa si ya existe)
    if (next.form.systemVoltage === undefined || next.form.systemVoltage === null) next.form.systemVoltage = 48;
    if (next.form.dod === undefined || next.form.dod === null) next.form.dod = 0.8;
    if (next.form.batteryRoundtripEff === undefined || next.form.batteryRoundtripEff === null) next.form.batteryRoundtripEff = 0.92;
    if (next.form.reserveFraction === undefined || next.form.reserveFraction === null) next.form.reserveFraction = 0.1;
    if (next.form.criticalLoadKW === undefined || next.form.criticalLoadKW === null) next.form.criticalLoadKW = 0;

    // Si batteryId viene vacío, armoniza con wantBattery
    if (!next.form.batteryId || typeof next.form.batteryId !== "string") {
      next.form.batteryId = next.form.wantBattery ? "bat_48v_generic" : "bat_none";
    } else {
      // si quieren batería pero batteryId=bat_none -> corrige
      if (next.form.wantBattery && String(next.form.batteryId).trim() === "bat_none") next.form.batteryId = "bat_48v_generic";
      // si NO quieren batería -> apaga
      if (!next.form.wantBattery) next.form.batteryId = "bat_none";
    }

    // Si batería apagada, autonomía 0
    if (!next.form.wantBattery) {
      next.form.autonomyDays = 0;
      next.form.autonomyHours = 0;
      next.form.criticalLoadKW = 0;
    } else {
      // Si solo llega autonomyDays, completa hours
      if (num(next.form.autonomyHours) <= 0 && num(next.form.autonomyDays) > 0) next.form.autonomyHours = round2(num(next.form.autonomyDays) * 24);
      // Si solo llega autonomyHours, completa days
      if (num(next.form.autonomyDays) <= 0 && num(next.form.autonomyHours) > 0) next.form.autonomyDays = round2(num(next.form.autonomyHours) / 24);
    }

    return next;
  };

  // =========================
  // Seed sync (solo si cambia de verdad)
  // =========================
  const lastSeedKeyRef = useRef("");

  useEffect(() => {
    const key = safeKey(seed);
    if (key && key === lastSeedKeyRef.current) return;
    lastSeedKeyRef.current = key;

    const normalized = normalizeEngineerPreset(seed);
    const next = ensureDefaults(applyCustomToModel(normalized, custom));
    setModel(next);
    setText(JSON.stringify(next, null, 2));
    setErr("");
    setInfo("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  // ✅ al montar: si hay custom guardado, inyectar una vez
  useEffect(() => {
    const saved = savedRef.current;
    if (!saved) return;

    setModel((prev) => {
      const normalized = normalizeEngineerPreset(prev);
      const next = ensureDefaults(applyCustomToModel(normalized, saved));
      setText(JSON.stringify(next, null, 2));
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ✅ FIX v3: si el componente está CONTROLADO (recibe state), sincroniza el JSON al cambiar state
  useEffect(() => {
    if (!(state && typeof state === "object")) return;
    try {
      const normalized = normalizeEngineerPreset(state);
      const safe = ensureDefaults(normalized);
      setText(JSON.stringify(safe, null, 2));
    } catch {
      // no-op
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  /* =========================
     setters
  ========================= */
  const setDeep = (path, value) => {
    setModel((prev) => {
      const next = clone(prev || {});
      let cur = next;
      for (let i = 0; i < path.length - 1; i++) {
        const k = path[i];
        if (!cur[k] || typeof cur[k] !== "object") cur[k] = {};
        cur = cur[k];
      }
      cur[path[path.length - 1]] = value;

      const normalized = normalizeEngineerPreset(next);
      const safe = ensureDefaults(normalized);
      setText(JSON.stringify(safe, null, 2));
      return safe;
    });
  };

  const setNum = (path, v) => setDeep(path, num(v));
  const setInt1 = (path, v) => setDeep(path, Math.max(1, Math.round(num(v))));
  const setBool = (path, v) => setDeep(path, Boolean(v));

  const setFinanceNum = (key, v) => setDeep(["form", "finance", key], numOrEmpty(v));
  const setPricingNum = (key, v) => setDeep(["form", "pricing", key], numOrEmpty(v));

  // ✅ Batería: toggle consistente
  const setWantBattery = (checked) => {
    setModel((prev) => {
      const next = clone(prev || {});
      if (!next.form || typeof next.form !== "object") next.form = {};
      next.form.wantBattery = Boolean(checked);
      next.form.useBattery = Boolean(checked);
      next.form.hasBattery = Boolean(checked);

      if (checked) {
        // defaults "conservador" pero razonable
        if (!next.form.batteryId || String(next.form.batteryId).trim() === "bat_none") next.form.batteryId = "bat_48v_generic";
        if (num(next.form.autonomyDays) <= 0 && num(next.form.autonomyHours) <= 0) next.form.autonomyHours = 6; // 6h default
        if (num(next.form.autonomyDays) <= 0 && num(next.form.autonomyHours) > 0) next.form.autonomyDays = round2(num(next.form.autonomyHours) / 24);
        if (num(next.form.systemVoltage) <= 0) next.form.systemVoltage = 48;
        if (num(next.form.dod) <= 0) next.form.dod = 0.8;
        if (num(next.form.batteryRoundtripEff) <= 0) next.form.batteryRoundtripEff = 0.92;
        if (!isFiniteNum(next.form.reserveFraction)) next.form.reserveFraction = 0.1;
        if (!isFiniteNum(next.form.criticalLoadKW)) next.form.criticalLoadKW = 0;
      } else {
        next.form.batteryId = "bat_none";
        next.form.autonomyDays = 0;
        next.form.autonomyHours = 0;
        next.form.criticalLoadKW = 0;
      }

      const normalized = normalizeEngineerPreset(next);
      const safe = ensureDefaults(normalized);
      setText(JSON.stringify(safe, null, 2));
      return safe;
    });
  };

  // ✅ Preset conservador (para que Engineer sea consistente y “no optimista”)
  const applyConservativePreset = () => {
    setModel((prev) => {
      const next = clone(prev || {});
      if (!next.form || typeof next.form !== "object") next.form = {};
      if (!next.form.finance || typeof next.form.finance !== "object") next.form.finance = {};
      if (!next.form.pricing || typeof next.form.pricing !== "object") next.form.pricing = {};

      // Batería
      next.form.wantBattery = Boolean(next.form.wantBattery);
      next.form.useBattery = Boolean(next.form.wantBattery);
      next.form.hasBattery = Boolean(next.form.wantBattery);
      if (next.form.wantBattery) {
        if (!next.form.batteryId || String(next.form.batteryId).trim() === "bat_none") next.form.batteryId = "bat_48v_generic";
        if (num(next.form.dod) <= 0) next.form.dod = 0.8;
        if (num(next.form.batteryRoundtripEff) <= 0) next.form.batteryRoundtripEff = 0.92;
        // ✅ v6: no pisar si el usuario puso 0 a propósito
        if (!isFiniteNum(next.form.reserveFraction)) next.form.reserveFraction = 0.1;

        if (num(next.form.autonomyHours) <= 0 && num(next.form.autonomyDays) <= 0) next.form.autonomyHours = 6;
        if (num(next.form.autonomyDays) <= 0 && num(next.form.autonomyHours) > 0) next.form.autonomyDays = round2(num(next.form.autonomyHours) / 24);
      }

      // Técnicos: pérdidas y packing (suaves)
      if (!isFiniteNum(next.form.systemLosses) || num(next.form.systemLosses) <= 0) next.form.systemLosses = 0.2;
      if (!isFiniteNum(next.form.packingFactor) || num(next.form.packingFactor) <= 0) next.form.packingFactor = 0.85;

      // Finanzas: supuestos conservadores suaves
      next.form.finance.discountRate = isFiniteNum(next.form.finance.discountRate) ? next.form.finance.discountRate : 0.12;
      next.form.finance.degradationPct = isFiniteNum(next.form.finance.degradationPct) ? next.form.finance.degradationPct : 0.005;
      next.form.finance.tariffEscalationPct = isFiniteNum(next.form.finance.tariffEscalationPct) ? next.form.finance.tariffEscalationPct : 0.06;
      next.form.finance.omPctPerYear = isFiniteNum(next.form.finance.omPctPerYear) ? next.form.finance.omPctPerYear : 0.015;

      // Pricing: deja defaults si están vacíos
      const dp = defaultPricing();
      Object.keys(dp).forEach((k) => {
        const v = next.form.pricing[k];
        const ok = v !== undefined && v !== null && !(typeof v === "string" && v.trim() === "");
        if (!ok) next.form.pricing[k] = dp[k];
      });

      const normalized = normalizeEngineerPreset(next);
      const safe = ensureDefaults(applyCustomToModel(normalized, custom));
      setText(JSON.stringify(safe, null, 2));
      return safe;
    });
    setInfo("🛡️ Preset conservador aplicado (batería/finanzas/tech coherentes).");
  };

  /* =========================
     run
  ========================= */
  const handleRun = () => {
    setErr("");
    setInfo("");
    try {
      const normalized = normalizeEngineerPreset(model);
      const safeModel = ensureDefaults(normalized);
      setModel(safeModel);
      setText(JSON.stringify(safeModel, null, 2));
      onCalculate?.(safeModel);
      setInfo("✅ Preset enviado al motor Ingeniero.");
    } catch (e) {
      setErr(`No se pudo calcular: ${e?.message || "error"}`);
    }
  };

  const handleRunFromJson = () => {
    setErr("");
    setInfo("");
    try {
      const objRaw = JSON.parse(text);
      const normalized = normalizeEngineerPreset(objRaw);
      const obj = ensureDefaults(normalized);
      setModel(obj);
      onCalculate?.(obj);
      setText(JSON.stringify(obj, null, 2));
      setInfo("✅ Calculado desde JSON (avanzado).");
    } catch (e) {
      setErr(`JSON inválido: ${e?.message || "error"}`);
    }
  };

  const handlePrettify = () => {
    setErr("");
    setInfo("");
    try {
      const obj = JSON.parse(text);
      setText(JSON.stringify(obj, null, 2));
      setInfo("✅ JSON formateado.");
    } catch (e) {
      setErr(`No puedo formatear: JSON inválido (${e?.message || "error"})`);
    }
  };

  /* =========================
     model slices
  ========================= */
  const m = model || {};
  const form = m.form || {};
  const loc = m.loc || {};
  const proj = m.project || {};
  const bill = m.bill || {};

  const finance = form.finance || {};
  const pricing = form.pricing || {};

  const isCI = String(m.clientMode || "RES") === "CI";
  const acPhase = String(form.acPhase || (isCI ? "3P" : "1P"));

  // ✅ v6: si el usuario cambia RES/CI y acPhase era “default”, ajústalo automáticamente
  const lastClientModeRef = useRef(String(m.clientMode || "RES"));
  useEffect(() => {
    const currentMode = String(m.clientMode || "RES");
    const prevMode = lastClientModeRef.current;
    if (currentMode === prevMode) return;

    const prevDefault = prevMode === "CI" ? "3P" : "1P";
    const nextDefault = currentMode === "CI" ? "3P" : "1P";

    // Solo auto-ajusta si acPhase NO fue personalizado (i.e., coincide con el default anterior o está vacío)
    const currentPhase = String((m.form || {}).acPhase || "");
    const shouldAuto = !currentPhase || currentPhase === prevDefault;

    lastClientModeRef.current = currentMode;

    if (shouldAuto) {
      setDeep(["form", "acPhase"], nextDefault);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.clientMode]);

  /* =========================
     custom actions
  ========================= */
  const handleSaveCustom = () => {
    const payload = {
      panelCustom: {
        brand: String(custom?.panelCustom?.brand || "").trim(),
        model: String(custom?.panelCustom?.model || "").trim(),
      },
      inverterCustom: {
        brand: String(custom?.inverterCustom?.brand || "").trim(),
        model: String(custom?.inverterCustom?.model || "").trim(),
      },
    };

    saveEngineerEquipment(payload);
    savedRef.current = payload;

    setModel((prev) => {
      const normalized = normalizeEngineerPreset(prev);
      const next = ensureDefaults(applyCustomToModel(normalized, payload));
      setText(JSON.stringify(next, null, 2));
      return next;
    });

    setInfo("✅ Equipo personalizado guardado (localStorage) y aplicado al preset.");
  };

  const handleApplyCustomOnly = () => {
    setModel((prev) => {
      const normalized = normalizeEngineerPreset(prev);
      const next = ensureDefaults(applyCustomToModel(normalized, custom));
      setText(JSON.stringify(next, null, 2));
      return next;
    });
    setInfo("✅ Equipo personalizado aplicado al preset (sin guardar).");
  };

  const handleClearCustom = () => {
    clearEngineerEquipment();
    savedRef.current = null;

    const blank = {
      panelCustom: { brand: "", model: "" },
      inverterCustom: { brand: "", model: "" },
    };
    setCustom(blank);

    setModel((prev) => {
      const normalized = normalizeEngineerPreset(prev);
      const next = ensureDefaults(applyCustomToModel(normalized, blank));
      setText(JSON.stringify(next, null, 2));
      return next;
    });

    setInfo("🧹 Equipo personalizado borrado (localStorage).");
  };

  const handleResetFinance = () => {
    setModel((prev) => {
      const next = clone(prev || {});
      if (!next.form || typeof next.form !== "object") next.form = {};
      next.form.finance = defaultFinance();
      const normalized = normalizeEngineerPreset(next);
      const safe = ensureDefaults(normalized);
      setText(JSON.stringify(safe, null, 2));
      return safe;
    });
    setInfo("🧾 Finanzas: valores por defecto restaurados.");
  };

  const handleResetPricing = () => {
    setModel((prev) => {
      const next = clone(prev || {});
      if (!next.form || typeof next.form !== "object") next.form = {};
      next.form.pricing = defaultPricing();
      const normalized = normalizeEngineerPreset(next);
      const safe = ensureDefaults(normalized);
      setText(JSON.stringify(safe, null, 2));
      return safe;
    });
    setInfo("💲 Precios: valores por defecto restaurados.");
  };

  const handleResetAllEconomic = () => {
    setModel((prev) => {
      const next = clone(prev || {});
      if (!next.form || typeof next.form !== "object") next.form = {};
      next.form.finance = defaultFinance();
      next.form.pricing = defaultPricing();
      const normalized = normalizeEngineerPreset(next);
      const safe = ensureDefaults(normalized);
      setText(JSON.stringify(safe, null, 2));
      return safe;
    });
    setInfo("🧾💲 Finanzas y precios: defaults restaurados.");
  };

  const handleResetTech = () => {
    setModel((prev) => {
      const next = clone(prev || {});
      // mantiene proyecto/loc/bill/finanzas/precios/custom ids, pero resetea campos técnicos típicos
      if (!next.form || typeof next.form !== "object") next.form = {};
      const keep = next.form;

      const base = makeEmptyPreset();
      next.form = {
        ...clone(base.form),
        // preserve equipment + economics
        panelId: keep.panelId ?? keep.selectedPanelId ?? base.form.panelId,
        inverterId: keep.inverterId ?? keep.selectedInverterId ?? base.form.inverterId,
        selectedPanelId: keep.panelId ?? keep.selectedPanelId ?? base.form.selectedPanelId,
        selectedInverterId: keep.inverterId ?? keep.selectedInverterId ?? base.form.selectedInverterId,

        finance: keep.finance || base.form.finance,
        pricing: keep.pricing || base.form.pricing,

        // preserve battery choice & custom strings
        wantBattery: Boolean(keep.wantBattery),
        useBattery: Boolean(keep.wantBattery),
        hasBattery: Boolean(keep.wantBattery),
        batteryId: keep.wantBattery ? (keep.batteryId && keep.batteryId !== "bat_none" ? keep.batteryId : "bat_48v_generic") : "bat_none",
        autonomyDays: keep.wantBattery ? num(keep.autonomyDays) : 0,
        autonomyHours: keep.wantBattery ? num(keep.autonomyHours) : 0,
        systemVoltage: keep.wantBattery ? num(keep.systemVoltage) || 48 : 48,
        dod: keep.wantBattery ? num(keep.dod) || 0.8 : 0.8,
        batteryRoundtripEff: keep.wantBattery ? num(keep.batteryRoundtripEff) || 0.92 : 0.92,
        reserveFraction: keep.wantBattery ? (isFiniteNum(keep.reserveFraction) ? num(keep.reserveFraction) : 0.1) : 0.1,
        criticalLoadKW: keep.wantBattery ? num(keep.criticalLoadKW) : 0,

        customPanelBrand: keep.customPanelBrand || "",
        customPanelModel: keep.customPanelModel || "",
        customInverterBrand: keep.customInverterBrand || "",
        customInverterModel: keep.customInverterModel || "",
      };

      const normalized = normalizeEngineerPreset(next);
      const safe = ensureDefaults(applyCustomToModel(normalized, custom));
      setText(JSON.stringify(safe, null, 2));
      return safe;
    });
    setInfo("🧰 Parámetros técnicos restaurados (sin tocar finanzas/precios/equipos).");
  };

  const handleResetAll = () => {
    const base = makeEmptyPreset();
    const normalized = normalizeEngineerPreset(base);
    const safe = ensureDefaults(applyCustomToModel(normalized, custom));
    setModel(safe);
    setText(JSON.stringify(safe, null, 2));
    setErr("");
    setInfo("🧼 Todo restaurado a valores base (Engineer).");
  };

  const handleAutoDailyFromBill = () => {
    const kwh = num(bill.billingKWh);
    const days = Math.max(1, num(bill.billingDays) || 30);
    const daily = kwh > 0 ? round2(kwh / days) : 0;
    setNum(["form", "dailyConsumption"], daily);
    setInfo(daily > 0 ? `🧮 Consumo diario calculado desde factura: ${daily} kWh/día.` : "🧮 No se pudo calcular (revisa kWh y días).");
  };

  return (
    <div className="card" style={{ minWidth: 0 }}>
      <div className="row" style={{ justifyContent: "space-between", gap: 12, alignItems: "flex-start", minWidth: 0 }}>
        <div style={{ minWidth: 0 }}>
          <div className="badge">MODO INGENIERO</div>
          <h2 style={{ marginTop: 10 }}>Parámetros técnicos (formulario)</h2>
          <div className="muted">Ajusta parámetros reales (panel/inversor/MPPT/distancias/batería) y calcula. El JSON queda oculto (opcional).</div>
        </div>

        <div className="row" style={{ gap: 10, flexWrap: "wrap", justifyContent: "flex-end", minWidth: 0 }}>
          <button type="button" className="btn" onClick={applyConservativePreset} title="Aplica supuestos base coherentes para un análisis conservador">
            Preset conservador
          </button>
          <button type="button" className="btn" onClick={handleResetTech} title="Restaurar parámetros técnicos típicos (sin tocar precios/finanzas/equipos)">
            Reset técnico
          </button>
          <button type="button" className="btn" onClick={() => setShowAdvanced((s) => !s)}>
            {showAdvanced ? "Ocultar avanzado" : "Avanzado (JSON)"}
          </button>
          <button type="button" className="btnPrimary" onClick={handleRun}>
            Calcular Ingeniero
          </button>
        </div>
      </div>

      {err ? (
        <div className="note" style={{ marginTop: 12, borderColor: "rgba(255, 99, 132, 0.55)" }}>
          ⚠ {err}
        </div>
      ) : null}

      {info ? (
        <div className="note" style={{ marginTop: 12, borderColor: "rgba(102, 255, 153, 0.35)" }}>
          {info}
        </div>
      ) : null}

      {/* ====== PROYECTO / UBICACIÓN ====== */}
      <h3 className="section">Proyecto y ubicación</h3>
      <div className="grid2" style={{ minWidth: 0 }}>
        <FormInput label="Nombre del proyecto" value={proj.name || ""} onChange={(v) => setDeep(["project", "name"], v)} placeholder="ENRGY ONE • Solar Designer" />
        <FormInput label="Empresa" value={proj.company || ""} onChange={(v) => setDeep(["project", "company"], v)} placeholder="—" />
      </div>

      <div className="grid3" style={{ marginTop: 10, minWidth: 0 }}>
        <FormInput label="País" value={loc.country || ""} onChange={(v) => setDeep(["loc", "country"], v)} placeholder="Colombia" />
        <FormInput label="Ciudad" value={loc.city || ""} onChange={(v) => setDeep(["loc", "city"], v)} placeholder="Cali" />
        <FormInput
          label="PSH (loc)"
          value={String(loc.psh ?? "")}
          onChange={(v) => setNum(["loc", "psh"], v)}
          onBlurNormalize={(v) => setNum(["loc", "psh"], v)}
          inputMode="decimal"
          placeholder="4.8"
          hint="Si no defines PSH del motor, el motor usa loc.psh."
        />
      </div>

      <div className="grid3" style={{ marginTop: 10, minWidth: 0 }}>
        <FormInput
          label="PSH (motor)"
          value={String(form.peakSunHours ?? "")}
          onChange={(v) => setNum(["form", "peakSunHours"], v)}
          onBlurNormalize={(v) => setNum(["form", "peakSunHours"], v)}
          inputMode="decimal"
          placeholder="4.8"
          hint="Este es el que usa el motor Ingeniero (peakSunHours)."
        />
        <FormSelect
          label="Material conductor"
          value={(form.conductorMaterial || "Cu").toUpperCase() === "AL" ? "Al" : "Cu"}
          onChange={(v) => setDeep(["form", "conductorMaterial"], v)}
          options={[
            { value: "Cu", label: "Cobre (Cu)" },
            { value: "Al", label: "Aluminio (Al)" },
          ]}
        />
        {/* ✅ v6: se eliminó el duplicado de eficiencia inversor (queda en Inversor/MPPT) */}
        <div style={{ minWidth: 0 }} />
      </div>

      {/* ====== TIPO DE CLIENTE ====== */}
      <h3 className="section">Tipo de cliente</h3>
      <div className="row" style={{ marginTop: 8, flexWrap: "wrap", minWidth: 0 }}>
        <button type="button" className={`tab ${!isCI ? "active" : ""}`} onClick={() => setDeep(["clientMode"], "RES")}>
          Residencial (1P)
        </button>
        <button type="button" className={`tab ${isCI ? "active" : ""}`} onClick={() => setDeep(["clientMode"], "CI")}>
          Comercial/Industrial (3P)
        </button>
      </div>

      {/* ====== FACTURA ====== */}
      <h3 className="section">Factura (auditoría)</h3>
      <div className="grid3" style={{ minWidth: 0 }}>
        <FormInput label="kWh periodo" value={String(bill.billingKWh ?? "")} onChange={(v) => setNum(["bill", "billingKWh"], v)} onBlurNormalize={(v) => setNum(["bill", "billingKWh"], v)} inputMode="numeric" />
        <FormInput label="Días facturados" value={String(bill.billingDays ?? "")} onChange={(v) => setNum(["bill", "billingDays"], v)} onBlurNormalize={(v) => setNum(["bill", "billingDays"], v)} inputMode="numeric" />
        <FormInput label="Tarifa (COP/kWh)" value={String(bill.tariffCOPkWh ?? "")} onChange={(v) => setNum(["bill", "tariffCOPkWh"], v)} onBlurNormalize={(v) => setNum(["bill", "tariffCOPkWh"], v)} inputMode="numeric" />
      </div>

      <div className="row" style={{ marginTop: 10, gap: 10, flexWrap: "wrap", justifyContent: "flex-end", minWidth: 0 }}>
        <button type="button" className="btn" onClick={handleAutoDailyFromBill} title="Calcula consumo diario = kWh periodo / días facturados">
          Autocalcular consumo diario
        </button>
      </div>

      {/* ====== CONSUMO / PÉRDIDAS ====== */}
      <h3 className="section">Consumo y pérdidas</h3>
      <div className="grid3" style={{ minWidth: 0 }}>
        <FormInput
          label="Consumo diario (kWh/día)"
          value={String(form.dailyConsumption ?? "")}
          onChange={(v) => setNum(["form", "dailyConsumption"], v)}
          onBlurNormalize={(v) => setNum(["form", "dailyConsumption"], v)}
          inputMode="decimal"
          placeholder="0"
          hint="Si lo dejas en 0, el motor puede estimar desde factura (según tu sizing.js)."
        />
        <FormInput
          label="Pérdidas del sistema (0..1)"
          value={String(form.systemLosses ?? "")}
          onChange={(v) => setNum(["form", "systemLosses"], v)}
          onBlurNormalize={(v) => setNum(["form", "systemLosses"], v)}
          inputMode="decimal"
          placeholder="0.20"
          hint="Ej: 0.20 = 20% (conservador)."
        />
        <FormInput
          label="Autoconsumo ref. (0..1)"
          value={String(form.selfConsumptionRatio ?? "")}
          onChange={(v) => setNum(["form", "selfConsumptionRatio"], v)}
          onBlurNormalize={(v) => setNum(["form", "selfConsumptionRatio"], v)}
          inputMode="decimal"
          placeholder="0.85"
          hint="Se usa en finanzas si tu motor lo lee desde form.*"
        />
      </div>

      {/* ====== ÁREA ====== */}
      <h3 className="section">Restricción por área</h3>
      <div className="row" style={{ marginTop: 10, gap: 12, flexWrap: "wrap", alignItems: "center", minWidth: 0 }}>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={Boolean(form.limitedByArea)} onChange={(e) => setBool(["form", "limitedByArea"], e.target.checked)} />
          Limitar por área disponible
        </label>
        <div className="muted" style={{ minWidth: 0 }}>
          packingFactor: <b>{String(form.packingFactor ?? 0.85)}</b>
        </div>
      </div>

      <div className="grid3" style={{ marginTop: 10, minWidth: 0, opacity: form.limitedByArea ? 1 : 0.55, pointerEvents: form.limitedByArea ? "auto" : "none" }}>
        <FormInput label="Área disponible (m²)" value={String(form.areaM2 ?? "")} onChange={(v) => setNum(["form", "areaM2"], v)} onBlurNormalize={(v) => setNum(["form", "areaM2"], v)} inputMode="decimal" placeholder="0" />
        <FormInput
          label="Área panel (m²)"
          value={String(form.panelAreaM2 ?? "")}
          onChange={(v) => setNum(["form", "panelAreaM2"], v)}
          onBlurNormalize={(v) => setNum(["form", "panelAreaM2"], v)}
          inputMode="decimal"
          placeholder="2.6"
        />
        <FormInput
          label="Packing factor (0..1)"
          value={String(form.packingFactor ?? "")}
          onChange={(v) => setNum(["form", "packingFactor"], v)}
          onBlurNormalize={(v) => setNum(["form", "packingFactor"], v)}
          inputMode="decimal"
          placeholder="0.85"
          hint="Factor por pasillos/sombras/espacios."
        />
      </div>

      {/* ====== PANEL ====== */}
      <h3 className="section">Panel FV (parámetros eléctricos)</h3>
      <div className="grid3" style={{ minWidth: 0 }}>
        <FormInput label="Potencia panel (W)" value={String(form.panelPower ?? "")} onChange={(v) => setNum(["form", "panelPower"], v)} onBlurNormalize={(v) => setNum(["form", "panelPower"], v)} inputMode="numeric" placeholder="550" />
        <FormInput label="Vmp (V)" value={String(form.vmp ?? "")} onChange={(v) => setNum(["form", "vmp"], v)} onBlurNormalize={(v) => setNum(["form", "vmp"], v)} inputMode="decimal" placeholder="41.5" />
        <FormInput label="Imp (A)" value={String(form.imp ?? "")} onChange={(v) => setNum(["form", "imp"], v)} onBlurNormalize={(v) => setNum(["form", "imp"], v)} inputMode="decimal" placeholder="13.25" />
      </div>

      <div className="grid3" style={{ marginTop: 10, minWidth: 0 }}>
        <FormInput label="Voc (V)" value={String(form.voc ?? "")} onChange={(v) => setNum(["form", "voc"], v)} onBlurNormalize={(v) => setNum(["form", "voc"], v)} inputMode="decimal" placeholder="49.5" />
        <FormInput label="Isc (A)" value={String(form.isc ?? "")} onChange={(v) => setNum(["form", "isc"], v)} onBlurNormalize={(v) => setNum(["form", "isc"], v)} inputMode="decimal" placeholder="13.9" />
        <FormInput
          label="Coef. temp Voc (%/°C)"
          value={String(form.vocTempCoeffPctPerC ?? "")}
          onChange={(v) => setNum(["form", "vocTempCoeffPctPerC"], v)}
          onBlurNormalize={(v) => setNum(["form", "vocTempCoeffPctPerC"], v)}
          inputMode="decimal"
          placeholder="-0.28"
          hint="Ej: -0.28 (%/°C)."
        />
      </div>

      <div className="grid3" style={{ marginTop: 10, minWidth: 0 }}>
        <FormInput label="T mínima sitio (°C)" value={String(form.tMinC ?? "")} onChange={(v) => setNum(["form", "tMinC"], v)} onBlurNormalize={(v) => setNum(["form", "tMinC"], v)} inputMode="numeric" placeholder="0" />
        <FormInput label="Export ratio (0..1)" value={String(form.exportRatio ?? "")} onChange={(v) => setNum(["form", "exportRatio"], v)} onBlurNormalize={(v) => setNum(["form", "exportRatio"], v)} inputMode="decimal" placeholder="0" hint="Si vendes excedentes (finanzas)." />
        <FormInput label="Export límite (kW)" value={String(form.exportKW ?? "")} onChange={(v) => setNum(["form", "exportKW"], v)} onBlurNormalize={(v) => setNum(["form", "exportKW"], v)} inputMode="decimal" placeholder="0" hint="0 = sin límite." />
      </div>

      {/* ====== INVERSOR / MPPT ====== */}
      <h3 className="section">Inversor y MPPT</h3>
      <div className="grid3" style={{ minWidth: 0 }}>
        <FormInput label="Potencia AC objetivo (kWac)" value={String(form.acKw ?? "")} onChange={(v) => setNum(["form", "acKw"], v)} onBlurNormalize={(v) => setNum(["form", "acKw"], v)} inputMode="decimal" placeholder="0" hint="Si 0, el motor puede dimensionar." />
        <FormInput label="MPPT Vmin (V)" value={String(form.mpptVmin ?? "")} onChange={(v) => setNum(["form", "mpptVmin"], v)} onBlurNormalize={(v) => setNum(["form", "mpptVmin"], v)} inputMode="numeric" placeholder="120" />
        <FormInput label="MPPT Vmax (V)" value={String(form.mpptVmax ?? "")} onChange={(v) => setNum(["form", "mpptVmax"], v)} onBlurNormalize={(v) => setNum(["form", "mpptVmax"], v)} inputMode="numeric" placeholder="500" />
      </div>

      <div className="grid3" style={{ marginTop: 10, minWidth: 0 }}>
        <FormInput label="Vdc máx (V)" value={String(form.dcMaxV ?? "")} onChange={(v) => setNum(["form", "dcMaxV"], v)} onBlurNormalize={(v) => setNum(["form", "dcMaxV"], v)} inputMode="numeric" placeholder="600" />
        <FormInput label="I máx por MPPT (A)" value={String(form.mpptMaxInputA ?? "")} onChange={(v) => setNum(["form", "mpptMaxInputA"], v)} onBlurNormalize={(v) => setNum(["form", "mpptMaxInputA"], v)} inputMode="decimal" placeholder="16" />
        <FormInput label="# MPPT" value={String(form.numMppt ?? "")} onChange={(v) => setInt1(["form", "numMppt"], v)} onBlurNormalize={(v) => setInt1(["form", "numMppt"], v)} inputMode="numeric" placeholder="2" />
      </div>

      <div className="grid3" style={{ marginTop: 10, minWidth: 0 }}>
        <FormSelect
          label="Fase AC"
          value={acPhase}
          onChange={(v) => setDeep(["form", "acPhase"], v)}
          options={[
            { value: "1P", label: "1F (1P)" },
            { value: "3P", label: "3F (3P)" },
          ]}
        />
        <FormInput
          label="Voltaje AC (V)"
          value={String(form.acVoltageV ?? "")}
          onChange={(v) => setNum(["form", "acVoltageV"], v)}
          onBlurNormalize={(v) => setNum(["form", "acVoltageV"], v)}
          inputMode="numeric"
          placeholder={acPhase === "3P" ? "220/380" : "220"}
          hint="Pon el valor real que use tu cálculo."
        />
        <FormInput
          label="Eficiencia inversor (0..1)"
          value={String(form.inverterEff ?? "")}
          onChange={(v) => setNum(["form", "inverterEff"], v)}
          onBlurNormalize={(v) => setNum(["form", "inverterEff"], v)}
          inputMode="decimal"
          placeholder="0.98"
        />
      </div>

      {/* ====== DISTANCIAS ====== */}
      <h3 className="section">Distancias (1 vía)</h3>
      <div className="note" style={{ marginTop: 8 }}>
        <b>Tip:</b> Usa distancias de <b>una vía</b> (ida). El motor normalmente multiplica por 2 (ida y vuelta) para DC.
      </div>

      <div className="grid3" style={{ marginTop: 10, minWidth: 0 }}>
        <FormInput
          label="String → Combiner (m)"
          value={String(form.L_stringToCombiner_1w ?? "")}
          onChange={(v) => setNum(["form", "L_stringToCombiner_1w"], v)}
          onBlurNormalize={(v) => setNum(["form", "L_stringToCombiner_1w"], v)}
          inputMode="decimal"
          placeholder="15"
        />
        <FormInput
          label="Combiner → Inversor (m)"
          value={String(form.L_combinerToInverter_1w ?? "")}
          onChange={(v) => setNum(["form", "L_combinerToInverter_1w"], v)}
          onBlurNormalize={(v) => setNum(["form", "L_combinerToInverter_1w"], v)}
          inputMode="decimal"
          placeholder="30"
        />
        <FormInput
          label="Inversor → Tablero AC (m)"
          value={String(form.L_inverterToACPanel_1w ?? "")}
          onChange={(v) => setNum(["form", "L_inverterToACPanel_1w"], v)}
          onBlurNormalize={(v) => setNum(["form", "L_inverterToACPanel_1w"], v)}
          inputMode="decimal"
          placeholder="20"
        />
      </div>

      {/* ====== LÍMITES CAÍDA ====== */}
      <h3 className="section">Límites de caída de tensión</h3>
      <div className="grid3" style={{ minWidth: 0 }}>
        <FormInput
          label="ΔV DC string (%)"
          value={String(form.maxDropDC_string ?? "")}
          onChange={(v) => setNum(["form", "maxDropDC_string"], v)}
          onBlurNormalize={(v) => setNum(["form", "maxDropDC_string"], v)}
          inputMode="decimal"
          placeholder="1.5"
        />
        <FormInput
          label="ΔV DC principal (%)"
          value={String(form.maxDropDC_main ?? "")}
          onChange={(v) => setNum(["form", "maxDropDC_main"], v)}
          onBlurNormalize={(v) => setNum(["form", "maxDropDC_main"], v)}
          inputMode="decimal"
          placeholder="1.5"
        />
        <FormInput
          label="ΔV AC por tramo (%)"
          value={String(form.maxDropAC_seg ?? "")}
          onChange={(v) => setNum(["form", "maxDropAC_seg"], v)}
          onBlurNormalize={(v) => setNum(["form", "maxDropAC_seg"], v)}
          inputMode="decimal"
          placeholder="3"
        />
      </div>

      {/* ====== BATERÍA ====== */}
      <h3 className="section">Batería (ingeniero)</h3>
      <div className="note" style={{ marginTop: 8 }}>
        <b>Nota:</b> Es normal que la batería “Ingeniero” salga un poco mayor que “Amateur” (ej. 6.9 vs 7.6 kWh) porque aquí aplicas
        eficiencia/DoD/reserva de forma explícita. Para propuesta conservadora, deja <b>reserva 10%</b> y <b>roundtrip 0.92</b>.
      </div>

      <div className="row" style={{ marginTop: 10, gap: 12, flexWrap: "wrap", alignItems: "center", minWidth: 0 }}>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={Boolean(form.wantBattery)} onChange={(e) => setWantBattery(e.target.checked)} />
          Incluir batería
        </label>

        <div className="muted" style={{ minWidth: 0 }}>
          batteryId: <b>{String(form.batteryId || "bat_none")}</b>
        </div>
      </div>

      <div className="grid3" style={{ marginTop: 10, minWidth: 0, opacity: form.wantBattery ? 1 : 0.55, pointerEvents: form.wantBattery ? "auto" : "none" }}>
        <FormInput
          label="Autonomía (horas)"
          value={String(form.autonomyHours ?? "")}
          onChange={(v) => {
            setNum(["form", "autonomyHours"], v);
            const h = num(v);
            if (h > 0) setNum(["form", "autonomyDays"], round2(h / 24));
          }}
          onBlurNormalize={(v) => {
            const h = num(v);
            setNum(["form", "autonomyHours"], h);
            if (h > 0) setNum(["form", "autonomyDays"], round2(h / 24));
          }}
          inputMode="decimal"
          placeholder="6"
          hint="Si pones horas, también se calcula días."
        />
        <FormInput
          label="Autonomía (días)"
          value={String(form.autonomyDays ?? "")}
          onChange={(v) => {
            setNum(["form", "autonomyDays"], v);
            const d = num(v);
            if (d > 0) setNum(["form", "autonomyHours"], round2(d * 24));
          }}
          onBlurNormalize={(v) => {
            const d = num(v);
            setNum(["form", "autonomyDays"], d);
            if (d > 0) setNum(["form", "autonomyHours"], round2(d * 24));
          }}
          inputMode="decimal"
          placeholder="0.25"
          hint="0.25 días = 6 horas."
        />
        <FormInput label="Voltaje sistema (V)" value={String(form.systemVoltage ?? "")} onChange={(v) => setNum(["form", "systemVoltage"], v)} onBlurNormalize={(v) => setNum(["form", "systemVoltage"], v)} inputMode="numeric" placeholder="48" />
      </div>

      <div className="grid3" style={{ marginTop: 10, minWidth: 0, opacity: form.wantBattery ? 1 : 0.55, pointerEvents: form.wantBattery ? "auto" : "none" }}>
        <FormInput label="DoD (0..1)" value={String(form.dod ?? "")} onChange={(v) => setNum(["form", "dod"], v)} onBlurNormalize={(v) => setNum(["form", "dod"], v)} inputMode="decimal" placeholder="0.8" hint="Profundidad de descarga útil." />
        <FormInput
          label="Eficiencia roundtrip (0..1)"
          value={String(form.batteryRoundtripEff ?? "")}
          onChange={(v) => setNum(["form", "batteryRoundtripEff"], v)}
          onBlurNormalize={(v) => setNum(["form", "batteryRoundtripEff"], v)}
          inputMode="decimal"
          placeholder="0.92"
          hint="Incluye pérdidas carga/descarga."
        />
        <FormInput
          label="Reserva (0..1)"
          value={String(form.reserveFraction ?? "")}
          onChange={(v) => setNum(["form", "reserveFraction"], v)}
          onBlurNormalize={(v) => setNum(["form", "reserveFraction"], v)}
          inputMode="decimal"
          placeholder="0.10"
          hint="Ej: 0.10 = 10% de reserva (conservador)."
        />
      </div>

      <div className="grid3" style={{ marginTop: 10, minWidth: 0, opacity: form.wantBattery ? 1 : 0.55, pointerEvents: form.wantBattery ? "auto" : "none" }}>
        <FormInput
          label="Carga crítica (kW) (opcional)"
          value={String(form.criticalLoadKW ?? "")}
          onChange={(v) => setNum(["form", "criticalLoadKW"], v)}
          onBlurNormalize={(v) => setNum(["form", "criticalLoadKW"], v)}
          inputMode="decimal"
          placeholder="0"
          hint="Si solo respaldarás cargas esenciales."
        />
        <FormInput label="ID batería" value={String(form.batteryId ?? "")} onChange={(v) => setDeep(["form", "batteryId"], String(v || "").trim())} placeholder="bat_48v_generic" hint="Si no sabes, deja el default." />
        <div className="note" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, minWidth: 0 }}>
          <div style={{ minWidth: 0 }}>
            <b>Tip</b>
            <div className="muted" style={{ marginTop: 4 }}>Si quieres que se parezca más a Amateur, baja la reserva (0) o usa eff 0.90.</div>
          </div>
          <button type="button" className="btn" onClick={applyConservativePreset}>
            Conservador
          </button>
        </div>
      </div>

      {/* ====== FINANZAS ====== */}
      <h3 className="section">Finanzas (PRO)</h3>
      <div className="note" style={{ marginTop: 8 }}>
        <b>Tip:</b> estos supuestos alimentan VPN/TIR/Payback/ROI/LCOE.
      </div>

      <div className="grid3" style={{ marginTop: 10, minWidth: 0 }}>
        <FormInput label="Años de análisis" value={String(finance.analysisYears ?? "")} onChange={(v) => setFinanceNum("analysisYears", v)} onBlurNormalize={(v) => setFinanceNum("analysisYears", v)} inputMode="numeric" placeholder="25" />
        <FormInput
          label="Tasa de descuento (0..1)"
          value={String(finance.discountRate ?? "")}
          onChange={(v) => setFinanceNum("discountRate", v)}
          onBlurNormalize={(v) => setFinanceNum("discountRate", v)}
          inputMode="decimal"
          placeholder="0.12"
          hint="Ej: 0.12 = 12%"
        />
        <FormInput
          label="Degradación FV anual (0..1)"
          value={String(finance.degradationPct ?? "")}
          onChange={(v) => setFinanceNum("degradationPct", v)}
          onBlurNormalize={(v) => setFinanceNum("degradationPct", v)}
          inputMode="decimal"
          placeholder="0.005"
          hint="Ej: 0.005 = 0.5%"
        />
      </div>

      <div className="grid3" style={{ marginTop: 10, minWidth: 0 }}>
        <FormInput
          label="Escalación tarifa anual (0..1)"
          value={String(finance.tariffEscalationPct ?? "")}
          onChange={(v) => setFinanceNum("tariffEscalationPct", v)}
          onBlurNormalize={(v) => setFinanceNum("tariffEscalationPct", v)}
          inputMode="decimal"
          placeholder="0.06"
          hint="Ej: 0.06 = 6%"
        />
        <FormInput label="Autoconsumo (0..1)" value={String(finance.selfConsumptionRatio ?? "")} onChange={(v) => setFinanceNum("selfConsumptionRatio", v)} onBlurNormalize={(v) => setFinanceNum("selfConsumptionRatio", v)} inputMode="decimal" placeholder="0.85" />
        <FormInput
          label="Precio excedentes (COP/kWh)"
          value={String(finance.exportPriceCOPkWh ?? "")}
          onChange={(v) => setFinanceNum("exportPriceCOPkWh", v)}
          onBlurNormalize={(v) => setFinanceNum("exportPriceCOPkWh", v)}
          inputMode="numeric"
          placeholder="0"
          hint="Si no vendes excedentes, 0"
        />
      </div>

      <div className="grid3" style={{ marginTop: 10, minWidth: 0 }}>
        <FormInput label="O&M (% CAPEX/año) (0..1)" value={String(finance.omPctPerYear ?? "")} onChange={(v) => setFinanceNum("omPctPerYear", v)} onBlurNormalize={(v) => setFinanceNum("omPctPerYear", v)} inputMode="decimal" placeholder="0.015" />
        <FormInput label="Escalación O&M anual (0..1)" value={String(finance.omEscalationPct ?? "")} onChange={(v) => setFinanceNum("omEscalationPct", v)} onBlurNormalize={(v) => setFinanceNum("omEscalationPct", v)} inputMode="decimal" placeholder="0.04" />
        <FormInput label="Reemplazo inversor (año)" value={String(finance.inverterReplaceYear ?? "")} onChange={(v) => setFinanceNum("inverterReplaceYear", v)} onBlurNormalize={(v) => setFinanceNum("inverterReplaceYear", v)} inputMode="numeric" placeholder="12" />
      </div>

      <div className="grid3" style={{ marginTop: 10, minWidth: 0 }}>
        <FormInput
          label="% costo inversor a reemplazar (0..1)"
          value={String(finance.inverterReplacePctOfInverterCost ?? "")}
          onChange={(v) => setFinanceNum("inverterReplacePctOfInverterCost", v)}
          onBlurNormalize={(v) => setFinanceNum("inverterReplacePctOfInverterCost", v)}
          inputMode="decimal"
          placeholder="0.7"
        />
        <FormInput label="Contingencia (0..1)" value={String(finance.contingencyPct ?? "")} onChange={(v) => setFinanceNum("contingencyPct", v)} onBlurNormalize={(v) => setFinanceNum("contingencyPct", v)} inputMode="decimal" placeholder="0.07" />
        <FormInput label="Permisos (COP)" value={String(finance.permitsCOP ?? "")} onChange={(v) => setFinanceNum("permitsCOP", v)} onBlurNormalize={(v) => setFinanceNum("permitsCOP", v)} inputMode="numeric" placeholder="800000" />
      </div>

      <div className="grid3" style={{ marginTop: 10, minWidth: 0 }}>
        <FormInput label="Instalación (% CAPEX) (0..1)" value={String(finance.installPct ?? "")} onChange={(v) => setFinanceNum("installPct", v)} onBlurNormalize={(v) => setFinanceNum("installPct", v)} inputMode="decimal" placeholder="0.10" />
        <FormInput label="Ingeniería (% CAPEX) (0..1)" value={String(finance.engineeringPct ?? "")} onChange={(v) => setFinanceNum("engineeringPct", v)} onBlurNormalize={(v) => setFinanceNum("engineeringPct", v)} inputMode="decimal" placeholder="0.03" />
        <FormInput label="Margen (% CAPEX) (0..1)" value={String(finance.marginPct ?? "")} onChange={(v) => setFinanceNum("marginPct", v)} onBlurNormalize={(v) => setFinanceNum("marginPct", v)} inputMode="decimal" placeholder="0" hint="Si es para venta/propuesta" />
      </div>

      <div className="grid3" style={{ marginTop: 10, minWidth: 0 }}>
        <FormInput label="Seguro anual (COP/año) (opcional)" value={String(finance.insuranceCOPperYear ?? "")} onChange={(v) => setFinanceNum("insuranceCOPperYear", v)} onBlurNormalize={(v) => setFinanceNum("insuranceCOPperYear", v)} inputMode="numeric" placeholder="0" />
        <FormInput label="Limpieza anual (COP/año) (opcional)" value={String(finance.cleaningCOPperYear ?? "")} onChange={(v) => setFinanceNum("cleaningCOPperYear", v)} onBlurNormalize={(v) => setFinanceNum("cleaningCOPperYear", v)} inputMode="numeric" placeholder="0" />
        <div className="note" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, minWidth: 0 }}>
          <div style={{ minWidth: 0 }}>
            <b>Acciones</b>
            <div className="muted" style={{ marginTop: 4 }}>Restaurar rápidamente supuestos base.</div>
          </div>
          <button type="button" className="btn" onClick={handleResetFinance}>
            Restaurar
          </button>
        </div>
      </div>

      {/* ====== PRICING ====== */}
      <h3 className="section">Precios (Pricing PRO)</h3>
      <div className="note" style={{ marginTop: 8 }}>
        Estos costos alimentan el <b>CAPEX</b>. Puedes dejarlos en blanco y el motor aplica defaults.
      </div>

      <div className="grid3" style={{ marginTop: 10, minWidth: 0 }}>
        <FormInput label="Panel: COP por Wp" value={String(pricing.panel_watt_price ?? "")} onChange={(v) => setPricingNum("panel_watt_price", v)} onBlurNormalize={(v) => setPricingNum("panel_watt_price", v)} inputMode="decimal" placeholder="1.35" />
        <FormInput label="Inversor: COP por kWac" value={String(pricing.inverter_kwac_price ?? "")} onChange={(v) => setPricingNum("inverter_kwac_price", v)} onBlurNormalize={(v) => setPricingNum("inverter_kwac_price", v)} inputMode="numeric" placeholder="1450000" />
        <FormInput label="Estructura por panel (COP)" value={String(pricing.structure_per_panel ?? "")} onChange={(v) => setPricingNum("structure_per_panel", v)} onBlurNormalize={(v) => setPricingNum("structure_per_panel", v)} inputMode="numeric" placeholder="120000" />
      </div>

      <div className="grid3" style={{ marginTop: 10, minWidth: 0 }}>
        <FormInput label="Protección DC por string (COP)" value={String(pricing.dc_protections_per_string ?? "")} onChange={(v) => setPricingNum("dc_protections_per_string", v)} onBlurNormalize={(v) => setPricingNum("dc_protections_per_string", v)} inputMode="numeric" placeholder="90000" />
        <FormInput label="SPD DC (COP)" value={String(pricing.spd_dc ?? "")} onChange={(v) => setPricingNum("spd_dc", v)} onBlurNormalize={(v) => setPricingNum("spd_dc", v)} inputMode="numeric" placeholder="240000" />
        <FormInput label="SPD AC (COP)" value={String(pricing.spd_ac ?? "")} onChange={(v) => setPricingNum("spd_ac", v)} onBlurNormalize={(v) => setPricingNum("spd_ac", v)} inputMode="numeric" placeholder="260000" />
      </div>

      <div className="grid3" style={{ marginTop: 10, minWidth: 0 }}>
        <FormInput label="Breaker AC base (COP)" value={String(pricing.ac_breaker_base ?? "")} onChange={(v) => setPricingNum("ac_breaker_base", v)} onBlurNormalize={(v) => setPricingNum("ac_breaker_base", v)} inputMode="numeric" placeholder="180000" />
        <FormInput label="Seccionador DC (COP)" value={String(pricing.dc_switch ?? "")} onChange={(v) => setPricingNum("dc_switch", v)} onBlurNormalize={(v) => setPricingNum("dc_switch", v)} inputMode="numeric" placeholder="220000" />
        <FormInput label="Batería: COP por kWh" value={String(pricing.battery_kwh_price ?? "")} onChange={(v) => setPricingNum("battery_kwh_price", v)} onBlurNormalize={(v) => setPricingNum("battery_kwh_price", v)} inputMode="numeric" placeholder="1650000" hint="Usado en CAPEX cuando hay batería." />
      </div>

      <div className="grid3" style={{ marginTop: 10, minWidth: 0 }}>
        <FormInput label="Cable DC (COP/m)" value={String(pricing.cable_dc_m ?? "")} onChange={(v) => setPricingNum("cable_dc_m", v)} onBlurNormalize={(v) => setPricingNum("cable_dc_m", v)} inputMode="numeric" placeholder="18000" />
        <FormInput label="Cable AC (COP/m)" value={String(pricing.cable_ac_m ?? "")} onChange={(v) => setPricingNum("cable_ac_m", v)} onBlurNormalize={(v) => setPricingNum("cable_ac_m", v)} inputMode="numeric" placeholder="22000" />
        <FormInput label="Canalización (COP/m)" value={String(pricing.conduit_m ?? "")} onChange={(v) => setPricingNum("conduit_m", v)} onBlurNormalize={(v) => setPricingNum("conduit_m", v)} inputMode="numeric" placeholder="9000" />
      </div>

      <div className="grid3" style={{ marginTop: 10, minWidth: 0 }}>
        <FormInput
          label="BOS batería (0..1) (opcional)"
          value={String(pricing.battery_bos_pct ?? "")}
          onChange={(v) => setPricingNum("battery_bos_pct", v)}
          onBlurNormalize={(v) => setPricingNum("battery_bos_pct", v)}
          inputMode="decimal"
          placeholder="0"
          hint="Ej: 0.10 = +10% sobre baterías (BMS/rack/protección)."
        />
        <div className="note" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, minWidth: 0 }}>
          <div style={{ minWidth: 0 }}>
            <b>Acciones</b>
            <div className="muted" style={{ marginTop: 4 }}>Restaurar defaults de precios.</div>
          </div>
          <button type="button" className="btn" onClick={handleResetPricing}>
            Restaurar
          </button>
        </div>
        <div className="note" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, minWidth: 0 }}>
          <div style={{ minWidth: 0 }}>
            <b>Acción total</b>
            <div className="muted" style={{ marginTop: 4 }}>Restaura finanzas + precios.</div>
          </div>
          <button type="button" className="btn" onClick={handleResetAllEconomic}>
            Restaurar TODO
          </button>
        </div>
      </div>

      {/* ====== EQUIPO PERSONALIZADO ====== */}
      <h3 className="section">Equipo personalizado (marca/modelo) + guardar</h3>
      <div className="grid2" style={{ minWidth: 0 }}>
        <div className="note" style={{ minWidth: 0 }}>
          <b>Panel (custom)</b>
          <div className="grid2" style={{ marginTop: 8, minWidth: 0 }}>
            <FormInput label="Marca" value={custom?.panelCustom?.brand || ""} onChange={(v) => setCustom((p) => ({ ...(p || {}), panelCustom: { ...(p?.panelCustom || {}), brand: v } }))} placeholder="Ej: JA Solar" />
            <FormInput label="Modelo" value={custom?.panelCustom?.model || ""} onChange={(v) => setCustom((p) => ({ ...(p || {}), panelCustom: { ...(p?.panelCustom || {}), model: v } }))} placeholder="Ej: JAM72D30 550W" />
          </div>
        </div>

        <div className="note" style={{ minWidth: 0 }}>
          <b>Inversor (custom)</b>
          <div className="grid2" style={{ marginTop: 8, minWidth: 0 }}>
            <FormInput label="Marca" value={custom?.inverterCustom?.brand || ""} onChange={(v) => setCustom((p) => ({ ...(p || {}), inverterCustom: { ...(p?.inverterCustom || {}), brand: v } }))} placeholder="Ej: Huawei" />
            <FormInput label="Modelo" value={custom?.inverterCustom?.model || ""} onChange={(v) => setCustom((p) => ({ ...(p || {}), inverterCustom: { ...(p?.inverterCustom || {}), model: v } }))} placeholder="Ej: SUN2000-5KTL-L1" />
          </div>
        </div>
      </div>

      <div className="row" style={{ gap: 10, marginTop: 10, flexWrap: "wrap", justifyContent: "flex-end", minWidth: 0 }}>
        <button type="button" className="btn" onClick={handleApplyCustomOnly}>
          Aplicar al preset
        </button>
        <button type="button" className="btn" onClick={handleClearCustom}>
          Borrar guardado
        </button>
        <button type="button" className="btnPrimary" onClick={handleSaveCustom}>
          Guardar equipo (local)
        </button>
      </div>

      {/* ====== EQUIPMENT PICKER ====== */}
      <EquipmentPicker
        clientMode={m.clientMode || "RES"}
        country={loc.country || "Colombia"}
        acVoltageV={form.acVoltageV}
        value={{
          // ✅ compat + normalización
          panelId: form.panelId ?? form.selectedPanelId,
          inverterId: form.inverterId ?? form.selectedInverterId,
        }}
        onApply={(patch) => {
          setModel((prev) => {
            const merged = deepMergePreset(prev, patch);
            const normalized = normalizeEngineerPreset(merged);
            const next = ensureDefaults(applyCustomToModel(normalized, custom));
            setText(JSON.stringify(next, null, 2));
            return next;
          });
          setInfo("✅ Equipos aplicados al preset (puedes ajustar manualmente si quieres).");
        }}
      />

      {/* ====== ACCIONES FINALES ====== */}
      <div className="row" style={{ gap: 10, marginTop: 14, flexWrap: "wrap", justifyContent: "space-between", minWidth: 0 }}>
        <button type="button" className="btn" onClick={handleResetAll} title="Restaurar todo a valores base Engineer">
          Reset TODO
        </button>
        <button type="button" className="btnPrimary" onClick={handleRun}>
          Calcular Ingeniero
        </button>
      </div>

      {/* ====== AVANZADO (JSON) ====== */}
      {showAdvanced ? (
        <>
          <h3 className="section">Avanzado (JSON)</h3>
          <div className="note" style={{ marginBottom: 10 }}>
            Esto es opcional. Si no quieres ver “código”, déjalo cerrado.
          </div>

          <div className="row" style={{ gap: 10, flexWrap: "wrap", minWidth: 0 }}>
            <button type="button" className="btn" onClick={handlePrettify}>
              Formatear
            </button>
            <button type="button" className="btnPrimary" onClick={handleRunFromJson}>
              Calcular desde JSON
            </button>
          </div>

          <div className="codeCard" style={{ marginTop: 12, maxWidth: "100%", minWidth: 0 }}>
            <textarea className="codeArea" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
          </div>
        </>
      ) : null}
    </div>
  );
}

/* ======================= UI helpers ======================= */
function FormInput({ label, hint, value, onChange, onBlurNormalize, placeholder, inputMode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <label>{label}</label>
      <input
        type="text"
        value={value ?? ""}
        onChange={(e) => onChange?.(e.target.value)}
        onBlur={(e) => onBlurNormalize?.(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
      />
      {hint ? <small>{hint}</small> : null}
    </div>
  );
}

function FormSelect({ label, value, onChange, options }) {
  return (
    <div style={{ minWidth: 0 }}>
      <label>{label}</label>
      <select className="select" value={value} onChange={(e) => onChange?.(e.target.value)}>
        {options.map((op) => (
          <option key={op.value} value={op.value}>
            {op.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/* ======================= utils ======================= */
function safeKey(x) {
  try {
    return JSON.stringify(x || {});
  } catch {
    return String(Date.now());
  }
}

function clone(x) {
  if (typeof structuredClone === "function") return structuredClone(x);
  return JSON.parse(JSON.stringify(x ?? {}));
}

function num(x) {
  const s = String(x ?? "").trim().replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function isFiniteNum(x) {
  const s = String(x ?? "").trim().replace(",", ".");
  if (s === "") return false;
  const n = Number(s);
  return Number.isFinite(n);
}

function numOrEmpty(x) {
  const s = String(x ?? "").trim().replace(",", ".");
  if (s === "") return "";
  const n = Number(s);
  return Number.isFinite(n) ? n : "";
}

function round2(n) {
  const v = num(n);
  return Math.round(v * 100) / 100;
}

function defaultFinance() {
  return {
    analysisYears: 25,
    discountRate: 0.12,
    degradationPct: 0.005,
    tariffEscalationPct: 0.06,
    omPctPerYear: 0.015,
    omEscalationPct: 0.04,
    selfConsumptionRatio: 0.85,
    exportPriceCOPkWh: 0,
    inverterReplaceYear: 12,
    inverterReplacePctOfInverterCost: 0.7,
    contingencyPct: 0.07,
    installPct: 0.10,
    engineeringPct: 0.03,
    permitsCOP: 800000,
    insuranceCOPperYear: 0,
    cleaningCOPperYear: 0,
    taxPct: 0,
    marginPct: 0,
  };
}

function defaultPricing() {
  return {
    panel_watt_price: 1.35,
    inverter_kwac_price: 1450000,
    structure_per_panel: 120000,
    dc_protections_per_string: 90000,
    spd_dc: 240000,
    spd_ac: 260000,
    ac_breaker_base: 180000,
    dc_switch: 220000,
    cable_dc_m: 18000,
    cable_ac_m: 22000,
    conduit_m: 9000,
    battery_kwh_price: 1650000,
    // opcional
    battery_bos_pct: "",
  };
}

function ensureDefaults(preset) {
  const next = clone(preset || {});
  if (!next.project || typeof next.project !== "object") next.project = { name: "", company: "" };
  if (!next.loc || typeof next.loc !== "object") next.loc = { country: "", city: "", psh: 0 };
  if (!next.bill || typeof next.bill !== "object") next.bill = { billingKWh: 0, billingDays: 30, tariffCOPkWh: 0, daytimeRatio: 0.85, zeroExport: false };
  if (!next.form || typeof next.form !== "object") next.form = {};

  // ✅ finanzas
  if (!next.form.finance || typeof next.form.finance !== "object") next.form.finance = {};
  const df = defaultFinance();
  Object.keys(df).forEach((k) => {
    const v = next.form.finance[k];
    const ok = v !== undefined && v !== null && !(typeof v === "string" && v.trim() === "");
    if (!ok) next.form.finance[k] = df[k];
  });

  // ✅ pricing
  if (!next.form.pricing || typeof next.form.pricing !== "object") next.form.pricing = {};
  const dp = defaultPricing();
  Object.keys(dp).forEach((k) => {
    const v = next.form.pricing[k];
    const ok = v !== undefined && v !== null && !(typeof v === "string" && v.trim() === "");
    if (!ok) next.form.pricing[k] = dp[k];
  });

  // ✅ defaults técnicos (ANTI-CRASH)
  if (next.clientMode !== "RES" && next.clientMode !== "CI") next.clientMode = "RES";

  if (next.form.peakSunHours === undefined || next.form.peakSunHours === null) next.form.peakSunHours = num(next.loc?.psh) || 4.8;
  if (next.form.dailyConsumption === undefined || next.form.dailyConsumption === null) next.form.dailyConsumption = 0;
  if (next.form.systemLosses === undefined || next.form.systemLosses === null) next.form.systemLosses = 0.2;

  if (!next.form.conductorMaterial) next.form.conductorMaterial = "Cu";
  if (next.form.inverterEff === undefined || next.form.inverterEff === null) next.form.inverterEff = 0.98;

  // área
  if (typeof next.form.limitedByArea !== "boolean") next.form.limitedByArea = false;
  if (next.form.areaM2 === undefined || next.form.areaM2 === null) next.form.areaM2 = 0;
  if (next.form.panelAreaM2 === undefined || next.form.panelAreaM2 === null) next.form.panelAreaM2 = 2.6;
  if (next.form.packingFactor === undefined || next.form.packingFactor === null) next.form.packingFactor = 0.85;

  // ids equipo
  if (!next.form.panelId) next.form.panelId = next.form.selectedPanelId || "p550_std";
  if (!next.form.inverterId) next.form.inverterId = next.form.selectedInverterId || "inv_res_5k_2mppt_600v";
  next.form.selectedPanelId = next.form.panelId;
  next.form.selectedInverterId = next.form.inverterId;

  // panel params
  if (next.form.panelPower === undefined || next.form.panelPower === null) next.form.panelPower = 550;
  if (next.form.vmp === undefined || next.form.vmp === null) next.form.vmp = 41.5;
  if (next.form.voc === undefined || next.form.voc === null) next.form.voc = 49.5;
  if (next.form.imp === undefined || next.form.imp === null) next.form.imp = 13.25;
  if (next.form.isc === undefined || next.form.isc === null) next.form.isc = 13.9;
  if (next.form.vocTempCoeffPctPerC === undefined || next.form.vocTempCoeffPctPerC === null) next.form.vocTempCoeffPctPerC = -0.28;
  if (next.form.tMinC === undefined || next.form.tMinC === null) next.form.tMinC = 0;

  // inversor params
  if (next.form.acKw === undefined || next.form.acKw === null) next.form.acKw = 0;
  if (next.form.mpptVmin === undefined || next.form.mpptVmin === null) next.form.mpptVmin = 120;
  if (next.form.mpptVmax === undefined || next.form.mpptVmax === null) next.form.mpptVmax = 500;
  if (next.form.dcMaxV === undefined || next.form.dcMaxV === null) next.form.dcMaxV = 600;
  if (next.form.mpptMaxInputA === undefined || next.form.mpptMaxInputA === null) next.form.mpptMaxInputA = 16;
  if (next.form.numMppt === undefined || next.form.numMppt === null) next.form.numMppt = 2;

  if (!next.form.acPhase) next.form.acPhase = next.clientMode === "CI" ? "3P" : "1P";
  if (next.form.acVoltageV === undefined || next.form.acVoltageV === null) next.form.acVoltageV = 220;

  // export
  if (next.form.exportRatio === undefined || next.form.exportRatio === null) next.form.exportRatio = 0;
  if (next.form.exportKW === undefined || next.form.exportKW === null) next.form.exportKW = 0;
  if (next.form.selfConsumptionRatio === undefined || next.form.selfConsumptionRatio === null) next.form.selfConsumptionRatio = 0.85;

  // distancias
  if (next.form.L_stringToCombiner_1w === undefined || next.form.L_stringToCombiner_1w === null) next.form.L_stringToCombiner_1w = 15;
  if (next.form.L_combinerToInverter_1w === undefined || next.form.L_combinerToInverter_1w === null) next.form.L_combinerToInverter_1w = 30;
  if (next.form.L_inverterToACPanel_1w === undefined || next.form.L_inverterToACPanel_1w === null) next.form.L_inverterToACPanel_1w = 20;

  // límites caída
  if (next.form.maxDropDC_string === undefined || next.form.maxDropDC_string === null) next.form.maxDropDC_string = 1.5;
  if (next.form.maxDropDC_main === undefined || next.form.maxDropDC_main === null) next.form.maxDropDC_main = 1.5;
  if (next.form.maxDropAC_seg === undefined || next.form.maxDropAC_seg === null) next.form.maxDropAC_seg = 3;

  // ✅ defaults mínimos para batería (para que sizing.js no “ignore”)
  if (typeof next.form.wantBattery !== "boolean") next.form.wantBattery = false;

  // ✅ alinear aliases siempre
  next.form.useBattery = Boolean(next.form.wantBattery);
  next.form.hasBattery = Boolean(next.form.wantBattery);

  if (!next.form.batteryId || typeof next.form.batteryId !== "string") next.form.batteryId = next.form.wantBattery ? "bat_48v_generic" : "bat_none";
  if (!next.form.wantBattery) next.form.batteryId = "bat_none";

  if (next.form.autonomyDays === undefined || next.form.autonomyDays === null) next.form.autonomyDays = 0;
  if (next.form.autonomyHours === undefined || next.form.autonomyHours === null) next.form.autonomyHours = 0;
  if (next.form.systemVoltage === undefined || next.form.systemVoltage === null) next.form.systemVoltage = 48;
  if (next.form.dod === undefined || next.form.dod === null) next.form.dod = 0.8;
  if (next.form.batteryRoundtripEff === undefined || next.form.batteryRoundtripEff === null) next.form.batteryRoundtripEff = 0.92;
  if (next.form.reserveFraction === undefined || next.form.reserveFraction === null) next.form.reserveFraction = 0.1;
  if (next.form.criticalLoadKW === undefined || next.form.criticalLoadKW === null) next.form.criticalLoadKW = 0;

  // custom strings
  if (next.form.customPanelBrand === undefined || next.form.customPanelBrand === null) next.form.customPanelBrand = "";
  if (next.form.customPanelModel === undefined || next.form.customPanelModel === null) next.form.customPanelModel = "";
  if (next.form.customInverterBrand === undefined || next.form.customInverterBrand === null) next.form.customInverterBrand = "";
  if (next.form.customInverterModel === undefined || next.form.customInverterModel === null) next.form.customInverterModel = "";

  return next;
}

function deepMergePreset(base, patch) {
  if (!patch || typeof patch !== "object") return base;
  const out = clone(base || {});
  mergeInto(out, patch);
  return out;

  function mergeInto(target, src) {
    if (!src || typeof src !== "object") return;
    Object.keys(src).forEach((k) => {
      const sv = src[k];
      const tv = target[k];

      if (Array.isArray(sv)) {
        target[k] = sv.slice();
        return;
      }
      if (sv && typeof sv === "object") {
        if (!tv || typeof tv !== "object" || Array.isArray(tv)) target[k] = {};
        mergeInto(target[k], sv);
        return;
      }
      target[k] = sv;
    });
  }
}

function makeEmptyPreset() {
  return ensureDefaults({
    project: { name: "ENRGY ONE • Solar Designer", company: "—" },
    loc: { country: "Colombia", city: "Cali", psh: 4.8 },
    clientMode: "RES",
    bill: { billingKWh: 0, billingDays: 30, tariffCOPkWh: 900, daytimeRatio: 0.85, zeroExport: false },
    form: {
      dailyConsumption: 0,
      systemLosses: 0.2,
      peakSunHours: 4.8,

      finance: defaultFinance(),
      pricing: defaultPricing(),

      // área
      limitedByArea: false,
      areaM2: 0,
      panelAreaM2: 2.6,
      packingFactor: 0.85,

      // ✅ ids normalizados (y alias)
      panelId: "p550_std",
      inverterId: "inv_res_5k_2mppt_600v",
      selectedPanelId: "p550_std",
      selectedInverterId: "inv_res_5k_2mppt_600v",

      // batería (defaults)
      batteryId: "bat_none",
      wantBattery: false,
      useBattery: false,
      hasBattery: false,
      autonomyDays: 0,
      autonomyHours: 0,
      systemVoltage: 48,
      dod: 0.8,
      batteryRoundtripEff: 0.92,
      reserveFraction: 0.1,
      criticalLoadKW: 0,

      customPanelBrand: "",
      customPanelModel: "",
      customInverterBrand: "",
      customInverterModel: "",

      // panel
      panelPower: 550,
      vmp: 41.5,
      voc: 49.5,
      imp: 13.25,
      isc: 13.9,

      vocTempCoeffPctPerC: -0.28,
      tMinC: 0,

      // inversor
      acKw: 0,
      mpptVmin: 120,
      mpptVmax: 500,
      dcMaxV: 600,
      mpptMaxInputA: 16,
      numMppt: 2,
      inverterEff: 0.98,

      acPhase: "1P",
      acVoltageV: 220,

      exportRatio: 0,
      exportKW: 0,
      selfConsumptionRatio: 0.85,

      conductorMaterial: "Cu",

      // distancias
      L_stringToCombiner_1w: 15,
      L_combinerToInverter_1w: 30,
      L_inverterToACPanel_1w: 20,

      // límites caída
      maxDropDC_string: 1.5,
      maxDropDC_main: 1.5,
      maxDropAC_seg: 3,
    },
  });
}