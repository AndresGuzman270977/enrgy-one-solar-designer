// src/i18n/translations.js
export const translations = {
  es: {
    common: {
      print: "Imprimir reporte",
      downloadJson: "Descargar JSON",
      showAll: "Ver todo",
      showLess: "Ver menos",
      yes: "Sí",
      no: "No",
      notAvailable: "No disponible",

      // extras comunes usados por Results.jsx
      note: "Nota",
      notes: "Notas",
      showing: "Mostrando",
      of: "de",
      and: "y",
      in: "en",
      days: "días",
      years: "años",
      year: "año",

      // tablas / columnas
      level: "Nivel",
      detail: "Detalle",
      errors: "errores",
      warnings: "advertencias",
      info: "info",
      status: "Estado",
      type: "Tipo",
      circuit: "Circuito",
      lengthM: "Longitud (m)",
      currentA: "I estimada (A)",
      recommendedGauge: "Calibre recomendado",
      ampacity: "Inom cable (A)",
      category: "Categoría",
      concept: "Concepto",
      qty: "Cant.",
      unit: "Unidad",
      unitCost: "Costo unit",
      total: "Total",
      description: "Descripción",
      segment: "Tramo",
      cable: "Cable",
      vdrop: "Vdrop",
      limit: "Límite",

      // botones específicos
      seeAllCapex: "Ver todo CAPEX",
      seeAllCashflow: "Ver todo el flujo",
      seeAllSegments: "Ver todo tramos",

      // estados
      ok: "OK ✅",
      high: "ALTO ⚠️",
    },

    results: {
      title: "RESULTADOS",
      amateur: "AMATEUR",
      engineer: "INGENIERO",

      compatibility: "Compatibilidad del diseño",
      technicalSummary: "Resumen técnico",
      economy: "Economía y finanzas",
      financesNotAvailableTitle: "Finanzas no disponibles",

      distances: "Distancias y metrado rápido",
      wiring: "Cableado (DC/AC) — calibre e Inom",
      stringing: "Stringing (Ingeniero)",
      segments: "Tramos (cables) y caída de tensión",
      protections: "Protecciones (base)",
      inventory: "Inventario técnico (sin precios)",
      audit: "Entradas usadas (auditoría)",

      compatible: "✅ COMPATIBLE",
      review: "⚠ REVISAR",
      notCompatible: "⛔ NO COMPATIBLE",
      issuesNone: "✅ Sin issues reportados.",
      modeNoteEngineer: "Basado en warnings del motor + checks de ingeniería.",
      modeNoteAmateur: "En modo Amateur puede haber menos validaciones; ideal validar en Ingeniero.",

      // Descripciones A5 (usadas en Results.jsx)
      compatTitle: "Compatibilidad general del diseño (A5)",
      compatEngineerDesc: "Basado en warnings del motor + checks de ingeniería.",
      compatAmateurDesc: "En modo Amateur puede haber menos validaciones; ideal validar en Ingeniero.",

      // Bloque área
      areaLimitTitle: "Limitación por área",
      areaLimitMsg1: "Para cumplir la meta se requerían aprox.",
      areaLimitMsg2: "pero por el área disponible",
      areaLimitMsg3: "caben aprox.",
      areaLimitTip:
        "Solución típica: aumenta área, usa panel mayor potencia/menor área efectiva, o reduce meta de excedentes.",

      // Finanzas
      financeUnavailable: "Finanzas no disponibles",
      financeUnavailableDesc1: "Asegúrate de estar corriendo el motor que entrega",
      financeEngineerOnlyTitle: "Finanzas solo en Modo Ingeniero",
      financeEngineerOnlyDesc:
        "El modo Amateur es únicamente técnico (inventario + reporte). Cambia a Ingeniero para ver CAPEX, VPN, TIR, ROI y flujo de caja.",

      capexDetail: "Costo del proyecto (CAPEX) — detalle",
      cashflowTitle: "Flujo de caja (ahorros + excedentes − OPEX − reemplazos)",
      noCapexLines: "Sin líneas de CAPEX.",
      noCashflow: "Sin flujo de caja.",

      equipmentSubtotalRow: "Subtotal equipos (inventario)",
      installRow: "Instalación",
      engineeringRow: "Ingeniería",
      permitsRow: "Permisos",
      contingencyRow: "Contingencia",
      taxesRow: "Impuestos",
      marginRow: "Margen",
      capexTotalRow: "CAPEX total",

      // Distancias
      inputDistances: "Distancias ingresadas (ida)",
      panelsToInv: "Paneles → Inversor",
      invToAcBoard: "Inversor → Tablero AC",
      invToDcPoint: "Inversor → Punto DC (opc.)",
      estimates: "Estimaciones",
      dcCableTotal: "Cable DC total (ida/vuelta aprox.)",
      acCable: "Cable AC (ida aprox.)",
      conduit: "Canalización (recorridos aprox.)",

      // Nota cableado
      engineerNote:
        "Ingeniero: validar por caída de tensión, temperatura, método de instalación, norma aplicable y configuración real (strings/MPPT/3F).",
      amateurNote:
        "Amateur: validar por caída de tensión, temperatura, método de instalación, norma aplicable y configuración real.",

      // Stringing
      result: "Resultado",
      byMppt: "Por MPPT",
      stringsUsed: "Strings usados",
      required: "requeridos",
      effectivePanels: "Paneles efectivos",
      effectiveKwp: "kWp efectivo",

      // Segments extras
      totals: "Totales",
      subtotalConductors: "Subtotal conductores (si existe)",
      quickTip: "Tip rápido",
      quickTipMsg: "si algún tramo sale ALTO, aumenta calibre o reduce recorrido (o ajusta los límites).",

      // Protecciones extras
      stringFuse: "Fusible string aprox",
      breaker: "Breaker aprox",

      // Inventario
      noInventory: "Aún no hay inventario. Calcula primero.",

      // Auditoría
      bill: "Factura",
      mode: "Modo",
      ci: "Comercial/Industrial",
      res: "Residencial",
      area: "Área disponible",
      areaLimited: "Limitado por área",

      // Batería extras
      noBattery: "Sin batería",
      autonomy: "Autonomía",
      batteryEstimated: "Banco de baterías (estimado)",
      backup: "Respaldo",
      reserve: "Reserva",
      criticalLoad: "Carga crítica",

      // Excedentes
      exportSubYes: "Meta de potencia",
      exportSubNo: "No desea exportar",

      // Subtext consumo
      consumptionSubEngineer: "Tomado de preset o inferido de factura",
      consumptionSubAmateur: "kWh periodo / días facturados",

      // DC/AC sub
      dcacSub: "FV(kWp) / Inversor(kWac) (si disponible)",
    },

    kpi: {
      pvPower: "Potencia FV (kWp)",
      panels: "# Paneles",
      annualEnergy: "Energía anual (kWh)",
      dailyConsumption: "Consumo diario (kWh/día)",
      tariff: "Tarifa (COP/kWh)",
      battery: "Batería (kWh)",
      export: "Excedentes (kW)",
      dcac: "DC/AC (ratio)",

      // subtexts KPI (usados en Results.jsx)
      pvPowerSub: "Potencia FV estimada/instalada",
      numPanelsSub: "Cantidad total de módulos",
      annualEnergySub: "Estimación con pérdidas",
      tariffSub: "Factura o tarifa ingresada",
    },

    finance: {
      capexTotal: "CAPEX total",
      capexTotalSub: "Costo total del proyecto (con extras)",
      equipmentSubtotal: "Subtotal equipos",
      equipmentSubtotalSub: "Valor estimado inventario (equipos)",
      install: "Instalación",
      installSub: "Mano de obra / montaje (pct)",
      engineering: "Ingeniería",
      engineeringSub: "Diseño / ingeniería (pct)",
      permits: "Permisos",
      permitsSub: "Trámites / legalización (si aplica)",
      contingency: "Contingencia",
      contingencySub: "Reserva por imprevistos",
      taxes: "Impuestos",
      taxesSub: "IVA u otros (si aplica)",
      margin: "Margen",
      marginSub: "Margen (si aplica)",

      npv: "VPN (NPV)",
      discountRate: "Tasa descuento",
      irr: "TIR (IRR)",
      irrSub: "Rendimiento anual estimado",
      payback: "Payback",
      paybackSub: "Retorno simple",
      paybackDisc: "Payback desc.",
      paybackDiscSub: "Retorno con descuento",
      roi: "ROI",
      roiSub: "(beneficio neto - CAPEX) / CAPEX",
      lcoe: "LCOE",
      lcoeSub: "Costo nivelado energía",

      financialAssumptions: "Supuestos financieros",
      analysisYears: "Años análisis",
      degradation: "Degradación",
      tariffEsc: "Escalación tarifa",
      omPct: "O&M (% CAPEX/año)",
      omEsc: "O&M escalación",
      selfCons: "Autoconsumo",
      exportPrice: "Precio excedentes",
      invReplace: "Reemplazo inversor",
    },
  },

  en: {
    common: {
      print: "Print report",
      downloadJson: "Download JSON",
      showAll: "Show all",
      showLess: "Show less",
      yes: "Yes",
      no: "No",
      notAvailable: "Not available",

      note: "Note",
      notes: "Notes",
      showing: "Showing",
      of: "of",
      and: "and",
      in: "in",
      days: "days",
      years: "years",
      year: "year",

      level: "Level",
      detail: "Detail",
      errors: "errors",
      warnings: "warnings",
      info: "info",
      status: "Status",
      type: "Type",
      circuit: "Circuit",
      lengthM: "Length (m)",
      currentA: "Estimated I (A)",
      recommendedGauge: "Recommended gauge",
      ampacity: "Cable ampacity (A)",
      category: "Category",
      concept: "Concept",
      qty: "Qty",
      unit: "Unit",
      unitCost: "Unit cost",
      total: "Total",
      description: "Description",
      segment: "Segment",
      cable: "Cable",
      vdrop: "Vdrop",
      limit: "Limit",

      seeAllCapex: "Show all CAPEX",
      seeAllCashflow: "Show full cashflow",
      seeAllSegments: "Show all segments",

      ok: "OK ✅",
      high: "HIGH ⚠️",
    },

    results: {
      title: "RESULTS",
      amateur: "AMATEUR",
      engineer: "ENGINEER",

      compatibility: "Design compatibility",
      technicalSummary: "Technical summary",
      economy: "Economics & finance",
      financesNotAvailableTitle: "Finance not available",

      distances: "Distances & quick takeoff",
      wiring: "Wiring (DC/AC) — gauge & ampacity",
      stringing: "Stringing (Engineer)",
      segments: "Cable segments & voltage drop",
      protections: "Protections (base)",
      inventory: "Technical inventory (no prices)",
      audit: "Inputs used (audit)",

      compatible: "✅ COMPATIBLE",
      review: "⚠ REVIEW",
      notCompatible: "⛔ NOT COMPATIBLE",
      issuesNone: "✅ No issues reported.",
      modeNoteEngineer: "Based on engine warnings + engineering checks.",
      modeNoteAmateur: "Amateur mode may run fewer checks; validate in Engineer mode.",

      compatTitle: "Overall design compatibility (A5)",
      compatEngineerDesc: "Based on engine warnings + engineering checks.",
      compatAmateurDesc: "Amateur mode may run fewer checks; validate in Engineer mode.",

      areaLimitTitle: "Area constraint",
      areaLimitMsg1: "To meet the target you needed about",
      areaLimitMsg2: "but with the available area",
      areaLimitMsg3: "you can fit about",
      areaLimitTip:
        "Typical solution: increase area, use higher-power/lower-area panels, or reduce export target.",

      financeUnavailable: "Finance not available",
      financeUnavailableDesc1: "Make sure you're running the engine that provides",
      financeEngineerOnlyTitle: "Finance is Engineer-only",
      financeEngineerOnlyDesc:
        "Amateur mode is technical only (inventory + report). Switch to Engineer to see CAPEX, NPV, IRR, ROI and cashflow.",

      capexDetail: "Project cost (CAPEX) — detail",
      cashflowTitle: "Cashflow (savings + exports − OPEX − replacements)",
      noCapexLines: "No CAPEX lines.",
      noCashflow: "No cashflow.",

      equipmentSubtotalRow: "Equipment subtotal (inventory)",
      installRow: "Installation",
      engineeringRow: "Engineering",
      permitsRow: "Permits",
      contingencyRow: "Contingency",
      taxesRow: "Taxes",
      marginRow: "Margin",
      capexTotalRow: "Total CAPEX",

      inputDistances: "Input distances (one-way)",
      panelsToInv: "Panels → Inverter",
      invToAcBoard: "Inverter → AC board",
      invToDcPoint: "Inverter → DC point (opt.)",
      estimates: "Estimates",
      dcCableTotal: "Total DC cable (approx. roundtrip)",
      acCable: "AC cable (approx. one-way)",
      conduit: "Conduit (approx. routes)",

      engineerNote:
        "Engineer: validate by voltage drop, temperature, installation method, applicable standard and real configuration (strings/MPPT/3P).",
      amateurNote:
        "Amateur: validate by voltage drop, temperature, installation method, applicable standard and real configuration.",

      result: "Result",
      byMppt: "By MPPT",
      stringsUsed: "Strings used",
      required: "required",
      effectivePanels: "Effective panels",
      effectiveKwp: "Effective kWp",

      totals: "Totals",
      subtotalConductors: "Conductors subtotal (if available)",
      quickTip: "Quick tip",
      quickTipMsg:
        "if any segment is HIGH, increase gauge or shorten the route (or adjust limits).",

      stringFuse: "Approx. string fuse",
      breaker: "Approx. breaker",

      noInventory: "No inventory yet. Run the calculation first.",

      bill: "Bill",
      mode: "Mode",
      ci: "Commercial/Industrial",
      res: "Residential",
      area: "Available area",
      areaLimited: "Area-limited",

      noBattery: "No battery",
      autonomy: "Autonomy",
      batteryEstimated: "Battery bank (estimated)",
      backup: "Backup",
      reserve: "Reserve",
      criticalLoad: "Critical load",

      exportSubYes: "Power target",
      exportSubNo: "No export",

      consumptionSubEngineer: "Preset or inferred from bill",
      consumptionSubAmateur: "Period kWh / billed days",

      dcacSub: "PV(kWp) / Inverter(kWac) (if available)",
    },

    kpi: {
      pvPower: "PV power (kWp)",
      panels: "# Panels",
      annualEnergy: "Annual energy (kWh)",
      dailyConsumption: "Daily consumption (kWh/day)",
      tariff: "Tariff (COP/kWh)",
      battery: "Battery (kWh)",
      export: "Export target (kW)",
      dcac: "DC/AC (ratio)",

      pvPowerSub: "Estimated/installed PV power",
      numPanelsSub: "Total modules count",
      annualEnergySub: "Estimate incl. losses",
      tariffSub: "Bill or entered tariff",
    },

    finance: {
      capexTotal: "Total CAPEX",
      capexTotalSub: "Total project cost (incl. extras)",
      equipmentSubtotal: "Equipment subtotal",
      equipmentSubtotalSub: "Estimated equipment inventory value",
      install: "Installation",
      installSub: "Labor / assembly (pct)",
      engineering: "Engineering",
      engineeringSub: "Design / engineering (pct)",
      permits: "Permits",
      permitsSub: "Permits / legalization (if applicable)",
      contingency: "Contingency",
      contingencySub: "Unexpected reserve",
      taxes: "Taxes",
      taxesSub: "VAT or others (if applicable)",
      margin: "Margin",
      marginSub: "Margin (if applicable)",

      npv: "NPV",
      discountRate: "Discount rate",
      irr: "IRR",
      irrSub: "Estimated annual return",
      payback: "Payback",
      paybackSub: "Simple payback",
      paybackDisc: "Discounted payback",
      paybackDiscSub: "Payback with discount",
      roi: "ROI",
      roiSub: "(net benefit - CAPEX) / CAPEX",
      lcoe: "LCOE",
      lcoeSub: "Levelized cost of energy",

      financialAssumptions: "Financial assumptions",
      analysisYears: "Analysis years",
      degradation: "Degradation",
      tariffEsc: "Tariff escalation",
      omPct: "O&M (% CAPEX/year)",
      omEsc: "O&M escalation",
      selfCons: "Self-consumption",
      exportPrice: "Export price",
      invReplace: "Inverter replacement",
    },
  },
};
