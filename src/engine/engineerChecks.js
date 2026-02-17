// src/engine/engineerChecks.js
// Validaciones técnicas "soft" para modo Ingeniero
// v1.1 — robusto / anti-crash
// - No detiene el cálculo: solo genera "issues" para diagnostics
// - Alineado con sizing.js (Istring ≈ Isc*1.25, ventana MPPT, Voc frío)
// - Tolerante a null/undefined/strings y evita NaN/Infinity

function num(x) {
  const n = Number(String(x ?? "").replace(",", ".").trim());
  return Number.isFinite(n) ? n : 0;
}

function safeStr(x) {
  return String(x ?? "").trim();
}

function clamp01(x) {
  const v = num(x);
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function pushIssue(issues, msg) {
  if (!msg) return;
  issues.push(String(msg));
}

/**
 * Voc frío aprox por panel:
 * Voc_cold = Voc * (1 + coef*(Tmin - Tstc))
 * En ficha típica coef es NEGATIVO (ej -0.28 %/°C).
 * Si Tmin < 25 y coef < 0 => Voc sube (correcto).
 */
function vocColdApprox({ voc, vocTempCoeffPctPerC, tMinC, tStcC = 25 }) {
  const Voc = num(voc);
  const coefPct = num(vocTempCoeffPctPerC);
  const Tmin = num(tMinC);
  const Tstc = num(tStcC);

  if (Voc <= 0) return 0;

  if (coefPct === 0) return Voc;

  let cold = Voc * (1 + (coefPct / 100) * (Tmin - Tstc));

  // coherencia mínima si inputs raros:
  if (Tmin < Tstc && coefPct < 0 && cold < Voc) {
    cold = Voc * (1 + (Math.abs(coefPct) / 100) * (Tstc - Tmin));
  }

  return Number.isFinite(cold) && cold > 0 ? cold : Voc;
}

/**
 * Valida consistencia AC fase/voltaje típica.
 */
function checkAcCompatibility({ acPhase, acVoltageV }, issues) {
  const phase = safeStr(acPhase).toUpperCase();
  const v = Math.round(num(acVoltageV));

  if (!phase || v <= 0) return;

  const ok1p = phase === "1P" && (v === 220 || v === 230);
  const ok3p = phase === "3P" && (v === 380 || v === 400);

  if (!ok1p && !ok3p) {
    pushIssue(
      issues,
      `Compatibilidad AC: tienes ${phase} con ${v} V. Normal típico: 1P→220/230 V, 3P→380/400 V.`
    );
  }
}

/**
 * Valida stringing vs límites MPPT/VdcMax.
 * Usa preferentemente resultados del motor (stringing.result).
 * Si no existen, estima con Ns aproximado por mpptVmin/vmp.
 */
function checkDcWindow({ form, stringing }, issues) {
  const mpptVmin = num(form?.mpptVmin);
  const mpptVmax = num(form?.mpptVmax);
  const dcMaxV = num(form?.dcMaxV);

  const vmp = num(form?.vmp);
  const voc = num(form?.voc);
  const coef = num(form?.vocTempCoeffPctPerC);
  const tmin = num(form?.tMinC);

  // Ns: si motor lo entregó úsalo, si no infiere aprox
  const Ns =
    num(stringing?.result?.Ns) > 0
      ? num(stringing.result.Ns)
      : mpptVmin > 0 && vmp > 0
      ? Math.max(1, Math.round(mpptVmin / vmp))
      : 0;

  if (Ns <= 0) return;

  const vmpString =
    num(stringing?.result?.vmpString) > 0 ? num(stringing.result.vmpString) : vmp > 0 ? vmp * Ns : 0;

  const vocColdPanel = vocColdApprox({
    voc,
    vocTempCoeffPctPerC: coef,
    tMinC: tmin,
    tStcC: 25,
  });

  const vocColdString =
    num(stringing?.result?.vocColdString) > 0
      ? num(stringing.result.vocColdString)
      : vocColdPanel > 0
      ? vocColdPanel * Ns
      : 0;

  // Ventana MPPT (tolerancia)
  if (mpptVmin > 0 && vmpString > 0 && vmpString < mpptVmin * 0.98) {
    pushIssue(
      issues,
      `MPPT: Vmp string (${vmpString.toFixed(1)} V) parece por debajo de MPPT Vmin (${mpptVmin} V). Considera aumentar Ns.`
    );
  }
  if (mpptVmax > 0 && vmpString > 0 && vmpString > mpptVmax * 1.02) {
    pushIssue(
      issues,
      `MPPT: Vmp string (${vmpString.toFixed(1)} V) parece por encima de MPPT Vmax (${mpptVmax} V). Considera reducir Ns.`
    );
  }

  // Límite DC máximo (Voc frío)
  if (dcMaxV > 0 && vocColdString > 0 && vocColdString > dcMaxV * 0.98) {
    pushIssue(
      issues,
      `DC Max: Voc frío del string (${vocColdString.toFixed(1)} V) se acerca/supera VdcMax (${dcMaxV} V). Riesgo en frío; reduce Ns.`
    );
  }
}

/**
 * Valida corriente MPPT (strings en paralelo).
 * Motor sizing.js usa Istring ≈ Isc * 1.25 (factor código).
 * Estimación por MPPT: I_mppt ≈ Istring * stringsEnParaleloEnEseMPPT.
 */
function checkMpptCurrent({ form, stringing }, issues) {
  const mpptMaxInputA = num(form?.mpptMaxInputA);
  if (mpptMaxInputA <= 0) return;

  const isc = num(form?.isc);
  const imp = num(form?.imp);

  const Ipanel = isc > 0 ? isc : imp;
  if (Ipanel <= 0) return;

  const Istring = Ipanel * 1.25; // coherente con sizing.js

  // strings por MPPT: si motor lo entrega, úsalo; si no, asume 1
  let maxStringsOnMppt = 1;
  const alloc = stringing?.result?.mpptAlloc;

  if (Array.isArray(alloc) && alloc.length) {
    maxStringsOnMppt = Math.max(...alloc.map((a) => num(a?.strings)));
    if (!Number.isFinite(maxStringsOnMppt) || maxStringsOnMppt <= 0) maxStringsOnMppt = 1;
  }

  const Iapprox = Istring * maxStringsOnMppt;

  if (Iapprox > mpptMaxInputA * 0.98) {
    pushIssue(
      issues,
      `MPPT Imax: estimación ${Iapprox.toFixed(1)} A (≈ ${maxStringsOnMppt} strings en paralelo × ${(Istring).toFixed(
        1
      )} A por string) cerca/supera mpptMaxInputA (${mpptMaxInputA} A).`
    );
  }
}

/**
 * Validación DC/AC ratio
 * - pv.requiredPower en legacy se llena con installedKWpEffective (kWp)
 * - sizing.inverter.acPowerKW (kWac)
 */
function checkDcAcRatio({ pv, sizing }, issues) {
  const pdc = num(pv?.requiredPower); // kWp
  const pac = num(sizing?.inverter?.acPowerKW); // kWac
  if (pdc <= 0 || pac <= 0) return;

  const ratio = pdc / pac;

  if (ratio < 0.8) {
    pushIssue(issues, `DC/AC ratio bajo (${ratio.toFixed(2)}). Puede subutilizar inversor.`);
  } else if (ratio > 1.35) {
    pushIssue(issues, `DC/AC ratio alto (${ratio.toFixed(2)}). Posible clipping frecuente; revisa criterio.`);
  }
}

/**
 * Punto de entrada único:
 * devuelve { ok, issues } para anexar a diagnostics.
 */
export function runEngineerChecks(payload) {
  const d = payload || {};

  // se acepta cualquiera de estas entradas
  const form = d?.inputs?.form || d?.engineerPreset?.form || d?.form || {};
  const pv = d?.pv || {};
  const sizing = d?.sizing || {};
  const stringing = d?.stringing || null;

  const issues = [];

  try {
    checkAcCompatibility({ acPhase: form?.acPhase, acVoltageV: form?.acVoltageV }, issues);
  } catch (e) {
    pushIssue(issues, `Checks AC fallaron: ${e?.message || "desconocido"}`);
  }

  try {
    checkDcWindow({ form, stringing }, issues);
  } catch (e) {
    pushIssue(issues, `Checks ventana DC fallaron: ${e?.message || "desconocido"}`);
  }

  try {
    checkMpptCurrent({ form, stringing }, issues);
  } catch (e) {
    pushIssue(issues, `Checks MPPT corriente fallaron: ${e?.message || "desconocido"}`);
  }

  try {
    checkDcAcRatio({ pv, sizing }, issues);
  } catch (e) {
    pushIssue(issues, `Checks DC/AC fallaron: ${e?.message || "desconocido"}`);
  }

  const ok = issues.length === 0;
  return { ok, issues };
}
