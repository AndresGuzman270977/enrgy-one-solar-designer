// src/utils/exporters.js

export function downloadJson(filename, data) {
  const safeName = String(filename || "reporte").replace(/[^\w\-]+/g, "_");
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = safeName.endsWith(".json") ? safeName : `${safeName}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}
