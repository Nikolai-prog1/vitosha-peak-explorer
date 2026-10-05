import test from "node:test";
import assert from "node:assert/strict";
import { dialogTabStops, openModalDialog, isBackdropClick } from "../src/focus-management.js";

function fixture() {
  const document = { activeElement: null, defaultView: { getComputedStyle: element => ({ visibility: element.visibility || "visible" }) } };
  const element = (name, options = {}) => ({
    name, ownerDocument: document, isConnected: true, disabled: false, tabIndex: 0, focusCount: 0,
    closest() { return this.inert || this.hidden ? {} : null; },
    getClientRects() { return this.visible === false ? [] : [{}]; },
    focus() { document.activeElement = this; this.focusCount++; },
    ...options,
  });
  const trigger = element("trigger"); trigger.focus();
  const listeners = new Map(), first = element("close"), last = element("summary");
  let items = [first, last], preferred;
  const dialog = element("dialog", {
    tabIndex: -1, open: false, showCount: 0, closeCount: 0,
    showModal() { this.open = true; this.showCount++; },
    close() { this.open = false; this.closeCount++; },
    querySelectorAll() { return items; },
    querySelector() { return preferred; },
    contains(item) { return item === this || items.includes(item); },
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name, callback) { if (listeners.get(name) === callback) listeners.delete(name); },
  });
  const event = (key, shiftKey = false) => ({ key, shiftKey, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } });
  return { document, element, dialog, first, last, trigger, listeners, event, setItems: value => { items = value; }, setPreferred: value => { preferred = value; } };
}

test("dialog tab stops include native summaries but exclude disabled, hidden, inert, negative and CSS-hidden controls", () => {
  const f = fixture();
  f.setItems([f.first, f.element("disabled", { disabled: true }), f.element("hidden", { hidden: true }), f.element("inert", { inert: true }), f.element("negative", { tabIndex: -1 }), f.element("invisible", { visible: false }), f.element("css-hidden", { visibility: "hidden" }), f.element("collapsed", { visibility: "collapse" }), f.element("detached", { isConnected: false }), f.last]);
  assert.deepEqual(dialogTabStops(f.dialog), [f.first, f.last]);
});

test("modal lifecycle uses showModal, keeps dynamic Tab edges inside and restores its connected trigger once", () => {
  const f = fixture(), dispose = openModalDialog(f.dialog);
  assert.equal(f.dialog.showCount, 1); assert.equal(f.document.activeElement, f.first);
  const backward = f.event("Tab", true); f.listeners.get("keydown")(backward);
  assert.equal(backward.prevented, true); assert.equal(f.document.activeElement, f.last);
  const forward = f.event("Tab"); f.listeners.get("keydown")(forward);
  assert.equal(forward.prevented, true); assert.equal(f.document.activeElement, f.first);
  const textarea = f.element("expanded-copy-fallback"); f.setItems([f.first, f.last, textarea]); textarea.focus();
  f.listeners.get("keydown")(f.event("Tab")); assert.equal(f.document.activeElement, f.first);
  dispose(); dispose();
  assert.equal(f.dialog.closeCount, 1); assert.equal(f.document.activeElement, f.trigger); assert.equal(f.trigger.focusCount, 2); assert.equal(f.listeners.size, 0);
});

test("explicit and data initial focus are validated inside the dialog", () => {
  const f = fixture(); f.setPreferred(f.last);
  const dispose = openModalDialog(f.dialog, { initialFocus: () => f.trigger });
  assert.equal(f.document.activeElement, f.first); dispose();
  const disposeAgain = openModalDialog(f.dialog);
  assert.equal(f.document.activeElement, f.last); disposeAgain();
});

test("empty or temporarily escaped modal focus is contained without intercepting ordinary typing", () => {
  const f = fixture(); f.setItems([]);
  const dispose = openModalDialog(f.dialog); assert.equal(f.document.activeElement, f.dialog);
  const tab = f.event("Tab"); f.listeners.get("keydown")(tab); assert.equal(tab.prevented, true);
  f.setItems([f.first, f.last]); f.trigger.focus();
  f.listeners.get("keydown")(f.event("Tab", true)); assert.equal(f.document.activeElement, f.last);
  f.trigger.focus(); f.listeners.get("keydown")(f.event("Tab")); assert.equal(f.document.activeElement, f.first);
  const typing = f.event("a"); f.listeners.get("keydown")(typing); assert.equal(typing.prevented, false);
  dispose();
});

test("Escape and native cancel prevent default closing and call the current owner callback", () => {
  const f = fixture(); let closeCount = 0;
  const dispose = openModalDialog(f.dialog, { onClose: () => { closeCount++; } });
  const escape = f.event("Escape"); f.listeners.get("keydown")(escape);
  assert.equal(closeCount, 1); assert.equal(escape.prevented, true); assert.equal(escape.stopped, true);
  const cancel = f.event(); f.listeners.get("cancel")(cancel);
  assert.equal(closeCount, 2); assert.equal(cancel.prevented, true); assert.equal(cancel.stopped, true);
  dispose();
});

test("restoration uses a visible fallback when the original trigger is removed or hidden", () => {
  for (const invalid of [{ isConnected: false }, { hidden: true }, { visible: false }, { disabled: true }]) {
    const f = fixture(), fallback = f.element("details-toggle");
    const dispose = openModalDialog(f.dialog, { returnFocus: () => fallback }); Object.assign(f.trigger, invalid);
    dispose(); assert.equal(f.document.activeElement, fallback);
  }
  const f = fixture(), dispose = openModalDialog(f.dialog, { returnFocus: () => f.element("hidden-fallback", { inert: true }) });
  f.trigger.isConnected = false; dispose(); assert.equal(f.document.activeElement, f.first);
});

test("an unfocusable body is not a restoration target; explicitly focusable static content is", () => {
  const f = fixture(), fallback = f.element("note-button");
  f.document.activeElement = f.element("body", { tabIndex: -1 });
  const dispose = openModalDialog(f.dialog, { returnFocus: () => fallback });
  dispose(); assert.equal(f.document.activeElement, fallback);
  const heading = f.element("static-heading", { tabIndex: -1, hasAttribute: name => name === "tabindex" });
  f.document.activeElement = heading;
  const disposeAgain = openModalDialog(f.dialog, { returnFocus: () => fallback });
  disposeAgain(); assert.equal(f.document.activeElement, heading);
});

test("only a pointer click outside the native dialog rectangle is a backdrop close", () => {
  const dialog = { getBoundingClientRect: () => ({ left: 10, top: 10, right: 380, bottom: 834 }) };
  const pointer = { target: dialog, currentTarget: dialog, detail: 1, clientX: 4, clientY: 400 };
  assert.equal(isBackdropClick(pointer), true);
  assert.equal(isBackdropClick({ ...pointer, clientX: 200, clientY: 300 }), false);
  assert.equal(isBackdropClick({ ...pointer, detail: 0 }), false);
  assert.equal(isBackdropClick({ ...pointer, target: {} }), false);
});
