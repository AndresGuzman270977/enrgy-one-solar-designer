// src/utils/models.js

export function makeEmptyAppData() {
  return {
    // ✅ Mantén un tag claro (tu app lo usa como “modo”)
    mode: "AMATEUR", // AMATEUR | ENGINEER

    project: { name: "—", company: "—" },

    // ✅ inputs “esperables” para no romper UI si alguien intenta leerlos
    inputs: {
      clientMode: "RES",
      country: "Colombia",
      city: "Cali",
      psh: 4.8,

      billingKWh: 0,
      billingDays: 30,
      billingEnergyCOP: "",
      tariffCOPkWh: 0,
      daytimeRatio: 0.85,
      zeroExport: false,

      areaM2: 0,
      wantBattery: false,
      wantExport: false,
      exportKW: 0,

      // distancias (si luego las muestras)
      panelToInverterM: 0,
      inverterToACBoardM: 0,
    },

    // ✅ outputs comunes (legacy)
    pv: { numberOfPanels: 0, requiredPower: 0, annualEnergy: 0 },
    battery: { mode: "none", requiredBatteryKWh: 0, requiredAh: 0, systemVoltage: 48 },

    // ✅ (Amateur) energía adicional opcional
    energy: {
      dailyKWh: 0,
      tariffCOPkWh: 0,
      annualEnergyKWh: 0,
      selfConsumptionRatio: 0,
      exportTargetKW: 0,
      zeroExport: false,
    },

    // ✅ ingeniería (solo ENGINEER, pero mantenemos estructura para no romper UI)
    stringing: {
      best: { ns: 0, strings: 0, stringsPerMppt: 0, vmpStringOp: 0, vocColdString: 0, mpptInputA: 0 },
    },
    protections: { fuseStringA: 0, dcMainA: 0, acBreakerA: 0, idcTotalA: 0, iacDesignA: 0 },

    // ✅ evita crashes si algún componente asume segments.totals
    segments: { rows: [], totals: { subtotalConductores: 0, metrosTotales: 0 } },

    /**
     * ✅ BOM unificado:
     * - AmateurResults lee bom.items
     * - Algunos Results/legacy leen bom.totals
     * - Tu motor a veces entrega bom: { items, totals: {...} }
     */
    bom: {
      items: [],
      totals: { subtotal: 0, tax: 0, margin: 0, total: 0 },
    },

    // ✅ preset para “Enviar a Ingeniero”
    engineerPreset: null,

    // ✅ diagnostics compatibles (Results suele hacer join/slice)
    diagnostics: { ok: true, issues: [] },
  };
}
