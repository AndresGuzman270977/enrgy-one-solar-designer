// src/utils/pricingCatalog.js
// ✅ Catálogo de precios base (COP) para el motor financiero (financeEngine.js)
// - Mantiene compatibilidad con tu catálogo anterior PRICING_CATALOG_COP
// - Expone el objeto que el motor espera: PRICING_COP
//
// Nota importante:
// En tu versión anterior tenías panel_watt_price: 1.35, pero el comentario decía
// 695W ≈ 938k COP  => 938000/695 ≈ 1350 COP/Wp.
// Aquí lo corregimos a 1350 COP/Wp (tres ceros más).

/* -------------------------
   Catálogo legacy (compat)
------------------------- */
export const PRICING_CATALOG_COP = {
  // FV
  panel_watt_price: 1350, // COP por Wp del panel (695W ≈ 938k COP)
  inverter_kwac_price: 1450000, // COP por kWac de inversor
  structure_per_panel: 120000, // estructura + herrajes por panel

  // protecciones (legacy)
  dc_protections_per_string: 90000,
  spd_dc: 240000,
  spd_ac: 260000,
  ac_breaker_base: 180000,
  dc_switch: 220000,

  // Cableado / canalización (promedios legacy)
  cable_dc_m: 18000, // COP/m típico DC (4–6mm² Cu)
  cable_ac_m: 22000, // COP/m típico AC
  conduit_m: 9000, // COP/m

  // Ingeniería e instalación (porcentaje de CAPEX hardware)
  eng_percent: 0.05,
  install_percent: 0.12,
  permits_percent: 0.02,

  // Batería (si aplica)
  battery_kwh_price: 1650000,

  // OPEX anual (porcentaje de CAPEX total)
  opex_percent_year: 0.015,
};

/* -----------------------------------------
   Catálogo PRO: lo que espera financeEngine
----------------------------------------- */
export const PRICING_COP = buildPricingCOPFromLegacy(PRICING_CATALOG_COP);

/* -------------------------
   Helpers
------------------------- */
function buildPricingCOPFromLegacy(legacy) {
  const L = legacy || {};

  // Panel e inversor en unidades que usa el motor:
  // panelCOPperWp: COP/Wp
  // inverterCOPperWac: COP/Wac
  const panelCOPperWp = num(L.panel_watt_price, 1350);
  const inverterCOPperWac = num(L.inverter_kwac_price, 1450000) / 1000;

  // Estructura/montaje: el motor lo calcula por Wp instalado.
  // Tu legacy está por panel; aquí lo pasamos a COP/Wp usando un panel de referencia.
  // Si quieres más precisión, ajusta panelRefW a tu panel típico (ej. 550/695).
  const panelRefW = 550;
  const structureCOPperWp = num(L.structure_per_panel, 120000) / panelRefW;

  // Montaje/herrajes adicionales: si no tienes dato, deja un % de estructura
  const mountingCOPperWp = Math.round(structureCOPperWp * 0.35);

  // Kits (valores redondos; ajusta con tus proveedores)
  const dcProtectionKitCOP = round0(
    // aproximación: seccionador + SPD DC + un set base de protecciones
    num(L.dc_switch, 220000) + num(L.spd_dc, 240000) + 220000
  );

  const acProtectionKitCOP = round0(
    // aproximación: breaker + SPD AC + RCD/RCBO base
    num(L.ac_breaker_base, 180000) + num(L.spd_ac, 260000) + 260000
  );

  const groundingKitCOP = 320000; // varillas, conectores, conductor tierra base

  // Conectividad y misceláneos
  const mc4PairCOP = 28000; // par MC4
  const labelsAndConsumablesCOP = 180000;

  // Cableado por mm² y material (COP/m)
  // Nota: tus legacy cable_dc_m y cable_ac_m eran promedios.
  // Aquí los usamos como ancla para 4–6mm² (Cu) y escalamos para otros calibres.
  const dcBase = num(L.cable_dc_m, 18000);
  const acBase = num(L.cable_ac_m, 22000);

  const cableCOPperM = {
    Cu: {
      "2.5": round0(dcBase * 0.75),
      "4": round0(dcBase * 1.0),
      "6": round0(dcBase * 1.18),
      "10": round0(dcBase * 1.75),
      "16": round0(dcBase * 2.55),
      "25": round0(dcBase * 3.7),
      "35": round0(dcBase * 4.9),
      "50": round0(dcBase * 6.6),
      "70": round0(dcBase * 9.0),
      "95": round0(dcBase * 12.0),
    },
    Al: {
      // Al suele ser más barato por mm² (pero requiere mayor sección por ampacidad)
      "10": round0(dcBase * 1.1),
      "16": round0(dcBase * 1.55),
      "25": round0(dcBase * 2.25),
      "35": round0(dcBase * 3.0),
      "50": round0(dcBase * 4.0),
      "70": round0(dcBase * 5.4),
      "95": round0(dcBase * 7.2),
    },
    // si alguien pone "CU"/"AL" en mayúscula por error:
    CU: {},
    AL: {},
  };

  // Ancla AC (si quieres diferenciar AC vs DC por tabla, puedes copiar/editar)
  // Por ahora el motor usa la misma tabla por material/mm²; perfecto para estimación.
  // Si quieres: usa acBase para ajustar la tabla Cu/Al aquí.
  // (Lo dejo simple para que no te cambie demasiado el estimado de golpe.)

  return {
    // Equipos (COP por unidad base)
    panelCOPperWp,
    inverterCOPperWac,
    structureCOPperWp,
    mountingCOPperWp,

    // Kits / sets
    dcProtectionKitCOP,
    acProtectionKitCOP,
    groundingKitCOP,

    // Cableado (COP/m por mm² y material)
    cableCOPperM,

    // Conectividad / misceláneos
    mc4PairCOP,
    labelsAndConsumablesCOP,

    // Extras opcionales (por si luego los quieres usar en UI/engine)
    conduitCOPperM: num(L.conduit_m, 9000),
    legacy: { ...L },
  };
}

/* -------------------------
   Utils
------------------------- */
function num(x, fallback = 0) {
  const s = String(x ?? "").trim().replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}
function round0(n) {
  return Math.round(num(n, 0));
}
