import test from "node:test";
import assert from "node:assert/strict";
import { WORKSPACE_KEY, LEGACY_REPORTS_KEY, PREFERENCES_KEY, EMPTY_WORKSPACE, MAX_BACKUP_BYTES, NOTE_COORDINATE_BOUNDS, parseNoteCoordinates, readWorkspace, validateWorkspace, commitWorkspace, createBackup, parseBackup, mergeWorkspaces, readLanguage, writeLanguage } from "../src/local-workspace.js";

const date = "2026-10-05T12:30:00.000Z";
const saved = { routeId: "peak-26862677--hut-55188093", peakId: "peak-26862677", hutId: "hut-55188093", savedAt: date };
const note = { id: "fallen-tree-test-1", longitude: 23.28, latitude: 42.56, severity: "blocked", note: "Test only <script>not executable</script>", createdAt: date, reviewedAt: null, resolvedAt: null };
const workspace = { schemaVersion: 1, plans: [saved], reports: [note] };
function memoryStorage(values = {}) {
  const entries = new Map(Object.entries(values));
  return { entries, getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, String(value)) };
}

test("explicit note coordinates accept numeric decimal input and the existing workspace boundaries", () => {
  assert.deepEqual(parseNoteCoordinates(" 23.279341 ", "42.563093"), { longitude: 23.279341, latitude: 42.563093 });
  assert.deepEqual(parseNoteCoordinates(23.28, 42.56), { longitude: 23.28, latitude: 42.56 });
  assert.deepEqual(parseNoteCoordinates(NOTE_COORDINATE_BOUNDS.west, NOTE_COORDINATE_BOUNDS.south), { longitude: 22.9, latitude: 42.2 });
  assert.deepEqual(parseNoteCoordinates(NOTE_COORDINATE_BOUNDS.east, NOTE_COORDINATE_BOUNDS.north), { longitude: 23.7, latitude: 42.85 });
});

test("blank, partial, non-decimal, swapped and out-of-area note coordinates never invent a location", () => {
  for (const value of ["", " ", ".", "23,28", "0x17", "23.28degrees", "NaN", "Infinity", null, false, [], {}, NaN, Infinity]) {
    assert.equal(parseNoteCoordinates(value, 42.56), null);
    assert.equal(parseNoteCoordinates(23.28, value), null);
  }
  for (const [longitude, latitude] of [[42.56, 23.28], [22.89, 42.56], [23.71, 42.56], [23.28, 42.19], [23.28, 42.86]]) assert.equal(parseNoteCoordinates(longitude, latitude), null);
});

test("manual entry normalizes numbers before storage; imported string coordinates remain invalid", () => {
  const coordinates = parseNoteCoordinates("23.28", "42.56");
  const normalized = validateWorkspace({ ...EMPTY_WORKSPACE, reports: [{ ...note, ...coordinates, manualCoordinates: true }] });
  assert.deepEqual(normalized.reports, [note]);
  assert.throws(() => validateWorkspace({ ...EMPTY_WORKSPACE, reports: [{ ...note, longitude: "23.28" }] }), error => error.code === "invalidBackup");
  assert.equal(Object.isFrozen(NOTE_COORDINATE_BOUNDS), true);
});

test("legacy device reports migrate by reading validated fields, without writing or deleting the original", () => {
  const legacy = JSON.stringify([{ ...note, confirmations: 7, confirmedByDevice: true, privateUnknownField: "discard" }]);
  const storage = memoryStorage({ [LEGACY_REPORTS_KEY]: legacy });
  const read = readWorkspace(storage);
  assert.equal(read.error, null); assert.deepEqual(read.workspace.reports, [note]); assert.equal(storage.entries.size, 1);
  const next = commitWorkspace(storage, { ...read.workspace, plans: [saved] }, read);
  assert.equal(storage.getItem(LEGACY_REPORTS_KEY), legacy);
  assert.deepEqual(readWorkspace(storage).workspace, next.workspace);
  assert.equal(next.workspace.reports[0].confirmations, undefined);
});

test("workspace schema bounds IDs, coordinates, dates, enums, duplicates and collection sizes", () => {
  const mutations = [
    value => value.schemaVersion = 99,
    value => value.plans[0].hutId = "hut-1",
    value => value.plans[0].routeId = "https://example.invalid/",
    value => value.plans[0].savedAt = "2026-02-30T00:00:00Z",
    value => value.reports[0].latitude = 23.28,
    value => value.reports[0].longitude = 42.56,
    value => value.reports[0].latitude = NaN,
    value => value.reports[0].severity = "safe",
    value => value.reports[0].note = "a".repeat(281),
    value => value.reports[0].note = "null\u0000byte",
    value => value.reports[0].resolvedAt = "not a date",
    value => value.reports.push(value.reports[0]),
    value => value.plans.push(value.plans[0]),
    value => value.plans = Array.from({ length: 101 }, (_, index) => ({ ...saved, peakId: `peak-${index}`, routeId: `peak-${index}--hut-55188093` })),
  ];
  for (const mutate of mutations) { const copy = structuredClone(workspace); mutate(copy); assert.throws(() => validateWorkspace(copy), error => error.code === "invalidBackup"); }
  assert.deepEqual(validateWorkspace({ ...workspace, token: "must not persist" }), workspace);
});

test("a corrupt original stays untouched until explicit recovery, which preserves a separate copy", () => {
  const storage = memoryStorage({ [WORKSPACE_KEY]: "{broken original" });
  const current = readWorkspace(storage);
  assert.equal(current.error, "storageInvalid");
  assert.throws(() => commitWorkspace(storage, workspace, current), error => error.code === "storageInvalid");
  assert.equal(storage.getItem(WORKSPACE_KEY), "{broken original");
  commitWorkspace(storage, workspace, current, { recover: true, recoveryId: () => "fixture-only" });
  assert.equal(storage.getItem(`${WORKSPACE_KEY}:recovery:fixture-only`), "{broken original");
  assert.deepEqual(readWorkspace(storage).workspace, workspace);
});

test("unavailable or quota-limited storage cannot claim a save or overwrite existing entries", () => {
  assert.equal(readWorkspace(null).error, "storageUnavailable");
  const storage = memoryStorage({ [WORKSPACE_KEY]: JSON.stringify(workspace) });
  const current = readWorkspace(storage); storage.setItem = () => { throw new Error("Private browser or quota"); };
  assert.throws(() => commitWorkspace(storage, EMPTY_WORKSPACE, current), error => error.code === "storageUnavailable");
  assert.equal(storage.getItem(WORKSPACE_KEY), current.raw);
});

test("optimistic storage checks protect changes made in another tab and retained legacy entries", () => {
  const storage = memoryStorage(); const current = readWorkspace(storage);
  storage.setItem(LEGACY_REPORTS_KEY, JSON.stringify([note]));
  assert.throws(() => commitWorkspace(storage, workspace, current), error => error.code === "storageConflict");
  const refreshed = readWorkspace(storage); commitWorkspace(storage, workspace, refreshed);
  assert.throws(() => commitWorkspace(storage, EMPTY_WORKSPACE, refreshed), error => error.code === "storageConflict");
});

test("backups round-trip and merge idempotently, retaining a newer existing note on collisions", () => {
  const restored = parseBackup(createBackup(workspace, new Date(date)));
  assert.deepEqual(restored, workspace);
  const incoming = { ...restored, reports: [{ ...note, note: "older imported text" }, { ...note, id: "fallen-tree-test-2" }] };
  const merged = mergeWorkspaces(workspace, incoming);
  assert.equal(merged.reports.length, 2); assert.equal(merged.reports[0].note, note.note);
  assert.deepEqual(mergeWorkspaces(merged, incoming), merged);
});

test("invalid, oversized and unsupported backups are rejected before storage changes", () => {
  for (const input of ["not JSON", "null", "{}", JSON.stringify({ ...workspace, kind: "another-app", exportedAt: date }), "x".repeat(MAX_BACKUP_BYTES + 1)]) {
    assert.throws(() => parseBackup(input), error => error.code === "invalidBackup");
  }
  const storage = memoryStorage({ [WORKSPACE_KEY]: "{invalid" });
  assert.equal(readWorkspace(storage).error, "storageInvalid");
});

test("marking a note gone retains its history and can be reversed without inventing public confirmations", () => {
  const gone = validateWorkspace({ ...workspace, reports: [{ ...note, resolvedAt: date }] });
  const restored = validateWorkspace({ ...gone, reports: gone.reports.map(report => ({ ...report, resolvedAt: null })) });
  assert.deepEqual(restored, workspace);
});

test("language preferences are small, versioned and tolerant of unavailable storage", () => {
  const storage = memoryStorage(); assert.equal(readLanguage(storage), "bg");
  assert.equal(writeLanguage(storage, "en"), true); assert.equal(readLanguage(storage), "en");
  assert.deepEqual(JSON.parse(storage.getItem(PREFERENCES_KEY)), { schemaVersion: 1, language: "en" });
  assert.equal(writeLanguage(null, "bg"), false); assert.equal(readLanguage(null), "bg");
});
