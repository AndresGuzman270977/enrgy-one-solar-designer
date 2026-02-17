// src/engine/energyEngine.js
// Energy Engine común (v1.0)
// Fuente única de verdad para:
// - dailyKWh (consumo diario)
// - exportTargetKW (meta exportación en kW)
// - exportEnergyAnnualKWh (energía anual por exportación aprox.)
// - requiredKwp (kWp objetivo)
// - panelsTarget (paneles objetivo por energía)
// - annualEnergyKWh (energía anual FV estimada)
// - dcAcRatio (si se conoce acKw)

export function computeEnergyPlan(params = {}) {
  const {
    // ubicación / recurso
    psh: pshIn,
    losses: lossesIn,

    // consumo
    dailyKWh: dailyKWhIn,
    billingKWh,
    billingDays,

    // panel
    panelW,

    // inversor / ratio
    acKw, // opcional, para dc/ac ratio o mínimos

    // exportación (elige 1)
    exportKW: exportKWIn,
    exportRatio: exportRatioIn, // 0..1  (si no hay exportKW)
    wantExport,

    // límites/sobredimensionado suave
    minDcAc = 1.05,
    maxDcAc = 1.35,

    // extras
    clampExportKWToAc = true,
  } = params;

  const psh = clampMin(num(pshIn), 0);
  const losses = clamp01(lossesIn, 0.2);

  const pW = clampMin(num(panelW), 1);

  // consumo diario (prioridad: dailyKWhIn -> factura -> 0)
  const bKWh = clampMin(num(billingKWh), 0);
  const bDays = Math.max(1, clampMin(num(billingDays), 0));
  const dailyFromBill = bKWh > 0 ? bKWh / bDays : 0;
  const dailyKWh = clampMin(num(dailyKWhIn) > 0 ? num(dailyKWhIn) : dailyFromBill, 0);

  // export target kW (prioridad: exportKWIn -> exportRatio*acKw -> 0)
  const ac = clampMin(num(acKw), 0);
  const exportRatio = clamp01(exportRatioIn, 0);

  let exportTargetKW = clampMin(num(exportKWIn), 0);

  const wants = Boolean(wantExport) || exportTargetKW > 0 || exportRatio > 0;
  if (wants && exportTargetKW <= 0 && exportRatio > 0 && ac > 0) {
    exportTargetKW = round1(ac * exportRatio);
  }
  if (!wants) exportTargetKW = 0;

  // si exportKW supera AC, clamp (opcional)
  if (clampExportKWToAc && ac > 0 && exportTargetKW > ac) {
    exportTargetKW = ac;
  }

  // energía anual FV necesaria:
  // E_fv = (E_load + E_export) / (selfcons??)  -> aquí NO dividimos por autoconsumo; eso es financiero.
  // A nivel diseño: generas energía total, y luego finanzas usan selfConsumptionRatio.
  // E_export anual aprox: exportKW * psh * 365 (simplificado; es "potencia meta" en horas solares)
  const exportEnergyAnnualKWh = (exportTargetKW > 0 && psh > 0)
    ? exportTargetKW * psh * 365
    : 0;

  const loadAnnualKWh = dailyKWh * 365;
  const requiredAnnualKWh = loadAnnualKWh + exportEnergyAnnualKWh;

  // kWp requerido por energía (con pérdidas)
  const denom = psh * 365 * Math.max(0.01, 1 - losses);
  let requiredKwp = denom > 0 ? (requiredAnnualKWh / denom) : 0;

  // si hay acKw, mantenemos dc/ac en banda
  if (ac > 0) {
    const minKwp = ac * minDcAc;
    const maxKwp = ac * maxDcAc;
    requiredKwp = clamp(requiredKwp, minKwp, maxKwp);
  }

  if (!Number.isFinite(requiredKwp) || requiredKwp < 0.1) requiredKwp = 0.1;

  const panelsTarget = Math.max(1, Math.ceil((requiredKwp * 1000) / pW));
  const installedKWp = (panelsTarget * pW) / 1000;

  const annualEnergyKWh = (psh > 0)
    ? installedKWp * psh * 365 * Math.max(0.01, 1 - losses)
    : 0;

  const dcAcRatio = ac > 0 ? installedKWp / ac : null;

  return {
    psh,
    losses,
    dailyKWh: round2(dailyKWh),

    exportTargetKW: round1(exportTargetKW),
    exportEnergyAnnualKWh: round0(exportEnergyAnnualKWh),

    requiredAnnualKWh: round0(requiredAnnualKWh),
    requiredKwp: round2(requiredKwp),

    panelsTarget,
    installedKWp: round2(installedKWp),

    annualEnergyKWh: round0(annualEnergyKWh),
    dcAcRatio: dcAcRatio != null ? round2(dcAcRatio) : null,
  };
}

/* ---------------- utils ---------------- */

function num(x) {
  const s = String(x ?? "").trim().replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
function clamp01(x, fallback = 0) {
  const n = num(x);
  if (!Number.isFinite(n) || String(x ?? "").trim() === "") return fallback;
  return Math.max(0, Math.min(1, n));
}
function clampMin(x, min) {
  const n = num(x);
  return Number.isFinite(n) ? Math.max(min, n) : min;
}
function clamp(x, lo, hi) {
  const n = num(x);
  return Math.max(lo, Math.min(hi, n));
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
