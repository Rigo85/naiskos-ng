// Real Chromium + production bundle + local synthetic agent. No production data,
// credentials, external services or browser profile are used.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { DEFAULT_FRAME_SETTINGS, EMPTY_WEATHER } from '../src/app/core/models.ts';

const root = path.resolve(import.meta.dirname, '../dist/naiskos-ng/browser');
await readFile(path.join(root, 'index.html'));
const video = execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=navy:s=670x1000:r=10',
  '-t', '1', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', 'frag_keyframe+empty_moov',
  '-f', 'mp4', 'pipe:1'], { maxBuffer: 2_000_000 });
const profile = await mkdtemp(path.join(tmpdir(), 'naiskos-collage-smoke-'));
const events = [], errors = [], beats = [], playbackErrors = [];
const manifest = { schemaVersion: 1, frameId: 'synthetic-test', version: 1, settingsRevision: 1,
  publishedAt: new Date().toISOString(), settings: { ...DEFAULT_FRAME_SETTINGS, collageMode: 'columns',
    order: 'shuffle', photoDurationSeconds: 1, fadeDurationMs: 50 },
  media: Array.from({ length: 18 }, (_, i) => ({ id: `sample-${i}`, sha256: `hash-${i}`, kind: 'photo',
    width: 670, height: 1000, url: `/sample/${i}.svg`, receivedAt: '2026-01-01T00:00:00Z', fitMode: 'inherit',
    caption: null, senderName: null, posterUrl: null, rotationDegrees: 0, durationSeconds: null,
    sizeBytes: 1, posterSizeBytes: null })) };
manifest.media[5] = { ...manifest.media[5], kind: 'video', url: '/sample/test.mp4',
  posterUrl: '/sample/5.svg', durationSeconds: 1, sizeBytes: video.length };
const repose = { schemaVersion: 1, active: false, source: null, enteredAt: null,
  updatedAt: new Date().toISOString(), overrideUntil: null, schedule: { from: '23:30', until: '07:00' } };
let brokenImage = false, chrome, ws, slowPhotosMs = 0;
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost').pathname;
    if (url.startsWith('/api/v1/')) {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
      let data = {};
      if (url.endsWith('/manifest/version')) data = { version: manifest.version };
      else if (url.endsWith('/manifest')) data = manifest;
      else if (url.endsWith('/repose')) data = repose;
      else if (url.endsWith('/weather')) data = EMPTY_WEATHER;
      else if (url.endsWith('/notifications')) data = { notifications: [] };
      else if (url.endsWith('/provisioning')) data = { state: 'approved', frameId: manifest.frameId };
      else if (url.endsWith('/health')) data = { ok: true };
      else if (url.endsWith('/viewer/runtime')) data = { quiesceId: null };
      else if (url.endsWith('/viewer/collage-events')) { events.push(body); data = { accepted: true }; }
      else if (url.endsWith('/viewer/heartbeat')) beats.push(body);
      else if (url.endsWith('/viewer/media-events')) errors.push(body);
      else if (url.endsWith('/viewer/playback-events')) playbackErrors.push(body);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(data)); return;
    }
    if (url === '/sample/test.mp4') {
      const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
      if (range) {
        const start = Number(range[1]), end = Math.min(Number(range[2] || video.length - 1), video.length - 1);
        if (start > end) { res.writeHead(416); res.end(); return; }
        res.writeHead(206, { 'Content-Type': 'video/mp4', 'Content-Range': `bytes ${start}-${end}/${video.length}`,
          'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes' });
        res.end(video.subarray(start, end + 1));
      } else {
        res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': video.length, 'Accept-Ranges': 'bytes' }); res.end(video);
      }
      return;
    }
    if (url.startsWith('/sample/')) {
      if (brokenImage && url === '/sample/broken-17.svg') { res.writeHead(404); res.end(); return; }
      if (slowPhotosMs) await delay(slowPhotosMs);
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
      res.end('<svg xmlns="http://www.w3.org/2000/svg" width="670" height="1000"><rect width="670" height="1000" fill="#507f9c"/></svg>'); return;
    }
    const file = path.resolve(root, '.' + (url === '/' ? '/index.html' : url));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    const bytes = await readFile(file);
    const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' }[path.extname(file)] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type }); res.end(bytes);
  } catch { res.writeHead(404); res.end(); }
});
const waitFor = async (fn, ms = 30_000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { const value = await fn(); if (value) return value; await delay(100); }
  throw new Error('smoke condition timed out');
};
try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  chrome = spawn(process.env['CHROME_BIN'] ?? 'google-chrome', [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--remote-debugging-port=0',
    '--autoplay-policy=no-user-gesture-required',
    `--user-data-dir=${profile}`, '--window-size=1280,800', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let browserError;
  chrome.once('error', (error) => { browserError = error; });
  chrome.stderr.on('data', () => {});
  const port = await waitFor(async () => {
    if (browserError) throw browserError;
    if (chrome.exitCode !== null) throw new Error(`Chromium exited ${chrome.exitCode}`);
    try { return (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; }
    catch { return null; }
  });
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  const pending = new Map(); let sequence = 0; const browserExceptions = [];
  ws.addEventListener('message', ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.id) {
      const waiter = pending.get(msg.id); pending.delete(msg.id);
      if (waiter) msg.error ? waiter.reject(msg.error) : waiter.resolve(msg.result);
    } else if (msg.method === 'Runtime.exceptionThrown') browserExceptions.push(msg.params.exceptionDetails);
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  await call('Runtime.enable');
  await call('Page.navigate', { url: `http://127.0.0.1:${server.address().port}` });
  await waitFor(() => events.some((e) => e.action === 'round-adopted' && e.details.round >= 3));
  const committed = events.filter((e) => e.action === 'scene-committed' && e.details.round === 1);
  const ids = committed.flatMap((e) => e.details.mediaIds);
  assert.equal(ids.length, 18); assert.equal(new Set(ids).size, 18);
  assert(events.some((e) => e.action === 'preload-used'));
  assert(events.filter((e) => e.action === 'round-adopted').every((e) => !e.details.fallback));
  assert.equal(errors.length, 0);
  // Real delayed downloads: 30s photos must preload immediately, and a manual
  // advance while decode/download is pending must join rather than restart.
  const regularMedia = [...manifest.media];
  slowPhotosMs = 700;
  manifest.settings.photoDurationSeconds = 30;
  manifest.settings.fadeDurationMs = 1000; // Wide controlled window for real input delivery.
  manifest.media = regularMedia.map((m, i) => ({ ...m, kind: 'photo',
    sha256: `slow-${i}`, url: `/sample/slow-${i}.svg`, posterUrl: null }));
  manifest.version++;
  const slowVersion = manifest.version;
  await waitFor(() => events.some((e) => e.action === 'scene-committed' && e.details.manifestVersion === slowVersion));
  // Planner traces can already refer to the new manifest while an older scene
  // is finishing. Wait for actual slow media on screen, not just its trace.
  await waitFor(() => evaluate(`!!document.querySelector('.stage--stable img[src^="/sample/slow-"]') && !!document.querySelector('.stage--staging img[src^="/sample/slow-"]')`));
  const beforeManual = events.filter((e) => e.action === 'scene-committed').length;
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: 1000, y: 350, button: 'left', clickCount: 1 });
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 1000, y: 350, button: 'left', clickCount: 1 });
  await waitFor(() => events.some((e) => e.action === 'preload-joined'), 5_000);
  await waitFor(() => evaluate(`!!document.querySelector('.stage--incoming')`), 5_000);
  await delay(360); // Separate intentional tap, not the second half of a double tap.
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: 1000, y: 350, button: 'left', clickCount: 1 });
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 1000, y: 350, button: 'left', clickCount: 1 });
  await waitFor(() => events.some((e) => e.action === 'navigation-deferred-used'), 5_000);
  await waitFor(() => events.filter((e) => e.action === 'scene-committed').length === beforeManual + 2, 8_000);
  assert(events.some((e) => e.action === 'navigation-visible' && e.details.source === 'manual' && e.details.elapsedMs < 3_000));
  await waitFor(() => events.some((e) => e.action === 'reserve-ready' && e.details.reason === 'ready'), 5_000);
  slowPhotosMs = 0; manifest.media = regularMedia; manifest.settings.photoDurationSeconds = 1; manifest.version++;
  // Existing 30s scene keeps its timer until the new manifest commits.
  await waitFor(() => events.some((e) => e.action === 'scene-committed' && e.details.manifestVersion === manifest.version), 45_000);
  await waitFor(() => evaluate(`!!document.querySelector('.stage--stable') && !document.querySelector('.stage--stable img[src^="/sample/slow-"]')`), 45_000);
  const joinedBefore = events.filter((e) => e.action === 'navigation-joined').length;
  const deferredBefore = events.filter((e) => e.action === 'navigation-deferred-used').length;
  await waitFor(() => evaluate(`!!document.querySelector('.stage--incoming')`));
  await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: 1000, y: 350, button: 'left', clickCount: 1 });
  await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 1000, y: 350, button: 'left', clickCount: 1 });
  await waitFor(() => events.filter((e) => e.action === 'navigation-joined').length > joinedBefore);
  await delay(1100);
  assert.equal(events.filter((e) => e.action === 'navigation-deferred-used').length, deferredBefore);
  // Repose preserves the scene/round, while polling and the clock continue.
  repose.active = true; repose.source = 'manual'; repose.updatedAt = new Date().toISOString();
  await waitFor(() => events.some((e) => e.action === 'planning-suspended'));
  const lastCommitted = events.filter((e) => e.action === 'scene-committed').length;
  await delay(2_500);
  assert.equal(events.filter((e) => e.action === 'scene-committed').length, lastCommitted);
  repose.active = false; repose.updatedAt = new Date().toISOString();
  await waitFor(() => events.filter((e) => e.action === 'scene-committed').length > lastCommitted);
  // A genuine HTTP/decode failure must leave the rest of the library running.
  brokenImage = true;
  manifest.media[17] = { ...manifest.media[17], sha256: 'broken-test-revision', url: '/sample/broken-17.svg' }; manifest.version++;
  await waitFor(() => errors.length > 0);
  const before = events.filter((e) => e.action === 'scene-committed').length;
  await waitFor(() => events.filter((e) => e.action === 'scene-committed').length >= before + 2);
  // Execute the shipped worker with a production-sized synthetic library.
  const workerFile = (await readdir(root)).find((name) => /^worker-.*\.js$/.test(name));
  assert(workerFile);
  const benchmark = await evaluate(`new Promise((resolve, reject) => {
    const worker = new Worker(${JSON.stringify('/' + workerFile)}, {type:'module'});
    const media = ${JSON.stringify(manifest.media)};
    const input = {mode:'adaptive',order:'shuffle',fit:'contain',aspect:1.6,seed:123,
      media:Array.from({length:2300},(_,i)=>({...media[i%media.length],id:'bench-'+i,sha256:'hash-'+i,url:'',caption:null}))};
    let ticks=0; const heartbeat=setInterval(()=>ticks++,10);
    const deadline=setTimeout(()=>{worker.terminate();clearInterval(heartbeat);reject('worker deadline')},15000);
    worker.onerror=reject;
    worker.onmessage=({data})=>{clearInterval(heartbeat);clearTimeout(deadline);worker.terminate();
      resolve({elapsedMs:data.elapsedMs,scenes:data.scenes?.length,materials:data.scenes?.flatMap(s=>s.cells).length,mainThreadTicks:ticks,error:data.error})};
    worker.postMessage({id:1,job:{kind:'plan',input}});
  })`);
  assert.equal(benchmark.materials, 2300); assert(benchmark.mainThreadTicks > 0); assert(!benchmark.error);
  assert.equal(browserExceptions.length, 0, JSON.stringify(browserExceptions));
  assert.equal(playbackErrors.length, 0, JSON.stringify(playbackErrors));
  console.log(JSON.stringify({ ok: true, rounds: events.filter((e) => e.action === 'round-adopted').length,
    precacheHits: events.filter((e) => e.action === 'preload-used').length, recoveredMediaFailures: errors.length,
    joinedPreloads: events.filter((e) => e.action === 'preload-joined').length,
    auxiliaryReady: events.filter((e) => e.action === 'reserve-ready' && e.details.reason === 'ready').length,
    manualLatenciesMs: events.filter((e) => e.action === 'navigation-visible' && e.details.source === 'manual').map((e) => e.details.elapsedMs),
    deferredUsed: events.filter((e) => e.action === 'navigation-deferred-used').length,
    joinedAutomatic: events.filter((e) => e.action === 'navigation-joined').length,
    heartbeatCount: beats.length, videoRecoveries: playbackErrors.length, benchmark }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ lastEvents: events.slice(-20), errors, playbackErrors }));
  throw error;
} finally {
  ws?.close();
  if (chrome && chrome.exitCode === null) {
    chrome.kill('SIGTERM');
    await Promise.race([new Promise((r) => chrome.once('exit', r)), delay(3_000)]);
    if (chrome.exitCode === null) chrome.kill('SIGKILL');
  }
  server.closeAllConnections(); await new Promise((r) => server.close(r));
  await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
