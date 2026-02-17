// src/components/Results.jsx
import { useMemo, useState } from "react";
import { downloadJson } from "../utils/exporters";
import { useI18n } from "../i18n/I18nProvider";

export default function Results({ data }) {
  const safe = useMemo(() => normalizeAnyData(data), [data]);

  const {
    modeTag,
    project,
    inputs,
    pv,
    battery,
    bom,
    diagnostics,
    energy,
    wiring, // <- unificado desde wiringEstimates si existe
    wiringSizing,
    stringing,
    protections,
    segments,

    // ✅ FINANZAS (mostrar si existen, incluso en Amateur)
    costing,
    finance,
  } = safe;

  const isEngineer = modeTag === "ENGINEER";

  // ========= i18n real =========
  const { t, locale, lang } = useI18n();

  // ✅ Mapea keys legacy (planas) -> rutas i18n (dot notation)
  const TT = (key, fallback = "") => t(mapKey(key), fallback || key);

  const handlePrint = () => window.print();

  const handleDownload = () => {
    const base = (project?.name || "ENRGY_ONE").replace(/[^\w\-]+/g, "_");
    const fname = `${base}_${isEngineer ? "engineer" : "amateur"}_${lang === "en" ? "results" : "resultados"}.json`;
    downloadJson(fname, safe._raw || safe);
  };

  const limitedByArea = Boolean(inputs?.limitedByArea);

  // ✅ helpers para mostrar voltajes del string si el motor los entrega
  const hasStringing = Boolean(isEngineer && stringing?.result);
  const vmpString = num(stringing?.result?.vmpString);
  const vocColdString = num(stringing?.result?.vocColdString);

  // ✅ Diagnósticos pro
  const issues = Array.isArray(diagnostics?.issues) ? diagnostics.issues.filter(Boolean) : [];

  // ✅ KPI subtexto más correcto según modo
  const consumptionSub = isEngineer
    ? TT("consumptionSubEngineer", "Tomado de preset o inferido de factura")
    : TT("consumptionSubAmateur", "kWh periodo / días facturados");

  // ✅ SEGMENTS SAFE: soporta múltiples esquemas del motor
  const segRowsRaw = pickSegmentRows(segments);
  const segRowsBase = segRowsRaw.map((r, idx) => normalizeSegmentRow(r, idx));
  const segTotals = normalizeSegmentTotals(segments);

  // ✅ anti-crash: si wiringSizing no existe, usamos fallback calculado desde wiring/energy
  const wiringSizingSafe = useMemo(() => {
    const norm = normalizeWiringSizing(wiringSizing);
    return norm || makeFallbackWiringSizing({ safe });
  }, [wiringSizing, safe]);

  // ✅ Si el motor no trae voltage_V, lo inferimos aquí
  const segRows = useMemo(() => {
    const inferred = inferSegmentVoltages({
      segRows: segRowsBase,
      inputs,
      hasStringing,
      vmpString,
    });

    // también tratamos de inferir mm² del label para mostrarlo
    return inferred.map((r) => ({
      ...r,
      mm2: r.mm2 ?? parseMm2FromLabel(r.cable),
    }));
  }, [segRowsBase, inputs, hasStringing, vmpString]);

  const showSegments = segRows.length > 0;

  // UI toggles
  const [showAllIssues, setShowAllIssues] = useState(false);
  const [showAllSegments, setShowAllSegments] = useState(false);

  // ✅ FINANZAS UI toggles
  const [showAllCapex, setShowAllCapex] = useState(false);
  const [showAllCashflows, setShowAllCashflows] = useState(false);

  /* =========================
     A5 — Compatibilidad PRO
  ========================= */
  const classified = useMemo(() => classifyIssues(issues), [issues]);
  const counts = useMemo(
    () => ({
      error: classified.filter((x) => x.level === "error").length,
      warn: classified.filter((x) => x.level === "warn").length,
      info: classified.filter((x) => x.level === "info").length,
    }),
    [classified]
  );
  const compatStatus = counts.error > 0 ? "error" : counts.warn > 0 ? "warn" : "ok";
  const compatLabel =
    compatStatus === "ok"
      ? TT("compatOk", "✅ COMPATIBLE")
      : compatStatus === "warn"
      ? TT("compatWarn", "⚠ REVISAR")
      : TT("compatNo", "⛔ NO COMPATIBLE");

  const issuesToRender = showAllIssues ? classified : classified.slice(0, 20);
  const segmentsToRender = showAllSegments ? segRows : segRows.slice(0, 12);

  // ✅ FINANZAS SAFE (mostrar si existen, independientemente del modo)
  const hasCosting = Boolean(costing && (Array.isArray(costing.capexLines) || isFiniteNum(costing.totalCapex)));
  const hasFinance = Boolean(finance && (Array.isArray(finance.flows) || isFiniteNum(finance.npvCOP)));

  const capexLinesAll = Array.isArray(costing?.capexLines) ? costing.capexLines : [];
  const capexLinesToRender = showAllCapex ? capexLinesAll : capexLinesAll.slice(0, 16);

  const flowsAll = Array.isArray(finance?.flows) ? finance.flows : [];
  const flowsToRender = showAllCashflows ? flowsAll : flowsAll.slice(0, 10);

  // ✅ FIX UI: baterías (compatibilidad Amateur/Engineer)
  const batteryLabelValue = battery?.mode === "none" ? "—" : fmt(battery?.capacityKWh, 1, locale);

  const bAss = battery?.assumptions || null;
  const extraB =
    bAss
      ? [
          bAss.backupEnergyKWh != null ? `${TT("backup", "Respaldo")}: ${fmt(bAss.backupEnergyKWh, 2, locale)} kWh` : null,
          bAss.dod != null ? `DoD: ${(num(bAss.dod) * 100).toFixed(0)}%` : null,
          bAss.battEff != null ? `η: ${(num(bAss.battEff) * 100).toFixed(0)}%` : null,
          bAss.reserve != null ? `${TT("reserve", "Reserva")}: ${(num(bAss.reserve) * 100).toFixed(0)}%` : null,
          bAss.criticalLoadKW != null && num(bAss.criticalLoadKW) > 0
            ? `${TT("criticalLoad", "Carga crítica")}: ${fmt(bAss.criticalLoadKW, 2, locale)} kW`
            : null,
        ]
          .filter(Boolean)
          .join(" • ")
      : null;

  const batterySub =
    battery?.mode === "none"
      ? TT("noBattery", "Sin batería")
      : [
          battery?.autonomyHours ? `${TT("autonomy", "Autonomía")}: ${fmt(battery.autonomyHours, 1, locale)} h` : null,
          battery?.systemVoltage ? `${fmt(battery.systemVoltage, 0, locale)} V` : null,
          battery?.requiredAh ? `~${fmt(battery.requiredAh, 0, locale)} Ah` : null,
        ]
          .filter(Boolean)
          .join(" • ") || TT("batteryEstimated", "Banco de baterías (estimado)");

  const batterySubFinal = extraB ? `${batterySub} • ${extraB}` : batterySub;

  // ✅ FIX UI: excedentes (preferir energy.exportTargetKW)
  const exportKW = isFiniteNum(energy?.exportTargetKW) ? num(energy?.exportTargetKW) : num(inputs?.exportKW);
  const wantExport = Boolean(inputs?.wantExport) || exportKW > 0;

  // ✅ FIX UI: DC/AC ratio (fallback mejor)
  const dcAcRatio =
    isFiniteNum(energy?.dcAcRatio)
      ? num(energy?.dcAcRatio)
      : isFiniteNum(safe?._raw?.sizing?.inverter?.dcAcRatio)
      ? num(safe._raw.sizing.inverter.dcAcRatio)
      : null;

  // ✅ finanzas: se muestran si existen (Amateur o Engineer)
  const showFinanceSection = Boolean(hasCosting || hasFinance);

  return (
    <div className="card">
      <div className="row" style={{ alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div className="badge">
            {TT("results", "RESULTADOS")} • {isEngineer ? TT("engineer", "INGENIERO") : TT("amateur", "AMATEUR")}
          </div>
          <h2 style={{ marginTop: 10 }}>{project?.name || "—"}</h2>
          <div className="muted">{project?.company || "—"}</div>
          <div className="muted" style={{ marginTop: 6 }}>
            {inputs?.city || "—"}, {inputs?.country || "—"} • PSH {fmt(inputs?.psh, 1, locale)}
          </div>
        </div>

        <div className="row" style={{ gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <span
            className={`pill ${pillByStatus(compatStatus)}`}
            title={TT("compatTitle", "Compatibilidad general del diseño (A5)")}
          >
            {compatLabel}
          </span>

          <button type="button" className="btn" onClick={handleDownload}>
            {TT("downloadJson", "Descargar JSON")}
          </button>
          <button type="button" className="btnPrimary" onClick={handlePrint}>
            {TT("printReport", "Imprimir reporte")}
          </button>
        </div>
      </div>

      {/* ✅ A5: PANEL PRO DE COMPATIBILIDAD */}
      <div className="note" style={{ marginTop: 12 }}>
        <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <b>{TT("designCompatibility", "Compatibilidad del diseño")}</b>
            <div className="muted" style={{ marginTop: 4 }}>
              {isEngineer
                ? TT("compatEngineerDesc", "Basado en warnings del motor + checks de ingeniería.")
                : TT("compatAmateurDesc", "En modo Amateur puede haber menos validaciones; ideal validar en Ingeniero.")}
            </div>
          </div>

          <div className="row" style={{ gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <span className={`pill ${pillByStatus(compatStatus)}`}>{compatLabel}</span>
            <span className="pill" style={{ opacity: 0.95 }}>
              ⛔ {counts.error} {TT("errors", "errores")}
            </span>
            <span className="pill" style={{ opacity: 0.95 }}>
              ⚠ {counts.warn} {TT("warnings", "advertencias")}
            </span>
            <span className="pill" style={{ opacity: 0.85 }}>
              ℹ {counts.info} {TT("info", "info")}
            </span>
          </div>
        </div>

        {classified.length ? (
          <div style={{ marginTop: 10 }}>
            <div className="tableWrap" style={{ marginTop: 10 }}>
              <table className="table" style={{ minWidth: 900, tableLayout: "fixed" }}>
                <thead>
                  <tr>
                    <th style={{ width: 140 }}>{TT("level", "Nivel")}</th>
                    <th>{TT("detail", "Detalle")}</th>
                  </tr>
                </thead>
                <tbody>
                  {issuesToRender.map((it, idx) => (
                    <tr key={idx}>
                      <td>
                        <IssueChip level={it.level} />
                      </td>
                      <td style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{it.text}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {classified.length > 20 ? (
              <div className="row" style={{ marginTop: 8, justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div className="muted">
                  {showAllIssues
                    ? `${TT("showing", "Mostrando")} ${classified.length}.`
                    : `${TT("showing", "Mostrando")} 20 ${TT("of", "de")} ${classified.length}.`}
                </div>
                <button type="button" className="btn" onClick={() => setShowAllIssues((s) => !s)}>
                  {showAllIssues ? TT("seeLess", "Ver menos") : TT("seeAll", "Ver todo")}
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="muted" style={{ marginTop: 8 }}>
            ✅ {TT("noIssues", "Sin issues reportados.")}
          </div>
        )}
      </div>

      {/* ALERTA CLAVE: LIMITACIÓN POR ÁREA */}
      {limitedByArea ? (
        <div className="note" style={{ marginTop: 12, borderColor: "rgba(255, 193, 7, 0.45)" }}>
          <b>⚠ {TT("areaLimitTitle", "Limitación por área")}</b>
          <div className="muted" style={{ marginTop: 6 }}>
            {TT("areaLimitMsg1", "Para cumplir la meta se requerían aprox.")} <b>{fmt(inputs?.panelsTarget, 0, locale)}</b>{" "}
            {TT("panels", "paneles")},{" "}
            {TT("areaLimitMsg2", "pero por el área disponible")} (<b>{fmt(inputs?.areaM2, 1, locale)}</b> m²){" "}
            {TT("areaLimitMsg3", "caben aprox.")} <b>{fmt(inputs?.maxPanelsByArea, 0, locale)}</b>.
          </div>
          <div className="muted" style={{ marginTop: 4 }}>
            {TT("areaLimitTip", "Solución típica: aumenta área, usa panel mayor potencia/menor área efectiva, o reduce meta de excedentes.")}
          </div>
        </div>
      ) : null}

      <h3 className="section">{TT("techSummary", "Resumen técnico")}</h3>

      <div className="kpiGrid">
        <KPI label={TT("pvPower", "Potencia FV (kWp)")} value={fmt(pv?.requiredPower, 2, locale)} sub={TT("pvPowerSub", "Potencia FV estimada/instalada")} />
        <KPI label={TT("numPanels", "# Paneles")} value={fmt(pv?.numberOfPanels, 0, locale)} sub={TT("numPanelsSub", "Cantidad total de módulos")} />
        <KPI label={TT("annualEnergy", "Energía anual (kWh)")} value={fmt(pv?.annualEnergy, 0, locale)} sub={TT("annualEnergySub", "Estimación con pérdidas")} />
        <KPI label={TT("dailyConsumption", "Consumo diario (kWh/día)")} value={fmt(energy?.dailyKWh, 2, locale)} sub={consumptionSub} />
        <KPI label={TT("tariff", "Tarifa (COP/kWh)")} value={fmt(energy?.tariffCOPkWh, 0, locale)} sub={TT("tariffSub", "Factura o tarifa ingresada")} />
        <KPI label={TT("battery", "Batería (kWh)")} value={batteryLabelValue} sub={batterySubFinal} />
        <KPI
          label={TT("export", "Excedentes (kW)")}
          value={wantExport ? fmt(exportKW, 1, locale) : "—"}
          sub={wantExport ? TT("exportSubYes", "Meta de potencia") : TT("exportSubNo", "No desea exportar")}
        />
        <KPI label={TT("dcac", "DC/AC (ratio)")} value={dcAcRatio != null ? fmt(dcAcRatio, 2, locale) : "—"} sub={TT("dcacSub", "FV(kWp) / Inversor(kWac) (si disponible)")} />
      </div>

      {/* =========================
          ECONOMÍA Y FINANZAS — SE MUESTRA SI EXISTE
      ========================= */}
      <h3 className="section">{TT("financeTitle", "Economía y finanzas")}</h3>

      {!showFinanceSection ? (
        <div className="note">
          <b>{TT("financeUnavailable", "Finanzas no disponibles")}</b>
          <div className="muted" style={{ marginTop: 6 }}>
            {TT("financeUnavailableDesc1", "Asegúrate de estar corriendo el motor que entrega")} <b>data.costing</b>{" "}
            {TT("and", "y")} <b>data.finance</b>.
          </div>
          {!isEngineer ? (
            <div className="muted" style={{ marginTop: 6 }}>
              {TT(
                "financeTipEngineer",
                "Tip: cambia a Modo Ingeniero para ver supuestos avanzados (o habilita finanzas en Amateur si tu motor ya las calcula)."
              )}
            </div>
          ) : null}
        </div>
      ) : (
        <>
          {hasCosting ? (
            <div className="kpiGrid" style={{ marginTop: 8 }}>
              <KPI label={TT("capexTotal", "CAPEX total")} value={money(costing?.totalCapex, locale)} sub={TT("capexTotalSub", "Costo total del proyecto (con extras)")} />
              <KPI label={TT("equipmentSubtotal", "Subtotal equipos")} value={money(costing?.equipmentSubtotal, locale)} sub={TT("equipmentSubtotalSub", "Valor estimado inventario (equipos)")} />
              <KPI label={TT("install", "Instalación")} value={money(costing?.installCOP, locale)} sub={TT("installSub", "Mano de obra / montaje (pct)")} />
              <KPI label={TT("engineering", "Ingeniería")} value={money(costing?.engineeringCOP, locale)} sub={TT("engineeringSub", "Diseño / ingeniería (pct)")} />
              <KPI label={TT("permits", "Permisos")} value={money(costing?.permitsCOP, locale)} sub={TT("permitsSub", "Trámites / legalización (si aplica)")} />
              <KPI label={TT("contingency", "Contingencia")} value={money(costing?.contingencyCOP, locale)} sub={TT("contingencySub", "Reserva por imprevistos")} />
              <KPI label={TT("taxes", "Impuestos")} value={money(costing?.taxCOP, locale)} sub={TT("taxesSub", "IVA u otros (si aplica)")} />
              <KPI label={TT("margin", "Margen")} value={money(costing?.marginCOP, locale)} sub={TT("marginSub", "Margen (si aplica)")} />
            </div>
          ) : null}

          {hasFinance ? (
            <>
              <div className="kpiGrid" style={{ marginTop: 10 }}>
                <KPI
                  label={TT("npv", "VPN (NPV)")}
                  value={money(finance?.npvCOP, locale)}
                  sub={`${TT("discountRate", "Tasa descuento")}: ${(num(finance?.discountRate) * 100).toFixed(1)}%`}
                />
                <KPI label={TT("irr", "TIR (IRR)")} value={pct(finance?.irr)} sub={TT("irrSub", "Rendimiento anual estimado")} />
                <KPI
                  label={TT("payback", "Payback")}
                  value={finance?.paybackYear ? `${fmt(finance.paybackYear, 0, locale)} ${TT("years", "años")}` : "—"}
                  sub={TT("paybackSub", "Retorno simple")}
                />
                <KPI
                  label={TT("paybackDisc", "Payback desc.")}
                  value={finance?.paybackDiscountedYear ? `${fmt(finance.paybackDiscountedYear, 0, locale)} ${TT("years", "años")}` : "—"}
                  sub={TT("paybackDiscSub", "Retorno con descuento")}
                />
                <KPI label={TT("roi", "ROI")} value={pct(finance?.roi)} sub={TT("roiSub", "(beneficio neto - CAPEX) / CAPEX")} />
                <KPI
                  label={TT("lcoe", "LCOE")}
                  value={finance?.lcoeCOPkWh != null ? `${fmt(finance.lcoeCOPkWh, 0, locale)} COP/kWh` : "—"}
                  sub={TT("lcoeSub", "Costo nivelado energía")}
                />
              </div>

              <div className="note" style={{ marginTop: 10 }}>
                <b>{TT("financialAssumptions", "Supuestos financieros")}</b>
                <div className="muted" style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>
                  • {TT("analysisYears", "Años análisis")}: {fmt(finance?.years, 0, locale)}
                  {"\n"}• {TT("degradation", "Degradación")}: {pct(finance?.assumptions?.degradationPct)}
                  {"\n"}• {TT("tariffEsc", "Escalación tarifa")}: {pct(finance?.assumptions?.tariffEscalationPct)}
                  {"\n"}• {TT("omPct", "O&M (% CAPEX/año)")}: {pct(finance?.assumptions?.omPctPerYear)}
                  {"\n"}• {TT("omEsc", "O&M escalación")}: {pct(finance?.assumptions?.omEscalationPct)}
                  {"\n"}• {TT("selfCons", "Autoconsumo")}: {pct(finance?.assumptions?.selfConsumptionRatio)}
                  {"\n"}• {TT("exportPrice", "Precio excedentes")}:{" "}
                  {finance?.assumptions?.exportPriceCOPkWh ? `${fmt(finance.assumptions.exportPriceCOPkWh, 0, locale)} COP/kWh` : "—"}
                  {"\n"}• {TT("invReplace", "Reemplazo inversor")}: {TT("year", "año")} {fmt(finance?.assumptions?.inverterReplaceYear, 0, locale)} (≈{" "}
                  {money(finance?.assumptions?.inverterReplacementCOP, locale)})
                </div>
              </div>
            </>
          ) : null}

          {/* CAPEX TABLE */}
          {hasCosting ? (
            <>
              <h3 className="section">{TT("capexDetail", "Costo del proyecto (CAPEX) — detalle")}</h3>

              <div className="tableWrap">
                <table className="table" style={{ minWidth: 1100, tableLayout: "fixed" }}>
                  <thead>
                    <tr>
                      <th style={{ width: "18%" }}>{TT("category", "Categoría")}</th>
                      <th>{TT("concept", "Concepto")}</th>
                      <th style={{ width: "10%" }}>{TT("qty", "Cant.")}</th>
                      <th style={{ width: "10%" }}>{TT("unit", "Unidad")}</th>
                      <th style={{ width: "14%" }}>{TT("unitCost", "Costo unit")}</th>
                      <th style={{ width: "16%" }}>{TT("total", "Total")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {capexLinesToRender.length ? (
                      capexLinesToRender.map((x, idx) => (
                        <tr key={idx}>
                          <td>{x.category || "—"}</td>
                          <td style={{ whiteSpace: "normal", wordBreak: "break-word" }}>{x.concept || "—"}</td>
                          <td>{fmt(x.qty, 0, locale)}</td>
                          <td className="muted">{x.unit || "—"}</td>
                          <td>{money(x.unitCostCOP, locale)}</td>
                          <td style={{ fontWeight: 800 }}>{money(x.totalCOP, locale)}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={6} className="muted">
                          — {TT("noCapexLines", "Sin líneas de CAPEX.")}
                        </td>
                      </tr>
                    )}

                    {/* Totales */}
                    <tr>
                      <td colSpan={5} style={{ fontWeight: 900 }}>
                        {TT("equipmentSubtotalRow", "Subtotal equipos (inventario)")}
                      </td>
                      <td style={{ fontWeight: 900 }}>{money(costing?.equipmentSubtotal, locale)}</td>
                    </tr>
                    <tr>
                      <td colSpan={5} className="muted">
                        {TT("installRow", "Instalación")}
                      </td>
                      <td className="muted">{money(costing?.installCOP, locale)}</td>
                    </tr>
                    <tr>
                      <td colSpan={5} className="muted">
                        {TT("engineeringRow", "Ingeniería")}
                      </td>
                      <td className="muted">{money(costing?.engineeringCOP, locale)}</td>
                    </tr>
                    <tr>
                      <td colSpan={5} className="muted">
                        {TT("permitsRow", "Permisos")}
                      </td>
                      <td className="muted">{money(costing?.permitsCOP, locale)}</td>
                    </tr>
                    <tr>
                      <td colSpan={5} className="muted">
                        {TT("contingencyRow", "Contingencia")}
                      </td>
                      <td className="muted">{money(costing?.contingencyCOP, locale)}</td>
                    </tr>
                    <tr>
                      <td colSpan={5} className="muted">
                        {TT("taxesRow", "Impuestos")}
                      </td>
                      <td className="muted">{money(costing?.taxCOP, locale)}</td>
                    </tr>
                    <tr>
                      <td colSpan={5} className="muted">
                        {TT("marginRow", "Margen")}
                      </td>
                      <td className="muted">{money(costing?.marginCOP, locale)}</td>
                    </tr>
                    <tr>
                      <td colSpan={5} style={{ fontWeight: 1000 }}>
                        {TT("capexTotalRow", "CAPEX total")}
                      </td>
                      <td style={{ fontWeight: 1000 }}>{money(costing?.totalCapex, locale)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {capexLinesAll.length > 16 ? (
                <div className="row" style={{ marginTop: 10, justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div className="muted">
                    {showAllCapex
                      ? `${TT("showing", "Mostrando")} ${capexLinesAll.length}.`
                      : `${TT("showing", "Mostrando")} 16 ${TT("of", "de")} ${capexLinesAll.length}.`}
                  </div>
                  <button type="button" className="btn" onClick={() => setShowAllCapex((s) => !s)}>
                    {showAllCapex ? TT("seeLess", "Ver menos") : TT("seeAllCapex", "Ver todo CAPEX")}
                  </button>
                </div>
              ) : null}
            </>
          ) : null}

          {/* CASHFLOW */}
          {hasFinance ? (
            <>
              <h3 className="section">{TT("cashflowTitle", "Flujo de caja (ahorros + excedentes − OPEX − reemplazos)")}</h3>

              <div className="tableWrap">
                <table className="table" style={{ minWidth: 1200, tableLayout: "fixed" }}>
                  <thead>
                    <tr>
                      <th style={{ width: 70 }}>{TT("year", "año")}</th>
                      <th style={{ width: 140 }}>{TT("energy", "Energía (kWh)")}</th>
                      <th style={{ width: 140 }}>{TT("tariffCol", "Tarifa")}</th>
                      <th style={{ width: 170 }}>{TT("savings", "Ahorros")}</th>
                      <th style={{ width: 160 }}>{TT("exports", "Excedentes")}</th>
                      <th style={{ width: 170 }}>{TT("opex", "OPEX")}</th>
                      <th style={{ width: 170 }}>{TT("replacements", "Reemplazos")}</th>
                      <th style={{ width: 170 }}>{TT("net", "Neto")}</th>
                      <th style={{ width: 190 }}>{TT("netDisc", "Neto desc.")}</th>
                      <th style={{ width: 190 }}>{TT("cumDisc", "Acum. desc.")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {flowsToRender.length ? (
                      flowsToRender.map((f, idx) => (
                        <tr key={idx}>
                          <td style={{ fontWeight: 900 }}>{fmt(f.year, 0, locale)}</td>
                          <td>{fmt(f.energyKWh, 0, locale)}</td>
                          <td>{f.tariffCOPkWh != null ? `${fmt(f.tariffCOPkWh, 0, locale)} COP/kWh` : "—"}</td>
                          <td>{money(f.savingsCOP, locale)}</td>
                          <td>{money(f.exportCOP, locale)}</td>
                          <td>{money(f.opexCOP, locale)}</td>
                          <td>{money(f.replacementsCOP, locale)}</td>
                          <td style={{ fontWeight: 800 }}>{money(f.netCOP, locale)}</td>
                          <td className="muted">{money(f.netDiscCOP, locale)}</td>
                          <td className="muted">{money(f.cumDiscCOP, locale)}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={10} className="muted">
                          — {TT("noCashflow", "Sin flujo de caja.")}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {flowsAll.length > 10 ? (
                <div className="row" style={{ marginTop: 10, justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div className="muted">
                    {showAllCashflows
                      ? `${TT("showing", "Mostrando")} ${flowsAll.length}.`
                      : `${TT("showing", "Mostrando")} 10 ${TT("of", "de")} ${flowsAll.length}.`}
                  </div>
                  <button type="button" className="btn" onClick={() => setShowAllCashflows((s) => !s)}>
                    {showAllCashflows ? TT("seeLess", "Ver menos") : TT("seeAllCashflow", "Ver todo el flujo")}
                  </button>
                </div>
              ) : null}
            </>
          ) : null}
        </>
      )}

      {/* DISTANCIAS + METRADO */}
      <h3 className="section">{TT("distancesTitle", "Distancias y metrado rápido")}</h3>

      <div className="grid2">
        <div className="note">
          <b>{TT("inputDistances", "Distancias ingresadas (ida)")}</b>
          <br />
          {TT("panelsToInv", "Paneles → Inversor")}: <b>{fmt(inputs?.panelToInverterM, 1, locale)}</b> m
          <br />
          {TT("invToAcBoard", "Inversor → Tablero AC")}: <b>{fmt(inputs?.inverterToACBoardM, 1, locale)}</b> m
          <br />
          {TT("invToDcPoint", "Inversor → Punto DC (opc.)")}: <b>{fmt(inputs?.inverterDistanceM, 1, locale)}</b> m
        </div>

        <div className="note">
          <b>{TT("estimates", "Estimaciones")}</b>
          <br />
          {TT("dcCableTotal", "Cable DC total (ida/vuelta aprox.)")}: <b>{fmt(wiring?.dcCableM, 0, locale)}</b> m
          <br />
          {TT("acCable", "Cable AC (ida aprox.)")}: <b>{fmt(wiring?.acCableM, 0, locale)}</b> m
          <br />
          {TT("conduit", "Canalización (recorridos aprox.)")}: <b>{fmt(wiring?.conduitM, 0, locale)}</b> m
          {wiring?.notes?.length ? (
            <>
              <br />
              <span className="muted">
                {TT("notes", "Notas")}: {wiring.notes.slice(0, 3).join(" • ")}
              </span>
            </>
          ) : null}
        </div>
      </div>

      {/* CABLEADO (DC/AC) */}
      <h3 className="section">{TT("wiringTitle", "Cableado (DC/AC) — calibre e Inom")}</h3>

      <div className="tableWrap">
        <table className="table" style={{ tableLayout: "fixed" }}>
          <thead>
            <tr>
              <th style={{ width: "16%" }}>{TT("circuit", "Circuito")}</th>
              <th style={{ width: "18%" }}>{TT("lengthM", "Longitud (m)")}</th>
              <th style={{ width: "22%" }}>{TT("currentA", "I estimada (A)")}</th>
              <th style={{ width: "22%" }}>{TT("recommendedGauge", "Calibre recomendado")}</th>
              <th style={{ width: "22%" }}>{TT("ampacity", "Inom cable (A)")}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><b>DC</b></td>
              <td>{fmt(wiringSizingSafe?.dc?.lengthM, 0, locale)}</td>
              <td>{fmt(wiringSizingSafe?.dc?.currentA, 1, locale)}</td>
              <td style={{ whiteSpace: "normal", wordBreak: "break-word" }}>{wiringSizingSafe?.dc?.gaugeLabel || "—"}</td>
              <td>{fmt(wiringSizingSafe?.dc?.ampacityA, 0, locale)}</td>
            </tr>
            <tr>
              <td><b>AC</b></td>
              <td>{fmt(wiringSizingSafe?.ac?.lengthM, 0, locale)}</td>
              <td>{fmt(wiringSizingSafe?.ac?.currentA, 1, locale)}</td>
              <td style={{ whiteSpace: "normal", wordBreak: "break-word" }}>{wiringSizingSafe?.ac?.gaugeLabel || "—"}</td>
              <td>{fmt(wiringSizingSafe?.ac?.ampacityA, 0, locale)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="note" style={{ marginTop: 10 }}>
        <b>{TT("note", "Nota")}:</b>{" "}
        {isEngineer
          ? TT("engineerNote", "Ingeniero: validar por caída de tensión, temperatura, método de instalación, norma aplicable y configuración real (strings/MPPT/3F).")
          : TT("amateurNote", "Amateur: validar por caída de tensión, temperatura, método de instalación, norma aplicable y configuración real.")}
      </div>

      {/* INGENIERO — STRINGING */}
      {hasStringing ? (
        <>
          <h3 className="section">{TT("stringingTitle", "Stringing (Ingeniero)")}</h3>

          <div className="grid2">
            <div className="note">
              <b>{TT("result", "Resultado")}</b>
              <br />
              Ns: <b>{fmt(stringing.result.Ns, 0, locale)}</b>
              <br />
              {TT("stringsUsed", "Strings usados")}: <b>{fmt(stringing.result.stringsUsed, 0, locale)}</b> / {TT("required", "requeridos")}{" "}
              <b>{fmt(stringing.result.stringsTotal, 0, locale)}</b>
              <br />
              {TT("effectivePanels", "Paneles efectivos")}: <b>{fmt(stringing.result.panelsEffective, 0, locale)}</b>
              <br />
              {TT("effectiveKwp", "kWp efectivo")}: <b>{fmt(stringing.result.installedKWpEffective, 2, locale)}</b>
              {vmpString > 0 ? (
                <>
                  <br />
                  Vmp ≈ <b>{fmt(vmpString, 1, locale)}</b> V
                </>
              ) : null}
              {vocColdString > 0 ? (
                <>
                  <br />
                  Voc (cold) ≈ <b>{fmt(vocColdString, 1, locale)}</b> V
                </>
              ) : null}
            </div>

            <div className="note">
              <b>{TT("byMppt", "Por MPPT")}</b>
              <br />
              {Array.isArray(stringing.result.mpptAlloc) && stringing.result.mpptAlloc.length ? (
                <span className="muted">{stringing.result.mpptAlloc.map((m) => `MPPT ${m.mppt}: ${m.strings} strings`).join(" • ")}</span>
              ) : (
                <span className="muted">—</span>
              )}
            </div>
          </div>
        </>
      ) : null}

      {/* TRAMOS / VDROP */}
      {showSegments ? (
        <>
          <h3 className="section">{TT("segmentsTitle", "Tramos (cables) y caída de tensión")}</h3>

          <div className="tableWrap">
            <table className="table" style={{ minWidth: 1200, tableLayout: "fixed" }}>
              <thead>
                <tr>
                  <th style={{ width: 260 }}>{TT("segment", "Tramo")}</th>
                  <th style={{ width: 90 }}>{TT("type", "Tipo")}</th>
                  <th style={{ width: 90 }}>L (m)</th>
                  <th style={{ width: 90 }}>I (A)</th>
                  <th style={{ width: 180 }}>{TT("cable", "Cable")}</th>
                  <th style={{ width: 90 }}>mm²</th>
                  <th style={{ width: 90 }}>{TT("ampacity", "Inom cable (A)")}</th>
                  <th style={{ width: 90 }}>{TT("vdrop", "Vdrop")}</th>
                  <th style={{ width: 90 }}>{TT("limit", "Límite")}</th>
                  <th style={{ width: 90 }}>V</th>
                  <th style={{ width: 110 }}>{TT("status", "Estado")}</th>
                </tr>
              </thead>
              <tbody>
                {segmentsToRender.map((r) => {
                  const ok = Boolean(r.ok);
                  return (
                    <tr key={r._key}>
                      <td>
                        <div style={{ fontWeight: 800, whiteSpace: "normal", wordBreak: "break-word" }}>{r.segment || "—"}</div>
                        {r.notes ? (
                          <div className="muted" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", marginTop: 4 }}>
                            {r.notes}
                          </div>
                        ) : null}
                      </td>
                      <td className="muted">{r.kind || "—"}</td>
                      <td>{fmt(r.length_m_1w, 0, locale)}</td>
                      <td>{fmt(r.current_A, 1, locale)}</td>
                      <td style={{ whiteSpace: "normal", wordBreak: "break-word" }}>{r.cable || "—"}</td>
                      <td className="muted">{r.mm2 != null ? fmt(r.mm2, 1, locale) : "—"}</td>
                      <td>{fmt(r.ampacity_A, 0, locale)}</td>
                      <td>{fmt(r.vdrop_pct, 2, locale)}%</td>
                      <td className="muted">{r.limit_pct != null ? `${fmt(r.limit_pct, 2, locale)}%` : "—"}</td>
                      <td className="muted">{r.voltage_V != null ? fmt(r.voltage_V, 0, locale) : "—"}</td>
                      <td>
                        <span
                          className="pill"
                          style={{
                            borderColor: ok ? "rgba(102,255,153,0.35)" : "rgba(255,99,132,0.45)",
                            background: ok ? "rgba(102,255,153,0.10)" : "rgba(255,99,132,0.10)",
                            color: ok ? "rgba(102,255,153,0.95)" : "rgba(255,180,190,0.95)",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {ok ? TT("ok", "OK ✅") : TT("high", "ALTO ⚠️")}
                        </span>
                      </td>
                    </tr>
                  );
                })}

                {segTotals ? (
                  <tr>
                    <td colSpan={2} style={{ fontWeight: 900 }}>
                      {TT("totals", "Totales")}
                    </td>
                    <td style={{ fontWeight: 900 }}>{fmt(segTotals.metrosTotales, 0, locale)}</td>
                    <td colSpan={3} className="muted">
                      {TT("subtotalConductors", "Subtotal conductores (si existe)")}
                    </td>
                    <td style={{ fontWeight: 900 }}>{fmt(segTotals.subtotalConductores, 0, locale)}</td>
                    <td colSpan={4} />
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          {segRows.length > 12 ? (
            <div className="row" style={{ marginTop: 10, justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div className="muted">
                {showAllSegments ? `${TT("showing", "Mostrando")} ${segRows.length}.` : `${TT("showing", "Mostrando")} 12 ${TT("of", "de")} ${segRows.length}.`}
              </div>
              <button type="button" className="btn" onClick={() => setShowAllSegments((s) => !s)}>
                {showAllSegments ? TT("seeLess", "Ver menos") : TT("seeAllSegments", "Ver todo tramos")}
              </button>
            </div>
          ) : null}

          <div className="note" style={{ marginTop: 10 }}>
            <b>{TT("quickTip", "Tip rápido")}:</b>{" "}
            {TT("quickTipMsg", "si algún tramo sale ALTO, aumenta calibre o reduce recorrido (o ajusta los límites).")}
          </div>
        </>
      ) : null}

      {/* INGENIERO — PROTECCIONES */}
      {isEngineer && protections ? (
        <>
          <h3 className="section">{TT("protectionsTitle", "Protecciones (base)")}</h3>
          <div className="grid2">
            <div className="note">
              <b>DC</b>
              <br />
              {TT("stringFuse", "Fusible string aprox")}: <b>{fmt(protections?.dc?.stringFuseA, 0, locale)}</b> A
              <br />
              {protections?.dc?.combiner || "—"}
              <br />
              <span className="muted">{protections?.dc?.spd || ""}</span>
            </div>
            <div className="note">
              <b>AC</b>
              <br />
              {TT("breaker", "Breaker aprox")}: <b>{fmt(protections?.ac?.breakerA, 0, locale)}</b> A
              <br />
              <span className="muted">{protections?.ac?.spd || ""}</span>
              <br />
              <span className="muted">{protections?.ac?.rcd || ""}</span>
            </div>
          </div>

          {Array.isArray(protections?.notes) && protections.notes.length ? (
            <div className="note" style={{ marginTop: 10 }}>
              <b>{TT("notes", "Notas")}:</b>
              <div className="muted" style={{ marginTop: 6 }}>
                {protections.notes.slice(0, 6).map((n, i) => (
                  <div key={i}>• {n}</div>
                ))}
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      <h3 className="section">{TT("inventoryTitle", "Inventario técnico (sin precios)")}</h3>

      <div className="tableWrap">
        <table className="table" style={{ tableLayout: "fixed" }}>
          <thead>
            <tr>
              <th style={{ width: "18%" }}>{TT("category", "Categoría")}</th>
              <th>{TT("description", "Descripción")}</th>
              <th style={{ width: "10%" }}>{TT("qty", "Cant.")}</th>
              <th style={{ width: "12%" }}>{TT("unit", "Unidad")}</th>
              <th style={{ width: "28%" }}>{TT("notes", "Notas")}</th>
            </tr>
          </thead>
          <tbody>
            {(bom?.items?.length || 0) === 0 ? (
              <tr>
                <td colSpan={5} className="muted">
                  {TT("noInventory", "Aún no hay inventario. Calcula primero.")}
                </td>
              </tr>
            ) : (
              bom.items.map((it, idx) => (
                <tr key={idx}>
                  <td>{it.category || it.cat || "—"}</td>
                  <td style={{ whiteSpace: "normal", wordBreak: "break-word" }}>{it.item || it.description || "—"}</td>
                  <td>{fmt(it.qty, 0, locale)}</td>
                  <td>{it.unit || "—"}</td>
                  <td className="muted" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    {it.notes || ""}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <h3 className="section">{TT("auditTitle", "Entradas usadas (auditoría)")}</h3>
      <div className="grid2">
        <div className="note">
          <b>{TT("bill", "Factura")}:</b> {fmt(inputs?.billingKWh, 0, locale)} kWh {TT("in", "en")} {fmt(inputs?.billingDays, 0, locale)}{" "}
          {TT("days", "días")}
          <br />
          <b>{TT("tariff", "Tarifa (COP/kWh)")}:</b> {fmt(energy?.tariffCOPkWh, 0, locale)} COP/kWh
          <br />
          <b>{TT("mode", "Modo")}:</b> {inputs?.clientMode === "CI" ? TT("ci", "Comercial/Industrial") : TT("res", "Residencial")}
          <br />
          <b>PSH:</b> {fmt(inputs?.psh, 2, locale)}
        </div>
        <div className="note">
          <b>{TT("area", "Área disponible")}:</b> {fmt(inputs?.areaM2, 1, locale)} m²
          <br />
          <b>{TT("battery", "Batería (kWh)")}:</b> {inputs?.wantBattery ? TT("yes", "Sí") : TT("no", "No")}
          <br />
          <b>{TT("export", "Excedentes (kW)")}:</b> {wantExport ? `${TT("yes", "Sí")} (${fmt(exportKW, 1, locale)} kW)` : TT("no", "No")}
          <br />
          <b>{TT("areaLimited", "Limitado por área")}:</b> {limitedByArea ? TT("yes", "Sí") : TT("no", "No")}
        </div>
      </div>

      <PrintStyles />
    </div>
  );
}

/* ---------------- helpers & small components ---------------- */

function KPI({ label, value, sub }) {
  return (
    <div className="kpiCard">
      <div className="kpiLabel">{label}</div>
      <div className="kpiValue">{value}</div>
      <div className="kpiSub">{sub}</div>
    </div>
  );
}

/* =========================
   A5 — helpers UI
========================= */

function IssueChip({ level }) {
  const style =
    level === "error"
      ? { borderColor: "rgba(255,80,80,0.45)", background: "rgba(255,80,80,0.08)" }
      : level === "warn"
      ? { borderColor: "rgba(255,193,7,0.45)", background: "rgba(255,193,7,0.08)" }
      : { borderColor: "rgba(120, 200, 255, 0.35)", background: "rgba(120, 200, 255, 0.06)" };

  const label = level === "error" ? "ERROR" : level === "warn" ? "WARN" : "INFO";
  const icon = level === "error" ? "⛔" : level === "warn" ? "⚠" : "ℹ";

  return (
    <span className="pill" style={{ ...style, opacity: 1, whiteSpace: "nowrap" }}>
      {icon} {label}
    </span>
  );
}

function pillByStatus(status) {
  if (status === "error") return "pillDanger";
  if (status === "warn") return "pillWarn";
  return "pillOk";
}

// Clasificación por heurística (ajustada: MPPT limitado -> WARN, no ERROR)
function classifyIssues(list) {
  return (list || [])
    .map((raw) => String(raw || "").trim())
    .filter(Boolean)
    .map((text) => {
      const t = text.toLowerCase();

      // Errores duros
      if (
        t.includes("no compatible") ||
        t.includes("nsmin") ||
        t.includes("nsmax") ||
        (t.includes("voc") && t.includes("cold") && (t.includes(">") || t.includes("excede") || t.includes("supera"))) ||
        (t.includes("vdc") && (t.includes("excede") || t.includes("supera") || t.includes("máx") || t.includes("max")) && t.includes("cold")) ||
        (t.includes("inválido") || t.includes("invalido")) ||
        (t.includes("error") && !t.includes("warning"))
      ) {
        return { level: "error", text };
      }

      // Warnings
      if (
        t.includes("warning") ||
        t.includes("revisa") ||
        t.includes("alto") ||
        t.includes("cercano") ||
        t.includes("limitación") ||
        t.includes("limitacion") ||
        t.includes("considera") ||
        t.includes("por debajo") ||
        t.includes("caída de tensión") ||
        t.includes("caida de tension") ||
        t.includes("voc frío") ||
        t.includes("voc frio") ||
        t.includes("vmp") ||
        t.includes("limita") ||
        (t.includes("mppt") && t.includes("limitado"))
      ) {
        return { level: "warn", text };
      }

      return { level: "info", text };
    });
}

function fmt(x, d = 0, locale = "es-CO") {
  const n = Number(String(x ?? "").replace(",", "."));
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(locale, { maximumFractionDigits: d, minimumFractionDigits: d });
}

function money(x, locale = "es-CO") {
  const n = num(x);
  if (!Number.isFinite(n)) return "—";
  return `${n.toLocaleString(locale, { maximumFractionDigits: 0 })} COP`;
}

function pct(x) {
  const n = num(x);
  if (!Number.isFinite(n) || String(x ?? "").trim() === "") return "—";
  return `${(n * 100).toFixed(2)}%`;
}

/**
 * Normaliza tanto AMATEUR como ENGINEER (legacy-friendly).
 * ✅ FINANZAS: se conservan si vienen (no se fuerzan a null por modo).
 */
function normalizeAnyData(data) {
  const d = data || {};
  const inputs0 = d.inputs || {};
  const modeTag = String(d.modeTag || d.mode || "AMATEUR").toUpperCase().includes("ENGINEER") ? "ENGINEER" : "AMATEUR";

  // energía
  const billingKWh = num(inputs0.billingKWh);
  const billingDays = Math.max(1, num(inputs0.billingDays));
  const dailyKWh = d?.energy?.dailyKWh ?? (billingKWh > 0 ? billingKWh / billingDays : 0);
  const tariffCOPkWh = d?.energy?.tariffCOPkWh ?? num(inputs0.tariffCOPkWh);

  // ✅ preferir exportTargetKW si viene
  const exportTargetKW = isFiniteNum(d?.energy?.exportTargetKW) ? num(d.energy.exportTargetKW) : num(inputs0.exportKW);

  const dcAcRatio =
    d?.sizing?.inverter?.dcAcRatio ??
    d?.energy?.dcAcRatio ??
    (num(d?.pv?.requiredPower) > 0 && num(d?.sizing?.inverter?.acPowerKW) > 0 ? num(d.pv.requiredPower) / num(d.sizing.inverter.acPowerKW) : null);

  // wiring estimates: prefer wiringEstimates
  const wiringFromMotor = d?.wiringEstimates || null;

  // ✅ distancias: si el motor las entrega, úsalas como verdad
  const panelToInverterM =
    wiringFromMotor && isFiniteNum(wiringFromMotor.panelToInverterM) ? num(wiringFromMotor.panelToInverterM) : num(inputs0.panelToInverterM);

  const inverterToACBoardM =
    wiringFromMotor && isFiniteNum(wiringFromMotor.inverterToAcBoardM) ? num(wiringFromMotor.inverterToAcBoardM) : num(inputs0.inverterToACBoardM);

  const inverterDistanceM = num(inputs0.inverterDistanceM);

  const wiring = wiringFromMotor
    ? {
        dcCableM: num(wiringFromMotor.dcCableM),
        acCableM: num(wiringFromMotor.acCableM),
        conduitM: num(wiringFromMotor.conduitM),
        notes: Array.isArray(wiringFromMotor.notes) ? wiringFromMotor.notes : [],
      }
    : {
        dcCableM: panelToInverterM > 0 ? Math.round(panelToInverterM * 2) : 0,
        acCableM: inverterToACBoardM > 0 ? Math.round(inverterToACBoardM) : 0,
        conduitM: Math.round((panelToInverterM || 0) + (inverterDistanceM || 0) + (inverterToACBoardM || 0)),
        notes: panelToInverterM || inverterToACBoardM ? ["Estimación básica (sin motor)."] : ["Sin distancias."],
      };

  // BOM
  const bomItems =
    (d?.bom?.items && Array.isArray(d.bom.items) ? d.bom.items : null) ||
    (d?.bom?.technical && Array.isArray(d.bom.technical) ? d.bom.technical : null) ||
    (d?.bomTech?.items && Array.isArray(d.bomTech.items) ? d.bomTech.items : null) ||
    [];

  const wiringSizingFromData = normalizeWiringSizing(d?.wiringSizing) || null;

  const pvSafe = d?.pv || { numberOfPanels: 0, requiredPower: 0, annualEnergy: 0 };

  // ✅ batería: normaliza Amateur/Engineer/legacy a un shape único
  const batterySafe = normalizeBattery(d?.battery);

  const diagSafe0 = d?.diagnostics || { ok: true, issues: [] };
  const diagSafe = { ok: Boolean(diagSafe0?.ok ?? true), issues: Array.isArray(diagSafe0?.issues) ? diagSafe0.issues : [] };

  const seg0 = d?.segments || {};
  const segSafe = { ...seg0, rows: pickSegmentRows(seg0) };

  // ✅ inputs: mantener coherencia con distancias corregidas
  const inputs = { ...inputs0, panelToInverterM, inverterToACBoardM, inverterDistanceM };

  // ✅ FINANZAS: soporta variantes
  const costingRaw = d?.costing || d?.economics?.costing || d?.financial?.costing || d?.finance?.costing || null;
  const financeRaw = d?.finance || d?.economics?.finance || d?.financial?.finance || null;

  // ✅ STRINGING: soporta legacy {best}
  const stringingNorm = normalizeStringing(d?.stringing);

  return {
    _raw: d,
    modeTag,
    project: d.project || { name: "—", company: "—" },
    inputs,
    pv: pvSafe,
    battery: batterySafe,
    bom: { items: Array.isArray(bomItems) ? bomItems : [] },
    diagnostics: diagSafe,
    energy: { dailyKWh, tariffCOPkWh, exportTargetKW, dcAcRatio },
    wiring,
    wiringSizing: wiringSizingFromData,
    stringing: stringingNorm,
    protections: d.protections || null,
    segments: segSafe,

    // ✅ FINANZAS (si vienen, se muestran)
    costing: costingRaw,
    finance: financeRaw,
  };
}

/* ✅ Normaliza batería a un shape único: capacityKWh/systemVoltage/autonomyHours/requiredAh */
function normalizeBattery(b) {
  const bb = b || {};
  const mode0 = String(bb.mode || (bb.enabled ? "autonomy" : "none")).toLowerCase();

  const capacityKWh =
    isFiniteNum(bb.requiredBatteryKWh) ? num(bb.requiredBatteryKWh) :
    isFiniteNum(bb.capacityKWh) ? num(bb.capacityKWh) : 0;

  const systemVoltage =
    isFiniteNum(bb.systemVoltage) ? num(bb.systemVoltage) :
    isFiniteNum(bb.systemVoltageV) ? num(bb.systemVoltageV) : 48;

  const autonomyHours =
    isFiniteNum(bb.autonomyHours) ? num(bb.autonomyHours) :
    isFiniteNum(bb.autonomyDays) ? num(bb.autonomyDays) * 24 : 0;

  const requiredAh = isFiniteNum(bb.requiredAh) ? num(bb.requiredAh) : 0;

  const enabled = bb.enabled === true || mode0 !== "none";

  return {
    ...bb,
    enabled,
    mode: enabled ? (mode0 === "none" ? "autonomy" : mode0) : "none",
    capacityKWh,
    systemVoltage,
    autonomyHours,
    requiredAh,
  };
}

/* ✅ Normaliza stringing: soporta legacy {best} */
function normalizeStringing(s) {
  if (!s || typeof s !== "object") return null;
  if (s.result) return s;
  if (s.best) return { ...s, result: s.best };
  return s;
}

/* ✅ Normaliza wiringSizing venga como venga */
function normalizeWiringSizing(ws) {
  if (!ws || typeof ws !== "object") return null;

  const dc0 = ws.dc || ws.DC || null;
  const ac0 = ws.ac || ws.AC || null;

  const normSide = (s) => {
    if (!s || typeof s !== "object") return null;
    const lengthM =
      isFiniteNum(s.lengthM) ? num(s.lengthM) :
      isFiniteNum(s.length_m) ? num(s.length_m) :
      isFiniteNum(s.length_m_1w) ? num(s.length_m_1w) :
      isFiniteNum(s.L) ? num(s.L) : 0;

    const currentA =
      isFiniteNum(s.currentA) ? num(s.currentA) :
      isFiniteNum(s.current_A) ? num(s.current_A) :
      isFiniteNum(s.I) ? num(s.I) :
      isFiniteNum(s.I_A) ? num(s.I_A) : 0;

    const ampacityA =
      isFiniteNum(s.ampacityA) ? num(s.ampacityA) :
      isFiniteNum(s.ampacity_A) ? num(s.ampacity_A) :
      isFiniteNum(s.Inom) ? num(s.Inom) :
      isFiniteNum(s.Inom_A) ? num(s.Inom_A) : 0;

    const voltageV =
      isFiniteNum(s.voltageV) ? num(s.voltageV) :
      isFiniteNum(s.voltage_V) ? num(s.voltage_V) :
      isFiniteNum(s.V) ? num(s.V) : 0;

    const gaugeLabel = s.gaugeLabel || s.cable || s.label || "—";

    return { lengthM, currentA, ampacityA, voltageV, gaugeLabel };
  };

  const dc = normSide(dc0);
  const ac = normSide(ac0);
  if (!dc && !ac) return null;

  return {
    dc: dc || { lengthM: 0, currentA: 0, ampacityA: 0, voltageV: 0, gaugeLabel: "—" },
    ac: ac || { lengthM: 0, currentA: 0, ampacityA: 0, voltageV: 0, gaugeLabel: "—" },
  };
}

function pickSegmentRows(segments) {
  const s = segments || {};
  return (
    (Array.isArray(s.rows) && s.rows) ||
    (Array.isArray(s.items) && s.items) ||
    (Array.isArray(s.segments) && s.segments) ||
    (Array.isArray(s.data) && s.data) ||
    []
  );
}

function normalizeSegmentRow(r0, idx = 0) {
  const r = r0 || {};

  const segment =
    r.segment ||
    r.tramo ||
    r.name ||
    r.label ||
    r.title ||
    (typeof r.kind === "string" ? r.kind : null) ||
    `Tramo ${idx + 1}`;

  const kind =
    r.kind ||
    r.type ||
    r.circuit ||
    r.side ||
    (String(segment).toLowerCase().includes("ac") ? "AC" : String(segment).toLowerCase().includes("dc") ? "DC" : "");

  const length_m_1w =
    num(r.length_m_1w) ||
    num(r.length_1w_m) ||
    num(r.length_m) ||
    num(r.lengthM) ||
    num(r.L_m_1w) ||
    num(r.Lm) ||
    num(r.L) ||
    0;

  const current_A = num(r.current_A) || num(r.currentA) || num(r.I_A) || num(r.I) || num(r.amps) || num(r.current) || 0;

  const cable = r.cable || r.gauge || r.gaugeLabel || r.conductor || r.cableLabel || (r.mm2 ? `${r.mm2} mm²` : null) || "—";

  const ampacity_A = num(r.ampacity_A) || num(r.ampacityA) || num(r.Inom_A) || num(r.Inom) || num(r.ampacity) || 0;

  const vdrop_pct = num(r.vdrop_pct) || num(r.vdropPct) || num(r.vdrop_percent) || num(r.dropPct) || num(r.voltageDropPct) || 0;

  const limit_pct =
    isFiniteNum(r.limit_pct) ? num(r.limit_pct) :
    isFiniteNum(r.maxDropPct) ? num(r.maxDropPct) :
    isFiniteNum(r.limitPct) ? num(r.limitPct) :
    isFiniteNum(r.allowedPct) ? num(r.allowedPct) : null;

  const voltage_V =
    isFiniteNum(r.voltage_V) ? num(r.voltage_V) :
    isFiniteNum(r.voltageV) ? num(r.voltageV) :
    isFiniteNum(r.V) ? num(r.V) : null;

  const ok =
    typeof r.ok === "boolean"
      ? r.ok
      : limit_pct != null
      ? vdrop_pct <= limit_pct + 1e-9
      : ampacity_A > 0
      ? ampacity_A >= current_A * 1.05
      : true;

  const notes =
    r.notes ||
    r.note ||
    r.observations ||
    r.comment ||
    (Array.isArray(r.warnings) ? r.warnings.filter(Boolean).join("\n") : "") ||
    "";

  return {
    _key: `${idx}-${String(segment)}`,
    segment,
    kind,
    length_m_1w,
    current_A,
    cable,
    mm2: isFiniteNum(r.mm2) ? num(r.mm2) : null,
    ampacity_A,
    vdrop_pct,
    limit_pct,
    voltage_V,
    ok,
    notes: String(notes || "").trim() || "",
  };
}

function normalizeSegmentTotals(segments) {
  const s = segments || {};
  const t = s.totals || s.total || null;
  if (!t) return null;

  const subtotalConductores = num(t.subtotalConductores ?? t.subtotal ?? t.subtotal_cables ?? 0);
  const metrosTotales = num(t.metrosTotales ?? t.totalMeters ?? t.m_total ?? t.m ?? 0);

  if (subtotalConductores === 0 && metrosTotales === 0) return null;
  return { subtotalConductores, metrosTotales };
}

function inferSegmentVoltages({ segRows, inputs, hasStringing, vmpString }) {
  const clientMode = inputs?.clientMode === "CI" ? "CI" : "RES";
  const is3P = inputs?.clientMode === "CI";
  const acV = num(inputs?.acVoltageV) || (is3P ? 380 : 220);
  const vdcNom = clientMode === "CI" ? 800 : 500;

  return (segRows || []).map((r) => {
    if (r.voltage_V != null && Number.isFinite(r.voltage_V) && r.voltage_V > 0) return r;

    const name = String(r.segment || "").toLowerCase();
    const kind = String(r.kind || "").toUpperCase();

    if (kind === "AC" || name.includes("ac")) return { ...r, voltage_V: acV };

    if (kind === "DC" || name.includes("dc")) {
      if (hasStringing && vmpString > 0 && (name.includes("string") || name.includes("panel") || name.includes("módulo") || name.includes("modulo"))) {
        return { ...r, voltage_V: vmpString };
      }
      return { ...r, voltage_V: vdcNom };
    }

    return r;
  });
}

function parseMm2FromLabel(label) {
  const s = String(label || "");
  const m = s.match(/(\d+(\.\d+)?)\s*mm²/i) || s.match(/(\d+(\.\d+)?)\s*mm2/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function makeFallbackWiringSizing({ safe }) {
  try {
    const raw = computeWiringSizingFromContext({
      d: safe._raw || safe,
      inputs: safe.inputs || {},
      wiring: safe.wiring || {},
    });
    return normalizeWiringSizing(raw) || raw;
  } catch {
    return {
      dc: { lengthM: 0, voltageV: 0, currentA: 0, gaugeLabel: "—", ampacityA: 0 },
      ac: { lengthM: 0, voltageV: 0, currentA: 0, gaugeLabel: "—", ampacityA: 0 },
    };
  }
}

function computeWiringSizingFromContext({ d, inputs, wiring }) {
  const clientMode = inputs.clientMode === "CI" ? "CI" : "RES";
  const isES = String(inputs.country || "").toLowerCase().includes("espa");
  const acV = clientMode === "CI" ? (isES ? 400 : 380) : isES ? 230 : 220;

  const pf = 0.98;

  const acKw =
    num(d?.sizing?.inverter?.acPowerKW) > 0
      ? num(d.sizing.inverter.acPowerKW)
      : num(d?.pv?.requiredPower) > 0
      ? num(d.pv.requiredPower) / 1.1
      : 0;

  const acI =
    clientMode === "CI"
      ? acV > 0
        ? (acKw * 1000) / (Math.sqrt(3) * acV * pf)
        : 0
      : acV > 0
      ? (acKw * 1000) / (acV * pf)
      : 0;

  const vdcNom = clientMode === "CI" ? 800 : 500;
  const pdcKw = num(d?.pv?.requiredPower);
  const dcI = vdcNom > 0 ? (pdcKw * 1000) / (vdcNom * 0.98) : 0;

  const dcPick = pickCableByCurrent(dcI, "DC");
  const acPick = pickCableByCurrent(acI, "AC");

  return {
    dc: {
      lengthM: num(wiring?.dcCableM),
      voltageV: vdcNom,
      currentA: round1(dcI),
      gaugeLabel: dcPick.label,
      ampacityA: dcPick.ampacityA,
    },
    ac: {
      lengthM: num(wiring?.acCableM),
      voltageV: acV,
      currentA: round1(acI),
      gaugeLabel: acPick.label,
      ampacityA: acPick.ampacityA,
    },
  };
}

function pickCableByCurrent(currentA, kind = "AC") {
  const I = Math.max(0, num(currentA));
  const table = [
    { label: "2.5 mm² (≈14 AWG)", ampacityA: 20 },
    { label: "4 mm² (≈12 AWG)", ampacityA: 30 },
    { label: "6 mm² (≈10 AWG)", ampacityA: 40 },
    { label: "10 mm² (≈8 AWG)", ampacityA: 55 },
    { label: "16 mm² (≈6 AWG)", ampacityA: 75 },
    { label: "25 mm² (≈4 AWG)", ampacityA: 100 },
    { label: "35 mm² (≈2 AWG)", ampacityA: 125 },
    { label: "50 mm² (≈1/0 AWG)", ampacityA: 150 },
    { label: "70 mm² (≈2/0 AWG)", ampacityA: 200 },
    { label: "95 mm² (≈3/0 AWG)", ampacityA: 260 },
  ];
  const margin = kind === "DC" ? 1.25 : 1.15;
  const required = I * margin;
  return table.find((x) => x.ampacityA >= required) || table[table.length - 1];
}

function round1(x) {
  return Math.round(num(x) * 10) / 10;
}

function num(x) {
  const s = String(x ?? "").trim().replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function isFiniteNum(x) {
  const n = Number(String(x ?? "").replace(",", "."));
  return Number.isFinite(n);
}

/* ===== i18n key mapper ===== */

function mapKey(key) {
  const k = String(key || "").trim();
  const direct = LEGACY_TO_I18N[k];
  if (direct) return direct;

  // si ya viene con dot-notation, lo dejamos
  if (k.includes(".")) return k;

  // fallback: intenta como common.* primero
  return `common.${k}`;
}

// Keys legacy usadas en este Results.jsx -> rutas reales del translations.js
const LEGACY_TO_I18N = {
  // Common
  downloadJson: "common.downloadJson",
  printReport: "common.print",
  showAll: "common.showAll",
  seeAll: "common.showAll",
  showLess: "common.showLess",
  seeLess: "common.showLess",
  yes: "common.yes",
  no: "common.no",
  notAvailable: "common.notAvailable",

  // Results (secciones)
  results: "results.title",
  engineer: "results.engineer",
  amateur: "results.amateur",
  designCompatibility: "results.compatibility",
  techSummary: "results.technicalSummary",
  financeTitle: "results.economy",
  distancesTitle: "results.distances",
  wiringTitle: "results.wiring",
  stringingTitle: "results.stringing",
  segmentsTitle: "results.segments",
  protectionsTitle: "results.protections",
  inventoryTitle: "results.inventory",
  auditTitle: "results.audit",
  compatOk: "results.compatible",
  compatWarn: "results.review",
  compatNo: "results.notCompatible",
  noIssues: "results.issuesNone",

  // KPI
  pvPower: "kpi.pvPower",
  numPanels: "kpi.panels",
  annualEnergy: "kpi.annualEnergy",
  dailyConsumption: "kpi.dailyConsumption",
  tariff: "kpi.tariff",
  battery: "kpi.battery",
  export: "kpi.export",
  dcac: "kpi.dcac",
};

/**
 * ✅ SOLO AFECTA EL REPORTE IMPRESO (PDF).
 * - Evita recortes en tablas anchas
 * - Permite wrap en celdas
 */
function PrintStyles() {
  return (
    <style>{`
      @media print {
        .appHeader, .stackTop { display: none !important; }
        .btn, .btnPrimary { display: none !important; }
        .stackBottom { padding: 0 !important; }

        html, body {
          background: #ffffff !important;
          color: #111111 !important;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }

        :root { color-scheme: light !important; }

        .card {
          background: #ffffff !important;
          box-shadow: none !important;
          border: none !important;
        }

        h2 { margin-top: 0 !important; color: #111111 !important; }
        h3, .section { color: #111111 !important; }

        .badge {
          border: 1px solid #111111 !important;
          color: #111111 !important;
          background: transparent !important;
        }

        .muted, .note, .kpiSub, .kpiLabel { color: #2b2b2b !important; }
        .kpiValue, .kpiCard b, b { color: #111111 !important; }

        .tableWrap { overflow: visible !important; }

        table.table {
          font-size: 11.5px !important;
          border-collapse: collapse !important;
          width: 100% !important;
          table-layout: fixed !important;
        }

        table.table th {
          background: #f0f0f0 !important;
          color: #111111 !important;
          border: 1px solid #9a9a9a !important;
          padding: 6px !important;
          white-space: normal !important;
          word-break: break-word !important;
        }

        table.table td {
          background: #ffffff !important;
          color: #111111 !important;
          border: 1px solid #9a9a9a !important;
          padding: 6px !important;
          white-space: normal !important;
          word-break: break-word !important;
        }

        table.table td.muted, table.table .muted { color: #2b2b2b !important; }

        .kpiGrid { grid-template-columns: repeat(3, 1fr) !important; }
      }
    `}</style>
  );
}