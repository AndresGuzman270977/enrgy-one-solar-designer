// src/components/LangToggle.jsx
import { useI18n } from "../i18n/I18nProvider";

export default function LangToggle() {
  const { lang, setLang } = useI18n();

  return (
    <div className="row" style={{ gap: 8 }}>
      <button
        type="button"
        className={lang === "es" ? "btnPrimary" : "btn"}
        onClick={() => setLang("es")}
        title="Español"
      >
        ES
      </button>
      <button
        type="button"
        className={lang === "en" ? "btnPrimary" : "btn"}
        onClick={() => setLang("en")}
        title="English"
      >
        EN
      </button>
    </div>
  );
}
