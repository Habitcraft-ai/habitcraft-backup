// Habitcraft: a "back up now" button for this service (1 Nov 2026).
//
// Habitcraft's Directus asks for a backup before a change to itself. Railway tokens can't be narrowed to one service, so
// instead this service listens on Railway's private network for one request: POST /backup, with a shared secret.
// The secret can do exactly two things: start a backup (at most one every 30 minutes, never two at once) and read how the
// last one went (GET /backup). Nothing else is exposed. Give this service no public domain.
//
// Settings: BACKUP_TRIGGER_SECRET (at least 24 characters; Railway can generate it) turns the button on; without it no
// port is opened. TRIGGER_PORT (default 8080).

import { createServer, IncomingMessage, Server, ServerResponse } from "http";
import { timingSafeEqual } from "crypto";

export const MIN_GAP_MS = 30 * 60 * 1000;

export type LastRun = { started_at: string; finished_at: string | null; ok: boolean | null; error: string | null; by: "cron" | "startup" | "request" };

/** One backup at a time, whoever asks (the cron, startup, or the button). */
export class Runner {
  running = false;
  last: LastRun | null = null;
  lastRequestedAt = 0;
  constructor(private backup: () => Promise<void>, private now: () => number = Date.now) {}

  /** Runs a backup now; resolves when it ends. Returns false (and does nothing) if one is already running. */
  async run(by: LastRun["by"]): Promise<boolean> {
    if (this.running) return false;
    this.running = true;
    const run: LastRun = { started_at: new Date(this.now()).toISOString(), finished_at: null, ok: null, error: null, by };
    this.last = run;
    try {
      await this.backup();
      run.ok = true;
    } catch (e: any) {
      run.ok = false;
      run.error = String((e && (e.error?.message || e.error || e.message)) || e).slice(0, 300);
      console.error("Error while running backup: ", e);
    } finally {
      run.finished_at = new Date(this.now()).toISOString();
      this.running = false;
    }
    return true;
  }

  /** The button: starts a backup in the background unless one is running or the last request was under 30 minutes ago. */
  request(): { status: number; body: object } {
    if (this.running) return { status: 409, body: { error: "A backup is already running.", last: this.last } };
    const since = this.now() - this.lastRequestedAt;
    if (this.lastRequestedAt && since < MIN_GAP_MS)
      return { status: 429, body: { error: "One backup on request per 30 minutes.", retry_after_seconds: Math.ceil((MIN_GAP_MS - since) / 1000), last: this.last } };
    this.lastRequestedAt = this.now();
    void this.run("request");
    return { status: 202, body: { started: true, last: this.last } };
  }
}

export function secretMatches(given: string | undefined, secret: string): boolean {
  const a = Buffer.from(String(given || "")), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function handler(runner: Runner, secret: string) {
  return (req: IncomingMessage, res: ServerResponse) => {
    const send = (status: number, body: object) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
    const path = (req.url || "").split("?")[0];
    if (path !== "/backup") return send(404, { error: "not found" });
    const auth = String(req.headers["authorization"] || "");
    if (!secretMatches(auth.startsWith("Bearer ") ? auth.slice(7) : "", secret)) return send(401, { error: "wrong or missing secret" });
    if (req.method === "GET") return send(200, { running: runner.running, last: runner.last });
    if (req.method === "POST") { const r = runner.request(); return send(r.status, r.body); }
    return send(405, { error: "GET or POST only" });
  };
}

/** Opens the button if BACKUP_TRIGGER_SECRET is set (24+ characters). Listens on IPv6 too, for Railway's private network. */
export function startTrigger(runner: Runner, secret: string, port: number): Server | null {
  if (!secret) { console.log("Backup button off (no BACKUP_TRIGGER_SECRET)"); return null; }
  if (secret.length < 24) { console.log("Backup button off: BACKUP_TRIGGER_SECRET is shorter than 24 characters"); return null; }
  // "::" takes IPv6 and IPv4 where the machine has IPv6; where it doesn't, fall back to IPv4. A button that can't open
  // must never take the backups down with it, so errors are logged and the cron carries on.
  const server = createServer(handler(runner, secret));
  let fellBack = false;
  server.on("error", (e: NodeJS.ErrnoException) => {
    if (!fellBack && (e.code === "EAFNOSUPPORT" || e.code === "EADDRNOTAVAIL")) { fellBack = true; server.listen(port, "0.0.0.0"); return; }
    console.error(`Backup button off: ${e.code || e.message}`);
  });
  server.on("listening", () => console.log(`Backup button listening on port ${port}${fellBack ? " (IPv4)" : ""} (private network only)`));
  server.listen(port, "::");
  return server;
}
