// src/components/AmateurForm.jsx
import { useEffect, useMemo, useState } from "react";
import SolarCityPicker from "./SolarCityPicker";
import { runAmateurSizing } from "../engine/amateurSizing";

/**
 * ✅ CONTROLLED VERSION (no se resetea al cambiar de modo)
 * - El estado del formulario vive en App.jsx y se pasa aquí como `state`
 * - Este componente NO pierde inputs al desmontarse/montarse
 *
 * Requiere que App.jsx llame:
 * <AmateurForm
 *   state={amateurState}
 *   onStateChange={setAmateurState}
 *   onCalculate={handleCalculateAmateur}
 *   onSendToEngineer={handleSendToEngineer}
 * />
 */
export default function AmateurForm({ state, onStateChange, onCalculate, onSendToEngineer }) {
  /* ======================== DEFAULTS ======================== */
  const defaults = useMemo(
    () => ({
      project: { name: "ENRGY ONE - Solar Designer (Amateur)", company: "—" },
      loc: { country: "Colombia", city: "Cali", psh: 4.8 },
      clientMode: "RES", // RES | CI
      bill: {
        billingKWh: "300",
        billingDays: "30",
        billingEnergyCOP: "",
        tariffCOPkWh: "900",
        daytimeRatio: "0.85",
        zeroExport: false,
      },
      amateur: {
        areaM2: "25",
        wantBattery: false,
        wantExport: true,
        exportKW: "2",
        panelToInverterM: "",
        inverterToACBoardM: "",
        inverterDistanceM: "",
      },
      diagnosticsUI: { ok: true, issues: [] },
      lastEngineerPreset: null,
    }),
    []
  );

  /* ======================== CONTROLLED STATE ======================== */
  const [local, setLocal] = useState(() => (state && typeof state === "object" ? state : defaults));

  // si App cambia el state desde afuera, sincroniza
  useEffect(() => {
    if (state && typeof state === "object") setLocal(state);
  }, [state]);

  // helper: actualiza local + App
  const patch = (fn) => {
    setLocal((prev) => {
      const next = fn(prev);
      onStateChange?.(next);
      return next;
    });
  };

  const project = local.project || defaults.project;
  const loc = local.loc || defaults.loc;
  const clientMode = local.clientMode || defaults.clientMode;
  const bill = local.bill || defaults.bill;
  const amateur = local.amateur || defaults.amateur;
  const diagnosticsUI = local.diagnosticsUI || defaults.diagnosticsUI;
  const lastEngineerPreset = local.lastEngineerPreset || null;

  /* ======================== HANDLERS ======================== */
  const handleTextProject = (e) => {
    const { name, value } = e.target;
    patch((p) => ({
      ...p,
      project: {
        ...(p.project || {}),
        name: name === "projectName" ? value : (p.project?.name || project.name),
        company: name === "company" ? value : (p.project?.company || project.company),
      },
    }));
  };

  const handleBill = (e) => {
    const { name, value, type, checked } = e.target;
    patch((p) => ({
      ...p,
      bill: {
        ...(p.bill || {}),
        [name]: type === "checkbox" ? checked : value,
      },
    }));
  };

  const handleAmateur = (e) => {
    const { name, value, type, checked } = e.target;
    patch((p) => ({
      ...p,
      amateur: {
        ...(p.amateur || {}),
        [name]: type === "checkbox" ? checked : value,
      },
    }));
  };

  const handleLoc = (nextLoc) => {
    patch((p) => ({ ...p, loc: { ...(p.loc || {}), ...nextLoc } }));
  };

  const setClientMode = (v) => patch((p) => ({ ...p, clientMode: v === "CI" ? "CI" : "RES" }));

  /* ======================== VALIDATION ======================== */
  const validate = () => {
    const issues = [];

    const kWh = num(bill.billingKWh);
    const days = num(bill.billingDays);
    const area = num(amateur.areaM2);

    if (kWh <= 0) issues.push("Consumo del periodo (kWh) debe ser > 0.");
    if (days <= 0) issues.push("Días facturados debe ser > 0.");
    if (area <= 0) issues.push("Área disponible (m²) debe ser > 0.");

    if (amateur.wantExport && String(amateur.exportKW).trim() !== "" && num(amateur.exportKW) < 0) {
      issues.push("Potencia de excedentes (kW) no puede ser negativa.");
    }

    if (bill.zeroExport && amateur.wantExport) {
      issues.push("Tienes 'Cero exportación' activo: desactiva 'Venta de excedentes'.");
    }

    const d1 = num(amateur.panelToInverterM);
    const d2 = num(amateur.inverterToACBoardM);
    const d3 = num(amateur.inverterDistanceM);

    if (String(amateur.panelToInverterM).trim() !== "" && d1 < 0) issues.push("Distancia panel → inversor no puede ser negativa.");
    if (String(amateur.inverterToACBoardM).trim() !== "" && d2 < 0) issues.push("Distancia inversor → tablero AC no puede ser negativa.");
    if (String(amateur.inverterDistanceM).trim() !== "" && d3 < 0) issues.push("Distancia inversor → punto DC no puede ser negativa.");

    return { ok: issues.length === 0, issues };
  };

  /* ======================== ENGINEER PRESET FALLBACK ======================== */
  function buildEngineerPresetFallback({ project, loc, clientMode, bill, amateur, derived }) {
    // ✅ derived: información inferida para evitar banderas falsas
    const { limitedByArea, panelsTarget, maxPanelsByArea } = derived || {};

    return {
      project: {
        name: String(project?.name || "ENRGY ONE • Solar Designer"),
        company: String(project?.company || "—"),
      },
      loc: {
        country: String(loc?.country || "Colombia"),
        city: String(loc?.city || "Cali"),
        psh: num(loc?.psh) || 4.8,
      },
      clientMode: clientMode === "CI" ? "CI" : "RES",
      bill: {
        billingKWh: num(bill?.billingKWh),
        billingDays: num(bill?.billingDays) || 30,
        tariffCOPkWh: num(bill?.tariffCOPkWh) || 900,
        daytimeRatio: clamp01(bill?.daytimeRatio),
        zeroExport: Boolean(bill?.zeroExport),
      },
      form: {
        dailyConsumption: 0,
        peakSunHours: num(loc?.psh) || 4.8,
        systemLosses: 0.2,

        exportRatio: amateur?.wantExport ? 0.2 : 0,
        exportKW: amateur?.wantExport ? num(amateur?.exportKW) : 0,
        acKw: 0,

        panelPower: 550,
        vmp: 40,
        voc: 48,
        imp: 13,
        isc: 14,
        vocTempCoeffPctPerC: -0.28,
        tMinC: 10,

        dcMaxV: 600,
        mpptVmin: 120,
        mpptVmax: 500,
        mpptMaxInputA: 16,
        numMppt: clientMode === "CI" ? 3 : 2,

        acPhase: clientMode === "CI" ? "3P" : "1P",
        acVoltageV:
          clientMode === "CI"
            ? String(loc?.country || "").toLowerCase().includes("espa")
              ? 400
              : 380
            : String(loc?.country || "").toLowerCase().includes("espa")
            ? 230
            : 220,

        L_stringToCombiner_1w: 15,
        L_combinerToInverter_1w: num(amateur?.panelToInverterM) || 30,
        L_inverterToACPanel_1w: num(amateur?.inverterToACBoardM) || 20,

        maxDropDC_string: 1.5,
        maxDropDC_main: 1.5,
        maxDropAC_seg: 3,

        conductorMaterial: "Cu",
        inverterEff: 0.98,
        selfConsumptionRatio: clamp01(bill?.daytimeRatio),

        // ✅ área (para aviso en Results)
        limitedByArea: Boolean(limitedByArea),
        areaM2: num(amateur?.areaM2),
        panelAreaM2: 2.6,
        packingFactor: 0.85,

        // (opcionales si tu ingeniero los usa)
        panelsTarget: isFiniteNum(panelsTarget) ? num(panelsTarget) : null,
        maxPanelsByArea: isFiniteNum(maxPanelsByArea) ? num(maxPanelsByArea) : null,
      },
    };
  }

  /* ======================== LEGACY ADAPTER (ANTI-CRASH) ======================== */
  function toLegacyResult({ out, project, loc, clientMode, bill, amateur }) {
    const invItems =
      (out?.bom?.technical && Array.isArray(out.bom.technical) ? out.bom.technical : null) ||
      (out?.bomTech?.items && Array.isArray(out.bomTech.items) ? out.bomTech.items : null) ||
      (out?.bom?.items && Array.isArray(out.bom.items) ? out.bom.items : null) ||
      [];

    const panels = out?.sizing?.pv?.numberOfPanels ?? out?.pv?.numberOfPanels ?? 0;
    const kWp = out?.sizing?.pv?.installedPowerKWp ?? out?.pv?.requiredPower ?? 0;
    const annual = out?.sizing?.pv?.annualEnergyKWh ?? out?.pv?.annualEnergy ?? 0;
    const batteryKWh = out?.battery?.capacityKWh ?? out?.battery?.requiredBatteryKWh ?? 0;

    const panelsTarget = out?.sizing?.pv?.panelsTarget ?? null;
    const maxPanelsByArea = out?.sizing?.pv?.maxPanelsByArea ?? null;
    const limitedByArea = Boolean(out?.sizing?.pv?.limitedByArea);

    const diagIssues = [
      ...(out?.diagnostics?.issues || []),
      ...(out?.diagnostics?.errors || []),
      ...(out?.diagnostics?.warnings || []),
    ].filter(Boolean);

    return {
      project: { name: project?.name || "—", company: project?.company || "—" },

      inputs: {
        clientMode,
        country: loc?.country || "Colombia",
        city: loc?.city || "—",
        psh: Number(loc?.psh || 0),

        billingKWh: num(bill?.billingKWh),
        billingDays: num(bill?.billingDays),
        billingEnergyCOP: String(bill?.billingEnergyCOP || ""),
        tariffCOPkWh: num(bill?.tariffCOPkWh),
        daytimeRatio: clamp01(bill?.daytimeRatio),
        zeroExport: Boolean(bill?.zeroExport),

        areaM2: num(amateur?.areaM2),
        wantBattery: Boolean(amateur?.wantBattery),
        wantExport: Boolean(amateur?.wantExport),
        exportKW: num(amateur?.exportKW),

        panelToInverterM: num(amateur?.panelToInverterM),
        inverterToACBoardM: num(amateur?.inverterToACBoardM),
        inverterDistanceM: num(amateur?.inverterDistanceM),

        panelsTarget,
        maxPanelsByArea,
        limitedByArea,
      },

      pv: {
        numberOfPanels: Number(panels) || 0,
        requiredPower: Number(kWp) || 0,
        annualEnergy: Number(annual) || 0,
      },

      battery: {
        mode: amateur?.wantBattery ? "autonomy" : "none",
        requiredBatteryKWh: Number(batteryKWh) || 0,
        requiredAh: 0,
        systemVoltage: 48,
      },

      roi: {},
      stringing: {},
      protections: {},

      segments: { rows: [], totals: { subtotalConductores: 0, metrosTotales: 0 } },

      bom: {
        items: Array.isArray(invItems) ? invItems : [],
        subtotal: 0,
        tax: 0,
        margin: 0,
        total: 0,
      },

      energy: out?.energy || null,
      wiringEstimates: out?.wiringEstimates || null,
      wiringSizing: out?.wiringSizing || null,
      sizing: out?.sizing || null,

      diagnostics: {
        ok: out?.diagnostics?.ok !== false,
        issues: diagIssues,
      },

      engineerPreset: out?.engineerPreset || null,
      modeTag: "AMATEUR",
      mode: "AMATEUR",
    };
  }

  /* ======================== SUBMIT ======================== */
  const handleSubmit = () => {
    const v = validate();
    patch((p) => ({ ...p, diagnosticsUI: v }));

    if (!v.ok) {
      const legacyFail = {
        project: { name: project.name, company: project.company },
        inputs: { clientMode, country: loc.country, city: loc.city, psh: loc.psh },
        pv: { numberOfPanels: 0, requiredPower: 0, annualEnergy: 0 },
        battery: { mode: "none", requiredBatteryKWh: 0, requiredAh: 0, systemVoltage: 48 },
        roi: {},
        stringing: {},
        protections: {},
        segments: { rows: [], totals: { subtotalConductores: 0, metrosTotales: 0 } },
        bom: { items: [], subtotal: 0, tax: 0, margin: 0, total: 0 },
        diagnostics: { ok: false, issues: v.issues },
        engineerPreset: null,
        modeTag: "AMATEUR",
        mode: "AMATEUR",
      };
      onCalculate?.(legacyFail);
      return;
    }

    try {
      const model = {
        meta: {
          projectName: project.name,
          company: project.company,
          country: loc.country === "España" ? "ES" : "CO",
          city: loc.city,
          userMode: "AMATEUR",
        },
        location: {
          country: loc.country === "España" ? "ES" : "CO",
          city: loc.city,
          psh: num(loc.psh) || 4.8,
          source: "picker",
        },
        mode: {
          clientType: clientMode,
          phase: clientMode === "CI" ? "3F" : "1F",
          voltageAC:
            clientMode === "CI"
              ? loc.country === "España"
                ? 400
                : 380
              : loc.country === "España"
              ? 230
              : 220,
        },
        amateurInputs: {
          bill: {
            consumptionKWh: bill.billingKWh,
            billingDays: bill.billingDays,
            energyCostCOP: bill.billingEnergyCOP,
            tariff: bill.tariffCOPkWh,
            daytimeRatio: bill.daytimeRatio,
            zeroExport: bill.zeroExport,
          },
          site: {
            availableAreaM2: amateur.areaM2,
            panelToInverterM: amateur.panelToInverterM,
            inverterToACBoardM: amateur.inverterToACBoardM,
            inverterDistanceM: amateur.inverterDistanceM,
          },
          preferences: {
            wantBattery: amateur.wantBattery,
            wantExport: amateur.wantExport,
            exportPowerKW: amateur.exportKW,
          },
        },
      };

      const out = runAmateurSizing(model);

      const legacy = toLegacyResult({ out, project, loc, clientMode, bill, amateur });

      // ✅ fallback preset con derived para no marcar limitación falsa
      const derived = {
        limitedByArea: legacy?.inputs?.limitedByArea,
        panelsTarget: legacy?.inputs?.panelsTarget,
        maxPanelsByArea: legacy?.inputs?.maxPanelsByArea,
      };

      const presetReal = out?.engineerPreset || null;
      const presetFallback = buildEngineerPresetFallback({ project, loc, clientMode, bill, amateur, derived });
      const presetToUse = presetReal || presetFallback;

      legacy.engineerPreset = presetToUse;

      patch((p) => ({ ...p, diagnosticsUI: legacy.diagnostics, lastEngineerPreset: presetToUse }));

      onCalculate?.(legacy);
    } catch (err) {
      console.error("Error en Amateur:", err);
      const diag = { ok: false, issues: [`Error en modo Amateur: ${err?.message || "desconocido"}`] };

      patch((p) => ({ ...p, diagnosticsUI: diag }));

      const legacyFail = {
        project: { name: project.name, company: project.company },
        inputs: { clientMode, country: loc.country, city: loc.city, psh: loc.psh },
        pv: { numberOfPanels: 0, requiredPower: 0, annualEnergy: 0 },
        battery: { mode: "none", requiredBatteryKWh: 0, requiredAh: 0, systemVoltage: 48 },
        roi: {},
        stringing: {},
        protections: {},
        segments: { rows: [], totals: { subtotalConductores: 0, metrosTotales: 0 } },
        bom: { items: [], subtotal: 0, tax: 0, margin: 0, total: 0 },
        diagnostics: diag,
        engineerPreset: null,
        modeTag: "AMATEUR",
        mode: "AMATEUR",
      };

      onCalculate?.(legacyFail);
    }
  };

  const canSendToEngineer = Boolean(lastEngineerPreset);

  /* ======================== UI ======================== */
  return (
    <div className="card">
      <div className="badge">AMATEUR</div>
      <h2>Modo Amateur (datos simples)</h2>
      <div className="muted" style={{ marginTop: -6 }}>
        Ingresa datos tipo factura + área + baterías/excedentes. Obtendrás un inventario técnico y un preset para Modo Ingeniero.
      </div>

      <div className="row" style={{ marginTop: 12 }}>
        <div className="tabs">
          <button type="button" className={`tab ${clientMode === "RES" ? "active" : ""}`} onClick={() => setClientMode("RES")}>
            Residencial
          </button>
          <button type="button" className={`tab ${clientMode === "CI" ? "active" : ""}`} onClick={() => setClientMode("CI")}>
            Comercial/Industrial
          </button>
        </div>
      </div>

      <div className="grid2" style={{ marginTop: 12 }}>
        <FormInput label="Nombre del proyecto" name="projectName" value={project.name} onChange={handleTextProject} />
        <FormInput label="Empresa" name="company" value={project.company} onChange={handleTextProject} />
      </div>

      <h3 className="section">Ubicación (PSH)</h3>
      <SolarCityPicker value={loc} onChange={handleLoc} />

      <div className="grid2" style={{ marginTop: 10 }}>
        <FormInput
          label="PSH (manual opcional)"
          value={String(loc.psh)}
          onChange={(e) => {
            const raw = String(e.target.value).trim();
            if (raw === "") return;
            const p = parseFloat(raw.replace(",", "."));
            if (Number.isFinite(p)) handleLoc({ ...loc, psh: p });
          }}
          inputMode="decimal"
          placeholder="Ej: 4.8"
          hint="Si no estás seguro, deja el valor sugerido por la ciudad."
        />
        <div className="note">
          <b>Tip:</b> Cali suele estar ~4.5–5.0 PSH. El valor cambia por ciudad.
        </div>
      </div>

      <h3 className="section">Datos de factura</h3>
      <div className="grid3">
        <FormInput label="Consumo del periodo (kWh)" name="billingKWh" value={bill.billingKWh} onChange={handleBill} inputMode="numeric" />
        <FormInput label="Días facturados" name="billingDays" value={bill.billingDays} onChange={handleBill} inputMode="numeric" />
        <FormInput
          label="Valor energía (COP) (opcional)"
          name="billingEnergyCOP"
          value={bill.billingEnergyCOP}
          onChange={handleBill}
          inputMode="numeric"
          placeholder="Ej: 280000"
          hint="Ideal: solo componente energía (sin aseo/alumbrado/impuestos)."
        />
      </div>

      <div className="grid3" style={{ marginTop: 10 }}>
        <FormInput
          label="Tarifa (COP/kWh) si no pones valor energía"
          name="tariffCOPkWh"
          value={bill.tariffCOPkWh}
          onChange={handleBill}
          inputMode="numeric"
        />
        <FormInput
          label="% consumo diurno (0..1)"
          name="daytimeRatio"
          value={bill.daytimeRatio}
          onChange={handleBill}
          inputMode="decimal"
          hint="Si no sabes: residencial 0.85 / C&I 0.6–0.9"
        />
        <div>
          <label>Restricción exportación</label>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <CheckboxPill name="zeroExport" checked={bill.zeroExport} onChange={handleBill} label="Cero exportación (no inyectar)" />
          </div>
          <small>Si activas cero exportación, desactiva venta de excedentes.</small>
        </div>
      </div>

      <h3 className="section">Condiciones del sistema</h3>
      <div className="grid3">
        <FormInput label="Área disponible (m²)" name="areaM2" value={amateur.areaM2} onChange={handleAmateur} inputMode="decimal" hint="Área útil para instalar paneles." />

        <div>
          <label>Baterías</label>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <CheckboxPill name="wantBattery" checked={amateur.wantBattery} onChange={handleAmateur} label="Quiero baterías" />
          </div>
        </div>

        <div>
          <label>Venta de excedentes</label>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <CheckboxPill name="wantExport" checked={amateur.wantExport} onChange={handleAmateur} label="Quiero vender excedentes" />
          </div>
        </div>
      </div>

      {amateur.wantExport && !bill.zeroExport ? (
        <div className="grid3" style={{ marginTop: 10 }}>
          <FormInput
            label="Potencia activa deseada para vender excedentes (kW)"
            name="exportKW"
            value={amateur.exportKW}
            onChange={handleAmateur}
            inputMode="decimal"
            hint="Ej: 1–5 kW. Esto aumenta el tamaño FV."
          />
          <div className="note">
            <b>Nota:</b> esto es una meta (aprox.). En modo Ingeniero lo refinamos con límites reales (inversor, control, etc.).
          </div>
          <div />
        </div>
      ) : null}

      <h3 className="section">Distancias aproximadas (para metrado de cables)</h3>
      <div className="grid3">
        <FormInput
          label="Paneles → Inversor (m)"
          name="panelToInverterM"
          value={amateur.panelToInverterM}
          onChange={handleAmateur}
          inputMode="decimal"
          placeholder="Ej: 15"
          hint="Distancia (ida) desde el campo FV hasta el inversor."
        />
        <FormInput
          label="Inversor → Tablero AC (m)"
          name="inverterToACBoardM"
          value={amateur.inverterToACBoardM}
          onChange={handleAmateur}
          inputMode="decimal"
          placeholder="Ej: 20"
          hint="Distancia (ida) del inversor al tablero/medidor de AC."
        />
        <FormInput
          label="Inversor → Punto DC / seccionamiento (m) (opcional)"
          name="inverterDistanceM"
          value={amateur.inverterDistanceM}
          onChange={handleAmateur}
          inputMode="decimal"
          placeholder="Ej: 5"
          hint="Opcional si tienes un tablero DC o seccionamiento separado."
        />
      </div>

      <div className="row" style={{ gap: 10, marginTop: 14, flexWrap: "wrap", justifyContent: "flex-end" }}>
        <button
          type="button"
          className="btn"
          disabled={!canSendToEngineer}
          title={!canSendToEngineer ? "Primero calcula en Amateur para generar el preset." : "Enviar los datos al motor Ingeniero"}
          style={
            !canSendToEngineer
              ? { opacity: 0.65, cursor: "not-allowed" }
              : { borderColor: "rgba(125,211,252,0.55)", background: "rgba(125,211,252,0.10)" }
          }
          onClick={() => onSendToEngineer?.(lastEngineerPreset)}
        >
          Enviar a modo Ingeniero
        </button>

        <button className="btnPrimary" type="button" onClick={handleSubmit}>
          Calcular (Amateur)
        </button>
      </div>

      {!diagnosticsUI?.ok ? (
        <div className="note" style={{ marginTop: 10, borderColor: "rgba(255, 99, 132, 0.45)" }}>
          ⚠ Revisa: {diagnosticsUI.issues?.slice(0, 10).join(" | ")}
        </div>
      ) : null}
    </div>
  );
}

/* ======================== COMPONENTES UI ======================== */
function FormInput({ label, hint, ...props }) {
  return (
    <div>
      <label>{label}</label>
      <input type="text" {...props} />
      {hint ? <small>{hint}</small> : null}
    </div>
  );
}

function CheckboxPill({ label, checked, onChange, name }) {
  return (
    <label
      className="pill"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        cursor: "pointer",
        userSelect: "none",
      }}
    >
      <input type="checkbox" name={name} checked={checked} onChange={onChange} />
      {label}
    </label>
  );
}

/* ======================== HELPERS ======================== */
function num(x) {
  const s = String(x ?? "").trim().replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
function clamp01(x) {
  const n = num(x);
  return Math.max(0, Math.min(1, n));
}
function isFiniteNum(x) {
  const n = Number(String(x ?? "").replace(",", "."));
  return Number.isFinite(n);
}
