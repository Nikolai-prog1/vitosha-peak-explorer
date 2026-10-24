import React, { useEffect, useState } from "react";
import htm from "htm";
import { X } from "@vitosha/icons";
import { PlanningDialog } from "./planning-ui.js?v=vitosha-accessibility-20261005-3";
import { createTextFile } from "./planning.js?v=vitosha-camera-20261005-2";
import { translate, formatNumber } from "./i18n.js?v=explorer-v2-3";

const html = htm.bind(React.createElement);

export function FileExportDialog({ file, language, onClose }) {
  const [asset, setAsset] = useState(null), [message, setMessage] = useState("");
  const t = (key, values) => translate(language, key, values);
  useEffect(() => {
    setAsset(null); setMessage("");
    try {
      const next = createTextFile(file.content, file.filename, file.type);
      setAsset(next);
      return () => next.dispose();
    } catch { setMessage("fileDownloadUnavailable"); return undefined; }
  }, [file]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(file.content); setMessage("fileContentsCopied"); }
    catch { setMessage("fileManualCopy"); }
  };

  return html`<${PlanningDialog} titleId="file-export-title" onClose=${onClose}>
    <header className="dialog-header"><h2 id="file-export-title">${t("fileExportTitle")}</h2><button type="button" className="icon-button" onClick=${onClose} aria-label=${t("close")}><${X} size=${18} aria-hidden="true"/></button></header>
    <p className="export-filename">${file.filename}</p>
    <p>${t("fileExportHint")}</p>
    <p className="local-disclosure">${t(file.kind === "gpx" ? "planningWarning" : "backupNote")}</p>
    <div className="plan-actions">${asset ? html`<a className="route-show-button active file-download-link" href=${asset.url} download=${asset.filename}>${t("downloadFile")} · ${formatNumber(asset.size / 1024, language, 1)} KB</a>` : null}<button type="button" className="route-show-button" onClick=${onClose}>${t("close")}</button></div>
    <details className="file-export-fallback"><summary>${t("fileCopyFallback")}</summary><p>${t("fileCopyHint", { filename: file.filename })}</p><label className="file-content-field"><span>${t("fileContents")}</span><textarea rows="6" value=${file.content} readOnly spellCheck=${false} onFocus=${event => event.target.select()}/></label><button type="button" className="route-show-button" onClick=${copy}>${t("copyFileContents")}</button></details>
    ${message ? html`<p role="status">${t(message)}</p>` : null}
  </${PlanningDialog}>`;
}
