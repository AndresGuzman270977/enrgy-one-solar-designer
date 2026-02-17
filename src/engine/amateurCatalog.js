// src/engine/amateurCatalog.js
// Catálogo simple para Modo Amateur (NO precios)
// Objetivo: siempre devolver algo válido (anti-crash)
//
// PATCH v1.1 (Feb-2026):
// ✅ Inversor genérico grande -> MPPT current más realista (reduce warnings de stringing limitado por corriente)
// ✅ Redondeo de potencia más consistente (pasos 5/10/25 según tamaño)
// ✅ Normalización con clamps

export const AMATEUR_PANELS = [
  {
    id: "p550_generic",
    name: "Módulo FV genérico 550 W",
    powerW: 550,
    areaM2: 2.6,
    vmp: 41.5,
    voc: 49.5,
    imp: 13.25,
    isc: 13.9,
  },
  {
    id: "p585_generic",
    name: "Módulo FV genérico 585 W",
    powerW: 585,
    areaM2: 2.65,
    vmp: 42.0,
    voc: 50.0,
    imp: 13.9,
    isc: 14.6,
  },
  {
    id: "p605_generic",
    name: "Módulo FV genérico 605 W",
    powerW: 605,
    areaM2: 2.7,
    vmp: 42.5,
    voc: 50.5,
    imp: 14.2,
    isc: 14.9,
  },
  {
    id: "p695_generic",
    name: "Módulo FV genérico 695 W",
    powerW: 695,
    areaM2: 3.1,
    vmp: 43.5,
    voc: 52.0,
    imp: 16.0,
    isc: 16.8,
  },
];

export const AMATEUR_INVERTERS = [
  {
    id: "inv_3k_2mppt_600v",
    name: "Inversor 3 kW (2 MPPT)",
    acKw: 3,
    numMppt: 2,
    mpptVmin: 120,
    mpptVmax: 500,
    dcMaxV: 600,
    mpptMaxInputA: 16,
    eff: 0.98,
  },
  {
    id: "inv_5k_2mppt_600v",
    name: "Inversor 5 kW (2 MPPT)",
    acKw: 5,
    numMppt: 2,
    mpptVmin: 120,
    mpptVmax: 500,
    dcMaxV: 600,
    mpptMaxInputA: 16,
    eff: 0.98,
  },
  {
    id: "inv_8k_2mppt_600v",
    name: "Inversor 8 kW (2 MPPT)",
    acKw: 8,
    numMppt: 2,
    mpptVmin: 120,
    mpptVmax: 500,
    dcMaxV: 600,
    mpptMaxInputA: 16,
    eff: 0.985,
  },
  {
    id: "inv_10k_2mppt_1000v",
    name: "Inversor 10 kW (2 MPPT) 1000 Vdc",
    acKw: 10,
    numMppt: 2,
    mpptVmin: 200,
    mpptVmax: 800,
    dcMaxV: 1000,
    mpptMaxInputA: 26,
    eff: 0.985,
  },
  {
    id: "inv_15k_3mppt_1000v",
    name: "Inversor 15 kW (3 MPPT) 1000 Vdc",
    acKw: 15,
    numMppt: 3,
    mpptVmin: 200,
    mpptVmax: 800,
    dcMaxV: 1000,
    mpptMaxInputA: 26,
    eff: 0.985,
  },
  {
    id: "inv_20k_3mppt_1000v",
    name: "Inversor 20 kW (3 MPPT) 1000 Vdc",
    acKw: 20,
    numMppt: 3,
    mpptVmin: 200,
    mpptVmax: 800,
    dcMaxV: 1000,
    mpptMaxInputA: 26,
    eff: 0.985,
  },
  {
    id: "inv_30k_3mppt_1000v",
    name: "Inversor 30 kW (3 MPPT) 1000 Vdc",
    acKw: 30,
    numMppt: 3,
    mpptVmin: 200,
    mpptVmax: 800,
    dcMaxV: 1000,
    mpptMaxInputA: 26,
    eff: 0.985,
  },
  {
    id: "inv_50k_6mppt_1100v",
    name: "Inversor 50 kW (6 MPPT) 1100 Vdc",
    acKw: 50,
    numMppt: 6,
    mpptVmin: 250,
    mpptVmax: 900,
    dcMaxV: 1100,
    mpptMaxInputA: 30,
    eff: 0.985,
  },
];

export function pickDefaultPanel() {
  const p = (Array.isArray(AMATEUR_PANELS) ? AMATEUR_PANELS : []).find(
    (x) => num(x?.powerW) > 0 && num(x?.areaM2) > 0
  );
  return (
    p || {
      id: "p550_generic",
      name: "Módulo FV genérico 550 W",
      powerW: 550,
      areaM2: 2.6,
      vmp: 41.5,
      voc: 49.5,
      imp: 13.25,
      isc: 13.9,
    }
  );
}

export function pickInverterByAcKw(targetAcKw) {
  const t = Math.max(1, num(targetAcKw) || 1);
  const list = Array.isArray(AMATEUR_INVERTERS) ? AMATEUR_INVERTERS : [];

  if (!list.length) return makeGenericInverter(t, null);

  const sorted = [...list].sort((a, b) => num(a.acKw) - num(b.acKw));
  const found = sorted.find((inv) => num(inv.acKw) >= t);
  if (found) return normalizeInverter(found);

  const max = sorted[sorted.length - 1];
  return makeGenericInverter(t, max);
}

/* ------------------------- helpers ------------------------- */

function makeGenericInverter(target, maxInv) {
  const maxKw = maxInv ? num(maxInv.acKw) : null;

  // ✅ Redondeo más consistente
  // - <=30 kW: paso 5 kW
  // - 30..100 kW: paso 10 kW
  // - >100 kW: paso 25 kW (menos “saltos” raros)
  const step = target <= 30 ? 5 : target <= 100 ? 10 : 25;
  const rounded = roundUpToStep(target, step);

  // defaults base
  let numMppt = rounded <= 10 ? 2 : rounded <= 30 ? 3 : 6;
  let dcMaxV = 1000;
  let mpptVmin = 200;
  let mpptVmax = 800;
  let mpptMaxInputA = 26;
  let eff = 0.985;

  // ✅ Grandes: supuestos típicos string inverter
  if (rounded >= 50) {
    dcMaxV = 1100;
    mpptVmin = 250;
    mpptVmax = 900;

    // Más MPPT a medida que crece potencia
    numMppt = rounded >= 150 ? 12 : rounded >= 100 ? 10 : rounded >= 80 ? 8 : 6;

    // Corriente MPPT realista para 2 strings/MPPT con paneles típicos:
    // - Imp típico 13–16 A → Imp*1.25 ≈ 16–20 A → 2 strings ≈ 32–40 A
    // dejamos margen por tolerancias/temperatura (≈ +10%)
    const IstringMpptTypical = 18; // A (aprox para Imp≈14.5 A)
    const twoStringsTypical = 2 * IstringMpptTypical; // 36 A
    const margin = 1.10;
    const minMpptA = Math.ceil(twoStringsTypical * margin); // ~40 A

    // Escalonado por potencia (sube para 80/100/150+)
    mpptMaxInputA = rounded >= 150 ? 60 : rounded >= 100 ? 55 : rounded >= 80 ? 50 : 45;

    // y garantizamos un mínimo físico razonable:
    mpptMaxInputA = Math.max(mpptMaxInputA, minMpptA);

    // Para 50 kW (muchos equipos reales son 30A por MPPT),
    // pero en genérico preferimos evitar warnings en paneles grandes,
    // así que nunca bajamos de 40 A en este genérico grande.
    if (rounded === 50) mpptMaxInputA = Math.max(mpptMaxInputA, 40);
  }

  const inv = {
    id: `inv_generic_${rounded}kW`,
    name: `Inversor genérico ${rounded} kW`,
    acKw: rounded,
    numMppt,
    mpptVmin,
    mpptVmax,
    dcMaxV,
    mpptMaxInputA,
    eff,
    _note:
      maxKw && rounded > maxKw
        ? `Target ${round1(target)} kW supera catálogo (máx ${maxKw} kW). Se usó inversor genérico ${rounded} kW.`
        : `Se usó inversor genérico ${rounded} kW.`,
  };

  return normalizeInverter(inv);
}

function normalizeInverter(inv) {
  const acKw = Math.max(1, num(inv.acKw) || 1);
  const numMppt = clampInt(inv.numMppt, 1, 24, 2);
  const mpptVmin = Math.max(60, num(inv.mpptVmin) || 120);
  const mpptVmax = Math.max(mpptVmin + 10, num(inv.mpptVmax) || 500);
  const dcMaxV = Math.max(mpptVmax, num(inv.dcMaxV) || 600);

  // clamp para evitar mpptMaxInputA inválidos
  const mpptMaxInputA = Math.max(10, num(inv.mpptMaxInputA) || 16);

  const effRaw = num(inv.eff);
  const eff = Number.isFinite(effRaw) ? Math.max(0.90, Math.min(0.995, effRaw)) : 0.98;

  return {
    ...inv,
    acKw,
    numMppt,
    mpptVmin,
    mpptVmax,
    dcMaxV,
    mpptMaxInputA,
    eff,
  };
}

function clampInt(x, lo, hi, fallback = lo) {
  const n = Math.round(num(x));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

function roundUpToStep(x, step) {
  const s = Math.max(1, num(step) || 1);
  return Math.ceil(num(x) / s) * s;
}

function round1(x) {
  return Math.round(num(x) * 10) / 10;
}

function num(x) {
  const s = String(x ?? "").trim().replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

