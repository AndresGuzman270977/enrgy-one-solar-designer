// src/engine/economics.js
// SAFE MODE: sin imports externos (evita pantallas en blanco por resolución de módulos)
// Ahora: economics orquesta usando financeEngine (CAPEX + VPN/TIR/Payback/LCOE)

import { computeCosting, computeFinance } from "./financeEngine";

function num(x) {
  const s = String(x ?? "").trim().replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

export function computeEconomicsFromSizing(result) {
  const r = result || {};

  // Estructuras típicas del motor
  const inputs = r.inputs || {};
  const energy = r.energy || {};
  const pv = r.pv || {};
  const sizing = r.sizing || {};
  const wiringEstimates = r.wiringEstimates || r.wiring || {};
  const stringing = r.stringing || null;
  const protections = r.protections || null;
  const bom = r.bom || null;

  // Form puede venir en diferentes lugares según tu pipeline
  // Preferimos inputs.form (EngineerForm envía preset con form allí en muchos diseños),
  // luego r.form, luego inputs (por compat).
  const form = inputs.form || r.form || inputs || {};

  // Energía anual: soporta pv.annualEnergy (tu economics viejo) y energy.annualEnergyKWh
  const annualEnergyKWh =
    num(energy?.annualEnergyKWh) ||
    num(pv?.annualEnergyKWh) ||
    num(pv?.annualEnergy) ||
    num(r?.annualEnergyKWh) ||
    0;

  // Tarifa: soporta energy.tariffCOPkWh e inputs.tariffCOPkWh
  const tariffCOPkWh = num(energy?.tariffCOPkWh) || num(inputs?.tariffCOPkWh) || 0;

  // Asegura que energy tenga lo mínimo esperado por computeFinance
  const safeEnergy = { ...energy, tariffCOPkWh };

  // Asegura que sizing tenga pv/inverter si tu motor dejó pv fuera
  const safeSizing = {
    ...sizing,
    pv: sizing?.pv || pv || {},
  };

  // 1) CAPEX / Costing
  const costing = computeCosting({
    bom,
    sizing: safeSizing,
    wiringEstimates,
    stringing,
    protections,
    form,
  });

  // 2) Finance (VPN/TIR/Payback/ROI/LCOE)
  const finance = computeFinance({
    costing,
    annualEnergyKWh,
    inputs,
    energy: safeEnergy,
    form,
  });

  // 3) Salida unificada (para Results.jsx)
  return {
    currency: "COP",
    annualEnergyKWh: Math.round(annualEnergyKWh),
    tariffCOPkWh: Math.round(tariffCOPkWh),

    costing, // capexLines, totalCapex, subtotales
    finance, // npvCOP, irr, paybacks, flows, lcoe, assumptions

    // compat / alias por si alguna parte de UI esperaba "capex" o "roi"
    capex: {
      total: costing?.totalCapex ?? 0,
      equipmentSubtotal: costing?.equipmentSubtotal ?? 0,
      installCOP: costing?.installCOP ?? 0,
      engineeringCOP: costing?.engineeringCOP ?? 0,
      contingencyCOP: costing?.contingencyCOP ?? 0,
      permitsCOP: costing?.permitsCOP ?? 0,
      taxCOP: costing?.taxCOP ?? 0,
      marginCOP: costing?.marginCOP ?? 0,
      lines: costing?.capexLines || [],
    },
    roi: {
      paybackYear: finance?.paybackYear ?? null,
      paybackDiscountedYear: finance?.paybackDiscountedYear ?? null,
      irr: finance?.irr ?? null,
      npvCOP: finance?.npvCOP ?? 0,
      roi: finance?.roi ?? null,
      lcoeCOPkWh: finance?.lcoeCOPkWh ?? null,
    },
  };
}
