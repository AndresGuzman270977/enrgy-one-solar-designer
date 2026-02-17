// src/engine/financeEngine.js
// SAFE MODE: sin imports externos (evita pantallas en blanco por resolución de módulos)
// v1.8 PRO PATCH:
// - annualEnergyKWh robusto (soporta variantes de nombres)
// - tarifa/autoconsumo/exportPrice con prioridad consistente
// - ROI corregido (sin doble contar CAPEX)
// - OPEX más claro (pct + fijo) y estable
// - reemplazo inversor robusto

const DEFAULT_PRICING_COP = {
  panel_watt_price: 1.35, // COP por Wp
  inverter_kwac_price: 1450000, // COP por kWac
  structure_per_panel: 120000,
  dc_protections_per_string: 90000,
  spd_dc: 240000,
  spd_ac: 260000,
  ac_breaker_base: 180000,
  dc_switch: 220000,
  cable_dc_m: 18000,
  cable_ac_m: 22000,
  conduit_m: 9000,

  // ✅ batería
  battery_kwh_price: 1650000,
  // battery_bos_pct: 0.10, // opcional
};

const DEFAULT_FINANCE = {
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

export function computeCosting({ bom, sizing, wiringEstimates, stringing, protections, form }) {
  const pricing =
    form && typeof form === "object" && form.pricing && typeof form.pricing === "object" ? form.pricing : {};

  const price = (k, fallback) => {
    const v = pricing[k];
    if (isFiniteNum(v)) return num(v);
    const d = DEFAULT_PRICING_COP[k];
    if (isFiniteNum(d)) return num(d);
    return num(fallback);
  };

  const pv = sizing?.pv || {};
  const inv = sizing?.inverter || {};

  const panels = Math.max(0, round0(pv.numberOfPanels ?? 0));
  const panelW = Math.max(0, num(pv.panelPowerW ?? stringing?.panel?.powerW ?? 0));
  const inverterAcKw = Math.max(0, num(inv.acPowerKW ?? 0));
  const stringsUsed = Math.max(0, round0(stringing?.result?.stringsUsed ?? 0));

  const dcCableM = Math.max(0, round0(wiringEstimates?.dcCableM ?? 0));
  const acCableM = Math.max(0, round0(wiringEstimates?.acCableM ?? 0));
  const conduitM = Math.max(0, round0(wiringEstimates?.conduitM ?? 0));

  // ✅ BATERÍA: robusto
  const wantBattery = Boolean(form?.wantBattery) || Boolean(sizing?.battery?.mode && sizing.battery.mode !== "none");

  const batteryKWh = Math.max(
    0,
    num(
      sizing?.battery?.requiredBatteryKWh ??
        form?.battery?.requiredBatteryKWh ??
        form?.requiredBatteryKWh ??
        inferBatteryKWhFromBom(bom) ??
        0
    )
  );

  const panel_watt_price = price("panel_watt_price", 1.35);
  const inverter_kwac_price = price("inverter_kwac_price", 1450000);
  const structure_per_panel = price("structure_per_panel", 120000);
  const dc_protections_per_string = price("dc_protections_per_string", 90000);
  const spd_dc = price("spd_dc", 240000);
  const spd_ac = price("spd_ac", 260000);
  const ac_breaker_base = price("ac_breaker_base", 180000);
  const dc_switch = price("dc_switch", 220000);

  const cable_dc_m = price("cable_dc_m", 18000);
  const cable_ac_m = price("cable_ac_m", 22000);
  const conduit_m = price("conduit_m", 9000);

  const battery_kwh_price = price("battery_kwh_price", 1650000);

  // Opcional
  const battery_bos_pct = isFiniteNum(pricing?.battery_bos_pct) ? clampMin(pricing.battery_bos_pct, 0) : 0;

  const capexLines = [];
  const pushLine = (category, concept, qty, unit, unitCostCOP) => {
    const q = Math.max(0, num(qty));
    const u = Math.max(0, num(unitCostCOP));
    capexLines.push({
      category,
      concept,
      qty: q,
      unit,
      unitCostCOP: round0(u),
      totalCOP: round0(q * u),
    });
  };

  if (panels > 0 && panelW > 0)
    pushLine("Equipos FV", `Panel FV ${round0(panelW)} Wp`, panels, "und", panelW * panel_watt_price);

  if (inverterAcKw > 0)
    pushLine("Inversor", `Inversor ${round2(inverterAcKw)} kWac`, 1, "und", inverterAcKw * inverter_kwac_price);

  if (panels > 0) pushLine("Estructura", "Estructura + herrajes por panel", panels, "und", structure_per_panel);

  if (stringsUsed > 0)
    pushLine("Protecciones DC", "Fusibles / portafusibles por string", stringsUsed, "string", dc_protections_per_string);

  pushLine("Protecciones DC", "SPD DC", 1, "und", spd_dc);
  pushLine("Protecciones AC", "SPD AC", 1, "und", spd_ac);
  pushLine("Protecciones AC", "Breaker AC (base)", 1, "und", ac_breaker_base);
  pushLine("Protecciones DC", "Seccionador DC", 1, "und", dc_switch);

  if (dcCableM > 0) pushLine("Cableado", "Cable DC (promedio)", dcCableM, "m", cable_dc_m);
  if (acCableM > 0) pushLine("Cableado", "Cable AC (promedio)", acCableM, "m", cable_ac_m);
  if (conduitM > 0) pushLine("Canalización", "Canalización (tubería/canaleta)", conduitM, "m", conduit_m);

  // ✅ BATERÍAS al CAPEX (si aplica)
  if (wantBattery && batteryKWh > 0) {
    pushLine("Baterías", `Banco baterías (útil) ~${round2(batteryKWh)} kWh`, batteryKWh, "kWh", battery_kwh_price);

    if (battery_bos_pct > 0) {
      const base = round0(batteryKWh * battery_kwh_price);
      pushLine(
        "Baterías",
        `BOS batería (BMS/rack/protección) ${(battery_bos_pct * 100).toFixed(1)}%`,
        1,
        "set",
        base * battery_bos_pct
      );
    }
  }

  const equipmentSubtotal = round0(sum(capexLines.map((x) => x.totalCOP)));

  // finanzas defaults
  const fin = mergeFinanceDefaults(form?.finance);

  const contingencyPct = clampMin(fin.contingencyPct, 0);
  const installPct = clampMin(fin.installPct, 0);
  const engineeringPct = clampMin(fin.engineeringPct, 0);
  const permitsCOP = clampMin(fin.permitsCOP, 0);

  const taxPct = clampMin(fin.taxPct, 0);
  const marginPct = clampMin(fin.marginPct, 0);

  const installCOP = round0(equipmentSubtotal * installPct);
  const engineeringCOP = round0(equipmentSubtotal * engineeringPct);
  const contingencyCOP = round0(equipmentSubtotal * contingencyPct);
  const permits = round0(permitsCOP);

  const taxCOP = round0((equipmentSubtotal + installCOP + engineeringCOP + contingencyCOP + permits) * taxPct);
  const marginCOP = round0((equipmentSubtotal + installCOP + engineeringCOP + contingencyCOP + permits + taxCOP) * marginPct);

  const totalCapex = round0(equipmentSubtotal + installCOP + engineeringCOP + contingencyCOP + permits + taxCOP + marginCOP);

  return {
    capexLines,
    equipmentSubtotal,
    installCOP,
    engineeringCOP,
    permitsCOP: permits,
    contingencyCOP,
    taxCOP,
    marginCOP,
    totalCapex,
    pricingUsed: { ...DEFAULT_PRICING_COP, ...pricing },
    battery: { wantBattery, batteryKWh },
  };
}

export function computeFinance({ costing, annualEnergyKWh, inputs, energy, form }) {
  const fin = mergeFinanceDefaults(form?.finance);

  const years = clampInt(fin.analysisYears, 1, 40, DEFAULT_FINANCE.analysisYears);

  const discountRate = clampMin(fin.discountRate, 0);
  const degradationPct = clampMin(fin.degradationPct, 0);
  const tariffEscalationPct = clampMin(fin.tariffEscalationPct, 0);

  const omPctPerYear = clampMin(fin.omPctPerYear, 0);
  const omEscalationPct = clampMin(fin.omEscalationPct, 0);

  // ✅ selfConsumption: prioridad consistente y robusta
  const selfConsumptionRatio = clamp01(
    isFiniteNum(fin.selfConsumptionRatio)
      ? fin.selfConsumptionRatio
      : isFiniteNum(form?.selfConsumptionRatio)
      ? form.selfConsumptionRatio
      : isFiniteNum(energy?.selfConsumptionRatio)
      ? energy.selfConsumptionRatio
      : DEFAULT_FINANCE.selfConsumptionRatio,
    DEFAULT_FINANCE.selfConsumptionRatio
  );

  // ✅ export price: acepta de fin, o de form si lo pasas
  const exportPriceCOPkWh = clampMin(
    isFiniteNum(fin.exportPriceCOPkWh)
      ? fin.exportPriceCOPkWh
      : isFiniteNum(form?.exportPriceCOPkWh)
      ? form.exportPriceCOPkWh
      : 0,
    0
  );

  const inverterReplaceYear = clampInt(fin.inverterReplaceYear, 0, 50, DEFAULT_FINANCE.inverterReplaceYear);
  const inverterReplacePctOfInverterCost = clamp01(
    fin.inverterReplacePctOfInverterCost,
    DEFAULT_FINANCE.inverterReplacePctOfInverterCost
  );

  const insuranceCOPperYear = clampMin(fin.insuranceCOPperYear, 0);
  const cleaningCOPperYear = clampMin(fin.cleaningCOPperYear, 0);

  const capex = clampMin(costing?.totalCapex, 0);

  // ✅ energía anual robusta (variantes)
  const annualE0 = clampMin(
    annualEnergyKWh ??
      energy?.annualEnergyKWh ??
      energy?.annualKWh ??
      energy?.annualEnergy ??
      energy?.yearlyKWh ??
      0,
    0
  );

  // ✅ tarifa robusta
  const tariff0 = clampMin(
    energy?.tariffCOPkWh ?? inputs?.tariffCOPkWh ?? form?.tariffCOPkWh ?? form?.finance?.tariffCOPkWh ?? 0,
    0
  );

  const inverterCostBase = findInverterCost(costing?.capexLines || []);
  const flows = [];

  let cumDisc = -capex;
  flows.push({
    year: 0,
    energyKWh: 0,
    tariffCOPkWh: round0(tariff0),
    savingsCOP: 0,
    exportCOP: 0,
    opexCOP: 0,
    replacementsCOP: 0,
    netCOP: -round0(capex),
    netDiscCOP: -round0(capex),
    cumDiscCOP: round0(cumDisc),
  });

  for (let y = 1; y <= years; y++) {
    const energyY = annualE0 * Math.pow(1 - degradationPct, y - 1);
    const tariffY = tariff0 * Math.pow(1 + tariffEscalationPct, y - 1);

    const savingsCOP = energyY * selfConsumptionRatio * tariffY;
    const exportCOP = energyY * (1 - selfConsumptionRatio) * exportPriceCOPkWh;

    // ✅ OPEX = pct CAPEX + fijos; ambos escalables
    const opexPct = capex * omPctPerYear;
    const opexFixed = insuranceCOPperYear + cleaningCOPperYear;
    const opex0 = opexPct + opexFixed;
    const opex = opex0 * Math.pow(1 + omEscalationPct, y - 1);

    let replacements = 0;
    if (inverterReplaceYear > 0 && y === inverterReplaceYear && inverterCostBase > 0) {
      replacements = inverterCostBase * inverterReplacePctOfInverterCost;
    }

    const net = savingsCOP + exportCOP - opex - replacements;
    const df = Math.pow(1 + discountRate, y);
    const netDisc = df > 0 ? net / df : net;

    cumDisc += netDisc;

    flows.push({
      year: y,
      energyKWh: round0(energyY),
      tariffCOPkWh: round0(tariffY),
      savingsCOP: round0(savingsCOP),
      exportCOP: round0(exportCOP),
      opexCOP: round0(opex),
      replacementsCOP: round0(replacements),
      netCOP: round0(net),
      netDiscCOP: round0(netDisc),
      cumDiscCOP: round0(cumDisc),
    });
  }

  const cash = flows.map((f) => num(f.netCOP));
  const npv = flows.reduce((acc, f) => acc + num(f.netDiscCOP), 0);

  const irr = computeIRR(cash);
  const paybackYear = computePaybackYear(flows, capex, false);
  const paybackDiscountedYear = computePaybackYear(flows, capex, true);

  // ✅ ROI corregido: beneficio neto / CAPEX
  const totalNetYears = flows.slice(1).reduce((acc, f) => acc + num(f.netCOP), 0);
  const profitNet = totalNetYears - capex;
  const roi = capex > 0 ? profitNet / capex : null;

  const pvCosts = computePVCosts(flows, discountRate, capex);
  const pvEnergy = computePVEnergy(flows, discountRate);
  const lcoe = pvEnergy > 0 ? pvCosts / pvEnergy : null;

  return {
    years,
    discountRate,
    npvCOP: round0(npv),
    irr,
    paybackYear,
    paybackDiscountedYear,
    roi,
    lcoeCOPkWh: lcoe != null ? round0(lcoe) : null,
    flows,
    assumptions: {
      degradationPct,
      tariffEscalationPct,
      omPctPerYear,
      omEscalationPct,
      selfConsumptionRatio,
      exportPriceCOPkWh,
      insuranceCOPperYear,
      cleaningCOPperYear,
      inverterReplaceYear,
      inverterReplacementCOP: round0(inverterCostBase * inverterReplacePctOfInverterCost),
      inverterReplacePctOfInverterCost,
    },
  };
}

/* ========== helpers ========== */

function inferBatteryKWhFromBom(bom) {
  const items = Array.isArray(bom?.items) ? bom.items : [];
  for (const it of items) {
    const cat = String(it?.category || it?.cat || "").toLowerCase();
    const name = String(it?.item || it?.description || "").toLowerCase();
    if (!cat.includes("bater") && !name.includes("bater")) continue;

    const m = (it?.item || it?.description || "").match(/([\d.]+)\s*kwh/i);
    if (m) {
      const kwh = Number(String(m[1]).replace(",", "."));
      if (Number.isFinite(kwh) && kwh > 0) return kwh;
    }
  }
  return null;
}

function mergeFinanceDefaults(finMaybe) {
  const fin = finMaybe && typeof finMaybe === "object" ? finMaybe : {};
  return { ...DEFAULT_FINANCE, ...fin };
}

function findInverterCost(lines) {
  const arr = Array.isArray(lines) ? lines : [];
  const inv = arr.find(
    (x) =>
      String(x?.category || "").toLowerCase().includes("inversor") ||
      String(x?.concept || "").toLowerCase().includes("inversor")
  );
  return inv ? clampMin(inv.totalCOP, 0) : 0;
}

function computePaybackYear(flows, capex, discounted = false) {
  if (!Array.isArray(flows) || flows.length < 2 || capex <= 0) return null;
  let cum = 0;
  for (let i = 1; i < flows.length; i++) {
    const f = flows[i];
    const x = discounted ? num(f.netDiscCOP) : num(f.netCOP);
    cum += x;
    if (cum >= capex) return num(f.year);
  }
  return null;
}

function computeIRR(cashflows) {
  const cf = Array.isArray(cashflows) ? cashflows.map((x) => num(x)) : [];
  if (cf.length < 2) return null;
  const hasPos = cf.some((x) => x > 0);
  const hasNeg = cf.some((x) => x < 0);
  if (!hasPos || !hasNeg) return null;

  let lo = -0.9,
    hi = 1.5;

  const npvAt = (r) => cf.reduce((s, c, t) => s + c / Math.pow(1 + r, t), 0);

  let fLo = npvAt(lo),
    fHi = npvAt(hi);
  let tries = 0;
  while (fLo * fHi > 0 && tries < 10) {
    hi += 1.0;
    fHi = npvAt(hi);
    tries++;
  }
  if (fLo * fHi > 0) return null;

  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npvAt(mid);
    if (Math.abs(fMid) < 1e-6) return mid;
    if (fLo * fMid <= 0) {
      hi = mid;
      fHi = fMid;
    } else {
      lo = mid;
      fLo = fMid;
    }
  }
  return (lo + hi) / 2;
}

function computePVCosts(flows, discountRate, capex) {
  let pv = capex;
  for (let i = 1; i < flows.length; i++) {
    const y = num(flows[i].year);
    const df = Math.pow(1 + discountRate, y);
    pv += (num(flows[i].opexCOP) + num(flows[i].replacementsCOP)) / (df > 0 ? df : 1);
  }
  return pv;
}

function computePVEnergy(flows, discountRate) {
  let pv = 0;
  for (let i = 1; i < flows.length; i++) {
    const y = num(flows[i].year);
    const df = Math.pow(1 + discountRate, y);
    pv += num(flows[i].energyKWh) / (df > 0 ? df : 1);
  }
  return pv;
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

function clampMin(x, min) {
  const s = String(x ?? "").trim();
  if (s === "") return min;
  const n = num(x);
  return Number.isFinite(n) ? Math.max(min, n) : min;
}

function clampInt(x, lo, hi, fallback) {
  const s = String(x ?? "").trim();
  if (s === "") return fallback;
  const n = Math.round(num(x));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

function clamp01(x, fallback = 0) {
  const s = String(x ?? "").trim();
  if (s === "") return fallback;
  const n = num(x);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function round0(n) {
  return Math.round(num(n));
}

function round2(n) {
  return Math.round(num(n) * 100) / 100;
}

function sum(arr) {
  const a = Array.isArray(arr) ? arr : [];
  return a.reduce((acc, x) => acc + num(x), 0);
}