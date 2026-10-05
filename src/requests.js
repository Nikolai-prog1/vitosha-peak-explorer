export class RequestError extends Error {
  constructor(status) {
    super(`HTTP response ${status}`);
    this.name = "RequestError";
    this.status = status;
  }
}

export function withAbort(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) {
    promise.catch(() => {});
    return Promise.reject(signal.reason || new DOMException("Aborted", "AbortError"));
  }
  return new Promise((resolve, reject) => {
    const aborted = () => { signal.removeEventListener("abort", aborted); reject(signal.reason || new DOMException("Aborted", "AbortError")); };
    signal.addEventListener("abort", aborted, { once: true });
    promise.then((value) => { signal.removeEventListener("abort", aborted); resolve(value); }, (error) => { signal.removeEventListener("abort", aborted); reject(error); });
  });
}

export async function requestJson(url, { signal, timeoutMs = 10000, maxBytes = 1024 * 1024, fetchImpl = fetch, headers = {}, cache = "no-cache" } = {}) {
  const controller = new AbortController();
  const relay = () => controller.abort(signal.reason);
  if (signal?.aborted) relay();
  else signal?.addEventListener("abort", relay, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), timeoutMs);
  try {
    const response = await withAbort(fetchImpl(url, { signal: controller.signal, headers: { Accept: "application/json", ...headers }, credentials: "same-origin", redirect: "error", cache }), controller.signal);
    if (!response.ok) throw new RequestError(response.status);
    const contentLength = Number(response.headers.get("content-length"));
    if (contentLength > maxBytes) { controller.abort(); throw new Error("Response is too large"); }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Missing response body");
    const decoder = new TextDecoder();
    let bytes = 0;
    let text = "";
    try {
      while (true) {
        const chunk = await withAbort(reader.read(), controller.signal);
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > maxBytes) { controller.abort(); throw new Error("Response is too large"); }
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
      return JSON.parse(text);
    } finally {
      if (controller.signal.aborted) reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", relay);
  }
}
