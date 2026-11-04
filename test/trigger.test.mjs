// Habitcraft's backup button (src/trigger.ts). Run after `npm run build`: node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { Runner, handler, startTrigger, secretMatches, MIN_GAP_MS, version } from "../dist/trigger.js";

const SECRET = "s".repeat(32);
const tick = () => new Promise((r) => setImmediate(r));

function call(h, method, auth) {
  return new Promise((resolve) => {
    const res = { writeHead(status) { this.status = status; }, end(body) { resolve({ status: this.status, body: JSON.parse(body) }); } };
    h({ method, url: "/backup", headers: auth ? { authorization: auth } : {} }, res);
  });
}

test("the secret is checked: missing, wrong or different length is refused", () => {
  assert.equal(secretMatches(SECRET, SECRET), true);
  assert.equal(secretMatches("", SECRET), false);
  assert.equal(secretMatches("x".repeat(32), SECRET), false);
  assert.equal(secretMatches(SECRET + "x", SECRET), false);
});

test("POST starts one backup; a second while it runs is refused; GET reports the result", async () => {
  let release, calls = 0;
  const runner = new Runner(() => { calls++; return new Promise((r) => { release = r; }); });
  const h = handler(runner, SECRET);
  assert.equal((await call(h, "POST")).status, 401);
  assert.equal((await call(h, "POST", "Bearer wrong")).status, 401);
  assert.equal((await call(h, "POST", `Bearer ${SECRET}`)).status, 202);
  assert.equal((await call(h, "POST", `Bearer ${SECRET}`)).status, 409);
  assert.equal((await call(h, "GET", `Bearer ${SECRET}`)).body.running, true);
  release(); await tick();
  const st = await call(h, "GET", `Bearer ${SECRET}`);
  assert.equal(st.body.running, false); assert.equal(st.body.last.ok, true); assert.equal(st.body.last.by, "request");
  assert.equal(calls, 1);
  assert.equal((await call(h, "DELETE", `Bearer ${SECRET}`)).status, 405);
});

test("one request per 30 minutes; the cron never overlaps a running backup", async () => {
  let t = 1_000_000;
  const runner = new Runner(async () => {}, () => t);
  assert.equal(runner.request().status, 202); await tick();
  t += MIN_GAP_MS - 1000;
  assert.equal(runner.request().status, 429);
  t += 2000;
  assert.equal(runner.request().status, 202); await tick();
  let release; const slow = new Runner(() => new Promise((r) => { release = r; }));
  const first = slow.run("cron");
  assert.equal(await slow.run("cron"), false);
  release(); assert.equal(await first, true);
});

test("a failed backup is reported, not hidden, and the service stays up", async () => {
  const runner = new Runner(async () => { throw { error: new Error("pg_dump failed") }; });
  const orig = console.error; console.error = () => {};
  assert.equal(await runner.run("cron"), true);
  console.error = orig;
  assert.equal(runner.last.ok, false); assert.match(runner.last.error, /pg_dump failed/); assert.equal(runner.running, false);
});

test("no secret (or a short one) means no port is opened", () => {
  const log = console.log; console.log = () => {};
  assert.equal(startTrigger(new Runner(async () => {}), "", 0), null);
  assert.equal(startTrigger(new Runner(async () => {}), "short", 0), null);
  console.log = log;
});

test("GET says which code is running, and a run's files are kept on last (4 Nov 2026)", async () => {
  assert.deepEqual(version({ RAILWAY_GIT_COMMIT_SHA: "a".repeat(40) }), { commit: "a".repeat(40), features: ["button", "google-split"] });
  assert.equal(version({}).commit, null);
  assert.equal(version({ RAILWAY_GIT_COMMIT_SHA: "not a sha; rm" }).commit, null);
  const runner = new Runner(async () => ({ full: "backup-t.tar.gz", google: "google-t.tar.gz", google_kept: 1, google_deleted: 0 }));
  await runner.run("request");
  const st = await call(handler(runner, SECRET), "GET", `Bearer ${SECRET}`);
  assert.equal(st.body.last.files.google, "google-t.tar.gz");
  assert.deepEqual(st.body.version.features, ["button", "google-split"]);
  const plain = new Runner(async () => undefined); await plain.run("cron");
  assert.equal(plain.last.files, undefined);
});
