import { useMemo } from "react";

/**
 * Resultados para Modo Amateur
 * - Compatible con tus estructuras:
 *   - data.bom.items  (legacy adapter desde AmateurForm)
 *   - data.bomTech.items (algunos motores antiguos)
 *   - data.bom.technical (si viene del motor nuevo)
 * - Muestra: resumen FV + energía + batería + inventario técnico
 * - No depende de "segments/stringing/protections" del modo ingeniero
 */
export default function AmateurResults({ data }) {
  const safe = useMemo(() => normalizeAmateurData(data), [data]);

  const { project, inputs, pv, battery, energy, bom, diagnostics } = safe;

  return (
    <div className="card">
      <div className="badge">RESULTADOS AMATEUR</div>

      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ marginBottom: 6 }}>{project?.name || "Proyecto"}</h2>
          <div className="muted">
            {project?.company ? project.company : "—"} • {inputs?.city || "—"} • PSH{" "}
            {fmt(inputs?.psh)}
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {diagnostics?.ok ? (
            <span className="pill">OK</span>
          ) : (
            <span className="pill" style={{ borderColor: "#ff6b6b" }}>
              Revisar
            </span>
          )}
          <span className="pill">{inputs?.clientMode === "CI" ? "C&I" : "Residencial"}</span>
        </div>
      </div>

      {/* ALERTAS */}
      {!diagnostics?.ok || (diagnostics?.issues?.length || 0) > 0 ? (
        <div className="note" style={{ marginTop: 10 }}>
          ⚠ {diagnostics?.issues?.slice(0, 10).join(" | ")}
        </div>
      ) : null}

      {/* RESUMEN */}
      <h3 className="section">Resumen del sistema</h3>
      <div className="grid3">
        <Kpi label="Paneles" value={pv?.numberOfPanels} suffix="und" />
        <Kpi label="Potencia FV" value={pv?.requiredPower} suffix="kWp" />
        <Kpi label="Energía anual" value={pv?.annualEnergy} suffix="kWh/año" />
      </div>

      <div className="grid3" style={{ marginTop: 10 }}>
        <Kpi label="Consumo diario" value={energy?.dailyKWh} suffix="kWh/día" />
        <Kpi label="Tarifa" value={energy?.tariffCOPkWh} suffix="COP/kWh" />
        <Kpi label="Excedentes (meta)" value={energy?.exportTargetKW} suffix="kW" />
      </div>

      <h3 className="section">Baterías</h3>
      <div className="grid3">
        <Kpi label="Estado" value={battery?.mode === "autonomy" ? "Con batería" : "Sin batería"} />
        <Kpi label="Capacidad" value={battery?.requiredBatteryKWh} suffix="kWh" />
        <Kpi label="Voltaje" value={battery?.systemVoltage} suffix="V" />
      </div>

      {/* INVENTARIO */}
      <h3 className="section">Inventario técnico (sin precios)</h3>
      {bom?.items?.length ? (
        <InventoryTable items={bom.items} />
      ) : (
        <div className="note">
          No hay inventario para mostrar. (Revisa que el motor esté entregando <b>bom.items</b> o{" "}
          <b>bomTech.items</b>)
        </div>
      )}

      {/* BOTONES (placeholders: luego los conectamos a PDF/print/unifilar) */}
      <div className="row" style={{ gap: 10, marginTop: 14, justifyContent: "flex-end", flexWrap: "wrap" }}>
        <button type="button" className="btn" onClick={() => window.print()}>
          Imprimir reporte
        </button>
        <button type="button" className="btn" onClick={() => alert("Unifilar: lo conectamos en el siguiente paso")}>
          Imprimir unifilar
        </button>
      </div>
    </div>
  );
}

/* ===================== SUBCOMPONENTES ===================== */

function Kpi({ label, value, suffix }) {
  return (
    <div className="note" style={{ padding: 12 }}>
      <div className="muted" style={{ fontSize: 12 }}>
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>
        {value === null || value === undefined || value === "" ? "—" : String(value)}
        {suffix ? <span className="muted" style={{ marginLeft: 6, fontSize: 13 }}>{suffix}</span> : null}
      </div>
    </div>
  );
}

function InventoryTable({ items }) {
  return (
    <div style={{ marginTop: 10, overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <Th>Categoría</Th>
            <Th>Descripción</Th>
            <Th style={{ width: 90 }}>Cant.</Th>
            <Th style={{ width: 90 }}>Und</Th>
            <Th>Notas</Th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, idx) => (
            <tr key={idx}>
              <Td>{it.category || it.cat || "—"}</Td>
              <Td>{it.description || it.item || "—"}</Td>
              <Td style={{ textAlign: "right" }}>{fmt(it.qty)}</Td>
              <Td>{it.unit || "—"}</Td>
              <Td className="muted">{it.notes || ""}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children, style }) {
  return (
    <th
      style={{
        textAlign: "left",
        padding: "10px 8px",
        borderBottom: "1px solid rgba(255,255,255,0.15)",
        ...style,
      }}
    >
      {children}
    </th>
  );
}

function Td({ children, style, className }) {
  return (
    <td
      className={className}
      style={{
        padding: "10px 8px",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        verticalAlign: "top",
        ...style,
      }}
    >
      {children}
    </td>
  );
}

/* ===================== NORMALIZACIÓN ===================== */

function normalizeAmateurData(data) {
  const d = data || {};

  // Inventario puede venir por varias rutas según tu motor/adapter:
  const items =
    (d?.bom?.items && Array.isArray(d.bom.items) ? d.bom.items : null) ||
    (d?.bomTech?.items && Array.isArray(d.bomTech.items) ? d.bomTech.items : null) ||
    (d?.bom?.technical && Array.isArray(d.bom.technical) ? d.bom.technical : null) ||
    [];

  // energía
  const energy = {
    dailyKWh: d?.energy?.dailyKWh ?? d?.inputs?.dailyKWh ?? null,
    tariffCOPkWh: d?.energy?.tariffCOPkWh ?? d?.inputs?.tariffCOPkWh ?? null,
    exportTargetKW: d?.energy?.exportTargetKW ?? d?.inputs?.exportKW ?? null,
  };

  // pv
  const pv = {
    numberOfPanels: d?.pv?.numberOfPanels ?? d?.sizing?.pv?.numberOfPanels ?? 0,
    requiredPower: d?.pv?.requiredPower ?? d?.sizing?.pv?.installedPowerKWp ?? 0,
    annualEnergy: d?.pv?.annualEnergy ?? d?.sizing?.pv?.annualEnergyKWh ?? 0,
  };

  // battery legacy
  const battery = {
    mode: d?.battery?.mode ?? (d?.battery?.enabled ? "autonomy" : "none"),
    requiredBatteryKWh: d?.battery?.requiredBatteryKWh ?? d?.battery?.capacityKWh ?? 0,
    systemVoltage: d?.battery?.systemVoltage ?? d?.battery?.systemVoltageV ?? 48,
  };

  const diagnostics = d?.diagnostics || { ok: true, issues: [] };

  return {
    project: d?.project || { name: "—", company: "—" },
    inputs: d?.inputs || {},
    pv,
    battery,
    energy,
    bom: { items },
    diagnostics: {
      ok: diagnostics.ok !== false,
      issues: Array.isArray(diagnostics.issues) ? diagnostics.issues : [],
    },
  };
}

function fmt(x) {
  const n = Number(String(x ?? "").replace(",", "."));
  if (!Number.isFinite(n)) return "—";
  return Math.round(n * 100) / 100;
}
