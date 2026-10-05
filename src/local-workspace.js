export const WORKSPACE_KEY = "vitosha-peak-explorer:workspace:v1";
export const LEGACY_REPORTS_KEY = "vitosha-peak-explorer:trail-reports:v1";
export const PREFERENCES_KEY = "vitosha-peak-explorer:preferences:v1";
export const MAX_BACKUP_BYTES = 1024 * 1024;
export const EMPTY_WORKSPACE = { schemaVersion: 1, plans: [], reports: [] };
export const NOTE_COORDINATE_BOUNDS = Object.freeze({ west: 22.9, east: 23.7, south: 42.2, north: 42.85 });

// Explicit WGS84 input, never an inferred location or a silently accepted blank.
export function parseNoteCoordinates(longitude, latitude) {
  const number = value => typeof value === "number" ? value : typeof value === "string" && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()) ? Number(value.trim()) : NaN;
  const lon = number(longitude), lat = number(latitude);
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon < NOTE_COORDINATE_BOUNDS.west || lon > NOTE_COORDINATE_BOUNDS.east || lat < NOTE_COORDINATE_BOUNDS.south || lat > NOTE_COORDINATE_BOUNDS.north) return null;
  return { longitude: lon, latitude: lat };
}

export class WorkspaceError extends Error {
  constructor(code) { super(code); this.name = "WorkspaceError"; this.code = code; }
}
function invalid() { throw new WorkspaceError("invalidBackup"); }
function timestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
      || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().replace(".000Z", "Z") !== value.replace(".000Z", "Z")) invalid();
  return value;
}
function list(value, max, validate, key) {
  if (!Array.isArray(value) || value.length > max) invalid();
  const ids = new Set();
  return value.map(entry => {
    const result = validate(entry);
    if (ids.has(result[key])) invalid();
    ids.add(result[key]);
    return result;
  });
}
function plan(value) {
  if (!value || !/^peak-\d+$/.test(value.peakId) || !/^hut-\d+$/.test(value.hutId)
      || value.routeId !== `${value.peakId}--${value.hutId}`) invalid();
  return { peakId: value.peakId, hutId: value.hutId, routeId: value.routeId, savedAt: timestamp(value.savedAt) };
}
function report(value) {
  if (!value || typeof value.id !== "string" || !/^fallen-tree-[a-z0-9-]{1,70}$/i.test(value.id)
      || !Number.isFinite(value.longitude) || !Number.isFinite(value.latitude)
      || !parseNoteCoordinates(value.longitude, value.latitude)
      || !["blocked", "difficult"].includes(value.severity) || typeof value.note !== "string" || value.note.length > 280
      || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value.note)) invalid();
  return { id: value.id, longitude: value.longitude, latitude: value.latitude, severity: value.severity, note: value.note,
    createdAt: timestamp(value.createdAt), reviewedAt: value.reviewedAt ? timestamp(value.reviewedAt) : null,
    resolvedAt: value.resolvedAt ? timestamp(value.resolvedAt) : null };
}
export function validateWorkspace(value) {
  if (!value || value.schemaVersion !== 1) invalid();
  return { schemaVersion: 1, plans: list(value.plans, 100, plan, "routeId"), reports: list(value.reports, 300, report, "id") };
}
function parse(text) {
  if (typeof text !== "string" || new TextEncoder().encode(text).length > MAX_BACKUP_BYTES) invalid();
  try { return JSON.parse(text); } catch { invalid(); }
}
export function readWorkspace(storage) {
  let raw = null, legacyRaw = null;
  try {
    raw = storage.getItem(WORKSPACE_KEY);
    if (raw !== null) return { workspace: validateWorkspace(parse(raw)), raw, legacyRaw, error: null };
    legacyRaw = storage.getItem(LEGACY_REPORTS_KEY);
    const reports = legacyRaw === null ? [] : list(parse(legacyRaw), 300, report, "id");
    return { workspace: { schemaVersion: 1, plans: [], reports }, raw, legacyRaw, error: null };
  } catch (error) {
    return { workspace: { ...EMPTY_WORKSPACE }, raw, legacyRaw, error: error instanceof WorkspaceError ? "storageInvalid" : "storageUnavailable" };
  }
}
export function commitWorkspace(storage, value, previous, { recover = false, recoveryId = () => crypto.randomUUID() } = {}) {
  const workspace = validateWorkspace(value), raw = JSON.stringify(workspace);
  if (new TextEncoder().encode(raw).length > MAX_BACKUP_BYTES) invalid();
  try {
    if (storage.getItem(WORKSPACE_KEY) !== previous.raw || (previous.raw === null && storage.getItem(LEGACY_REPORTS_KEY) !== previous.legacyRaw)) throw new WorkspaceError("storageConflict");
    if (previous.error && !recover) throw new WorkspaceError(previous.error);
    if (previous.error === "storageInvalid") {
      // Keep an unreadable original before an explicit recovery; never overwrite an older recovery copy.
      const recoveryKey = `${WORKSPACE_KEY}:recovery:${recoveryId()}`;
      if (storage.getItem(recoveryKey) !== null) throw new WorkspaceError("storageUnavailable");
      storage.setItem(recoveryKey, previous.raw ?? previous.legacyRaw);
    }
    storage.setItem(WORKSPACE_KEY, raw);
    return { workspace, raw, legacyRaw: null, error: null };
  } catch (error) {
    if (error instanceof WorkspaceError) throw error;
    throw new WorkspaceError("storageUnavailable");
  }
}
export function createBackup(workspace, date = new Date()) {
  return JSON.stringify({ kind: "vitosha-workspace-backup", schemaVersion: 1, exportedAt: date.toISOString(), ...validateWorkspace(workspace) }, null, 2);
}
export function parseBackup(text) {
  const value = parse(text);
  if (value?.kind !== "vitosha-workspace-backup") invalid();
  timestamp(value.exportedAt);
  return validateWorkspace(value);
}
export function mergeWorkspaces(current, incoming) {
  const merge = (left, right, field) => [...left, ...right.filter(item => !left.some(existing => existing[field] === item[field]))];
  // Existing entries win on collisions; importing a backup cannot overwrite a user's newer note.
  return validateWorkspace({ schemaVersion: 1, plans: merge(current.plans, incoming.plans, "routeId"), reports: merge(current.reports, incoming.reports, "id") });
}
export function readLanguage(storage) {
  try {
    const value = JSON.parse(storage.getItem(PREFERENCES_KEY) || "null");
    return value?.schemaVersion === 1 && ["bg", "en"].includes(value.language) ? value.language : "bg";
  } catch { return "bg"; }
}
export function writeLanguage(storage, language) {
  try { storage.setItem(PREFERENCES_KEY, JSON.stringify({ schemaVersion: 1, language: language === "en" ? "en" : "bg" })); return true; }
  catch { return false; }
}
