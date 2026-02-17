// src/components/EquipmentPicker.jsx
import { useMemo, useState, useEffect } from "react";
import {
  getPanels,
  getInvertersByMarket,
  getInvertersFiltered,
  findPanel,
  findInverter,
  defaultPanelId,
  defaultInverterId,
  recommendedAcVoltage,
} from "../data/equipment";

export default function EquipmentPicker({
  clientMode = "RES",
  country = "Colombia",
  acVoltageV,
  value, // { panelId, inverterId } opcional (desde preset)
  onApply,
}) {
  const panels = useMemo(() => getPanels(), []);

  const acV = Number(acVoltageV) || recommendedAcVoltage({ clientMode, country });

  const filteredInverters = useMemo(
    () => getInvertersFiltered({ clientMode, country, acVoltageV: acV }),
    [clientMode, country, acV]
  );

  const fallbackInverters = useMemo(() => getInvertersByMarket(clientMode), [clientMode]);

  const invertersToShow = filteredInverters.length ? filteredInverters : fallbackInverters;

  const [panelId, setPanelId] = useState(value?.panelId || defaultPanelId());
  const [invId, setInvId] = useState(value?.inverterId || defaultInverterId(clientMode));

  // si cambia clientMode/país/voltaje y el invId ya no está disponible, auto-ajusta
  useEffect(() => {
    const exists = invertersToShow.some((x) => x.id === invId);
    if (!exists) setInvId(defaultInverterId(clientMode));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientMode, country, acV, invertersToShow.length]);

  const selectedPanel = findPanel(panelId);
  const selectedInv = findInverter(invId);

  const apply = () => {
    const p = selectedPanel;
    const inv = selectedInv;

    if (!p && !inv) return;

    const patch = { form: {} };

    // guardar ids seleccionados para persistencia
    patch.form.selectedPanelId = panelId;
    patch.form.selectedInverterId = invId;

    if (p) {
      patch.form.panelPower = p.powerW;
      patch.form.vmp = p.vmp;
      patch.form.voc = p.voc;
      patch.form.imp = p.imp;
      patch.form.isc = p.isc;
      patch.form.vocTempCoeffPctPerC = p.vocTempCoeffPctPerC;
      patch.form.panelAreaM2 = p.areaM2;
    }

    if (inv) {
      patch.form.dcMaxV = inv.dcMaxV;
      patch.form.mpptVmin = inv.mpptVmin;
      patch.form.mpptVmax = inv.mpptVmax;
      patch.form.mpptMaxInputA = inv.mpptMaxInputA;
      patch.form.numMppt = inv.numMppt;
      patch.form.inverterEff = inv.inverterEff;

      patch.form.acKw = inv.acPowerKW;
      patch.form.acPhase = inv.acPhase;

      // si el usuario no ha definido acVoltageV o está en otro, sugerimos el “recomendado”
      patch.form.acVoltageV = acV;
    }

    onApply?.(patch, { panel: p, inverter: inv });
  };

  const showFilteredNote = filteredInverters.length === 0;

  return (
    <div className="note" style={{ marginTop: 10 }}>
      <b>Biblioteca de equipos</b>
      <div className="muted" style={{ marginTop: 6 }}>
        Selecciona panel + inversor para autocompletar parámetros eléctricos (puedes editar después).
      </div>

      {showFilteredNote ? (
        <div className="muted" style={{ marginTop: 8 }}>
          ⚠ No hay inversores que coincidan con el filtro (país <b>{country}</b>, AC <b>{acV}V</b>). Mostrando catálogo general.
        </div>
      ) : null}

      <div className="grid3" style={{ marginTop: 10 }}>
        <div>
          <label>Panel</label>
          <select className="select" value={panelId} onChange={(e) => setPanelId(e.target.value)}>
            {panels.map((p) => (
              <option key={p.id} value={p.id}>
                {p.brand} — {p.model} ({p.powerW}W)
              </option>
            ))}
          </select>
          <small>
            Vmp {fmt(selectedPanel?.vmp)} V • Voc {fmt(selectedPanel?.voc)} V • Isc {fmt(selectedPanel?.isc)} A • Área{" "}
            {fmt(selectedPanel?.areaM2)} m²
          </small>
        </div>

        <div>
          <label>Inversor ({clientMode === "CI" ? "3F" : "1F"})</label>
          <select className="select" value={invId} onChange={(e) => setInvId(e.target.value)}>
            {invertersToShow.map((inv) => (
              <option key={inv.id} value={inv.id}>
                {inv.brand} — {inv.model} ({inv.acPowerKW}kW)
              </option>
            ))}
          </select>
          <small>
            VdcMax {fmt(selectedInv?.dcMaxV, 0)} V • MPPT {fmt(selectedInv?.mpptVmin, 0)}–{fmt(selectedInv?.mpptVmax, 0)} V •
            Imax {fmt(selectedInv?.mpptMaxInputA)} A • MPPT {fmt(selectedInv?.numMppt, 0)}
          </small>
        </div>

        <div style={{ display: "flex", alignItems: "flex-end" }}>
          <button type="button" className="btnPrimary" onClick={apply} style={{ width: "100%" }}>
            Aplicar al preset
          </button>
        </div>
      </div>
    </div>
  );
}

function fmt(x, d = 1) {
  const n = Number(x);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("es-CO", { maximumFractionDigits: d, minimumFractionDigits: d });
}
