# Habitcraft's copy of the Postgres backup template

Forked from `railwayapp-templates/postgres-s3-backups` on 1 Nov 2026. Railway's **Postgres Backup** service builds from
this repo. Everything the template does is unchanged (nightly backups to R2, a backup on start). Habitcraft added one thing:

## The "back up now" button (src/trigger.ts)

Before Habitcraft changes its own Directus, it takes a database backup. Railway tokens can't be narrowed to one service
(Ethan checked, 1 Nov), so instead this service listens on Railway's **private network** for:

- `POST /backup`: start a backup now. At most one every 30 minutes, never two at once (the nightly one included).
- `GET /backup`: whether one is running, and how the last one went (`started_at`, `finished_at`, `ok`, `error`, `by`).

Both need `Authorization: Bearer <BACKUP_TRIGGER_SECRET>`. Nothing else is exposed. **Give this service no public domain.**

| Variable | On | What |
|---|---|---|
| `BACKUP_TRIGGER_SECRET` | Postgres Backup | 24+ random characters (Railway can generate one). Empty keeps the button off. |
| `TRIGGER_PORT` | Postgres Backup | Default 8080. |
| `BACKUP_TRIGGER_URL` | Directus | `http://${{Postgres Backup.RAILWAY_PRIVATE_DOMAIN}}:8080` |
| `BACKUP_TRIGGER_SECRET` | Directus | `${{Postgres Backup.BACKUP_TRIGGER_SECRET}}` (a reference, so nobody copies it) |

Directus's `habitcraft-guards` extension calls it (`POST /habitcraft/backup`, admins only).

One other change: a failed backup no longer exits the process. It is logged, shown by `GET /backup`, and the service
stays up for the next run.

## Test

```
npm ci && npm test
```

## Keeping up with the template

"Sync fork" on GitHub pulls in Railway's changes. The only files Habitcraft changed are `src/index.ts`, `src/env.ts`,
`package.json` (the test script) and the new `src/trigger.ts`, `test/trigger.test.mjs` and this file.
