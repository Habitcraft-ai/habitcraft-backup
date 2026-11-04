# Habitcraft's copy of the Postgres backup template

Forked from `railwayapp-templates/postgres-s3-backups` on 1 Nov 2026. Railway's **Postgres Backup** service builds from
this repo. Everything the template does is unchanged (nightly backups to R2, a backup on start). Habitcraft added one thing:

## The "back up now" button (src/trigger.ts)

Before Habitcraft changes its own Directus, it takes a database backup. Railway tokens can't be narrowed to one service
(Ethan checked, 1 Nov), so instead this service listens on Railway's **private network** for:

- `POST /backup`: start a backup now. At most one every 30 minutes, never two at once (the nightly one included).
- `GET /backup`: whether one is running, and how the last one went (`started_at`, `finished_at`, `ok`, `error`, `by`).
  Since 4 Nov 2026 also `last.files` (the file names it made, and how many Google backups were kept and deleted) and
  `version` (`commit`: the deployed commit from Railway's `RAILWAY_GIT_COMMIT_SHA`; `features`), so Habitcraft can see
  which code made a backup without opening Railway.

Both need `Authorization: Bearer <BACKUP_TRIGGER_SECRET>`. Nothing else is exposed. **Give this service no public domain.**

| Variable | On | What |
|---|---|---|
| `BACKUP_TRIGGER_SECRET` | Postgres Backup | 24+ random characters (Railway can generate one). Empty keeps the button off. |
| `TRIGGER_PORT` | Postgres Backup | Default 8080. |
| `BACKUP_TRIGGER_URL` | Directus | `http://${{Postgres Backup.RAILWAY_PRIVATE_DOMAIN}}:8080` |
| `BACKUP_TRIGGER_SECRET` | Directus | `${{Postgres Backup.BACKUP_TRIGGER_SECRET}}` (a reference, so nobody copies it) |

Directus's `habitcraft-guards` extension calls it (`POST /habitcraft/backup`, admins only).

## Google data in its own backup (src/google.ts, 3 Nov 2026)

Habitcraft's privacy policy promises that data from a person's Gmail or Google Calendar leaves backups within 30 days of
a deletion request, while full backups are kept longer. So each run makes two files:

- `backup-<time>.tar.gz`: the whole database except the rows of the Google tables (`--exclude-table-data`; the tables'
  structure is still there). Kept as before.
- `google-<time>.tar.gz`: only the Google tables. After each run, `google-` files older than `GOOGLE_RETENTION_DAYS` are
  deleted from the bucket. Nothing else is ever deleted, apart from the delete check below.

Every run also proves the bucket key can delete (4 Nov 2026): it writes `delete-check.txt` in the backup folder, deletes
it and checks it's gone. `GET /backup` shows the result as `last.files.delete_check` (`ok`, or what failed) and the age
of the oldest Google backup as `last.files.google_oldest_days`. Habitcraft's daily guard probe reads both (guard
`google-backups-expire`), so a key that can't delete, or a Google backup kept too long, shows as broken the next morning.

| Variable | Default | What |
|---|---|---|
| `GOOGLE_TABLES` | `public.email_extracts` | The tables holding Google user data, `schema.table`, comma-separated |
| `GOOGLE_RETENTION_DAYS` | `28` | Days a Google backup is kept |

Restoring: restore the full file, then the newest Google file (`pg_restore --data-only`) if the Google rows are wanted.
Then apply the deletions Habitcraft logged since that backup (`service_events` kind `google_purge`) before anyone uses
the restored data.

One other change: a failed backup no longer exits the process. It is logged, shown by `GET /backup`, and the service
stays up for the next run.

## Test

```
npm ci && npm test
```

## Keeping up with the template

"Sync fork" on GitHub pulls in Railway's changes. The only files Habitcraft changed are `src/index.ts`, `src/env.ts`, `src/backup.ts`,
`package.json` (the test script) and the new `src/trigger.ts`, `src/google.ts`, `test/trigger.test.mjs`,
`test/google.test.mjs` and this file.
