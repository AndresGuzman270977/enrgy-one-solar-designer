// src/data/equipment.js
// Biblioteca base de equipos (editable).
// Nota: valores típicos; siempre validar datasheet real del fabricante.

export const PANEL_LIBRARY = [
  {
    id: "p550_std",
    brand: "Generic",
    model: "Mono PERC 550W",
    powerW: 550,
    vmp: 40.0,
    voc: 48.0,
    imp: 13.75,
    isc: 14.5,
    vocTempCoeffPctPerC: -0.28,
    areaM2: 2.2,
    notes: "Default app",
  },
  {
    id: "p600_std",
    brand: "Generic",
    model: "Mono 600W",
    powerW: 600,
    vmp: 41.5,
    voc: 50.0,
    imp: 14.45,
    isc: 15.1,
    vocTempCoeffPctPerC: -0.29,
    areaM2: 2.4,
    notes: "Para menos paneles a misma kWp",
  },
  {
    id: "p450_roof",
    brand: "Generic",
    model: "Rooftop 450W",
    powerW: 450,
    vmp: 34.0,
    voc: 41.0,
    imp: 13.2,
    isc: 13.9,
    vocTempCoeffPctPerC: -0.29,
    areaM2: 2.0,
    notes: "Útil si hay sombras/techo pequeño",
  },
];

// allowedCountries: si está vacío => universal
// allowedAcVoltages: lista de voltajes recomendados para la salida AC del inversor
export const INVERTER_LIBRARY = [
  // ---------- RES (1F) ----------
  {
    id: "inv_res_5k_2mppt_600v",
    market: "RES",
    brand: "Generic",
    model: "5kW 1F • 2 MPPT",
    acPowerKW: 5,
    acPhase: "1P",
    allowedCountries: ["Colombia", "España"],
    allowedAcVoltages: [220, 230],
    dcMaxV: 600,
    mpptVmin: 120,
    mpptVmax: 500,
    mpptMaxInputA: 16,
    numMppt: 2,
    inverterEff: 0.98,
    notes: "String corto/medio",
  },
  {
    id: "inv_res_10k_2mppt_1000v",
    market: "RES",
    brand: "Generic",
    model: "10kW 1F • 2 MPPT (1000Vdc)",
    acPowerKW: 10,
    acPhase: "1P",
    allowedCountries: ["Colombia", "España"],
    allowedAcVoltages: [220, 230],
    dcMaxV: 1000,
    mpptVmin: 180,
    mpptVmax: 850,
    mpptMaxInputA: 18,
    numMppt: 2,
    inverterEff: 0.985,
    notes: "Permite strings más largos",
  },

  // ---------- CI (3F) ----------
  {
    id: "inv_ci_20k_2mppt_1000v",
    market: "CI",
    brand: "Generic",
    model: "20kW 3F • 2 MPPT",
    acPowerKW: 20,
    acPhase: "3P",
    allowedCountries: ["Colombia", "España"],
    allowedAcVoltages: [380, 400],
    dcMaxV: 1000,
    mpptVmin: 200,
    mpptVmax: 850,
    mpptMaxInputA: 26,
    numMppt: 2,
    inverterEff: 0.985,
    notes: "C&I pequeño",
  },
  {
    id: "inv_ci_50k_4mppt_1100v",
    market: "CI",
    brand: "Generic",
    model: "50kW 3F • 4 MPPT",
    acPowerKW: 50,
    acPhase: "3P",
    allowedCountries: ["Colombia", "España"],
    allowedAcVoltages: [380, 400],
    dcMaxV: 1100,
    mpptVmin: 200,
    mpptVmax: 1000,
    mpptMaxInputA: 32,
    numMppt: 4,
    inverterEff: 0.985,
    notes: "C&I mediano",
  },
];

export function getPanels() {
  return PANEL_LIBRARY.slice();
}

export function getInvertersByMarket(clientMode /* 'RES' | 'CI' */) {
  const market = clientMode === "CI" ? "CI" : "RES";
  return INVERTER_LIBRARY.filter((x) => x.market === market);
}

export function getInvertersFiltered({ clientMode, country, acVoltageV }) {
  const base = getInvertersByMarket(clientMode);
  const c = String(country || "").trim();

  return base.filter((inv) => {
    const okCountry =
      !Array.isArray(inv.allowedCountries) || inv.allowedCountries.length === 0
        ? true
        : inv.allowedCountries.includes(c);

    const okV =
      !Array.isArray(inv.allowedAcVoltages) || inv.allowedAcVoltages.length === 0
        ? true
        : inv.allowedAcVoltages.includes(Number(acVoltageV));

    return okCountry && okV;
  });
}

export function findPanel(id) {
  return PANEL_LIBRARY.find((x) => x.id === id) || null;
}

export function findInverter(id) {
  return INVERTER_LIBRARY.find((x) => x.id === id) || null;
}

export function defaultPanelId() {
  return "p550_std";
}

export function defaultInverterId(clientMode) {
  return clientMode === "CI" ? "inv_ci_20k_2mppt_1000v" : "inv_res_5k_2mppt_600v";
}

// util: voltaje recomendado por país y modo (para ayudarte en EngineerForm)
export function recommendedAcVoltage({ clientMode, country }) {
  const isES = String(country || "").toLowerCase().includes("espa");
  if (clientMode === "CI") return isES ? 400 : 380;
  return isES ? 230 : 220;
}
