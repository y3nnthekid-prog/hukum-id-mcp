import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EDGE_PATH = process.env.HUKUM_EDGE_PATH
  ?? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PAGE_URL = "http://localhost:3000/?q=UU%2021%20Tahun%202008%20perbankan%20syariah";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function waitForOutput(child, pattern, timeoutMs = 15_000) {
  const ready = deferred();
  let output = "";
  const timer = setTimeout(() => ready.reject(new Error(`Timeout menunggu output: ${output}`)), timeoutMs);
  const inspect = (chunk) => {
    output += chunk.toString();
    const match = output.match(pattern);
    if (match) {
      clearTimeout(timer);
      ready.resolve(match);
    }
  };
  child.stdout?.on("data", inspect);
  child.stderr?.on("data", inspect);
  child.once("exit", (code) => {
    clearTimeout(timer);
    ready.reject(new Error(`Proses berhenti sebelum siap (${code}): ${output}`));
  });
  return ready.promise;
}

class CdpClient {
  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.socket = new WebSocket(url);
  }

  async connect() {
    if (this.socket.readyState === WebSocket.OPEN) return;
    const opened = deferred();
    this.socket.addEventListener("open", opened.resolve, { once: true });
    this.socket.addEventListener("error", opened.reject, { once: true });
    await opened.promise;
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      const key = `${message.sessionId ?? "browser"}:${message.method}`;
      for (const listener of this.listeners.get(key) ?? []) listener(message.params);
    });
  }

  call(method, params = {}, sessionId) {
    const id = this.nextId++;
    const pending = deferred();
    this.pending.set(id, pending);
    this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return pending.promise;
  }

  on(method, listener, sessionId) {
    const key = `${sessionId ?? "browser"}:${method}`;
    const listeners = this.listeners.get(key) ?? [];
    listeners.push(listener);
    this.listeners.set(key, listeners);
  }

  once(method, sessionId) {
    const event = deferred();
    const key = `${sessionId ?? "browser"}:${method}`;
    const listener = (params) => {
      const listeners = this.listeners.get(key) ?? [];
      this.listeners.set(key, listeners.filter((candidate) => candidate !== listener));
      event.resolve(params);
    };
    this.on(method, listener, sessionId);
    return event.promise;
  }

  close() {
    this.socket.close();
  }
}

async function evaluate(client, sessionId, expression) {
  const result = await client.call("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

async function waitFor(client, sessionId, expression, timeoutMs = 5_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await evaluate(client, sessionId, expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timeout menunggu kondisi halaman: ${expression}`);
}

async function tapSelector(client, sessionId, selector) {
  const point = await evaluate(client, sessionId, `(() => {
    const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await client.call("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ ...point, radiusX: 1, radiusY: 1, force: 1 }],
  }, sessionId);
  await new Promise((resolve) => setTimeout(resolve, 80));
  await client.call("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }, sessionId);
  return point;
}

async function removeProfile(path) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      await rm(path, { recursive: true, force: true });
      return;
    } catch (error) {
      if (error?.code !== "EBUSY" && error?.code !== "EPERM" && error?.code !== "ENOTEMPTY") throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  console.warn(`Profil browser temporer tetap terkunci dan perlu dibersihkan kemudian: ${path}`);
}

const profileDir = await mkdtemp(join(tmpdir(), "hukum-web-vitals-"));
const fixture = spawn(process.execPath, ["scripts/serve-browser-fixture.mjs"], {
  cwd: process.cwd(),
  stdio: ["ignore", "pipe", "pipe"],
});
let browser;
let client;

try {
  await waitForOutput(fixture, /web fixture: http:\/\/localhost:3000/);
  browser = spawn(EDGE_PATH, [
    "--edge-skip-compat-layer-relaunch",
    "--headless=new",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-domain-reliability",
    "--disable-extensions",
    "--disable-features=MediaRouter,OptimizationHints",
    "--disable-sync",
    "--metrics-recording-only",
    "--no-default-browser-check",
    "--no-first-run",
    "--remote-debugging-port=0",
    `--user-data-dir=${profileDir}`,
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  const match = await waitForOutput(browser, /DevTools listening on (ws:\/\/[^\s]+)/);
  client = new CdpClient(match[1]);
  await client.connect();

  const { targetId } = await client.call("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await client.call("Target.attachToTarget", { targetId, flatten: true });
  await client.call("Target.activateTarget", { targetId });
  await Promise.all([
    client.call("Page.enable", {}, sessionId),
    client.call("Runtime.enable", {}, sessionId),
    client.call("Network.enable", {}, sessionId),
  ]);

  const externalRequests = new Set();
  const requestedUrls = [];
  client.on("Network.requestWillBeSent", ({ request }) => {
    const url = new URL(request.url);
    if (url.protocol === "http:" || url.protocol === "https:") requestedUrls.push(url.href);
    if ((url.protocol === "http:" || url.protocol === "https:") && !LOCAL_HOSTS.has(url.hostname)) {
      externalRequests.add(url.hostname);
    }
  }, sessionId);

  await client.call("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    mobile: true,
    screenWidth: 390,
    screenHeight: 844,
  }, sessionId);
  await client.call("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 }, sessionId);
  await client.call("Emulation.setCPUThrottlingRate", { rate: 4 }, sessionId);
  await client.call("Network.setCacheDisabled", { cacheDisabled: true }, sessionId);
  await client.call("Network.emulateNetworkConditions", {
    offline: false,
    latency: 150,
    downloadThroughput: 1_600 * 1024 / 8,
    uploadThroughput: 750 * 1024 / 8,
    connectionType: "cellular4g",
  }, sessionId);
  await client.call("Page.addScriptToEvaluateOnNewDocument", {
    source: `(() => {
      window.__hukumVitals = { lcp: 0, interactions: [], clicks: 0 };
      addEventListener("click", () => { window.__hukumVitals.clicks += 1; }, { capture: true });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__hukumVitals.lcp = entry.renderTime || entry.loadTime || entry.startTime;
        }
      }).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.interactionId > 0) window.__hukumVitals.interactions.push({
            name: entry.name,
            duration: entry.duration,
            inputDelay: entry.processingStart - entry.startTime,
            processingTime: entry.processingEnd - entry.processingStart,
            presentationDelay: entry.startTime + entry.duration - entry.processingEnd,
            interactionId: entry.interactionId,
          });
        }
      }).observe({ type: "event", buffered: true, durationThreshold: 16 });
    })();`,
  }, sessionId);

  const loaded = client.once("Page.loadEventFired", sessionId);
  await client.call("Page.navigate", { url: PAGE_URL }, sessionId);
  await loaded;
  await waitFor(client, sessionId, "document.readyState === 'complete' && Boolean(document.querySelector('.starting-points button'))");
  await new Promise((resolve) => setTimeout(resolve, 500));

  const navigationPoint = await tapSelector(client, sessionId, '.header-nav a[href="#search"]');
  await waitFor(client, sessionId, "location.hash === '#search'");
  await new Promise((resolve) => setTimeout(resolve, 150));
  const searchPoint = await tapSelector(client, sessionId, ".starting-points button");
  try {
    await waitFor(client, sessionId, "Boolean(document.querySelector('.results-region, .error-state'))");
  } catch (error) {
    const state = await evaluate(client, sessionId, `({
      clicks: window.__hukumVitals.clicks,
      query: document.querySelector('#legal-query')?.value,
      output: document.querySelector('.search-output')?.innerText,
      navigationPoint: ${JSON.stringify(navigationPoint)},
      searchPoint: ${JSON.stringify(searchPoint)},
    })`);
    console.error(`WEB_VITALS_INTERACTION_STATE ${JSON.stringify({ state, requestedUrls })}`);
    throw error;
  }
  const errorText = await evaluate(client, sessionId, "document.querySelector('.error-state')?.innerText ?? null");
  if (errorText) throw new Error(`Pencarian browser gagal: ${errorText}`);
  await new Promise((resolve) => setTimeout(resolve, 300));

  const metrics = await evaluate(client, sessionId, `({
    lcpMs: window.__hukumVitals.lcp,
    inpMs: Math.max(0, ...window.__hukumVitals.interactions.map((entry) => entry.duration)),
    interactionCount: window.__hukumVitals.interactions.length,
    interactionEntries: window.__hukumVitals.interactions,
  })`);
  const report = {
    profile: {
      viewport: "390x844@3x",
      cpuSlowdown: 4,
      latencyMs: 150,
      downloadKbps: 1600,
      uploadKbps: 750,
    },
    lcpMs: Number(metrics.lcpMs.toFixed(2)),
    inpMs: Number(metrics.inpMs.toFixed(2)),
    interactionCount: metrics.interactionCount,
    interactionEntries: metrics.interactionEntries,
    externalRequests: [...externalRequests],
  };
  console.log(`WEB_VITALS_EVIDENCE ${JSON.stringify(report)}`);
  assert.ok(report.lcpMs > 0, "LCP tidak terekam");
  assert.ok(report.interactionCount > 0, "Interaksi Event Timing tidak terekam");
  assert.deepEqual(report.externalRequests, []);
  assert.ok(report.lcpMs <= 2_500, `LCP ${report.lcpMs} ms melebihi 2500 ms`);
  assert.ok(report.inpMs <= 200, `INP ${report.inpMs} ms melebihi 200 ms`);
} finally {
  try {
    await client?.call("Browser.close");
  } catch {
    // Browser may close its websocket before acknowledging Browser.close.
  }
  client?.close();
  browser?.kill();
  fixture.kill();
  await removeProfile(profileDir);
}
