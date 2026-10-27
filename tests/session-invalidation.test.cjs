const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const ts = require("typescript");

function fixture() {
  const secret = crypto.randomBytes(32).toString("hex");
  const cache = new Map(), cookies = new Map();
  const state = { user: { role: "RIDER", isBanned: false, authInvalidBefore: null }, unavailable: false };
  const db = { user: { findUnique: async () => {
    if (state.unavailable) throw new Error("Database unavailable");
    return state.user;
  } } };
  function load(name) {
    if (cache.has(name)) return cache.get(name);
    const exports = {}; cache.set(name, exports);
    const source = fs.readFileSync(path.resolve(__dirname, "../src/lib", name + ".ts"), "utf8");
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    vm.runInNewContext(code, { exports, Buffer, Date, process: { env: { NODE_ENV: "production", SESSION_SECRET: secret } }, require: name => {
      if (name === "./db") return { db };
      if (name === "next/headers") return { cookies: async () => ({ get: key => cookies.has(key) ? { value: cookies.get(key) } : undefined }) };
      if (name.startsWith("./")) return load(name.slice(2));
      return require(name);
    } });
    return exports;
  }
  const session = load("session"), access = load("rider-access");
  const identity = { uid: "fixture-rider", email: "rider@example.invalid", name: "Fixture Rider", role: "RIDER" };
  function signed(payload) {
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return encoded + "." + crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
  }
  const issue = iat => session.createSessionToken({ ...identity, ...(iat === undefined ? {} : { iat }) });
  const use = token => cookies.set(session.SESSION_COOKIE_NAME, token);
  const bearer = token => session.getBearerSession({ headers: new Headers({ authorization: "Bearer " + token }) });
  return { session, access, identity, state, signed, issue, use, bearer };
}

test("new browser and native sessions record their authentication time", async () => {
  const f = fixture(), token = f.issue(); f.use(token);
  const session = await f.session.getSession();
  assert(Number.isFinite(session.iat));
  assert.equal((await f.access.requireRider(f.bearer(token))).uid, f.identity.uid);
  assert.equal((await f.access.getRiderSession()).uid, f.identity.uid);
});

test("password reset rejects old cookies and native bearer access", async () => {
  const f = fixture(), token = f.issue(Date.now() - 1000); f.use(token);
  f.state.user.authInvalidBefore = new Date();
  assert.equal(await f.session.getSession(), null);
  assert.equal(await f.access.getRiderSession(), null);
  await assert.rejects(f.access.requireRider(f.bearer(token)), error => error.status === 401);
});

test("sessions issued at the invalidation boundary are rejected", async () => {
  const f = fixture(), timestamp = Date.now(), token = f.issue(timestamp); f.use(token);
  f.state.user.authInvalidBefore = new Date(timestamp);
  assert.equal(await f.session.getSession(), null);
  await assert.rejects(f.access.requireRider(f.bearer(token)), error => error.status === 401);
});

test("a new login after reset works for browser and native clients", async () => {
  const f = fixture(); f.state.user.authInvalidBefore = new Date(Date.now() - 1000);
  const token = f.issue(); f.use(token);
  assert.equal((await f.session.getSession()).uid, f.identity.uid);
  assert.equal((await f.access.requireRider(f.bearer(token))).uid, f.identity.uid);
});

test("legacy sessions remain usable only until the account is invalidated", async () => {
  const f = fixture(), token = f.signed({ ...f.identity, exp: Date.now() + 10000 }); f.use(token);
  assert.equal((await f.session.getSession()).uid, f.identity.uid);
  f.state.user.authInvalidBefore = new Date();
  assert.equal(await f.session.getSession(), null);
  await assert.rejects(f.access.requireRider(f.bearer(token)), error => error.status === 401);
});

test("deleted, banned, and changed-role accounts cannot reuse a signed session", async () => {
  for (const user of [null, { role: "RIDER", isBanned: true, authInvalidBefore: null }, { role: "CUSTOMER", isBanned: false, authInvalidBefore: null }]) {
    const f = fixture(), token = f.issue(); f.use(token); f.state.user = user;
    assert.equal(await f.session.getSession(), null);
    await assert.rejects(f.access.requireRider(f.bearer(token)), error => error.status === 403);
  }
});

test("a reset between cookie validation and a protected action is enforced", async () => {
  const f = fixture(); f.use(f.issue(Date.now() - 1000));
  const session = await f.session.getSession();
  f.state.user.authInvalidBefore = new Date();
  await assert.rejects(f.access.requireRider(session), error => error.status === 401);
});

test("expired, altered, and malformed session claims are rejected", () => {
  const f = fixture();
  for (const token of [f.issue() + "x", f.signed({ ...f.identity, exp: Date.now() - 1 }), f.signed({ ...f.identity, exp: Date.now() + 10000, iat: -1 }), f.signed({ ...f.identity, exp: Date.now() + 10000, iat: "yesterday" })]) {
    assert.equal(f.session.verifySessionToken(token), null);
  }
});

test("database failures cannot authorize cookies or native actions", async () => {
  const f = fixture(), token = f.issue(); f.use(token); f.state.unavailable = true;
  await assert.rejects(f.session.getSession(), /Database unavailable/);
  await assert.rejects(f.access.requireRider(f.bearer(token)), /Database unavailable/);
});
