// src/i18n/LanguageSwitch.jsx
import { useI18n } from "./I18nProvider";

export default function LanguageSwitch() {
  const { lang, setLang } = useI18n();

  return (
    <div className="row" style={{ gap: 8, alignItems: "center" }}>
      <button
        type="button"
        className={`btn ${lang === "es" ? "btnPrimary" : ""}`}
        onClick={() => setLang("es")}
        title="Español"
      >
        ES
      </button>
      <button
        type="button"
        className={`btn ${lang === "en" ? "btnPrimary" : ""}`}
        onClick={() => setLang("en")}
        title="English"
      >
        EN
      </button>
    </div>
  );
}
