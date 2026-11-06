const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');

function harness({ media, decoded = 'a-pickup-qr', accept = true } = {}) {
  const exports = {}, frames = new Map(), events = new Map();
  let stopped = 0, reads = 0, frameId = 0, ready = 0;
  const errors = [], options = [];
  const stream = { getTracks: () => [{ stop() { stopped++; } }] };
  const video = { srcObject: null, readyState: 2, videoWidth: 1920, videoHeight: 1080, play: async () => {} };
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(4), width: canvas.width, height: canvas.height }) }) };
  const document = { hidden: false, createElement: () => canvas, addEventListener: (name, fn) => events.set(name, fn), removeEventListener: name => events.delete(name) };
  const source = fs.readFileSync('src/lib/pickup-qr-camera.ts', 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, Error, navigator: { mediaDevices: { getUserMedia: async constraints => { options.push(constraints); return media ? media(stream) : stream; } } }, document,
    requestAnimationFrame(fn) { frames.set(++frameId, fn); return frameId; }, cancelAnimationFrame(id) { frames.delete(id); },
    require(name) { assert.equal(name, 'jsqr'); return { default: () => decoded ? { data: decoded } : null }; },
  });
  const stop = exports.startPickupCamera(video, { onReady() { ready++; }, onRead(text) { reads++; assert.equal(text, decoded); return accept; }, onError(message) { errors.push(message); } });
  return { stop, video, stream, frames, errors, options, document, events, canvas,
    get stopped() { return stopped; }, get reads() { return reads; }, get ready() { return ready; },
    tick(time) { const [id, fn] = frames.entries().next().value; frames.delete(id); fn(time); } };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('uses rear camera without audio, decodes once, and stops on an accepted QR', async () => {
  const h = harness(); await flush();
  assert.equal(h.ready, 1);
  assert.equal(h.options[0].audio, false);
  assert.equal(h.options[0].video.facingMode.ideal, 'environment');
  h.tick(250);
  assert.equal(h.reads, 1); assert.equal(h.stopped, 1);
  assert.equal(h.video.srcObject, null); assert.equal(h.frames.size, 0); assert.equal(h.events.size, 0);
  assert.equal(h.canvas.width, 640, 'Limits work on high-resolution phone cameras');
  h.stop(); assert.equal(h.stopped, 1, 'Cleanup stays safe after a successful scan');
});

test('an invalid or wrong-booking QR keeps scanning without verifying a booking', async () => {
  const h = harness({ accept: false }); await flush(); h.tick(250); h.tick(300);
  assert.equal(h.reads, 1, 'Decode runs at most four times a second');
  assert.equal(h.frames.size, 1); assert.equal(h.stopped, 0);
  h.stop(); assert.equal(h.stopped, 1); assert.equal(h.frames.size, 0);
});

test('closing while permission is pending stops the late camera stream', async () => {
  let resolve;
  const h = harness({ media: stream => new Promise(done => { resolve = () => done(stream); }) });
  await flush(); h.stop(); resolve(); await flush();
  assert.equal(h.stopped, 1); assert.equal(h.video.srcObject, null);
  assert.equal(h.ready, 0); assert.equal(h.frames.size, 0); assert.equal(h.errors.length, 0);
});

test('denied camera access gives manual-entry feedback without starting a loop', async () => {
  const error = new Error('Denied'); error.name = 'NotAllowedError';
  const h = harness({ media: async () => { throw error; } }); await flush();
  assert.match(h.errors[0], /Camera access is off.*enter the six-digit code/);
  assert.equal(h.frames.size, 0); assert.equal(h.events.size, 0);
});

test('leaving the app releases the camera and requires a new scan action', async () => {
  const h = harness({ decoded: null }); await flush();
  h.document.hidden = true; h.events.get('visibilitychange')();
  assert.equal(h.stopped, 1); assert.equal(h.frames.size, 0);
  assert.match(h.errors[0], /Scanning paused/);
});
