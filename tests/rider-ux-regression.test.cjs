const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
function load(file, imports, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { exports, require: name => { if (!(name in imports)) throw Error(name); return imports[name]; }, Date, Error, Response, AbortSignal, ...globals });
  return exports;
}
const flush = () => new Promise(resolve => setImmediate(resolve));
function nodes(tree) { return !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)]; }
function text(tree) { return nodes(tree).flatMap(node => [node.props?.children].flat().filter(value => typeof value === 'string')).join(' '); }
function ui(file, name, props, extra = {}, globals = {}) {
  const slots = [], effects = []; let cursor = 0;
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useEffect(effect, deps) { const i = cursor++; if (!(i in slots) || deps?.some((value, j) => value !== slots[i]?.[j])) { slots[i] = deps; effects.push(effect); } },
  };
  const jsx = (type, props) => ({ type, props });
  const module = load(file, {
    react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'lucide-react': new Proxy({}, { get: (_, key) => key }),
    '@/components/ui/button': { Button: 'button' }, '@/components/ui/input': { Input: 'input' }, '@/components/ui/label': { Label: 'label' },
    '@/components/ui/card': { Card: 'card', CardContent: 'content', CardDescription: 'description', CardHeader: 'header', CardTitle: 'title' },
    '@/components/ui/dialog': { Dialog: 'dialog', DialogContent: 'content', DialogDescription: 'description', DialogHeader: 'header', DialogTitle: 'title' },
    ...extra,
  }, globals);
  function render() { cursor = 0; const tree = module[name](props); effects.splice(0).forEach(effect => effect()); return tree; }
  return { render, find(type, label) { return nodes(render()).find(node => node.type === type && (!label || text(node).trim() === label)); } };
}

test('resume setup saves offline exactly once and keeps failures visible', async () => {
  let calls = 0, closed = 0, reject;
  const h = ui('src/components/fetchit/rider/go-online-dialog.tsx', 'GoOnlineDialog', {
    open: true, isOnline: true, notificationsReady: true, enableNotifications: async () => {}, onReady: async () => {},
    onOpenChange: value => { if (!value) closed++; }, onGoOffline: () => { calls++; return new Promise((_, no) => reject = no); },
  }, { '@/lib/rider-location-client': { captureRiderLocation: async () => ({}) } });
  const button = h.find('button', 'Go offline'); button.props.onClick(); button.props.onClick();
  assert.equal(calls, 1); assert(h.find('button', 'Going offline…').props.disabled); assert.equal(closed, 0);
  reject(Error('Connection lost. Retry going offline.')); await flush();
  assert.match(text(h.render()), /Connection lost/); assert.equal(closed, 0); assert.equal(h.find('button', 'Go offline').props.disabled, false);
});

test('unaccepted offer decline is single-tap, locked while pending and recoverable', async () => {
  let requests = [], reply, declined = 0; const busy = [];
  const h = ui('src/components/fetchit/rider/decline-offer.tsx', 'DeclineOffer', { id: 'offer', onDeclined: () => declined++, onBusyChange: value => busy.push(value) }, {}, {
    fetch: (url, init) => { requests.push({ url, ...init }); return new Promise(resolve => reply = resolve); },
  });
  const button = h.find('button', 'Decline offer'); button.props.onClick(); button.props.onClick();
  assert.equal(requests.length, 1); assert.deepEqual(JSON.parse(requests[0].body), { reason: 'Rider declined the unaccepted offer.', offerOnly: true });
  assert(h.find('button', 'Declining offer…').props.disabled);
  reply(Response.json({ error: 'Offer already accepted. Refresh jobs.' }, { status: 409 })); await flush();
  assert.equal(declined, 0); assert.match(text(h.render()), /already accepted/); assert.deepEqual(busy, [true, false]);
  h.find('button', 'Decline offer').props.onClick(); reply(Response.json({ ok: true })); await flush(); assert.equal(declined, 1);
});

test('accept and decline cannot run together even before React rerenders', async () => {
  let accepted = 0, resolve;
  const props = { job: { id: 'offer', status: 'MATCHED', type: 'DELIVERY', totalFare: 100, createdAt: new Date().toISOString(), scheduledAt: null, paymentMethod: 'CASH', assignmentExpiresAt: new Date(Date.now() + 45000).toISOString() }, onAccept: () => { accepted++; return new Promise(done => resolve = done); }, onReleased() {} };
  const h = ui('src/components/fetchit/rider/job-preview.tsx', 'JobPreview', props, {
    '@/lib/rider-workspace': { formatJobTime: () => '', isUpcomingJob: () => false, jobTiming: () => ({ kind: 'now', label: 'Pickup now' }) },
    '@/lib/payment-policy': { demoSplit: () => ({}), isDemoPayment: () => false }, './job-route-map': { JobRouteMap: 'map' }, './offer-countdown': { OfferCountdown: 'countdown' }, './decline-offer': { DeclineOffer: 'decline' },
  }, { setInterval() {}, clearInterval() {} });
  const accept = h.find('button', 'Accept delivery'), decline = h.find('decline');
  decline.props.onBusyChange(true); await accept.props.onClick(); assert.equal(accepted, 0);
  decline.props.onBusyChange(false); const pending = h.find('button', 'Accept delivery').props.onClick();
  assert(h.find('decline').props.disabled); assert.equal(accepted, 1); resolve(); await pending;
});

function dispatchHarness(record) {
  let writes = 0, locks = 0;
  const api = load('src/lib/dispatch.ts', {
    './matching-policy': {}, './job-expiry': { requestHasExpired: () => false }, './demo-payments': {}, './rider-eligibility': {},
    './payment-policy': { isDemoPayment: () => false }, './booking-events': { recordBookingEvent: async () => {} }, './push-delivery': {},
    './platform-policy': { defaultPlatformSettings: () => ({ maxReassignments: 10 }), validatePlatformSettings: value => value },
  });
  const tx = { $queryRaw: async () => { locks++; }, booking: { findUnique: async () => record, update: async ({ data }) => { writes++; return { ...record, ...data }; } },
    platformConfig: { findUnique: async () => null }, autoDispatch: { updateMany: async () => {} }, bookingLocation: { deleteMany: async () => {} }, deliveryChallenge: { deleteMany: async () => {} } };
  return { run: (offerOnly = true) => api.assignRider({ $transaction: fn => fn(tx) }, 'b', { uid: 'r', name: 'Rider', role: 'RIDER' }, 'Declined offer.', undefined, offerOnly), get writes() { return writes; }, get locks() { return locks; } };
}
const offer = { id: 'b', riderId: 'r', status: 'MATCHED', assignmentExpiresAt: new Date(Date.now() + 45000), excludedRiderIds: [], paymentMethod: 'CASH', paymentStatus: 'UNPAID' };
test('a stale decline cannot release a booking accepted in another tab or another rider’s job', async () => {
  for (const record of [{ ...offer, status: 'ACCEPTED' }, { ...offer, status: 'IN_TRANSIT' }, { ...offer, assignmentExpiresAt: new Date(0) }, { ...offer, riderId: 'other' }]) {
    const h = dispatchHarness(record); await assert.rejects(h.run()); assert.equal(h.writes, 0); assert.equal(h.locks, 1);
  }
});
test('declining a current offer returns it for matching; accepted-job release still uses the existing flow', async () => {
  const h = dispatchHarness(offer); assert.equal((await h.run()).status, 'PENDING'); assert.equal(h.writes, 1);
  const accepted = dispatchHarness({ ...offer, status: 'ACCEPTED' }); assert.equal((await accepted.run(false)).status, 'PENDING');
});

test('photo preparation stays local; failed confirmation preserves proof and retry sends one request', async () => {
  let prepare, reply, completed = 0; const requests = [], state = [];
  const h = ui('src/components/fetchit/rider/proof-capture.tsx', 'ProofCapture', { bookingId: 'b', onProofState: value => state.push(value), onDone: () => completed++ }, {
    '@/hooks/use-toast': { useToast: () => ({ toast() {} }) }, '../shared/signature-pad': { SignaturePad: 'signature' },
    '@/lib/epod-photo-client': { prepareDeliveryPhoto: () => new Promise(resolve => prepare = resolve) },
  }, { fetch: (url, init) => { requests.push({ url, ...init }); return new Promise(resolve => reply = resolve); } });
  const input = nodes(h.render()).find(node => node.type === 'input' && node.props.type === 'file');
  input.props.onChange({ target: { files: [{ name: 'dropoff.jpg' }], value: 'file' } });
  assert.match(text(h.render()), /Preparing photo/); assert.equal(state.at(-1).preparing, true);
  h.find('signature').props.onChange('<svg>signed</svg>');
  nodes(h.render()).find(node => node.type === 'input' && node.props.placeholder === 'Recipient’s name').props.onChange({ target: { value: 'Mira' } });
  h.find('form').props.onSubmit({ preventDefault() {} }); assert.equal(requests.length, 0);
  prepare('data:image/jpeg;base64,AA=='); await flush(); assert.match(text(h.render()), /dropoff.jpg/);
  const submit = h.find('form').props.onSubmit; submit({ preventDefault() {} }); submit({ preventDefault() {} }); assert.equal(requests.length, 1);
  assert.match(text(h.render()), /Uploading proof and confirming/);
  reply(Response.json({ error: 'Connection interrupted. Retry.' }, { status: 503 })); await flush();
  assert.equal(completed, 0); assert.match(text(h.render()), /Connection interrupted/); assert.match(text(h.render()), /dropoff.jpg/);
  assert.equal(nodes(h.render()).find(node => node.type === 'input' && node.props.placeholder === 'Recipient’s name').props.value, 'Mira');
  h.find('form').props.onSubmit({ preventDefault() {} }); assert.equal(requests.length, 2); assert.equal(requests[0].body, requests[1].body);
  reply(Response.json({ proofs: [{ verified: true }] })); await flush(); assert.equal(completed, 1);
});

