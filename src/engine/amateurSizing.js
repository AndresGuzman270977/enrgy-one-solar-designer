// src/engine/amateurSizing.js
import { AMATEUR_PANELS, pickDefaultPanel, pickInverterByAcKw } from "./amateurCatalog";
import { computeCosting, computeFinance } from "./financeEngine";

/**
 * Motor Modo Amateur (robusto / anti-crash)
 *
 * PATCH v7 (CONSISTENCIA UI + PRESET):
 * ✅ project.name default SIN "(Amateur)" para no contaminar Ingeniero
 * ✅ out.modeTag = "AMATEUR" explícito
 * ✅ diagnostics.issues siempre presente (merge warnings+errors)
 * ✅ engineerPreset: pasa exportKW explícito + flags (wantExport/exportKW)
 * ✅ battery.assumptions añade reservePct para explicar diferencias Amateur vs Ingeniero
 *
 * PATCH v8 (EXPORTACIÓN vs INVERSOR — FIX FÍSICO):
 * ✅ Si wantExport y exportKW>0: fuerza inversor AC >= exportKW (Amateur auto-ajusta)
 * ✅ Warning explicativo: exportKW es potencia NETA; si hay consumo simultáneo, inversor debe ser mayor
 */
export function runAmateurSizing(model) {
  const safe = normalizeModel(model);

  const { location, mode, amateurInputs } = safe;
  const diag = { ok: true, warnings: [], errors: [] };

  // ---------- Parse inputs ----------
  const bill = amateurInputs.bill;
  const site = amateurInputs.site;
  const pref = amateurInputs.preferences;

  const kWhPeriod = num(bill.consumptionKWh);
  const days = Math.max(1, num(bill.billingDays));
  const dailyKWh = kWhPeriod / days;

  const psh = num(location.psh) || 4.5;
  const losses = 0.20; // fijo Amateur

  const energyCost = money(bill.energyCostCOP);
  const tariff = energyCost > 0 && kWhPeriod > 0 ? energyCost / kWhPeriod : num(bill.tariff) || 900;

  const daytimeRatio = clamp01(num(bill.daytimeRatio) || 0.85);
  const selfConsumptionRatio = mode.clientType === "CI" ? daytimeRatio : 0.85;

  const zeroExport = Boolean(bill.zeroExport);

  // Área disponible
  const areaM2 = Math.max(1, num(site.availableAreaM2));
  const packing = 0.85; // factor ocupación (techo útil)

  // ---------- Meta energía / excedentes ----------
  const kWpForEnergy = psh > 0 ? dailyKWh / (psh * (1 - losses)) : 0;

  let exportKW = 0;
  if (!zeroExport && pref.wantExport) exportKW = Math.max(0, num(pref.exportPowerKW));

  // En Amateur, esto es solo una aproximación para sumar energía requerida.
  // La validación física de potencia AC la hacemos con el inversor más abajo.
  const kWpForExport = exportKW > 0 ? exportKW / 0.9 : 0;

  let kWpTarget = kWpForEnergy + kWpForExport;
  if (!Number.isFinite(kWpTarget) || kWpTarget < 0.5) kWpTarget = 0.5;

  // ---------- Selección de panel (AUTO-OPTIMIZACIÓN por área) ----------
  let panel = null;
  try {
    panel = typeof pickDefaultPanel === "function" ? pickDefaultPanel() : null;
  } catch (e) {
    panel = null;
    diag.warnings.push(`Catálogo panel falló: ${e?.message || "desconocido"}`);
  }

  if (!panel || num(panel.powerW) <= 0) {
    panel = {
      id: "p550_generic",
      name: "Módulo FV genérico 550 W",
      powerW: 550,
      areaM2: 2.6,
      vmp: 41.5,
      voc: 49.5,
      imp: 13.25,
      isc: 13.9,
    };
    diag.warnings.push("Se usó panel genérico 550 W (fallback).");
  }

  const panelChoice = pickBestPanelForArea({
    areaM2,
    packing,
    kWpTarget,
    defaultPanel: panel,
  });

  panel = panelChoice.panel;
  const maxPanelsByArea = panelChoice.maxPanelsByArea;

  if (panelChoice.usedAlternative) {
    diag.warnings.push(
      `Optimización por área: se eligió "${panel.name}" para maximizar potencia instalada dentro de ${round1(areaM2)} m².`
    );
  }

  // ---------- Paneles objetivo vs área ----------
  const panelsTarget = Math.ceil((kWpTarget * 1000) / Math.max(1, num(panel.powerW)));
  const limitedByArea = panelsTarget > maxPanelsByArea;

  const panelsFinal = Math.max(1, Math.min(panelsTarget, maxPanelsByArea));
  const installedKWp = (panelsFinal * num(panel.powerW)) / 1000;

  // Energía anual
  const annualEnergyKWh = installedKWp * psh * 365 * (1 - losses);

  // ---------- Inversor ----------
  // Base: DC/AC ~ 1.10
  let targetAcKw = installedKWp / 1.1;

  // ✅ PATCH v8: si hay meta de exportación, el inversor DEBE poder exportar esa potencia (neto).
  // En Amateur auto-ajustamos invAcKw mínimo a exportKW.
  if (!zeroExport && pref.wantExport && exportKW > 0) {
    const before = targetAcKw;
    targetAcKw = Math.max(targetAcKw, exportKW);

    if (targetAcKw !== before) {
      diag.warnings.push(
        `Exportación: se ajustó el tamaño del inversor para cumplir exportTarget=${round1(exportKW)} kW (AC). ` +
          `Nota: exportKW es potencia neta; si existe consumo simultáneo significativo, el inversor requerido debe ser > exportKW.`
      );
    }
  }

  let inverter = null;
  try {
    inverter = typeof pickInverterByAcKw === "function" ? pickInverterByAcKw(targetAcKw) : null;
  } catch (e) {
    inverter = null;
    diag.warnings.push(`Catálogo inversor falló: ${e?.message || "desconocido"}`);
  }

  if (!inverter || num(inverter.acKw) <= 0) {
    const acKwFallback = Math.max(1, round1(targetAcKw));
    inverter = {
      id: "inv_generic",
      name: `Inversor genérico ${acKwFallback} kW`,
      acKw: acKwFallback,
      numMppt: 2,
      mpptVmin: 120,
      mpptVmax: 500,
      dcMaxV: 600,
      mpptMaxInputA: 16,
      eff: 0.98,
    };
    diag.warnings.push("Se usó inversor genérico (fallback).");
  } else {
    inverter = {
      ...inverter,
      eff: Number.isFinite(num(inverter.eff)) ? num(inverter.eff) : 0.98,
      numMppt: Number.isFinite(num(inverter.numMppt)) ? num(inverter.numMppt) : 2,
      mpptVmin: Number.isFinite(num(inverter.mpptVmin)) ? num(inverter.mpptVmin) : 120,
      mpptVmax: Number.isFinite(num(inverter.mpptVmax)) ? num(inverter.mpptVmax) : 500,
      dcMaxV: Number.isFinite(num(inverter.dcMaxV)) ? num(inverter.dcMaxV) : 600,
      mpptMaxInputA: Number.isFinite(num(inverter.mpptMaxInputA)) ? num(inverter.mpptMaxInputA) : 16,
    };

    if (inverter?._note) diag.warnings.push(String(inverter._note));
  }

  // ✅ PATCH v8: sanity extra (no error duro en Amateur, pero deja warning si aún quedara inconsistente)
  if (!zeroExport && pref.wantExport && exportKW > 0 && num(inverter.acKw) > 0 && exportKW > num(inverter.acKw) + 1e-6) {
    diag.warnings.push(
      `Inconsistencia: exportTarget=${round1(exportKW)} kW > inverterAC=${round1(num(inverter.acKw))} kW. ` +
        `Esto no es físicamente posible. Revisa catálogo/selección de inversor.`
    );
  }

  // ---------- Warnings explicativos ----------
  if (limitedByArea) {
    diag.warnings.push(
      `Limitación por área: para ${round1(areaM2)} m² (packing ${packing}) caben aprox. ${maxPanelsByArea} paneles; se requerían ${panelsTarget} para la meta.`
    );
  }

  if (exportKW > 0 && panelsFinal === maxPanelsByArea) {
    diag.warnings.push(`Área limita el tamaño FV. Puede que NO se logren ${round1(exportKW)} kW de excedentes como meta.`);
  }

  if (mode.clientType !== "CI" && dailyKWh > 120) {
    diag.warnings.push(
      `Consumo diario estimado ~${round0(dailyKWh)} kWh/día (muy alto para residencial). Revisa el kWh del periodo.`
    );
  }

  // ---------- Batería (placeholder técnico) ----------
  const wantBattery = Boolean(pref.wantBattery);

  // reserva para explicar diferencia vs Ingeniero (muchos motores suman 10%)
  const reservePct = 0.10;

  const battery = {
    enabled: wantBattery,
    mode: wantBattery ? "AUTONOMY" : "NONE",
    systemVoltageV: 48,
    autonomyDays: wantBattery ? 0.5 : 0,
    dod: 0.8,
    eff: 0.9,
    reservePct,
    capacityKWh: 0,
    requiredAh: 0,
    rawKWhNeeded: 0,
    capped: false,
    capLimitKWh: 0,
    assumptions: null,
  };

  if (wantBattery) {
    const kWhNeededRaw = dailyKWh * battery.autonomyDays;
    battery.rawKWhNeeded = round1(kWhNeededRaw);

    const capLimit = mode.clientType === "CI" ? 250 : 80;
    battery.capLimitKWh = capLimit;

    let kWhNeeded = kWhNeededRaw;
    if (kWhNeededRaw > capLimit) {
      battery.capped = true;
      kWhNeeded = capLimit;
      diag.warnings.push(
        `Batería: con 0.5 día de autonomía resultaría ~${round0(kWhNeededRaw)} kWh. En Amateur se acota a ${capLimit} kWh (usa Modo Ingeniero para dimensionar batería real).`
      );
    }

    const usable = battery.dod * battery.eff;
    const cap = usable > 0 ? kWhNeeded / usable : 0;

    battery.capacityKWh = round1(cap);
    battery.requiredAh = round0((battery.capacityKWh * 1000) / battery.systemVoltageV);

    battery.assumptions = {
      backupEnergyKWh: round2(kWhNeeded),
      dod: round2(battery.dod),
      battEff: round2(battery.eff),
      reserve: round2(reservePct),
      criticalLoadKW: 0,
    };
  }

  // ---------- Estimación cableado / canalización ----------
  const wiringEstimates = estimateWiring({ site, mode, inverter });

  // ---------- WIRING SIZING (DC/AC) ----------
  const wiringSizing = computeWiringSizing({
    mode,
    location,
    inverter,
    installedKWp,
    wiringEstimates,
  });

  // ---------- BOM técnico ----------
  const bomTech = buildBomTech({
    mode,
    panel,
    panelsFinal,
    inverter,
    wantBattery,
    battery,
    siteDistances: site,
    zeroExport,
    wiringEstimates,
  });

  // ---------- engineerPreset ----------
  const engineerPreset = buildEngineerPreset({
    safe,
    panel,
    inverter,
    battery,
    dailyKWh,
    losses,
    tariff,
    selfConsumptionRatio,
    exportEnabled: !zeroExport && pref.wantExport,
    exportRatioGuess: !zeroExport && pref.wantExport ? 0.15 : 0,
    exportKW,
    packing,
    areaM2,
    wiringEstimates,
  });

  // ---------- salida nueva ----------
  const out = {
    ...safe,
    modeTag: "AMATEUR",
    sizing: {
      pv: {
        numberOfPanels: panelsFinal,
        panelPowerW: num(panel.powerW),
        installedPowerKWp: round2(installedKWp),
        annualEnergyKWh: round0(annualEnergyKWh),

        areaM2,
        packing,
        maxPanelsByArea,
        panelsTarget,
        limitedByArea,
        kWpTarget: round2(kWpTarget),
      },
      inverter: {
        inverterId: inverter.id,
        acPowerKW: num(inverter.acKw),
        dcAcRatio: round2(installedKWp / Math.max(1, num(inverter.acKw))),
      },
      battery: {
        mode: wantBattery ? "AUTONOMY" : "none",
        requiredBatteryKWh: wantBattery ? num(battery.capacityKWh) : 0,
        systemVoltageV: num(battery.systemVoltageV) || 48,
      },
    },
    battery: {
      enabled: battery.enabled,
      mode: battery.mode,
      capacityKWh: battery.capacityKWh,
      systemVoltageV: battery.systemVoltageV,
      autonomyDays: battery.autonomyDays,
      requiredAh: battery.requiredAh,
      rawKWhNeeded: battery.rawKWhNeeded,
      capped: battery.capped,
      capLimitKWh: battery.capLimitKWh,
      assumptions: battery.assumptions,
    },
    energy: {
      tariffCOPkWh: round2(tariff),
      dailyKWh: round2(dailyKWh),
      annualEnergyKWh: round0(annualEnergyKWh),
      selfConsumptionRatio: round2(selfConsumptionRatio),
      exportTargetKW: round1(exportKW),
      zeroExport: zeroExport,
      dcAcRatio: round2(installedKWp / Math.max(1, num(inverter.acKw))),
    },
    wiringEstimates,
    wiringSizing,
    bom: {
      technical: bomTech,
      costs: null,
    },
    diagrams: {
      unifilar: { svg: null, printable: true },
    },
    engineerPreset,
    diagnostics: {
      ok: diag.errors.length === 0,
      warnings: diag.warnings,
      errors: diag.errors,
      issues: [...diag.errors, ...diag.warnings],
    },
  };

  /* =========================
     FINANZAS (AMATEUR)
  ========================= */
  let costing = null;
  let finance = null;

  try {
    const legacyInputsForFinance = {
      clientMode: safe?.mode?.clientType === "CI" ? "CI" : "RES",
      country: safe?.location?.country === "ES" ? "España" : "Colombia",
      city: safe?.location?.city || "Cali",
      psh: num(safe?.location?.psh),
      tariffCOPkWh: round2(tariff),

      billingKWh: num(safe?.amateurInputs?.bill?.consumptionKWh),
      billingDays: num(safe?.amateurInputs?.bill?.billingDays),

      areaM2: areaM2,
      wantBattery: wantBattery,
      wantExport: Boolean(pref.wantExport) && !zeroExport,
      exportKW: round1(exportKW),

      panelToInverterM: num(safe?.amateurInputs?.site?.panelToInverterM ?? safe?.amateurInputs?.site?.panelDistanceM ?? 0),
      inverterToACBoardM: num(safe?.amateurInputs?.site?.inverterToACBoardM ?? safe?.amateurInputs?.site?.acBoardDistanceM ?? 0),
      inverterDistanceM: num(safe?.amateurInputs?.site?.inverterDistanceM ?? 0),

      panelsTarget: panelsTarget,
      maxPanelsByArea: maxPanelsByArea,
      limitedByArea: limitedByArea,
    };

    const financeForm = {
      wantBattery,
      battery: { requiredBatteryKWh: wantBattery ? num(battery.capacityKWh) : 0 },
      finance: {
        selfConsumptionRatio: selfConsumptionRatio,
        exportPriceCOPkWh: 0,
      },
    };

    costing = computeCosting({
      bom: { items: bomTech },
      sizing: out.sizing,
      wiringEstimates: out.wiringEstimates,
      stringing: null,
      protections: null,
      form: financeForm,
    });

    finance = computeFinance({
      costing,
      annualEnergyKWh: round0(annualEnergyKWh),
      inputs: legacyInputsForFinance,
      energy: out.energy,
      form: financeForm,
    });
  } catch (e) {
    diag.warnings.push(`Finanzas Amateur: no se pudo calcular (${e?.message || "error"}).`);
    costing = null;
    finance = null;
  }

  out.costing = costing;
  out.finance = finance;

  // ---------- salida legacy ----------
  const legacy = toLegacyOutput({
    safe,
    out,
    panel,
    inverter,
    battery,
    panelsFinal,
    installedKWp,
    annualEnergyKWh,
    tariff,
    exportKW,
    selfConsumptionRatio,
    bomTech,
  });

  legacy.costing = costing;
  legacy.finance = finance;

  // asegurar issues en legacy también
  legacy.diagnostics = legacy.diagnostics || {};
  legacy.diagnostics.issues = legacy.diagnostics.issues || [...(out.diagnostics?.issues || [])];

  return { ...out, ...legacy };
}

/* ========================= PANEL PICKER ========================= */

function pickBestPanelForArea({ areaM2, packing, kWpTarget, defaultPanel }) {
  const candidates = Array.isArray(AMATEUR_PANELS) && AMATEUR_PANELS.length ? AMATEUR_PANELS : [defaultPanel];

  const scored = candidates
    .map((p) => {
      const area = Math.max(0.5, num(p.areaM2) || 2.6);
      const maxPanels = Math.max(1, Math.floor((areaM2 * packing) / area));
      const maxKWp = (maxPanels * Math.max(1, num(p.powerW))) / 1000;

      const shortfall = Math.max(0, kWpTarget - maxKWp);
      return {
        panel: p,
        maxPanelsByArea: maxPanels,
        maxKWp,
        shortfall,
      };
    })
    .sort((a, b) => {
      if (a.shortfall !== b.shortfall) return a.shortfall - b.shortfall;
      return b.maxKWp - a.maxKWp;
    });

  const best = scored[0] || { panel: defaultPanel, maxPanelsByArea: 1 };

  const usedAlternative = best.panel?.id && defaultPanel?.id && best.panel.id !== defaultPanel.id;

  return {
    panel: best.panel || defaultPanel,
    maxPanelsByArea: best.maxPanelsByArea || 1,
    usedAlternative,
  };
}

/* ========================= WIRING ESTIMATES ========================= */

function estimateWiring({ site, mode, inverter }) {
  const distPanelInv = getDistance(site, "panelToInverterM", "panelDistanceM");
  const distInvAC = getDistance(site, "inverterToACBoardM", "acBoardDistanceM");
  const distInvDC = getDistance(site, "inverterDistanceM", "inverterDistanceM");

  const dcFactor = 2;

  const dcM = distPanelInv > 0 ? round0(distPanelInv * dcFactor) : 0;
  const acM = distInvAC > 0 ? round0(distInvAC) : 0;
  const conduitM = round0((distPanelInv || 0) + (distInvDC || 0) + (distInvAC || 0));

  const notes = [];
  if (mode?.clientType === "CI" && num(inverter?.acKw) >= 10) {
    notes.push("C&I: validar calibres AC y canalización en Modo Ingeniero.");
  }
  if (!distPanelInv && !distInvAC) {
    notes.push("Sin distancias: cableado/canalización en BOM se deja como 'set'.");
  }

  return {
    panelToInverterM: round1(distPanelInv),
    inverterToAcBoardM: round1(distInvAC),
    inverterToDcBoardM: round1(distInvDC),
    dcCableM: dcM,
    acCableM: acM,
    conduitM: conduitM,
    notes,
  };
}

/* ========================= WIRING SIZING ========================= */

function computeWiringSizing({ mode, location, inverter, installedKWp, wiringEstimates }) {
  const clientMode = mode?.clientType === "CI" ? "CI" : "RES";

  const country = location?.country === "ES" ? "ES" : "CO";
  const acV =
    num(mode?.voltageAC) > 0
      ? num(mode.voltageAC)
      : clientMode === "CI"
      ? country === "ES"
        ? 400
        : 380
      : country === "ES"
      ? 230
      : 220;

  const pf = 0.98;

  const acKw = num(inverter?.acKw) || (installedKWp > 0 ? installedKWp / 1.1 : 0);
  const acI =
    clientMode === "CI"
      ? acV > 0
        ? (acKw * 1000) / (Math.sqrt(3) * acV * pf)
        : 0
      : acV > 0
      ? (acKw * 1000) / (acV * pf)
      : 0;

  const invDcMaxV = num(inverter?.dcMaxV);
  const vdcNom = invDcMaxV >= 900 ? 800 : 500;

  const dcI = vdcNom > 0 ? (installedKWp * 1000) / vdcNom : 0;

  const dcPick = pickCableByCurrent(dcI, "DC");
  const acPick = pickCableByCurrent(acI, "AC");

  return {
    dc: {
      lengthM: num(wiringEstimates?.dcCableM),
      voltageV: vdcNom,
      currentA: round1(dcI),
      gaugeLabel: dcPick.label,
      ampacityA: dcPick.ampacityA,
    },
    ac: {
      lengthM: num(wiringEstimates?.acCableM),
      voltageV: acV,
      currentA: round1(acI),
      gaugeLabel: acPick.label,
      ampacityA: acPick.ampacityA,
    },
  };
}

function pickCableByCurrent(currentA, kind = "AC") {
  const I = Math.max(0, num(currentA));

  const table = [
    { label: "2.5 mm² (≈14 AWG)", ampacityA: 20 },
    { label: "4 mm² (≈12 AWG)", ampacityA: 30 },
    { label: "6 mm² (≈10 AWG)", ampacityA: 40 },
    { label: "10 mm² (≈8 AWG)", ampacityA: 55 },
    { label: "16 mm² (≈6 AWG)", ampacityA: 75 },
    { label: "25 mm² (≈4 AWG)", ampacityA: 100 },
    { label: "35 mm² (≈2 AWG)", ampacityA: 125 },
    { label: "50 mm² (≈1/0 AWG)", ampacityA: 150 },
    { label: "70 mm² (≈2/0 AWG)", ampacityA: 200 },
    { label: "95 mm² (≈3/0 AWG)", ampacityA: 260 },
  ];

  const margin = kind === "DC" ? 1.25 : 1.15;
  const required = I * margin;

  return table.find((x) => x.ampacityA >= required) || table[table.length - 1];
}

/* ========================= LEGACY ADAPTER ========================= */

function toLegacyOutput({
  safe,
  out,
  panel,
  inverter,
  battery,
  panelsFinal,
  installedKWp,
  annualEnergyKWh,
  tariff,
  exportKW,
  selfConsumptionRatio,
  bomTech,
}) {
  const clientMode = safe?.mode?.clientType === "CI" ? "CI" : "RES";

  const project = {
    name: safe?.meta?.projectName || "ENRGY ONE - Solar Designer",
    company: safe?.meta?.company || "—",
  };

  const inputs = {
    clientMode,
    country: safe?.location?.country === "ES" ? "España" : "Colombia",
    city: safe?.location?.city || "Cali",
    psh: num(safe?.location?.psh),
    tariffCOPkWh: round2(tariff),

    billingKWh: num(safe?.amateurInputs?.bill?.consumptionKWh),
    billingDays: num(safe?.amateurInputs?.bill?.billingDays),

    areaM2: num(safe?.amateurInputs?.site?.availableAreaM2),
    wantBattery: Boolean(safe?.amateurInputs?.preferences?.wantBattery),
    wantExport: Boolean(safe?.amateurInputs?.preferences?.wantExport) && !Boolean(safe?.amateurInputs?.bill?.zeroExport),
    exportKW: round1(exportKW),

    panelToInverterM: num(safe?.amateurInputs?.site?.panelToInverterM ?? safe?.amateurInputs?.site?.panelDistanceM ?? 0),
    inverterToACBoardM: num(
      safe?.amateurInputs?.site?.inverterToACBoardM ?? safe?.amateurInputs?.site?.acBoardDistanceM ?? 0
    ),
    inverterDistanceM: num(safe?.amateurInputs?.site?.inverterDistanceM ?? 0),

    panelsTarget: num(out?.sizing?.pv?.panelsTarget),
    maxPanelsByArea: num(out?.sizing?.pv?.maxPanelsByArea),
    limitedByArea: Boolean(out?.sizing?.pv?.limitedByArea),
  };

  const pv = {
    numberOfPanels: panelsFinal,
    requiredPower: round2(installedKWp),
    annualEnergy: round0(annualEnergyKWh),
    panelPower: num(panel.powerW),
  };

  const batteryLegacy = {
    mode: battery.enabled ? "autonomy" : "none",
    requiredBatteryKWh: battery.enabled ? battery.capacityKWh : 0,
    requiredAh: battery.enabled ? battery.requiredAh : 0,
    systemVoltage: battery.enabled ? battery.systemVoltageV : 48,
    assumptions: battery.assumptions || null,
  };

  return {
    modeTag: "AMATEUR",
    project,
    inputs,
    pv,
    battery: batteryLegacy,
    roi: null,
    stringing: { best: {} },
    protections: {},
    segments: { rows: [] },
    bomTech: { items: bomTech || [] },
    wiringEstimates: out?.wiringEstimates || null,
    wiringSizing: out?.wiringSizing || null,
    energy: out?.energy || null,
    sizing: out?.sizing || null,
    diagnostics: {
      ok: out?.diagnostics?.ok ?? true,
      issues: [...(out?.diagnostics?.errors || []), ...(out?.diagnostics?.warnings || [])],
    },
  };
}

/* ========================= INVENTARIO TÉCNICO ========================= */

function buildBomTech({ mode, panel, panelsFinal, inverter, wantBattery, battery, siteDistances, zeroExport, wiringEstimates }) {
  const items = [];

  const distPanelInv = getDistance(siteDistances, "panelToInverterM", "panelDistanceM");
  const distInvAC = getDistance(siteDistances, "inverterToACBoardM", "acBoardDistanceM");

  items.push({
    category: "Campo FV",
    description: panel.name,
    qty: panelsFinal,
    unit: "und",
    notes: `Potencia instalada ${((panelsFinal * num(panel.powerW)) / 1000).toFixed(2)} kWp`,
  });

  items.push({
    category: "Estructura",
    description: "Estructura / rieles / fijación por panel",
    qty: panelsFinal,
    unit: "kit/panel",
    notes: "Según cubierta (teja, losa, metálica, etc.)",
  });

  items.push({
    category: "Inversor",
    description: inverter.name,
    qty: 1,
    unit: "und",
    notes: `AC ${num(inverter.acKw)} kW • ${num(inverter.numMppt)} MPPT`,
  });

  items.push({
    category: "Protecciones DC",
    description: "Caja combinadora DC (si aplica)",
    qty: 1,
    unit: "und",
    notes: "Fusibles string, seccionador DC, SPD DC tipo 2 (según diseño)",
  });

  items.push({
    category: "Protecciones AC",
    description: "Protección AC tablero",
    qty: 1,
    unit: "set",
    notes: `Breaker AC + SPD AC tipo 2 • ${mode.phase}`,
  });

  if (zeroExport) {
    items.push({
      category: "Control",
      description: "Control cero-exportación (si no está integrado)",
      qty: 1,
      unit: "set",
      notes: "CT de medición + configuración (según inversor)",
    });
  }

  if (wiringEstimates?.dcCableM > 0) {
    items.push({
      category: "Cableado DC",
      description: "Cable solar DC + conectores (MC4)",
      qty: wiringEstimates.dcCableM,
      unit: "m",
      notes: `Dist panel→inv: ${fmtMaybe(distPanelInv)} m (ida). DC total ~${wiringEstimates.dcCableM} m (ida/vuelta).`,
    });
  } else {
    items.push({
      category: "Cableado DC",
      description: "Cable solar DC + conectores",
      qty: 1,
      unit: "set",
      notes: `Distancia aprox. panel→inversor: ${fmtMaybe(distPanelInv)} m`,
    });
  }

  if (wiringEstimates?.acCableM > 0) {
    items.push({
      category: "Cableado AC",
      description: "Cable AC hacia tablero",
      qty: wiringEstimates.acCableM,
      unit: "m",
      notes: `Dist inversor→tablero AC: ${fmtMaybe(distInvAC)} m. AC ~${wiringEstimates.acCableM} m.`,
    });
  } else {
    items.push({
      category: "Cableado AC",
      description: "Cable AC hacia tablero",
      qty: 1,
      unit: "set",
      notes: `Distancia aprox. inversor→tablero AC: ${fmtMaybe(distInvAC)} m`,
    });
  }

  items.push({
    category: "Puesta a tierra",
    description: "Sistema de puesta a tierra",
    qty: 1,
    unit: "set",
    notes: "Varilla, conductor, conectores, uniones equipotenciales",
  });

  if (wiringEstimates?.conduitM > 0) {
    items.push({
      category: "Canalización",
      description: "Tubería / canaleta / bandeja + accesorios",
      qty: wiringEstimates.conduitM,
      unit: "m",
      notes: "Metrado aproximado (recorridos). Confirmar en sitio.",
    });
  } else {
    items.push({
      category: "Canalización",
      description: "Tubería / canaleta / bandeja + accesorios",
      qty: 1,
      unit: "set",
      notes: "Según recorrido y estética",
    });
  }

  items.push({
    category: "Señalización",
    description: "Etiquetas y señalización FV",
    qty: 1,
    unit: "set",
    notes: "Rotulado de tableros, advertencias, planos básicos",
  });

  if (wantBattery) {
    items.push(
      {
        category: "Baterías",
        description: "Banco de baterías (técnico)",
        qty: 1,
        unit: "set",
        notes: `Capacidad preliminar ~ ${battery.capacityKWh} kWh @ ${battery.systemVoltageV} V`,
      },
      {
        category: "Baterías",
        description: "BMS / Protecciones batería (técnico)",
        qty: 1,
        unit: "set",
        notes: "Breaker DC, fusibles, contactor, BMS (según tecnología)",
      }
    );
  }

  items.push({
    category: "Monitoreo",
    description: "Monitoreo / datalogger (si no está incluido)",
    qty: 1,
    unit: "set",
    notes: "WiFi/4G según disponibilidad",
  });

  return items;
}

function getDistance(site, primary, alt) {
  if (!site) return 0;
  const a = num(site?.[primary]);
  if (a > 0) return a;
  const b = num(site?.[alt]);
  return b > 0 ? b : 0;
}

function fmtMaybe(x) {
  const n = num(x);
  return n > 0 ? n.toFixed(1) : "—";
}

/* ========================= PRESET PARA INGENIERO ========================= */

function buildEngineerPreset({
  safe,
  panel,
  inverter,
  battery,
  dailyKWh,
  losses,
  tariff,
  selfConsumptionRatio,
  exportEnabled,
  exportRatioGuess,
  exportKW,
  packing,
  areaM2,
  wiringEstimates,
}) {
  const { meta, location, mode, amateurInputs } = safe;

  const wantBattery = Boolean(battery?.enabled);
  const autonomyDays = wantBattery ? num(battery.autonomyDays) : 0;
  const autonomyHours = wantBattery ? round2(autonomyDays * 24) : 0;

  const systemVoltage = wantBattery ? num(battery.systemVoltageV) || 48 : 48;
  const dod = wantBattery ? num(battery.dod) || 0.8 : 0.8;
  const batteryEfficiency = wantBattery ? num(battery.eff) || 0.9 : 0.9;

  const distPanelInv = num(
    wiringEstimates?.panelToInverterM ??
      amateurInputs?.site?.panelToInverterM ??
      amateurInputs?.site?.panelDistanceM ??
      0
  );
  const distInvAC = num(
    wiringEstimates?.inverterToAcBoardM ??
      amateurInputs?.site?.inverterToACBoardM ??
      amateurInputs?.site?.acBoardDistanceM ??
      0
  );

  const preset = {
    modeTag: "ENGINEER_PRESET_FROM_AMATEUR",

    project: {
      name: meta.projectName || "ENRGY ONE - Solar Designer",
      company: meta.company || "—",
    },
    loc: {
      country: location.country === "ES" ? "España" : "Colombia",
      city: location.city,
      psh: num(location.psh),
    },
    clientMode: mode.clientType,

    bill: {
      billingKWh: num(amateurInputs.bill.consumptionKWh),
      billingDays: num(amateurInputs.bill.billingDays),
      billingEnergyCOP: String(amateurInputs.bill.energyCostCOP ?? ""),
      tariffCOPkWh: num(amateurInputs.bill.tariff ?? tariff),
      daytimeRatio: clamp01(num(amateurInputs.bill.daytimeRatio) || 0.85),
      zeroExport: Boolean(amateurInputs.bill.zeroExport),

      demandMaxKW: 0,
      demandBillableKW: 0,
      demandChargeCOPperKWMonth: 0,
      peakShavingEnabled: false,
      targetMaxKW: 0,
      shaveHoursPerDay: 0,
      shaveDays: 0,
      reservePct: 0.1,
    },

    form: {
      panelId: panel.id,
      inverterId: inverter.id,

      areaM2: Math.max(0, num(areaM2)),
      panelAreaM2: Math.max(0, num(panel.areaM2 ?? 0)),
      packingFactor: Number.isFinite(num(packing)) ? num(packing) : 0.85,

      batteryId: wantBattery ? "bat_48v_generic" : "bat_none",
      wantBattery,
      useBattery: wantBattery,
      hasBattery: wantBattery,

      dailyConsumption: round2(dailyKWh),
      systemLosses: losses,
      peakSunHours: num(location.psh),

      panelPower: num(panel.powerW),
      vmp: num(panel.vmp),
      voc: num(panel.voc),
      imp: num(panel.imp),
      isc: num(panel.isc),

      vocTempCoeffPctPerC: -0.28,
      vmpTempCoeffPctPerC: -0.35,
      iscTempCoeffPctPerC: 0.05,
      impTempCoeffPctPerC: 0.02,

      tMinC: location.country === "ES" ? -5 : 0,
      tOpC: 45,
      tMaxC: 70,

      acKw: num(inverter.acKw),
      mpptVmin: num(inverter.mpptVmin),
      mpptVmax: num(inverter.mpptVmax),
      dcMaxV: num(inverter.dcMaxV),
      mpptMaxInputA: num(inverter.mpptMaxInputA),
      numMppt: num(inverter.numMppt),
      inverterEff: num(inverter.eff),

      acPhase: mode.clientType === "CI" ? "3P" : "1P",
      acVoltageV: num(mode.voltageAC) || (location.country === "ES" ? 230 : 220),

      autonomyDays: round2(autonomyDays),
      autonomyHours: round2(autonomyHours),
      dod: round2(dod),
      batteryEfficiency: round2(batteryEfficiency),
      systemVoltage: round0(systemVoltage),

      batteryCapacityKWh_ref: round2(battery?.capacityKWh || 0),
      batteryRequiredAh_ref: round0(battery?.requiredAh || 0),

      conductorMaterial: "Cu",
      ambientC: 30,
      installType: "conduit",
      numCircuits: 1,
      numCombiners: 1,

      L_stringToCombiner_1w: Math.max(0, distPanelInv),
      L_combinerToInverter_1w: 0,
      L_inverterToACPanel_1w: Math.max(0, distInvAC),

      maxDropDC_string: 1.5,
      maxDropDC_main: 1.5,
      maxDropAC_seg: 3,

      tariff: round2(tariff),
      selfConsumptionRatio: round2(selfConsumptionRatio),

      // export explícito
      wantExport: Boolean(exportEnabled),
      exportKW: round2(num(exportKW)),
      exportRatio: exportEnabled ? exportRatioGuess : 0,

      finance: {
        selfConsumptionRatio: round2(selfConsumptionRatio),
        exportPriceCOPkWh: 300,
      },

      capex: 0,
      opexAnnual: 0,
      degradationAnnual: 0.008,
      taxPct: 0,
      marginPct: 0,
    },

    inputs: {
      wantBattery,
      batteryId: wantBattery ? "bat_48v_generic" : "bat_none",
      autonomyDays: round2(autonomyDays),
      autonomyHours: round2(autonomyHours),
      batteryDoD: round2(dod),
      batteryEfficiency: round2(batteryEfficiency),
      systemVoltage: round0(systemVoltage),
      dailyConsumption: round2(dailyKWh),
      tariff: round2(tariff),
      selfConsumptionRatio: round2(selfConsumptionRatio),

      wantExport: Boolean(exportEnabled),
      exportKW: round2(num(exportKW)),
      exportRatio: exportEnabled ? exportRatioGuess : 0,

      acVoltageV: num(mode.voltageAC) || (location.country === "ES" ? 230 : 220),
      acPhase: mode.clientType === "CI" ? "3P" : "1P",
    },
  };

  return preset;
}

/* ========================= NORMALIZERS / HELPERS ========================= */

function normalizeModel(m) {
  const meta = m?.meta || {};
  const location = m?.location || {};
  const mode = m?.mode || {};
  const amateurInputs = m?.amateurInputs || {};

  return {
    meta: {
      projectName: String(meta.projectName || ""),
      company: String(meta.company || "—"),
      country: meta.country === "ES" ? "ES" : "CO",
      city: String(meta.city || location.city || "Cali"),
      userMode: "AMATEUR",
      createdAt: meta.createdAt || new Date().toISOString(),
    },
    location: {
      country: location.country === "ES" ? "ES" : "CO",
      city: String(location.city || meta.city || "Cali"),
      latitude: location.latitude ?? null,
      longitude: location.longitude ?? null,
      psh: num(location.psh) || 4.8,
      source: location.source || "preset",
    },
    mode: {
      clientType: mode.clientType === "CI" ? "CI" : "RES",
      phase: mode.phase || (mode.clientType === "CI" ? "3F" : "1F"),
      voltageAC: num(mode.voltageAC) || 0,
    },
    amateurInputs: {
      bill: {
        consumptionKWh: amateurInputs?.bill?.consumptionKWh ?? 0,
        billingDays: amateurInputs?.bill?.billingDays ?? 30,
        energyCostCOP: amateurInputs?.bill?.energyCostCOP ?? "",
        tariff: amateurInputs?.bill?.tariff ?? "",
        daytimeRatio: amateurInputs?.bill?.daytimeRatio ?? 0.85,
        zeroExport: Boolean(amateurInputs?.bill?.zeroExport),
      },
      site: {
        availableAreaM2: amateurInputs?.site?.availableAreaM2 ?? 20,

        panelToInverterM: amateurInputs?.site?.panelToInverterM ?? amateurInputs?.site?.panelDistanceM ?? "",
        inverterDistanceM: amateurInputs?.site?.inverterDistanceM ?? "",
        inverterToACBoardM: amateurInputs?.site?.inverterToACBoardM ?? amateurInputs?.site?.acBoardDistanceM ?? "",
        acBoardDistanceM: amateurInputs?.site?.acBoardDistanceM ?? "",
        panelDistanceM: amateurInputs?.site?.panelDistanceM ?? "",
      },
      preferences: {
        wantBattery: Boolean(amateurInputs?.preferences?.wantBattery),
        wantExport: Boolean(amateurInputs?.preferences?.wantExport),
        exportPowerKW: amateurInputs?.preferences?.exportPowerKW ?? 0,
      },
    },
  };
}

function num(x) {
  const s = String(x ?? "").trim().replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function money(x) {
  const cleaned = String(x ?? "").replace(/[^\d.-]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function clamp01(x) {
  const n = num(x);
  return Math.max(0, Math.min(1, n));
}

function round0(n) {
  return Math.round(num(n));
}
function round1(n) {
  return Math.round(num(n) * 10) / 10;
}
function round2(n) {
  return Math.round(num(n) * 100) / 100;
}
