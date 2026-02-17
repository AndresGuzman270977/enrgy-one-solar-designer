// src/App.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import AmateurForm from "./components/AmateurForm";
import EngineerForm from "./components/EngineerForm";
import Results from "./components/Results";
import { makeEmptyAppData } from "./utils/models";
import { runEngineerSizing } from "./engine/sizing";
import { saveAppState, loadAppState, clearAppState } from "./utils/storage";

// ✅ Toggle idioma (debe cambiar el lang en I18nProvider)
import LangToggle from "./components/LangToggle";

// ✅ i18n real
import { useI18n } from "./i18n/I18nProvider";

// ✅ Finanzas (fallback) — SOLO para Ingeniero
import { computeCosting, computeFinance } from "./engine/financeEngine";

export default function App() {
  const empty = useMemo(() => makeEmptyAppData(), []);

  // ========= i18n =========
  const { t, lang } = useI18n();
  const TT = (key, fallback = "") => t(key, fallback || key);

  // UI mode (lo que se ve)
  const [mode, setMode] = useState("AMATEUR"); // AMATEUR | ENGINEER

  // ✅ Estado persistente del formulario Amateur (para que NO se resetee al cambiar de modo)
  const [amateurState, setAmateurState] = useState(null);

  // ✅ Resultados separados (para que NO se mezclen)
  const [amateurResult, setAmateurResult] = useState(null);
  const [engineerResult, setEngineerResult] = useState(null);

  // preset guardado (sale de Amateur o del propio Engineer)
  const [engineerPreset, setEngineerPreset] = useState(null);

  // ✅ preset activo único
  const activePreset = engineerPreset || amateurResult?.engineerPreset || null;
  const presetAvailable = Boolean(activePreset);

  // ✅ evita autosave antes del restore
  const didRestoreRef = useRef(false);

  /* =========================
     RESTORE (al cargar)
  ========================= */
  useEffect(() => {
    const saved = loadAppState();
    if (saved) {
      if (saved?.mode === "ENGINEER" || saved?.mode === "AMATEUR") setMode(saved.mode);

      // ✅ restaurar estados nuevos
      if (saved?.amateurState && typeof saved.amateurState === "object") setAmateurState(saved.amateurState);
      if (saved?.amateurResult && typeof saved.amateurResult === "object") setAmateurResult(saved.amateurResult);
      if (saved?.engineerResult && typeof saved.engineerResult === "object") setEngineerResult(saved.engineerResult);

      if (saved?.engineerPreset && typeof saved.engineerPreset === "object") setEngineerPreset(saved.engineerPreset);
    }
    didRestoreRef.current = true;
  }, []);

  /* =========================
     AUTOSAVE (cuando cambia)
  ========================= */
  useEffect(() => {
    if (!didRestoreRef.current) return;

    const tmr = setTimeout(() => {
      saveAppState({
        mode,
        amateurState: amateurState || null,
        amateurResult: amateurResult || null,
        engineerResult: engineerResult || null,
        engineerPreset: engineerPreset || null,
      });
    }, 250);

    return () => clearTimeout(tmr);
  }, [mode, amateurState, amateurResult, engineerResult, engineerPreset]);

  /* =========================
     HELPERS
  ========================= */

  // ✅ IMPORTANTÍSIMO: Amateur es SOLO TÉCNICO → quitamos cualquier bloque financiero
  function stripFinanceFromAmateurResult(result) {
    const out = result || {};
    const engineerPresetFromOut = out?.engineerPreset || null;

    const cleaned = {
      ...out,
      costing: null,
      finance: null,
      economics: null,
      financial: null,
    };

    if (engineerPresetFromOut) cleaned.engineerPreset = engineerPresetFromOut;
    return cleaned;
  }

  // ✅ Wrapper de "form" para financeEngine (espera form.wantBattery / form.finance / form.pricing)
  // (Se usa SOLO para Ingeniero como fallback)
  function buildFinanceForm({ preset, out }) {
    const presetForm =
      (preset && preset.form && typeof preset.form === "object" ? preset.form : null) ||
      (out?.engineerPreset && out.engineerPreset.form && typeof out.engineerPreset.form === "object"
        ? out.engineerPreset.form
        : null) ||
      {};

    const wantBattery =
      Boolean(preset?.form?.wantBattery) ||
      Boolean(preset?.wantBattery) ||
      Boolean(out?.battery?.enabled) ||
      Boolean(out?.sizing?.battery?.requiredBatteryKWh > 0) ||
      false;

    const batteryKWh =
      num(out?.sizing?.battery?.requiredBatteryKWh) > 0
        ? num(out.sizing.battery.requiredBatteryKWh)
        : num(out?.battery?.capacityKWh) > 0
        ? num(out.battery.capacityKWh)
        : num(preset?.form?.batteryCapacityKWh_ref) > 0
        ? num(preset.form.batteryCapacityKWh_ref)
        : 0;

    return {
      ...presetForm,
      wantBattery,
      battery: { requiredBatteryKWh: batteryKWh },
      pricing: (preset?.pricing && typeof preset.pricing === "object" ? preset.pricing : {}) || {},
      finance: (preset?.finance && typeof preset.finance === "object" ? preset.finance : {}) || {},
    };
  }

  // ✅ Calcula costing/finance si no los trae (SOLO para Ingeniero)
  function enrichEngineerWithFinanceIfMissing(result, preset = null) {
    const out = result || {};
    if (out.costing && out.finance) return out;

    try {
      const form = buildFinanceForm({ preset, out });

      const bom = out?.bom || {};
      const sizing = out?.sizing || {};
      const wiringEstimates = out?.wiringEstimates || out?.wiring || {};
      const stringing = out?.stringing || {};
      const protections = out?.protections || {};

      const costing = out.costing || computeCosting({ bom, sizing, wiringEstimates, stringing, protections, form });

      const annualEnergyKWh =
        num(out?.pv?.annualEnergy) > 0
          ? num(out.pv.annualEnergy)
          : num(out?.energy?.annualEnergyKWh) > 0
          ? num(out.energy.annualEnergyKWh)
          : num(out?.energy?.dailyKWh) > 0
          ? num(out.energy.dailyKWh) * 365
          : 0;

      const finance =
        out.finance ||
        computeFinance({
          costing,
          annualEnergyKWh,
          inputs: out?.inputs || {},
          energy: out?.energy || {},
          form,
        });

      return { ...out, costing, finance };
    } catch (e) {
      console.warn("No se pudo calcular finanzas (fallback - Ingeniero):", e);
      return out;
    }
  }

  /* =========================
     HANDLERS
  ========================= */

  // ✅ Amateur: guarda resultado SOLO en amateurResult — sin finanzas
  const handleCalculateAmateur = (legacyAmateurResult) => {
    const cleaned = stripFinanceFromAmateurResult(legacyAmateurResult);

    setAmateurResult({
      ...cleaned,
      mode: "AMATEUR",
      modeTag: "AMATEUR",
    });

    if (legacyAmateurResult?.engineerPreset) setEngineerPreset(legacyAmateurResult.engineerPreset);
    setMode("AMATEUR");
  };

  // ✅ Desde Amateur: guardo preset, cambio UI a Engineer y calculo Engineer result (independiente)
  const handleSendToEngineer = (preset) => {
    if (!preset) return;

    setEngineerPreset(preset);
    setMode("ENGINEER");

    try {
      const engineerLegacy0 = runEngineerSizing(preset);
      const engineerLegacy = enrichEngineerWithFinanceIfMissing(engineerLegacy0, preset);

      setEngineerResult({
        ...engineerLegacy,
        mode: "ENGINEER",
        modeTag: "ENGINEER",
        engineerPreset: preset,
      });
    } catch (err) {
      console.error("Error al pasar a modo Ingeniero:", err);

      setEngineerResult({
        ...makeEmptyAppData(),
        mode: "ENGINEER",
        modeTag: "ENGINEER",
        engineerPreset: preset,
        diagnostics: {
          ok: false,
          issues: [
            `Error en modo Ingeniero: ${err?.message || "desconocido"}`,
            "Revisa que exista src/engine/sizing.js y exporte runEngineerSizing().",
          ],
        },
      });
    }
  };

  // ✅ Desde EngineerForm: recalcula engineerResult (sin tocar amateurResult ni amateurState)
  const handleCalculateEngineer = (preset) => {
    if (!preset) return;

    setEngineerPreset(preset);
    setMode("ENGINEER");

    try {
      const engineerLegacy0 = runEngineerSizing(preset);
      const engineerLegacy = enrichEngineerWithFinanceIfMissing(engineerLegacy0, preset);

      setEngineerResult({
        ...engineerLegacy,
        mode: "ENGINEER",
        modeTag: "ENGINEER",
        engineerPreset: preset,
      });
    } catch (err) {
      console.error("Error al calcular Ingeniero:", err);

      setEngineerResult({
        ...makeEmptyAppData(),
        mode: "ENGINEER",
        modeTag: "ENGINEER",
        engineerPreset: preset,
        diagnostics: {
          ok: false,
          issues: [`Error en runEngineerSizing(): ${err?.message || "desconocido"}`],
        },
      });
    }
  };

  const goEngineerUI = () => {
    if (!presetAvailable) return;
    setMode("ENGINEER");
  };

  const handleNewProject = () => {
    clearAppState();
    setMode("AMATEUR");
    setAmateurState(null);
    setAmateurResult(null);
    setEngineerPreset(null);
    setEngineerResult(null);
  };

  const handleResetState = () => {
    clearAppState();
    setMode("AMATEUR");
    setAmateurState(null);
    setAmateurResult(null);
    setEngineerPreset(null);
    setEngineerResult(null);
  };

  // ✅ Resultado que se muestra depende del modo UI (y nunca se “mezcla”)
  const shownResult = mode === "ENGINEER" ? engineerResult || null : amateurResult || null;
  const safeShown = shownResult || empty;

  const isEngineerUI = mode === "ENGINEER";
  const isEngineerResultShown = safeShown?.modeTag === "ENGINEER" || safeShown?.mode === "ENGINEER";

  // Labels UI (traducidos)
  const uiModeLabel = isEngineerUI ? TT("results.engineer", "INGENIERO") : TT("results.amateur", "AMATEUR");
  const resultLabel = isEngineerResultShown ? TT("results.engineer", "ENGINEER") : TT("results.amateur", "AMATEUR");

  return (
    <div className="appShell">
      <div className="appHeader">
        <div className="headerBar">
          <div className="brand">
            <div className="brandTitle">ENRGY ONE • Solar Designer</div>
            <div className="brandSub">
              v2.0 — {lang === "en" ? (isEngineerUI ? "Engineer Mode" : "Amateur Mode") : `Modo ${uiModeLabel}`} •{" "}
              {lang === "en" ? "Technical inventory" : "Inventario técnico"} •{" "}
              {lang === "en" ? "Printable report" : "Reporte imprimible"}
            </div>
          </div>

          <div className="headerPills">
            <span className="pill">v2.0</span>

            {/* ✅ BOTONES DE MODO (UI) */}
            <button
              type="button"
              className={`pillBtn ${!isEngineerUI ? "pillBtnActive" : ""}`}
              onClick={() => setMode("AMATEUR")}
              title={lang === "en" ? "Go to Amateur form" : "Ir al formulario Amateur"}
            >
              {TT("results.amateur", "AMATEUR")}
            </button>

            <button
              type="button"
              className={`pillBtn ${isEngineerUI ? "pillBtnActive" : ""} ${!presetAvailable ? "pillBtnDisabled" : ""}`}
              onClick={goEngineerUI}
              disabled={!presetAvailable}
              title={
                !presetAvailable
                  ? lang === "en"
                    ? "First run Amateur to generate the preset"
                    : "Primero calcula en Amateur para generar el preset"
                  : lang === "en"
                  ? "Go to Engineer form"
                  : "Ir al formulario Ingeniero"
              }
            >
              {TT("results.engineer", "INGENIERO")}
            </button>

            {/* Estado del resultado mostrado (según modo UI) */}
            <span
              className="pill"
              style={{
                opacity: 1,
                borderColor: isEngineerResultShown ? "rgba(46, 204, 113, 0.65)" : "rgba(17, 17, 17, 0.18)",
              }}
              title={lang === "en" ? "Result currently shown below" : "Resultado mostrado en el panel inferior"}
            >
              {lang === "en" ? `RESULT: ${resultLabel}` : `RESULTADO: ${resultLabel}`}
            </span>

            <button
              type="button"
              className="pillBtn"
              onClick={handleNewProject}
              title={lang === "en" ? "Clear saved state and restart" : "Borra guardado y reinicia"}
            >
              {lang === "en" ? "New" : "Nuevo"}
            </button>

            <button
              type="button"
              className="pillBtn"
              onClick={handleResetState}
              title={lang === "en" ? "Full reset of local state" : "Reset total del estado local"}
            >
              Reset
            </button>

            {/* ✅ Toggle idioma (ES/EN) */}
            <LangToggle />
          </div>
        </div>
      </div>

      <div className="stackGrid">
        <section className="stackTop">
          {!isEngineerUI ? (
            <AmateurForm
              state={amateurState}
              onStateChange={setAmateurState}
              onCalculate={handleCalculateAmateur}
              onSendToEngineer={handleSendToEngineer}
            />
          ) : (
            <EngineerForm preset={activePreset} onCalculate={handleCalculateEngineer} />
          )}
        </section>

        <section className="stackBottom">
          {/* ✅ Results SOLO recibe el resultado del modo actual */}
          <Results data={safeShown} />
        </section>
      </div>
    </div>
  );
}

/* local tiny helper */
function num(x) {
  const s = String(x ?? "").trim().replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}