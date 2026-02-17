// src/utils/pricingCatalog.js
// Catálogo financiero PRO — Solar Designer v2.0
// Todos los valores en COP (Colombia)

export const PRICING_COP = {
  /* =========================
     EQUIPOS (CAPEX DIRECTO)
  ========================= */

  // Panel (COP por Wp)
  panelCOPperWp: 1350, 
  // 1.350 COP/Wp → panel 695W ≈ 938.250 COP

  // Inversor (COP por Wac)
  inverterCOPperWac: 1450,
  // 1.450 COP/Wac → inversor 20kW ≈ 29M COP

  // Estructura metálica (COP por Wp)
  structureCOPperWp: 180,

  // Herrajes / montaje (COP por Wp)
  mountingCOPperWp: 120,

  /* =========================
     PROTECCIONES (kits)
  ========================= */

  dcProtectionKitCOP: 900000,
  acProtectionKitCOP: 750000,
  groundingKitCOP: 450000,

  /* =========================
     CONECTIVIDAD
  ========================= */

  mc4PairCOP: 35000,
  labelsAndConsumablesCOP: 250000,

  /* =========================
     CABLEADO (COP por metro)
  ========================= */

  cableCOPperM: {
    Cu: {
      "2.5": 9500,
      "4": 13000,
      "6": 18000,
      "10": 26000,
      "16": 39000,
      "25": 58000,
      "35": 82000,
      "50": 115000,
      "70": 165000,
      "95": 225000,
    },
    Al: {
      "16": 21000,
      "25": 30000,
      "35": 42000,
      "50": 59000,
      "70": 85000,
      "95": 120000,
    },
  },
};
