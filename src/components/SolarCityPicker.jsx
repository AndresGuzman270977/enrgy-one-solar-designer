// src/components/SolarCityPicker.jsx
import { useMemo } from "react";
import { SOLAR_CITIES } from "../data/solarCities";

/**
 * value: { country, city, psh, source? }
 * onChange: (nextValue) => void
 *
 * - country: "Colombia" | "España"
 * - city: string (o "Otra (manual)")
 * - psh: number
 * - source: "city-db" | "manual"
 */
export default function SolarCityPicker({ value, onChange }) {
  const country = value?.country || "Colombia";
  const city = value?.city || "Cali";
  const psh = Number(value?.psh ?? 4.8);

  const countries = useMemo(() => Object.keys(SOLAR_CITIES), []);
  const cityList = useMemo(() => SOLAR_CITIES[country] || [], [country]);

  const cityOptions = useMemo(() => {
    const names = cityList.map((x) => x.city);
    // agrega opción manual
    return [...names, "Otra (manual)"];
  }, [cityList]);

  const handleCountry = (e) => {
    const nextCountry = e.target.value;

    const first = (SOLAR_CITIES[nextCountry] || [])[0];
    const nextCity = first?.city || "Otra (manual)";
    const nextPsh = Number(first?.psh ?? psh);

    onChange?.({
      ...value,
      country: nextCountry,
      city: nextCity,
      psh: nextPsh,
      source: first ? "city-db" : "manual",
    });
  };

  const handleCity = (e) => {
    const nextCity = e.target.value;

    if (nextCity === "Otra (manual)") {
      onChange?.({
        ...value,
        city: nextCity,
        source: "manual",
      });
      return;
    }

    const found = cityList.find((x) => x.city === nextCity);
    onChange?.({
      ...value,
      city: nextCity,
      psh: Number(found?.psh ?? psh),
      source: "city-db",
    });
  };

  const handlePshManual = (e) => {
    // Guardamos un número válido sin romper el foco
    const raw = String(e.target.value ?? "").replace(",", ".");
    const n = Number(raw);
    onChange?.({
      ...value,
      psh: Number.isFinite(n) ? n : psh,
      source: "manual",
    });
  };

  return (
    <div className="grid3">
      <div>
        <label>País</label>
        <select value={country} onChange={handleCountry}>
          {countries.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <small>Selecciona el país para cargar ciudades y PSH.</small>
      </div>

      <div>
        <label>Ciudad</label>
        <select value={cityOptions.includes(city) ? city : "Otra (manual)"} onChange={handleCity}>
          {cityOptions.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <small>La ciudad define el PSH base (editable si lo deseas).</small>
      </div>

      <div>
        <label>PSH (editable)</label>
        <input
          type="text"
          inputMode="decimal"
          value={String(psh)}
          onChange={handlePshManual}
          placeholder="Ej: 4.8"
        />
        <small>{value?.source === "city-db" ? "PSH desde ciudad" : "PSH manual"}</small>
      </div>
    </div>
  );
}
