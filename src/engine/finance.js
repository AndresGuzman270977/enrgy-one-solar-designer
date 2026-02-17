// src/engine/finance.js
// Wrapper de compatibilidad: NO re-implementa finanzas.
// Orquesta usando financeEngine (única fuente de verdad).

import { computeCosting, computeFinance } from "./financeEngine";

function num(x) {
  const s = String(x ?? "").trim().replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Compat: antes venía form plano (analysisYears, discountRate, etc).
 * Ahora viene form.finance (EngineerForm PRO).
 * Esta función fusiona para que financeEngine siempre reciba form.finance bien.
 */
function normalizeFormForFinanceEngine(formMaybe) {
  const form = formMaybe && typeof formMaybe === "object" ? formMaybe : {};

  // si ya viene form.finance, no tocamos
  if (form.finance && typeof form.finance === "object") return form;

  // si venía plano, lo migramos a finance
  const finance = {
    analysisYears: form.analysisYears,
    discountRate: form.discountRate,
    degradationPct: form.degradationPct,
    tariffEscalationPct: form.tariffEscalationPct,
    omPctPerYear: form.omPctPerYear,
    omEscalationPct: form.omEscalationPct,
    selfConsumptionRatio: form.selfConsumptionRatio,
    exportPriceCOPkWh: form.exportPriceCOPkWh,
    inverterReplaceYear: form.inverterReplaceYear,
    inverterReplacePctOfInverterCost: form.inverterReplacePctOfInverterCost,
    contingencyPct: form.contingencyPct,
    installPct: form.installPct,
    engineeringPct: form.engineeringPct,
    permitsCOP: form.permitsCOP,
    insuranceCOPperYear: form.insuranceCOPperYear,
    cleaningCOPperYear: form.cleaningCOPperYear,
    taxPct: form.taxPct,
    marginPct: form.marginPct,
  };

  return { ...form, finance };
}

/**
 * NUEVO: reemplaza tu computeProjectCosts viejo.
 * - Usa la lógica de financeEngine (costing por líneas CAPEX + porcentajes)
 * - Devuelve un objeto compatible con tu UI anterior.
 */
export function computeProjectCosts({ bom, sizing, wiringEstimates, stringing, protections, form }) {
  const safeForm = normalizeFormForFinanceEngine(form);

  const costing = computeCosting({
    bom,
    sizing,
    wiringEstimates,
    stringing,
    protections,
    form: safeForm,
  });

  // Compat: antes retornabas "items" con unitCostCOP y lineTotalCOP.
  // Ahora retornamos capexLines que ya trae unitCostCOP + totalCOP.
  const items = (costing.capexLines || []).map((x) => ({
    category: x.category,
    item: x.concept,
    qty: x.qty,
    unit: x.unit,
    unitCostCOP: x.unitCostCOP,
    lineTotalCOP: x.totalCOP,
  }));

  return {
    items,
    equipmentSubtotal: costing.equipmentSubtotal,
    capexExtraCOP: 0, // ya no se usa aquí (si lo necesitas, lo metemos como permitsCOP o un campo extra)
    installCOP: costing.installCOP,
    baseCapex: num(costing.totalCapex) - num(costing.taxCOP) - num(costing.marginCOP),
    taxCOP: costing.taxCOP,
    marginCOP: costing.marginCOP,
    totalCapex: costing.totalCapex,
    // extra útil para debug
    _costing: costing,
  };
}

/**
 * NUEVO: reemplaza computeFinanceKPIs viejo.
 * - Toma capexCOP y annualEnergyKWh
 * - Usa computeFinance (VPN/TIR/Payback/ROI/LCOE + flows)
 * - Devuelve compatible con la estructura anterior
 */
export function computeFinanceKPIs({ capexCOP, annualEnergyKWh, form, inputs, energy, costing }) {
  const safeForm = normalizeFormForFinanceEngine(form);

  const safeCosting =
    costing && typeof costing === "object"
      ? costing
      : {
          totalCapex: num(capexCOP),
          capexLines: [],
        };

  const fin = computeFinance({
    costing: safeCosting,
    annualEnergyKWh: num(annualEnergyKWh),
    inputs: inputs || {},
    energy: energy || {},
    form: safeForm,
  });

  // Compat con tu UI anterior:
  return {
    years: fin.years,
    discountRate: fin.discountRate,
    npvCOP: fin.npvCOP,
    irr: fin.irr,
    paybackYear: fin.paybackYear,
    roi: fin.roi,
    flows: (fin.flows || []).map((f) => ({
      year: f.year,
      energyKWh: f.energyKWh,
      tariffCOPkWh: f.tariffCOPkWh,
      savingsCOP: f.savingsCOP,
      exportCOP: f.exportCOP,
      opexCOP: f.opexCOP,
      netCOP: f.netCOP,
      netDiscCOP: f.netDiscCOP,
      cumCOP: f.cumDiscCOP, // antes era cumCOP sin descuento; aquí dejamos el acumulado descontado (más útil)
    })),
    // extras PRO
    paybackDiscountedYear: fin.paybackDiscountedYear,
    lcoeCOPkWh: fin.lcoeCOPkWh,
    assumptions: fin.assumptions,
    _finance: fin,
  };
}
