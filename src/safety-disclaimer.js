import React, { useState } from "react";
import htm from "htm";
import { PlanningDialog } from "./planning-ui.js?v=vitosha-accessibility-20261005-3";

const html = htm.bind(React.createElement);
// Shown before the map starts loading. Bulgarian first; the toggle only changes
// this notice, not the stored interface language.
const COPY = {
  bg: {
    eyebrow: "Безопасност в планината",
    title: "Преди да тръгнеш",
    switchLabel: "Switch to English",
    points: [
      "Ходи в планината подготвен: с подходящо облекло и обувки, топъл и непромокаем слой, вода, храна, челник и зареден телефон.",
      "Времето на Витоша се променя бързо. Провери прогнозата и условията преди тръгване и се връщай навреме, преди да се стъмни.",
      "Можеш да срещнеш диви животни (мечки, вълци, глигани, змии). Пази дистанция, не ги приближавай и не ги храни. Заради мечките вдигай шум, докато вървиш, и по възможност не ходи сам: животните чуват шума и сами те избягват.",
      "Картата, маршрутите и прогнозата са само за планиране. Не са средство за навигация или безопасност и може да са неточни или остарели.",
      "Кажи на някого къде отиваш. При инцидент звънни на 112 или на Планинската спасителна служба (ПСС) на 1470.",
    ],
    risk: "Посещението на планината е изцяло на твой риск и отговорност.",
    accept: "Разбирам, продължи към картата",
  },
  en: {
    eyebrow: "Mountain safety",
    title: "Before you set out",
    switchLabel: "Превключи на български",
    points: [
      "Go to the mountain prepared: proper clothing and footwear, a warm waterproof layer, water, food, a headlamp and a charged phone.",
      "Weather on Vitosha changes quickly. Check the forecast and conditions before you leave and turn back in time, before dark.",
      "You may encounter wild animals (bears, wolves, wild boar, snakes). Keep your distance, do not approach or feed them. Because of bears, make noise as you walk and preferably don't go alone: animals hear you coming and keep away.",
      "The map, routes and forecast are for planning only. They are not a navigation or safety tool and may be inaccurate or out of date.",
      "Tell someone where you are going. In an emergency call 112 or the Mountain Rescue Service (PSS) on 1470.",
    ],
    risk: "You visit the mountain entirely at your own risk and responsibility.",
    accept: "I understand, continue to the map",
  },
};

export function SafetyDisclaimer({ onAccept, returnFocus }) {
  const [language, setLanguage] = useState("bg");
  const copy = COPY[language];
  return html`<${PlanningDialog} titleId="safety-title" onClose=${onAccept} returnFocus=${returnFocus}><div className="safety-disclaimer" lang=${language}>
    <header className="dialog-header"><div><small>${copy.eyebrow}</small><h2 id="safety-title">${copy.title}</h2></div><button type="button" className="icon-button language-button" title=${copy.switchLabel} aria-label=${copy.switchLabel} onClick=${() => setLanguage(language === "bg" ? "en" : "bg")}>${language === "bg" ? "EN" : "БГ"}</button></header>
    <ul>${copy.points.map(point => html`<li key=${point}>${point}</li>`)}</ul>
    <p className="safety-risk">${copy.risk}</p>
    <button type="button" className="route-show-button active safety-accept" data-initial-focus onClick=${onAccept}>${copy.accept}</button>
  </div></${PlanningDialog}>`;
}
