// Habitcraft: Google data gets its own short-lived backup (Ethan, 3 Nov 2026).
//
// Habitcraft's privacy policy promises that data from a person's Gmail or Google Calendar is gone from backups within
// 30 days of a deletion request. Full backups are kept longer, so they must not hold that data. So every backup run makes
// two files:
//   backup-<time>.tar.gz   the whole database except the rows of the Google tables (their structure is kept)
//   google-<time>.tar.gz   only the Google tables; deleted once older than GOOGLE_RETENTION_DAYS (28)
// GOOGLE_TABLES lists the tables (default public.email_extracts: facts kept from email, decision 73684c75).
// Contact records (contact_ties, people) mix Google and other sources, so they stay in the full backup; Habitcraft's
// deletion button logs what it deleted, and a restore applies those deletions again before the data is used.

export const DAY_MS = 24 * 60 * 60 * 1000;

/** The table names, checked: schema.table made of lower-case letters, digits and underscores only. */
export function googleTables(list: string): string[] {
  const names = String(list || "").split(",").map((s) => s.trim()).filter(Boolean);
  for (const n of names) if (!/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/.test(n)) throw new Error(`GOOGLE_TABLES: "${n}" isn't schema.table`);
  return names;
}

/** pg_dump flags for the full backup (leave out the Google tables' rows) and for the Google one (only those tables). */
export function dumpFlags(tables: string[]): { full: string; google: string } {
  return {
    full: tables.map((t) => `--exclude-table-data=${t}`).join(" "),
    google: tables.map((t) => `--table=${t}`).join(" "),
  };
}

export type Stored = { Key?: string; LastModified?: Date | string };

/** Which stored Google backups are older than the retention period. Only keys under `<folder>/google-` are ever chosen. */
export function toPrune(objects: Stored[], now: number, days: number, folder: string): string[] {
  if (!(days >= 1)) throw new Error("GOOGLE_RETENTION_DAYS must be at least 1");
  const prefix = (folder ? folder + "/" : "") + "google-";
  return objects
    .filter((o) => typeof o.Key === "string" && o.Key.startsWith(prefix) && o.Key.endsWith(".tar.gz") && o.LastModified != null)
    .filter((o) => now - new Date(o.LastModified as Date).getTime() > days * DAY_MS)
    .map((o) => o.Key as string);
}

/** Age in days (one decimal) of the oldest stored Google backup, or null when there are none. Same keys toPrune looks at. */
export function oldestDays(objects: Stored[], now: number, folder: string): number | null {
  const prefix = (folder ? folder + "/" : "") + "google-";
  const ages = objects.filter((o) => typeof o.Key === "string" && o.Key.startsWith(prefix) && o.Key.endsWith(".tar.gz") && o.LastModified != null)
    .map((o) => (now - new Date(o.LastModified as Date).getTime()) / DAY_MS);
  return ages.length ? Math.round(Math.max(...ages) * 10) / 10 : null;
}

/** The key of the small file each run writes and deletes again, to prove the bucket key can delete (4 Nov 2026). */
export const deleteCheckKey = (folder: string) => (folder ? folder + "/" : "") + "delete-check.txt";
