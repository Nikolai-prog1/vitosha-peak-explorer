import test from "node:test";
import assert from "node:assert/strict";
import React, { createElement, useEffect, useMemo, useState, version } from "../public/vendor/modules/react.js";
import { createRoot, hydrateRoot } from "../public/vendor/modules/react-dom-client.js";
import { Mountain } from "../public/vendor/modules/icons.js";

test("native browser modules expose the public APIs used by the source preview", () => {
  assert.equal(version, "19.3.0");
  assert.equal(React.createElement, createElement);
  for (const exportedApi of [createElement, useEffect, useMemo, useState, createRoot, hydrateRoot]) {
    assert.equal(typeof exportedApi, "function");
  }
  const icon = createElement(Mountain, { size: 20 });
  assert.equal(React.isValidElement(icon), true);
  assert.equal(icon.props.size, 20);
});
