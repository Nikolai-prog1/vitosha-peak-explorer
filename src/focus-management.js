const TABBABLE = 'button, input, select, textarea, a[href], summary, [tabindex], [contenteditable="true"]';

function canFocus(element) {
  if (!element?.isConnected || element.disabled || element.closest('[inert], [hidden]') || !element.getClientRects().length) return false;
  if (element.tabIndex < 0 && !element.hasAttribute?.("tabindex")) return false;
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  return !style || (style.visibility !== "hidden" && style.visibility !== "collapse");
}

export function dialogTabStops(dialog) {
  return [...dialog.querySelectorAll(TABBABLE)].filter(element => element.tabIndex >= 0 && canFocus(element));
}

// Native showModal makes the background inert for pointer, keyboard and screen
// reader users. Keep explicit edge handling for dynamic disclosures/file views.
export function openModalDialog(dialog, { onClose, initialFocus, returnFocus } = {}) {
  const document = dialog.ownerDocument, previous = document.activeElement;
  dialog.showModal();
  const preferred = initialFocus?.() || dialog.querySelector("[data-initial-focus]");
  (preferred && dialog.contains(preferred) && canFocus(preferred) ? preferred : dialogTabStops(dialog)[0] || dialog).focus();
  const onCancel = event => { event.preventDefault(); event.stopPropagation(); onClose?.(); };
  const onKey = event => {
    if (event.key === "Escape") { onCancel(event); return; }
    if (event.key !== "Tab") return;
    const items = dialogTabStops(dialog), first = items[0], last = items.at(-1), active = document.activeElement;
    if (!first) { event.preventDefault(); dialog.focus(); }
    else if (event.shiftKey && (active === first || active === dialog || !dialog.contains(active))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (active === last || !dialog.contains(active))) { event.preventDefault(); first.focus(); }
  };
  dialog.addEventListener("keydown", onKey);
  dialog.addEventListener("cancel", onCancel);
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    dialog.removeEventListener("keydown", onKey);
    dialog.removeEventListener("cancel", onCancel);
    if (dialog.open) dialog.close();
    const target = canFocus(previous) ? previous : returnFocus?.();
    if (canFocus(target)) target.focus();
  };
}

export function isBackdropClick(event) {
  if (event.target !== event.currentTarget || event.detail === 0) return false;
  const rect = event.currentTarget.getBoundingClientRect();
  return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
}
