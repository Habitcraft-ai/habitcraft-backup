// Habitcraft: the Google-data backup (src/google.ts). Run after `npm run build`: node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { googleTables, dumpFlags, toPrune, DAY_MS } from "../dist/google.js";

test("the Google tables are checked and turned into pg_dump flags", () => {
  assert.deepEqual(googleTables("public.email_extracts"), ["public.email_extracts"]);
  assert.deepEqual(googleTables(" public.a , public.b_2 "), ["public.a", "public.b_2"]);
  assert.deepEqual(googleTables(""), []);
  assert.throws(() => googleTables("email_extracts"));
  assert.throws(() => googleTables("public.x; rm -rf /"));
  assert.throws(() => googleTables("public.X"));
  assert.deepEqual(dumpFlags(["public.a", "public.b"]), { full: "--exclude-table-data=public.a --exclude-table-data=public.b", google: "--table=public.a --table=public.b" });
  assert.deepEqual(dumpFlags([]), { full: "", google: "" });
});

test("only Google backups older than the retention period are chosen for deletion", () => {
  const now = Date.parse("2026-12-31T00:00:00Z");
  const ago = (d) => new Date(now - d * DAY_MS);
  const objects = [
    { Key: "db_backup/google-old.tar.gz", LastModified: ago(29) },
    { Key: "db_backup/google-edge.tar.gz", LastModified: ago(28) },
    { Key: "db_backup/google-new.tar.gz", LastModified: ago(1) },
    { Key: "db_backup/backup-old.tar.gz", LastModified: ago(400) },   // a full backup: never
    { Key: "other/google-old.tar.gz", LastModified: ago(400) },       // another folder: never
    { Key: "db_backup/google-noext", LastModified: ago(400) },
    { Key: "db_backup/google-nodate.tar.gz" },
  ];
  assert.deepEqual(toPrune(objects, now, 28, "db_backup"), ["db_backup/google-old.tar.gz"]);
  assert.deepEqual(toPrune([{ Key: "google-a.tar.gz", LastModified: ago(30) }], now, 28, ""), ["google-a.tar.gz"]);
  assert.throws(() => toPrune([], now, 0, ""));
});
