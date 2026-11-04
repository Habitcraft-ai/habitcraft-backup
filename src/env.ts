import { envsafe, str, bool, port, num } from "envsafe";

export const env = envsafe({
  AWS_ACCESS_KEY_ID: str(),
  AWS_SECRET_ACCESS_KEY: str(),
  AWS_S3_BUCKET: str(),
  AWS_S3_REGION: str(),
  BACKUP_DATABASE_URL: str({
    desc: 'The connection string of the database to backup.'
  }),
  BACKUP_CRON_SCHEDULE: str({
    desc: 'The cron schedule to run the backup on.',
    default: '0 5 * * *',
    allowEmpty: true
  }),
  AWS_S3_ENDPOINT: str({
    desc: 'The S3 custom endpoint you want to use.',
    default: '',
    allowEmpty: true,
  }),
  AWS_S3_FORCE_PATH_STYLE: bool({
    desc: 'Use path style for the endpoint instead of the default subdomain style, useful for MinIO',
    default: false,
    allowEmpty: true
  }),
  RUN_ON_STARTUP: bool({
    desc: 'Run a backup on startup of this application',
    default: false,
    allowEmpty: true,
  }),
  BACKUP_FILE_PREFIX: str({
    desc: 'Prefix to the file name',
    default: 'backup',
  }),
  BUCKET_SUBFOLDER: str({
    desc: 'A subfolder to place the backup files in',
    default: '',
    allowEmpty: true
  }),
  SINGLE_SHOT_MODE: bool({
    desc: 'Run a single backup on start and exit when completed',
    default: false,
    allowEmpty: true,
  }),
  // This is both time consuming and resource intensive so we leave it disabled by default
  SUPPORT_OBJECT_LOCK: bool({
    desc: 'Enables support for buckets with object lock by providing an MD5 hash with the backup file',
    default: false
  }),
  BACKUP_OPTIONS: str({
    desc: 'Any valid pg_dump option.',
    default: '',
    allowEmpty: true,
  }),
  // Habitcraft (1 Nov 2026): the "back up now" button on the private network (src/trigger.ts).
  BACKUP_TRIGGER_SECRET: str({
    desc: 'Shared secret for POST /backup; 24+ characters. Empty keeps the button off.',
    default: '',
    allowEmpty: true,
  }),
  TRIGGER_PORT: port({
    desc: 'Port for the backup button (private network only).',
    default: 8080,
  }),
  // Habitcraft (3 Nov 2026): Google data in its own backup, deleted after GOOGLE_RETENTION_DAYS (src/google.ts).
  GOOGLE_TABLES: str({
    desc: 'Comma-separated schema.table names holding Google user data; their rows are left out of the full backup.',
    default: 'public.email_extracts',
    allowEmpty: true,
  }),
  GOOGLE_RETENTION_DAYS: num({
    desc: 'Days a Google-data backup is kept before it is deleted.',
    default: 28,
  }),
})
