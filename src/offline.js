const WORKER_PATH = "/offline-worker.js";
export function ownedWorker(worker, origin) {
  if (!worker?.scriptURL) return false;
  try { const url = new URL(worker.scriptURL); return url.origin === origin && url.pathname === WORKER_PATH && !url.search; } catch { return false; }
}
export function offlineWorkerStatus(worker, { Channel = MessageChannel, timeoutMs = 5000, repair = false } = {}) {
  return new Promise((resolve, reject) => {
    const channel = new Channel();
    const finish = (error, value) => { clearTimeout(timer); channel.port1.close(); error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => finish(new Error("Offline status timed out")), timeoutMs);
    channel.port1.onmessage = event => {
      const value = event.data;
      if (value?.type !== "VITOSHA_OFFLINE_STATUS" || typeof value.ready !== "boolean" || !/^[a-f0-9]{64}$/.test(value.id)
        || !Number.isSafeInteger(value.bytes) || value.bytes < 0 || value.bytes > 8 * 1024 * 1024
        || (value.ready && !Number.isFinite(Date.parse(value.preparedAt)))) return finish(new Error("Invalid offline status"));
      finish(null, value);
    };
    channel.port1.onmessageerror = () => finish(new Error("Invalid offline status"));
    try { worker.postMessage({ type: repair ? "VITOSHA_OFFLINE_PREPARE" : "VITOSHA_OFFLINE_STATUS" }, [channel.port2]); } catch (error) { channel.port2.close(); finish(error); }
  });
}
function bounded(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Offline pack preparation timed out")), Math.max(1, timeoutMs));
    Promise.resolve(promise).then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}
export async function prepareOfflinePack(container, origin, { timeoutMs = 45000, expectedId } = {}) {
  const deadline = Date.now() + timeoutMs, remaining = () => Math.max(1, deadline - Date.now());
  const existing = await bounded(container.getRegistration("/"), remaining());
  if (existing && ![existing.active, existing.waiting, existing.installing].filter(Boolean).every(worker => ownedWorker(worker, origin))) throw new Error("Another service worker owns this app scope");
  const registration = await bounded(container.register(WORKER_PATH, { scope: "/", updateViaCache: "none" }), remaining());
  // Registering the same URL may return the existing registration without
  // downloading a new script. The explicit user action also checks for updates.
  if (existing && !registration.installing) await bounded(registration.update(), remaining());
  if (registration.installing) await new Promise((resolve, reject) => {
    const worker = registration.installing;
    const done = error => { clearTimeout(timer); worker.removeEventListener("statechange", changed); error ? reject(error) : resolve(); };
    const changed = () => { if (["installed", "activated"].includes(worker.state)) done(); else if (worker.state === "redundant") done(new Error("Offline pack installation failed")); };
    const timer = setTimeout(() => done(new Error("Offline pack installation timed out")), remaining());
    worker.addEventListener("statechange", changed); changed();
  });
  const worker = registration.waiting || registration.active;
  if (!ownedWorker(worker, origin)) throw new Error("Offline worker unavailable");
  let status = await offlineWorkerStatus(worker, { timeoutMs: Math.min(5000, remaining()) });
  if (expectedId && status.id !== expectedId) throw new Error("Offline pack does not match this release; reload before preparing it");
  if (!status.ready) status = await offlineWorkerStatus(worker, { timeoutMs: remaining(), repair: true });
  if (!status.ready) throw new Error("Offline facts are incomplete");
  if (registration.waiting) registration.waiting.postMessage({ type: "VITOSHA_OFFLINE_ACTIVATE" });
  return status;
}
