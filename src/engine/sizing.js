// src/engine/sizing.js
// Motor "Modo Ingeniero" (v2.0) — robusto / anti-crash + FINANZAS PRO
// PATCH v2.0 (modelo energético corregido):
// ✅ Exportación física (sin “exportBoost” arbitrario):
//    - Si viene exportKW → calcula energía anual extra ≈ exportKW * PSH * 365
//    - Si NO viene exportKW y viene exportRatio → asume energía anual extra = baseAnnualEnergy * exportRatio
// ✅ Corriente DC principal corregida:
//    - iDc = Pdc / Vdc (no dividir por inverterEff)
// ✅ Coherencia de longitudes DC en wiringSizing:
//    - lengthM DC ≈ (L1 + L2) * 2  (campo→inversor ida/vuelta)
// ✅ Mantiene compat Amateur→Engineer: batería/export/autoconsumo, distancias, legacy output
//
// PATCH v2.1 (Feb-2026) — FIX STRINGING MPPT CURRENT:
// ✅ Si stringsTotal excede límite por corriente MPPT, se intenta ajustar Ns (dentro de límites) para reducir strings
// ✅ MPPT current usa Imp*1.25 (más representativo de corriente MPP), y conserva Isc*1.25 para OCPD/fusibles
// ✅ Warning más explicativo + recomendaciones cuantificadas

import { runEngineerChecks } from "./engineerChecks";
import { computeCosting, computeFinance } from "./financeEngine";

export function runEngineerSizing(engineerPreset) {
  // ✅ FIX: safePreset debe existir incluso si el try falla
  let safePreset = null;
  try {
    safePreset = normalizePreset(engineerPreset);
  } catch (e) {
    // fallback ultra-safe
    try {
      safePreset = normalizePreset({});
    } catch {
      safePreset = null;
    }
  }

  const safe = safePreset || normalizePreset({});
  const diag = { ok: true, warnings: [], errors: [] };

  try {
    const { project, loc, clientMode, bill, form } = safe;

    // -------------------------
    // 0) ÁREA DISPONIBLE (para limitar paneles)
    // -------------------------
    const areaM2 = clampMin(num(form.areaM2), 0);
    const panelAreaM2 = clampMin(num(form.panelAreaM2), 0); // m²/panel
    const packingFactor = clamp01(num(form.packingFactor), 0.92); // factor ocupación
    const maxPanelsByArea =
      areaM2 > 0 && panelAreaM2 > 0 ? Math.max(0, Math.floor((areaM2 * packingFactor) / panelAreaM2)) : 0;

    // -------------------------
    // 1) ENERGÍA / POTENCIA FV (modelo corregido)
    // -------------------------
    const dailyFromBill = bill.billingDays > 0 ? bill.billingKWh / Math.max(1, bill.billingDays) : 0;
    const dailyKWh = clampMin(num(form.dailyConsumption) > 0 ? num(form.dailyConsumption) : dailyFromBill, 0);

    // -------------------------
    // 1.1) BATERÍAS (dimensionamiento real)
    // -------------------------
    const wantBattery = Boolean(form.wantBattery);

    // Autonomía: horas o días (si vienen ambos, manda horas)
    const autonomyHours =
      clampMin(num(form.autonomyHours), 0) ||
      (clampMin(num(form.autonomyDays), 0) > 0 ? clampMin(num(form.autonomyDays), 0) * 24 : 0);

    // Parámetros base (con compatibilidad Amateur)
    const systemVoltage = clampMin(num(form.systemVoltage), 48) || 48;
    const dod = clamp01(num(form.dod), 0.8); // 0..1

    // ✅ Acepta batteryEfficiency (Amateur) además de batteryRoundtripEff (Ingeniero)
    const battEff = clamp01(num(form.batteryRoundtripEff) || num(form.batteryEfficiency) || num(form.battEff), 0.92);

    // ✅ Acepta reservePct (Amateur) además de reserveFraction (Ingeniero)
    const reserve = clamp01(num(form.reserveFraction) || num(form.reservePct), 0.1);

    // Si defines carga crítica (kW), se usa para autonomía; si no, usa consumo diario promedio
    const criticalLoadKW = clampMin(num(form.criticalLoadKW), 0);

    // Energía a respaldar
    let backupEnergyKWh = 0;
    if (wantBattery && autonomyHours > 0) {
      if (criticalLoadKW > 0) {
        backupEnergyKWh = criticalLoadKW * autonomyHours;
      } else {
        const avgKW = dailyKWh / 24;
        backupEnergyKWh = avgKW * autonomyHours;
      }
    }

    // Ajustes por reserva, DoD y eficiencia
    let requiredBatteryKWh = 0;
    let requiredAh = 0;

    if (wantBattery && backupEnergyKWh > 0) {
      requiredBatteryKWh =
        backupEnergyKWh / Math.max(0.05, dod) / Math.max(0.05, battEff) / Math.max(0.05, 1 - reserve);

      requiredAh = (requiredBatteryKWh * 1000) / Math.max(12, systemVoltage);

      if (!Number.isFinite(requiredBatteryKWh) || requiredBatteryKWh < 0) requiredBatteryKWh = 0;
      if (!Number.isFinite(requiredAh) || requiredAh < 0) requiredAh = 0;
    }

    if (wantBattery && autonomyHours <= 0) {
      diag.warnings.push("Batería: activaste wantBattery pero no definiste autonomyHours/autonomyDays.");
    }
    if (wantBattery && dod <= 0.2) {
      diag.warnings.push(`Batería: DoD muy bajo (dod=${round2(dod)}). Revisa parámetro.`);
    }

    const psh = clampMin(num(form.peakSunHours) || num(loc.psh), 0);
    const losses = clamp01(num(form.systemLosses), 0.2);

    // Energía base anual (consumo)
    const baseAnnualEnergy = Math.max(0, dailyKWh * 365);

    // ✅ Exportación: si viene exportKW → energía anual extra ≈ exportKW * PSH * 365
    // Si NO viene exportKW y viene exportRatio → energía anual extra = baseAnnualEnergy * exportRatio
    const exportRatio = clamp01(num(form.exportRatio), 0); // 0..1
    const exportKWUser = clampMin(num(form.exportKW), 0);

    let exportEnergyAnnual = 0;
    if (exportKWUser > 0 && psh > 0) {
      exportEnergyAnnual = exportKWUser * psh * 365;
    } else if (exportRatio > 0) {
      exportEnergyAnnual = baseAnnualEnergy * exportRatio;
    }

    const targetAnnualEnergy = baseAnnualEnergy + exportEnergyAnnual;

    // kWp requerido por energía (físico, sin boosts “mágicos”)
    let kWpTarget = psh > 0 ? targetAnnualEnergy / (psh * 365 * Math.max(0.01, 1 - losses)) : 0;

    // Si usuario fija AC kW, garantizar mínimo DC/AC razonable
    const acKwUser = clampMin(num(form.acKw), 0);
    if (acKwUser > 0) {
      const minKwpByAc = acKwUser * 1.05;
      kWpTarget = Math.max(kWpTarget, minKwpByAc);
    }

    if (!Number.isFinite(kWpTarget) || kWpTarget < 0.5) kWpTarget = 0.5;

    // panel
    const panelW = clampMin(num(form.panelPower), 550);

    // ✅ paneles requeridos por energía (sin área)
    const panelsTarget = Math.max(1, Math.ceil((kWpTarget * 1000) / panelW));

    // ✅ limitación por área
    let nPanels = panelsTarget;
    let limitedByArea = false;

    if (maxPanelsByArea > 0 && nPanels > maxPanelsByArea) {
      limitedByArea = true;
      nPanels = Math.max(1, maxPanelsByArea);
      diag.warnings.push(
        `Limitación por área: se requerían ${panelsTarget} paneles, pero por área disponible caben ${maxPanelsByArea} (packingFactor=${round2(
          packingFactor
        )}).`
      );
    }

    const installedKWp = (nPanels * panelW) / 1000;
    const annualEnergyKWh = installedKWp * psh * 365 * Math.max(0.01, 1 - losses);

    // -------------------------
    // 2) STRINGING REAL (primero) — para definir potencia efectiva
    // -------------------------
    const vmp = clampMin(num(form.vmp), 40);
    const voc = clampMin(num(form.voc), 48);
    const imp = clampMin(num(form.imp), 10);
    const isc = clampMin(num(form.isc), 10);

    // Coeficiente típico viene NEGATIVO (ej -0.29 %/°C)
    const vocTcRaw = num(form.vocTempCoeffPctPerC);
    const vocTc = Number.isFinite(vocTcRaw) && vocTcRaw !== 0 ? vocTcRaw : 0;

    const tMin = Number.isFinite(num(form.tMinC)) ? num(form.tMinC) : 0;
    const tStc = 25;

    // ✅ Voc en frío: si coef es negativo y tMin < 25, Voc sube (correcto)
    let vocCold = voc;
    if (vocTc !== 0) {
      vocCold = voc * (1 + (vocTc / 100) * (tMin - tStc));
      if (tMin < tStc && vocTc < 0 && vocCold < voc) {
        vocCold = voc * (1 + (Math.abs(vocTc) / 100) * (tStc - tMin));
      }
    }
    if (!Number.isFinite(vocCold) || vocCold <= 0) vocCold = voc;

    const dcMaxV = clampMin(num(form.dcMaxV), 600);
    const mpptVmin = clampMin(num(form.mpptVmin), 120);
    const mpptVmax = clampMin(num(form.mpptVmax), 500);
    const mpptMaxInputA = clampMin(num(form.mpptMaxInputA), 16);
    const numMppt = Math.max(1, Math.round(clampMin(num(form.numMppt), 2)));

    const nsMin = Math.max(1, Math.ceil(mpptVmin / Math.max(1, vmp)));
    const nsMaxMppt = Math.max(1, Math.floor(mpptVmax / Math.max(1, vmp)));
    const nsMaxDc = Math.max(1, Math.floor(dcMaxV / Math.max(1, vocCold)));
    let nsMax = Math.max(1, Math.min(nsMaxMppt, nsMaxDc));

    if (nsMin > nsMax) {
      diag.warnings.push(
        `Rango Ns inválido (nsMin=${nsMin} > nsMax=${nsMax}). Se forzó Ns=${nsMin}. Revisa MPPT Vmin/Vmax y Vmp/Voc.`
      );
      nsMax = nsMin;
    }

    // ---------- FIX v2.1: elegir Ns para cumplir límite por corriente MPPT ----------
    // Para límite de entrada MPPT, la corriente relevante se aproxima con Imp (corriente en MPP),
    // con margen conservador. Isc*1.25 se conserva para fusibles/OCPD.
    const IstringForMppt = Math.max(0.1, imp) * 1.25;
    const IstringForOcpd = Math.max(0.1, isc) * 1.25;

    const stringingPick = pickStringingToFitMpptCurrent({
      nPanels,
      nsMin,
      nsMax,
      numMppt,
      mpptMaxInputA,
      IstringForMppt,
    });

    let Ns = stringingPick.Ns;
    let stringsTotal = stringingPick.stringsTotal;
    let maxParallelPerMppt = stringingPick.maxParallelPerMppt;
    let maxStringsAllMppt = stringingPick.maxStringsAllMppt;
    let stringsUsed = stringingPick.stringsUsed;

    // ✅ Si aún queda limitado, warning con recomendación cuantificada
    if (stringsUsed < stringsTotal) {
      const requiredMppt = Math.ceil(stringsTotal / Math.max(1, maxParallelPerMppt));
      const requiredInputA = round1(IstringForMppt * Math.ceil(stringsTotal / Math.max(1, numMppt)));
      diag.warnings.push(
        `Stringing limitado por corriente MPPT: requerías ${stringsTotal} strings, pero el inversor permite ${stringsUsed} (Istring≈${round1(
          IstringForMppt
        )} A, ImaxMPPT=${round1(mpptMaxInputA)} A, maxPar/MPPT=${maxParallelPerMppt}, MPPT=${numMppt}). ` +
          `Sugerencias: (1) usar inversor con ImaxMPPT ≥ ~${requiredInputA} A, o (2) aumentar MPPT a ≥ ${requiredMppt}, ` +
          `o (3) dividir en más de un inversor.`
      );
    } else if (stringingPick.adjustedByNs) {
      diag.warnings.push(
        `Stringing ajustado automáticamente para cumplir corriente MPPT: se aumentó Ns a ${Ns} para reducir strings (ahora strings=${stringsTotal}, max=${maxStringsAllMppt}).`
      );
    }

    // ✅ Evitar "paneles fantasma"
    let panelsEffective = stringsUsed * Ns;
    if (panelsEffective > nPanels) {
      let NsAdj = Ns;
      while (NsAdj > nsMin && stringsUsed * NsAdj > nPanels) NsAdj -= 1;
      if (stringsUsed * NsAdj <= nPanels) {
        Ns = NsAdj;
        panelsEffective = stringsUsed * Ns;
      } else {
        panelsEffective = nPanels;
      }
    }

    panelsEffective = Math.max(1, panelsEffective);

    // Recalcula stringsTotal coherente con Ns final (solo para reporte)
    stringsTotal = Math.max(1, Math.ceil(nPanels / Math.max(1, Ns)));

    const installedKWpEffective = (panelsEffective * panelW) / 1000;
    const annualEnergyEffective = installedKWpEffective * psh * 365 * Math.max(0.01, 1 - losses);

    // MPPT allocation
    const mpptAlloc = allocateStringsToMppt(stringsUsed, numMppt, maxParallelPerMppt);

    const vmpString = Ns * vmp;
    const vocColdString = Ns * vocCold;

    if (vocColdString > 0 && dcMaxV > 0) {
      const ratio = vocColdString / dcMaxV;
      if (ratio > 0.98) {
        diag.warnings.push(
          `Voc frío del string muy cercano al Vdc máx: Voc_frío≈${round1(vocColdString)} V vs VdcMax=${round0(dcMaxV)} V.`
        );
      }
    }
    if (vmpString > 0 && mpptVmin > 0 && vmpString < mpptVmin) {
      diag.warnings.push(`Vmp del string por debajo de MPPT Vmin: Vmp≈${round1(vmpString)} V vs MPPT Vmin=${round0(mpptVmin)} V.`);
    }

    const stringing = {
      panel: { powerW: panelW, vmp, voc, imp, isc, vocCold: round2(vocCold) },
      inverter: { numMppt, mpptVmin, mpptVmax, dcMaxV, mpptMaxInputA },
      result: {
        Ns,
        stringsTotal,
        stringsUsed,
        maxParallelPerMppt,
        mpptAlloc,
        panelsEffective,
        installedKWpEffective: round2(installedKWpEffective),
        vmpString: round2(vmpString),
        vocColdString: round2(vocColdString),

        mpptCurrentModel: {
          IstringForMppt_A: round1(IstringForMppt),
          IstringForOcpd_A: round1(IstringForOcpd),
          maxStringsAllMppt,
        },
      },
    };

    // -------------------------
    // 3) INVERSOR / DC-AC (consistente con potencia efectiva)
    // -------------------------
    const invAcKw = acKwUser > 0 ? acKwUser : round2(installedKWpEffective / 1.1);
    const inverterEff = clamp01(num(form.inverterEff), 0.98);
    const dcAcRatio = invAcKw > 0 ? installedKWpEffective / invAcKw : null;

    // ✅ exportKW coherente:
    const exportKW = exportKWUser > 0 ? exportKWUser : exportRatio > 0 ? round1(invAcKw * exportRatio) : 0;

    // -------------------------
    // 4) CORRIENTES AC/DC
    // -------------------------
    const acPhase = form.acPhase === "3P" ? "3P" : "1P";
    const acVoltage = clampMin(num(form.acVoltageV), acPhase === "3P" ? 380 : 220);
    const pf = 0.98;

    const iAc =
      acPhase === "3P"
        ? (invAcKw * 1000) / (Math.sqrt(3) * acVoltage * pf)
        : (invAcKw * 1000) / (acVoltage * pf);

    // ✅ Vdc nominal: preferimos vmpString si existe
    const vdcNom = Math.max(120, vmpString || (clientMode === "CI" ? 800 : 500));

    const pdcKw = installedKWpEffective;

    // ✅ FIX (v2.0): iDc = Pdc / Vdc (la eficiencia no se aplica aquí)
    const iDc = vdcNom > 0 ? (pdcKw * 1000) / vdcNom : 0;

    // Mantén corriente string para cable/protecciones con Isc*1.25 (OCPD)
    const iString = IstringForOcpd;

    // -------------------------
    // 5) TRAMOS + CABLES + VDROP
    // -------------------------
    const material = (form.conductorMaterial || "Cu").toUpperCase() === "AL" ? "Al" : "Cu";

    const L1 = clampMin(num(form.L_stringToCombiner_1w), 15);
    const L2 = clampMin(num(form.L_combinerToInverter_1w), 30);
    const L3 = clampMin(num(form.L_inverterToACPanel_1w), 20);

    const maxDropDC_string = clampMin(num(form.maxDropDC_string), 1.5);
    const maxDropDC_main = clampMin(num(form.maxDropDC_main), 1.5);
    const maxDropAC_seg = clampMin(num(form.maxDropAC_seg), 3);

    const dcStringCable = pickCableByCurrent(iString, "DC", material);
    const dcMainCable = pickCableByCurrent(iDc, "DC", material);
    const acCable = pickCableByCurrent(iAc, "AC", material);

    const vDropDC1 = estimateVdropPct_DC({
      I: iString,
      V: Math.max(120, vmpString),
      L_1w: L1,
      mm2: dcStringCable.mm2,
      material,
    });

    const vDropDC2 = estimateVdropPct_DC({
      I: iDc,
      V: Math.max(120, vdcNom),
      L_1w: L2,
      mm2: dcMainCable.mm2,
      material,
    });

    const vDropAC = estimateVdropPct_AC({
      I: iAc,
      V: acVoltage,
      L_1w: L3,
      mm2: acCable.mm2,
      material,
      phase: acPhase,
    });

    const segments = {
      rows: [
        {
          segment: "DC • String → Combiner",
          kind: "DC",
          length_m_1w: round0(L1),
          current_A: round1(iString),
          cable: dcStringCable.label,
          mm2: dcStringCable.mm2,
          ampacity_A: dcStringCable.ampacityA,
          vdrop_pct: round2(vDropDC1),
          limit_pct: maxDropDC_string,
          voltage_V: round0(Math.max(120, vmpString)),
          ok: vDropDC1 <= maxDropDC_string,
        },
        {
          segment: "DC • Combiner → Inversor",
          kind: "DC",
          length_m_1w: round0(L2),
          current_A: round1(iDc),
          cable: dcMainCable.label,
          mm2: dcMainCable.mm2,
          ampacity_A: dcMainCable.ampacityA,
          vdrop_pct: round2(vDropDC2),
          limit_pct: maxDropDC_main,
          voltage_V: round0(Math.max(120, vdcNom)),
          ok: vDropDC2 <= maxDropDC_main,
        },
        {
          segment: "AC • Inversor → Tablero",
          kind: "AC",
          length_m_1w: round0(L3),
          current_A: round1(iAc),
          cable: acCable.label,
          mm2: acCable.mm2,
          ampacity_A: acCable.ampacityA,
          vdrop_pct: round2(vDropAC),
          limit_pct: maxDropAC_seg,
          voltage_V: round0(acVoltage),
          ok: vDropAC <= maxDropAC_seg,
        },
      ],
      totals: {
        metrosTotales: round0(L1 + L2 + L3),
        subtotalConductores: 0,
      },
    };

    segments.rows.forEach((r) => {
      if (!r.ok) diag.warnings.push(`Caída de tensión alta en "${r.segment}": ${r.vdrop_pct}% (límite ${r.limit_pct}%).`);
    });

    // -------------------------
    // 6) PROTECCIONES (BASE)
    // -------------------------
    const protections = {
      dc: {
        stringFuseA: round0(Math.max(10, isc * 1.56)),
        combiner: "Caja combinadora DC (strings) con fusibles + seccionador",
        spd: "SPD DC Tipo 2 (validar Vdc nominal)",
      },
      ac: {
        breakerA: round0(iAc * 1.25),
        spd: "SPD AC Tipo 2",
        rcd: acPhase === "1P" ? "RCD/RCBO según norma local" : "RCD/RCBO (si aplica)",
      },
      grounding: "Puesta a tierra / equipotencialidad (validar RETIE / IEC)",
      notes: ["Protecciones son base (Ingeniero v2.0). Ajustar por normativa, cortocircuito y selectividad."],
    };

    // -------------------------
    // 7) BOM TÉCNICO (sin precios)
    // -------------------------
    const bom = {
      items: buildBomEngineer({
        panels: panelsEffective,
        panelW,
        inverterAcKw: invAcKw,
        stringsUsed,
        Ns,
        acPhase,
        acVoltage,
        cables: { dcStringCable, dcMainCable, acCable },
        lengths: { L1, L2, L3 },
        protections,
        battery: {
          wantBattery,
          autonomyHours,
          systemVoltage,
          requiredBatteryKWh,
          requiredAh,
          batteryId: form.batteryId || "bat_none",
        },
      }),
      subtotal: 0,
      tax: 0,
      margin: 0,
      total: 0,
    };

    // -------------------------
    // 7.1) wiringSizing (para Results)
    // -------------------------
    const wiringSizing = {
      dc: {
        // ✅ v2.0: DC total campo→inversor (L1 + L2) ida/vuelta
        lengthM: round0((L1 + L2) * 2),
        voltageV: round0(vdcNom),
        currentA: round1(iDc),
        gaugeLabel: dcMainCable.label,
        ampacityA: dcMainCable.ampacityA,
      },
      ac: {
        lengthM: round0(L3),
        voltageV: round0(acVoltage),
        currentA: round1(iAc),
        gaugeLabel: acCable.label,
        ampacityA: acCable.ampacityA,
      },
    };

    // ✅ wiringEstimates (para Results.jsx)
    const wiringEstimates = {
      panelToInverterM: round1(L1 + L2),
      inverterToAcBoardM: round1(L3),
      inverterToDcBoardM: 0,
      dcCableM: round0((L1 + L2) * 2),
      acCableM: round0(L3),
      conduitM: round0((L1 || 0) + (L2 || 0) + (L3 || 0)),
      notes: ["Estimación desde motor Ingeniero (v2.0)."],
    };

    // -------------------------
    // 8) LEGACY OUTPUT (Results.jsx friendly)
    // -------------------------
    const legacy = {
      mode: "ENGINEER",
      modeTag: "ENGINEER",
      project: { name: project.name, company: project.company },
      inputs: {
        clientMode: clientMode === "CI" ? "CI" : "RES",
        country: loc.country,
        city: loc.city,
        psh: loc.psh,

        acPhase,
        acVoltageV: round0(acVoltage),

        billingKWh: bill.billingKWh,
        billingDays: bill.billingDays,
        tariffCOPkWh: bill.tariffCOPkWh,
        daytimeRatio: bill.daytimeRatio,
        zeroExport: bill.zeroExport,

        wantExport: exportRatio > 0 || exportKW > 0,
        exportKW: round1(exportKW),
        exportRatio: round2(exportRatio),

        wantBattery: Boolean(wantBattery),

        areaM2: round1(areaM2),
        panelAreaM2: round2(panelAreaM2),
        maxPanelsByArea: round0(maxPanelsByArea),
        panelsTarget: round0(panelsTarget),
        limitedByArea: Boolean(limitedByArea),

        panelToInverterM: round1(L1 + L2),
        inverterToACBoardM: round1(L3),
        inverterDistanceM: 0,
      },
      pv: {
        numberOfPanels: panelsEffective,
        requiredPower: round2(installedKWpEffective),
        annualEnergy: round0(annualEnergyEffective),
        panelPowerW: round0(panelW),
      },
      battery: {
        mode: wantBattery && autonomyHours > 0 ? "autonomy" : "none",
        autonomyHours: round2(autonomyHours),
        requiredBatteryKWh: round2(requiredBatteryKWh),
        requiredAh: round0(requiredAh),
        systemVoltage: round0(systemVoltage),
      },
      roi: {},
      stringing,
      protections,
      segments,
      bom,
      wiringSizing,
      wiringEstimates,
      sizing: {
        pv: {
          numberOfPanels: panelsEffective,
          panelPowerW: panelW,
          installedPowerKWp: round2(installedKWpEffective),
          annualEnergyKWh: round0(annualEnergyEffective),
        },
        inverter: {
          acPowerKW: round2(invAcKw),
          dcAcRatio: dcAcRatio ? round2(dcAcRatio) : null,
          eff: inverterEff,
        },
      },
      energy: {
        dailyKWh: round2(dailyKWh),
        tariffCOPkWh: round2(bill.tariffCOPkWh),
        annualEnergyKWh: round0(annualEnergyEffective),

        selfConsumptionRatio: round2(num(form.selfConsumptionRatio)),
        exportTargetKW: round1(exportKW),
        zeroExport: Boolean(bill.zeroExport),
        dcAcRatio: dcAcRatio ? round2(dcAcRatio) : null,
      },
      diagnostics: {
        ok: diag.errors.length === 0,
        issues: [...diag.errors, ...diag.warnings],
      },
      engineerPreset: safe,
    };

    // -------------------------
    // 9) A4: VALIDACIONES EXTRA (soft checks)
    // -------------------------
    try {
      const checks = runEngineerChecks({
        inputs: { form: safe.form },
        pv: legacy.pv,
        sizing: legacy.sizing,
        stringing: legacy.stringing,
      });

      const extraIssues = Array.isArray(checks?.issues) ? checks.issues : [];
      const mergedIssues = [...(legacy.diagnostics?.issues || []), ...extraIssues];

      legacy.diagnostics = {
        ok: diag.errors.length === 0 && extraIssues.length === 0,
        issues: mergedIssues,
      };
    } catch (e) {
      legacy.diagnostics = {
        ok: false,
        issues: [...(legacy.diagnostics?.issues || []), `Checks internos fallaron: ${e?.message || "desconocido"}`],
      };
    }

    // -------------------------
    // 10) FINANZAS PRO (CAPEX + KPIs) — anti-crash
    // -------------------------
    try {
      legacy.engineerPreset = {
        ...legacy.engineerPreset,
        form: {
          ...(legacy.engineerPreset?.form || {}),
          finance: withDefaultFinance(legacy.engineerPreset?.form?.finance || {}),
        },
      };

      const costing = computeCosting({
        bom: legacy.bom,
        sizing: legacy.sizing,
        wiringEstimates: legacy.wiringEstimates,
        stringing: legacy.stringing,
        protections: legacy.protections,
        form: legacy.engineerPreset.form,
      });

      const finance = computeFinance({
        costing,
        annualEnergyKWh: legacy.energy?.annualEnergyKWh || legacy.pv?.annualEnergy || 0,
        inputs: legacy.inputs,
        energy: legacy.energy,
        form: legacy.engineerPreset.form,
      });

      legacy.costing = costing;
      legacy.finance = finance;
    } catch (e) {
      legacy.costing = null;
      legacy.finance = null;
      legacy.diagnostics = {
        ok: false,
        issues: [...(legacy.diagnostics?.issues || []), `Finanzas no pudieron calcularse: ${e?.message || "desconocido"}`],
      };
    }

    return legacy;
  } catch (err) {
    return {
      mode: "ENGINEER",
      modeTag: "ENGINEER",
      project: { name: "—", company: "—" },
      inputs: { clientMode: "RES", country: "Colombia", city: "—", psh: 0, acPhase: "1P", acVoltageV: 220 },
      pv: { numberOfPanels: 0, requiredPower: 0, annualEnergy: 0 },
      battery: { mode: "none", autonomyHours: 0, requiredBatteryKWh: 0, requiredAh: 0, systemVoltage: 48 },
      roi: {},
      stringing: {},
      protections: {},
      segments: { rows: [], totals: { subtotalConductores: 0, metrosTotales: 0 } },
      bom: { items: [], subtotal: 0, tax: 0, margin: 0, total: 0 },
      wiringSizing: null,
      wiringEstimates: null,
      costing: null,
      finance: null,
      diagnostics: {
        ok: false,
        issues: [`Error en runEngineerSizing(): ${err?.message || "desconocido"}`],
      },
      // ✅ FIX: ya no referencia "safe" inexistente
      engineerPreset: safePreset || null,
    };
  }
}

/* ========================= Helpers ========================= */

function pickStringingToFitMpptCurrent({ nPanels, nsMin, nsMax, numMppt, mpptMaxInputA, IstringForMppt }) {
  const Istr = Math.max(0.1, num(IstringForMppt));
  const Imax = Math.max(0.1, num(mpptMaxInputA));
  const maxParallelPerMppt = Math.max(1, Math.floor(Imax / Istr));
  const maxStringsAllMppt = maxParallelPerMppt * Math.max(1, Math.round(num(numMppt)));

  const NsMid = clampInt(Math.round((nsMin + nsMax) / 2), nsMin, nsMax);
  const stringsMid = Math.max(1, Math.ceil(nPanels / Math.max(1, NsMid)));

  if (stringsMid <= maxStringsAllMppt) {
    return {
      Ns: NsMid,
      stringsTotal: stringsMid,
      stringsUsed: stringsMid,
      maxParallelPerMppt,
      maxStringsAllMppt,
      adjustedByNs: false,
    };
  }

  let best = null;
  for (let Ns = nsMax; Ns >= nsMin; Ns--) {
    const stringsTotal = Math.max(1, Math.ceil(nPanels / Math.max(1, Ns)));
    if (stringsTotal <= maxStringsAllMppt) {
      best = { Ns, stringsTotal };
      break;
    }
  }

  if (best) {
    return {
      Ns: best.Ns,
      stringsTotal: best.stringsTotal,
      stringsUsed: best.stringsTotal,
      maxParallelPerMppt,
      maxStringsAllMppt,
      adjustedByNs: true,
    };
  }

  const stringsTotalWorst = Math.max(1, Math.ceil(nPanels / Math.max(1, nsMax)));
  return {
    Ns: nsMax,
    stringsTotal: stringsTotalWorst,
    stringsUsed: Math.max(1, maxStringsAllMppt),
    maxParallelPerMppt,
    maxStringsAllMppt,
    adjustedByNs: true,
  };
}

function withDefaultFinance(fin = {}) {
  const f = fin || {};
  return {
    analysisYears: isFiniteNum(f.analysisYears) ? num(f.analysisYears) : 25,
    discountRate: isFiniteNum(f.discountRate) ? num(f.discountRate) : 0.12,
    degradationPct: isFiniteNum(f.degradationPct) ? num(f.degradationPct) : 0.005,
    tariffEscalationPct: isFiniteNum(f.tariffEscalationPct) ? num(f.tariffEscalationPct) : 0.06,

    omPctPerYear: isFiniteNum(f.omPctPerYear) ? num(f.omPctPerYear) : 0.015,
    omEscalationPct: isFiniteNum(f.omEscalationPct) ? num(f.omEscalationPct) : 0.04,

    selfConsumptionRatio: isFiniteNum(f.selfConsumptionRatio) ? num(f.selfConsumptionRatio) : num(0.85),
    exportPriceCOPkWh: isFiniteNum(f.exportPriceCOPkWh) ? num(f.exportPriceCOPkWh) : 0,

    inverterReplaceYear: isFiniteNum(f.inverterReplaceYear) ? num(f.inverterReplaceYear) : 12,
    inverterReplacePctOfInverterCost: isFiniteNum(f.inverterReplacePctOfInverterCost)
      ? num(f.inverterReplacePctOfInverterCost)
      : 0.7,

    contingencyPct: isFiniteNum(f.contingencyPct) ? num(f.contingencyPct) : 0.07,
    installPct: isFiniteNum(f.installPct) ? num(f.installPct) : 0.1,
    engineeringPct: isFiniteNum(f.engineeringPct) ? num(f.engineeringPct) : 0.03,
    permitsCOP: isFiniteNum(f.permitsCOP) ? num(f.permitsCOP) : 800000,

    insuranceCOPperYear: isFiniteNum(f.insuranceCOPperYear) ? num(f.insuranceCOPperYear) : 0,
    cleaningCOPperYear: isFiniteNum(f.cleaningCOPperYear) ? num(f.cleaningCOPperYear) : 0,

    taxPct: isFiniteNum(f.taxPct) ? num(f.taxPct) : 0,
    marginPct: isFiniteNum(f.marginPct) ? num(f.marginPct) : 0,
  };
}

function normalizePreset(p) {
  const project = p?.project || {};
  const loc = p?.loc || {};
  const bill = p?.bill || {};
  const rawForm = p?.form || {};
  const inputs = p?.inputs || {};
  const batt = p?.battery || {};
  const battSizing = p?.batterySizing || {};

  const clientMode = p?.clientMode === "CI" ? "CI" : "RES";

  const country = String(loc.country || "Colombia");
  const city = String(loc.city || "Cali");

  const voltageDefault = clientMode === "CI" ? (country === "España" ? 400 : 380) : country === "España" ? 230 : 220;

  const billingKWh = num(bill.billingKWh || bill.consumptionKWh);
  const billingDays = num(bill.billingDays) || 30;

  const areaM2 = num(rawForm.areaM2) || num(inputs.areaM2) || 0;
  const panelAreaM2 = num(rawForm.panelAreaM2) || num(inputs.panelAreaM2) || 0;
  const packingFactor = Number.isFinite(num(rawForm.packingFactor)) ? num(rawForm.packingFactor) : 0.92;

  const wantBattery =
    Boolean(rawForm.wantBattery) ||
    Boolean(rawForm.useBattery) ||
    Boolean(rawForm.hasBattery) ||
    Boolean(inputs.wantBattery) ||
    Boolean(inputs.useBattery) ||
    Boolean(batt.enabled) ||
    Boolean(battSizing.enabled);

  const autonomyHours =
    num(rawForm.autonomyHours) ||
    num(inputs.autonomyHours) ||
    num(battSizing.autonomyHours) ||
    (num(rawForm.autonomyDays) ||
      num(inputs.autonomyDays) ||
      num(battSizing.autonomyDays) ||
      num(batt.autonomyDays)) * 24 ||
    0;

  const autonomyDays =
    num(rawForm.autonomyDays) || num(inputs.autonomyDays) || num(battSizing.autonomyDays) || num(batt.autonomyDays) || 0;

  const systemVoltage =
    num(rawForm.systemVoltage) || num(inputs.systemVoltage) || num(batt.systemVoltageV) || num(battSizing.systemVoltageV) || 48;

  const dod =
    num(rawForm.dod) ||
    num(inputs.batteryDoD) ||
    num(inputs.dod) ||
    num(batt.dod) ||
    num(battSizing.dod) ||
    0.8;

  const batteryRoundtripEff =
    num(rawForm.batteryRoundtripEff) ||
    num(rawForm.batteryEfficiency) ||
    num(inputs.batteryEfficiency) ||
    num(batt.eff) ||
    num(battSizing.eff) ||
    0.92;

  const reserveFraction =
    num(rawForm.reserveFraction) ||
    num(rawForm.reservePct) ||
    num(inputs.reserveFraction) ||
    num(inputs.reservePct) ||
    (num(bill.reservePct) > 0 ? num(bill.reservePct) : 0) ||
    0.1;

  const batteryId =
    rawForm.batteryId || inputs.batteryId || batt.batteryId || (wantBattery ? "bat_48v_generic" : "bat_none");

  const finance = withDefaultFinance(rawForm.finance || {});

  const selfConsumptionRatio =
    isFiniteNum(rawForm.selfConsumptionRatio) ? num(rawForm.selfConsumptionRatio)
    : isFiniteNum(inputs.selfConsumptionRatio) ? num(inputs.selfConsumptionRatio)
    : isFiniteNum(finance.selfConsumptionRatio) ? num(finance.selfConsumptionRatio)
    : 0.85;

  const exportRatio =
    isFiniteNum(rawForm.exportRatio) ? num(rawForm.exportRatio)
    : isFiniteNum(inputs.exportRatio) ? num(inputs.exportRatio)
    : 0;

  const exportKW =
    isFiniteNum(rawForm.exportKW) ? num(rawForm.exportKW)
    : isFiniteNum(inputs.exportKW) ? num(inputs.exportKW)
    : 0;

  const form = {
    ...rawForm,

    acPhase: rawForm.acPhase || (clientMode === "CI" ? "3P" : "1P"),
    acVoltageV: num(rawForm.acVoltageV) || voltageDefault,
    systemLosses: Number.isFinite(num(rawForm.systemLosses)) ? num(rawForm.systemLosses) : 0.2,
    peakSunHours: num(rawForm.peakSunHours) || num(loc.psh) || 4.8,
    dailyConsumption: num(rawForm.dailyConsumption) || 0,

    finance,

    areaM2,
    panelAreaM2,
    packingFactor,

    wantBattery,
    autonomyHours,
    autonomyDays,
    systemVoltage,
    dod,
    batteryRoundtripEff,
    reserveFraction,
    batteryId,

    selfConsumptionRatio,
    exportRatio,
    exportKW,
  };

  return {
    project: {
      name: String(project.name || "ENRGY ONE • Solar Designer"),
      company: String(project.company || "—"),
    },
    loc: {
      country,
      city,
      psh: num(loc.psh) || 4.8,
    },
    clientMode,
    bill: {
      billingKWh,
      billingDays,
      tariffCOPkWh: num(bill.tariffCOPkWh) || num(form.tariff) || 900,
      daytimeRatio: clamp01(bill.daytimeRatio, 0.85),
      zeroExport: Boolean(bill.zeroExport),
      reservePct: num(bill.reservePct) || 0,
    },
    form,
  };
}

function allocateStringsToMppt(stringsUsed, numMppt, maxParallelPerMppt) {
  const alloc = [];
  let remaining = Math.max(0, Math.round(stringsUsed));

  for (let i = 1; i <= numMppt; i++) {
    const can = Math.min(maxParallelPerMppt, remaining);
    alloc.push({ mppt: i, strings: can });
    remaining -= can;
  }

  if (remaining > 0) alloc[alloc.length - 1].strings += remaining;
  return alloc;
}

function buildBomEngineer({
  panels,
  panelW,
  inverterAcKw,
  stringsUsed,
  Ns,
  acPhase,
  acVoltage,
  cables,
  lengths,
  protections,
  battery,
}) {
  const items = [];

  items.push({
    category: "Campo FV",
    item: `Panel FV ${panelW} W`,
    qty: panels,
    unit: "und",
    notes: `Stringing: Ns=${Ns} • Strings=${stringsUsed} • Potencia ${((panels * panelW) / 1000).toFixed(2)} kWp`,
  });

  items.push({
    category: "Inversor",
    item: `Inversor ${round2(inverterAcKw)} kW (${acPhase} @ ${acVoltage} V)`,
    qty: 1,
    unit: "und",
    notes: "Validar ficha técnica real (MPPT, Vdc, Imax).",
  });

  items.push({
    category: "Protecciones DC",
    item: protections?.dc?.combiner || "Caja combinadora DC",
    qty: 1,
    unit: "und",
    notes: `Fusible string aprox: ${protections?.dc?.stringFuseA || "—"} A • ${protections?.dc?.spd || ""}`,
  });

  items.push({
    category: "Protecciones AC",
    item: "Tablero/protección AC",
    qty: 1,
    unit: "set",
    notes: `Breaker aprox: ${protections?.ac?.breakerA || "—"} A • ${protections?.ac?.spd || ""}`,
  });

  items.push({
    category: "Cableado DC",
    item: `Cable DC string: ${cables.dcStringCable.label}`,
    qty: Math.round((lengths.L1 || 0) * 2),
    unit: "m",
    notes: "Tramo string→combiner (estimado).",
  });

  items.push({
    category: "Cableado DC",
    item: `Cable DC principal: ${cables.dcMainCable.label}`,
    qty: Math.round((lengths.L2 || 0) * 2),
    unit: "m",
    notes: "Tramo combiner→inversor (estimado).",
  });

  items.push({
    category: "Cableado AC",
    item: `Cable AC: ${cables.acCable.label}`,
    qty: Math.round(lengths.L3 || 0),
    unit: "m",
    notes: "Tramo inversor→tablero (estimado).",
  });

  if (battery?.wantBattery) {
    items.push({
      category: "Baterías",
      item: `Banco de baterías ${round2(battery.requiredBatteryKWh)} kWh`,
      qty: 1,
      unit: "set",
      notes: `ID: ${battery.batteryId || "—"} • Autonomía: ${round1(battery.autonomyHours)} h • ${round0(
        battery.systemVoltage
      )} V • ~${round0(battery.requiredAh)} Ah`,
    });

    items.push({
      category: "Baterías",
      item: "Protección batería DC (breaker/fusible + seccionador)",
      qty: 1,
      unit: "set",
      notes: "Dimensionar por corriente de carga/descarga del inversor híbrido.",
    });
  }

  items.push({
    category: "Puesta a tierra",
    item: "Sistema de puesta a tierra",
    qty: 1,
    unit: "set",
    notes: protections?.grounding || "Varilla + conductor + uniones equipotenciales",
  });

  items.push({
    category: "Conectividad",
    item: "Conectores MC4 (pares)",
    qty: Math.max(2, stringsUsed * 2),
    unit: "par",
    notes: "Estimación base (ajustar por diseño real).",
  });

  return items;
}

/* -------- Cable selection + voltage drop (simplificado) -------- */

function pickCableByCurrent(currentA, kind = "AC", material = "Cu") {
  const I = Math.max(0, num(currentA));
  const margin = kind === "DC" ? 1.25 : 1.15;
  const required = I * margin;

  const tableCu = [
    { mm2: 2.5, label: "2.5 mm²", ampacityA: 20 },
    { mm2: 4, label: "4 mm²", ampacityA: 30 },
    { mm2: 6, label: "6 mm²", ampacityA: 40 },
    { mm2: 10, label: "10 mm²", ampacityA: 55 },
    { mm2: 16, label: "16 mm²", ampacityA: 75 },
    { mm2: 25, label: "25 mm²", ampacityA: 100 },
    { mm2: 35, label: "35 mm²", ampacityA: 125 },
    { mm2: 50, label: "50 mm²", ampacityA: 150 },
    { mm2: 70, label: "70 mm²", ampacityA: 200 },
    { mm2: 95, label: "95 mm²", ampacityA: 260 },
  ];

  const tableAl = tableCu.map((x) => ({
    ...x,
    label: `${x.mm2} mm² (Al)`,
    ampacityA: Math.round(x.ampacityA * 0.8),
  }));

  const table = material === "Al" ? tableAl : tableCu;
  return table.find((x) => x.ampacityA >= required) || table[table.length - 1];
}

function estimateVdropPct_DC({ I, V, L_1w, mm2, material = "Cu" }) {
  const rho = material === "Al" ? 0.0282 : 0.0175;
  const L = Math.max(0, num(L_1w)) * 2;
  const R = (rho * L) / Math.max(0.5, num(mm2));
  const dV = num(I) * R;
  return V > 0 ? (dV / V) * 100 : 0;
}

function estimateVdropPct_AC({ I, V, L_1w, mm2, material = "Cu", phase = "1P" }) {
  const rho = material === "Al" ? 0.0282 : 0.0175;
  const L = Math.max(0, num(L_1w));
  const R1 = (rho * L) / Math.max(0.5, num(mm2));
  let dV = 0;

  if (phase === "3P") dV = Math.sqrt(3) * num(I) * R1;
  else dV = 2 * num(I) * R1;

  return V > 0 ? (dV / V) * 100 : 0;
}

/* ---------------- basic utils ---------------- */

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
function clampInt(x, lo, hi) {
  const n = Math.round(num(x));
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
function isFiniteNum(x) {
  const n = Number(String(x ?? "").trim().replace(",", "."));
  return Number.isFinite(n);
}
