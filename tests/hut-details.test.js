import test from "node:test";
import assert from "node:assert/strict";
import { formatCheckedDate, formatEmailHref, formatPhoneHref, formatWebsiteHref, latestCheckedDate, visibleDetailRows } from "../src/hut-details.js";

const detail = (value, source = "osm", checked = null) => ({ value, source, checked });

test("hut facts keep their source, skip empty data, and localize explicit yes/no values", () => {
  const details = {
    capacity_beds: detail(40, "manual", "2026-11-18"),
    drinking_water: detail(false),
    opening_hours: detail("Mo-Fr 08:00-18:00"),
    food: detail(null),
    shower: detail(" "),
    payment: detail(["cash=yes", "Visa=no"]),
    website: detail("https://example.test/"),
  };
  const rows = visibleDetailRows(details, "bg");
  assert.deepEqual(rows.map(row => row.field), ["capacity_beds", "opening_hours", "drinking_water", "payment"]);
  assert.equal(rows[0].source, "manual");
  assert.equal(rows[0].checked, "2026-11-18");
  assert.equal(rows[1].display, "Mo-Fr 08:00-18:00");
  assert.equal(rows[2].display, "Не");
  assert.equal(visibleDetailRows(details, "en")[2].display, "No");
});

test("contact targets allow only safe web, telephone and email links", () => {
  assert.equal(formatPhoneHref("+359 (2) 123-45-67; 0899 123 456"), "tel:+35921234567");
  assert.equal(formatPhoneHref("javascript:1234567"), null);
  assert.equal(formatPhoneHref("+359"), null);
  assert.equal(formatWebsiteHref("www.example.test/hut"), "https://www.example.test/hut");
  assert.equal(formatWebsiteHref("javascript:alert(1)"), null);
  assert.equal(formatWebsiteHref("https://name:pass@example.test"), null);
  assert.equal(formatEmailHref("hello+hut@example.test"), "mailto:hello%2Bhut@example.test");
  assert.equal(formatEmailHref("me@example.test?bcc=other@example.test"), null);
});

test("the popup date reflects the latest checked manual value", () => {
  const details = { website: detail("https://example.test", "manual", "2026-11-19"),
    food: detail("yes", "manual", "2026-10-01"), phone: detail("123456", "osm", "2026-11-20") };
  assert.equal(latestCheckedDate(details), "2026-11-19");
  assert.equal(latestCheckedDate({ phone: details.phone }), null);
});

test("check dates format per language and fall back to the raw text when invalid", () => {
  assert.equal(formatCheckedDate("2026-11-19", "en"), "19 Nov 2026");
  assert.match(formatCheckedDate("2026-11-19", "bg"), /19\.11\.2026|19 ноем/);
  assert.equal(formatCheckedDate("2026-13-45", "bg"), "2026-13-45");
  assert.equal(formatCheckedDate("unknown", "en"), "unknown");
});

test("missing or empty hut details render no rows, links or dates", () => {
  for (const details of [undefined, null, {}]) {
    assert.deepEqual(visibleDetailRows(details, "bg"), []);
    assert.equal(latestCheckedDate(details), null);
  }
  for (const value of [undefined, null, "", "   ", 42, ["https://example.test"]]) {
    assert.equal(formatWebsiteHref(value), null);
    assert.equal(formatPhoneHref(value), null);
    assert.equal(formatEmailHref(value), null);
  }
});

test("only absolute web links survive; other schemes and malformed hosts are dropped", () => {
  for (const value of ["ftp://example.test/hut", "file:///C:/hut.html", "data:text/html,hi", "mailto:hut@example.test",
    "//example.test/hut", "http://", "https://", "javascript.test:alert(1)", " JavaScript:alert(1) "]) {
    assert.equal(formatWebsiteHref(value), null, value);
  }
  assert.equal(formatWebsiteHref(" http://example.test/a b "), "http://example.test/a%20b");
  assert.equal(formatEmailHref("hut@example.test; second@example.test"), "mailto:hut@example.test");
  // A scheme-looking local part stays inside the encoded mailto: address.
  assert.equal(formatEmailHref("javascript:alert(1)@example.test"), "mailto:javascript%3Aalert(1)@example.test");
});
