import { exec, execSync } from "child_process";
import { S3Client, S3ClientConfig, PutObjectCommandInput, ListObjectsV2Command, DeleteObjectCommand, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { createReadStream, unlink, statSync } from "fs";
import { filesize } from "filesize";
import path from "path";
import os from "os";

import { env } from "./env.js";
import { createMD5 } from "./util.js";
import { dumpFlags, googleTables, toPrune, oldestDays, deleteCheckKey, type Stored } from "./google.js";

const s3 = () => {
  const clientOptions: S3ClientConfig = {
    region: env.AWS_S3_REGION,
    forcePathStyle: env.AWS_S3_FORCE_PATH_STYLE
  }

  if (env.AWS_S3_ENDPOINT) {
    console.log(`Using custom endpoint: ${env.AWS_S3_ENDPOINT}`);

    clientOptions.endpoint = env.AWS_S3_ENDPOINT;
  }
  return new S3Client(clientOptions);
}

const uploadToS3 = async ({ name, path }: { name: string, path: string }) => {
  console.log("Uploading backup to S3...");

  const bucket = env.AWS_S3_BUCKET;

  if (env.BUCKET_SUBFOLDER) {
    name = env.BUCKET_SUBFOLDER + "/" + name;
  }

  let params: PutObjectCommandInput = {
    Bucket: bucket,
    Key: name,
    Body: createReadStream(path),
  }

  if (env.SUPPORT_OBJECT_LOCK) {
    console.log("MD5 hashing file...");

    const md5Hash = await createMD5(path);

    console.log("Done hashing file");

    params.ContentMD5 = Buffer.from(md5Hash, 'hex').toString('base64');
  }

  const client = s3();

  await new Upload({
    client,
    params: params
  }).done();

  console.log("Backup uploaded to S3...");
}

const dumpToFile = async (filePath: string, flags = "") => {
  console.log("Dumping DB to file...");

  await new Promise((resolve, reject) => {
    exec(`pg_dump --dbname=${env.BACKUP_DATABASE_URL} --format=tar ${env.BACKUP_OPTIONS} ${flags} | gzip > ${filePath}`, (error, stdout, stderr) => {
      if (error) {
        reject({ error: error, stderr: stderr.trimEnd() });
        return;
      }

      // check if archive is valid and contains data
      const isValidArchive = (execSync(`gzip -cd ${filePath} | head -c1`).length == 1) ? true : false;
      if (isValidArchive == false) {
        reject({ error: "Backup archive file is invalid or empty; check for errors above" });
        return;
      }

      // not all text in stderr will be a critical error, print the error / warning
      if (stderr != "") {
        console.log({ stderr: stderr.trimEnd() });
      }

      console.log("Backup archive file is valid");
      console.log("Backup filesize:", filesize(statSync(filePath).size));

      // if stderr contains text, let the user know that it was potently just a warning message
      if (stderr != "") {
        console.log(`Potential warnings detected; Please ensure the backup file "${path.basename(filePath)}" contains all needed data`);
      }

      resolve(undefined);
    });
  });

  console.log("DB dumped to file...");
}

const deleteFile = async (path: string) => {
  console.log("Deleting file...");
  await new Promise((resolve, reject) => {
    unlink(path, (err) => {
      reject({ error: err });
      return;
    });
    resolve(undefined);
  });
}

/** Habitcraft (4 Nov 2026): proves the bucket key can delete, every run: writes a tiny file, deletes it, and checks it's
 * gone. "ok", or what failed. Habitcraft's daily guard probe reads this (guard google-backups-expire). */
const deleteCheck = async (): Promise<string> => {
  const client = s3(), Key = deleteCheckKey(env.BUCKET_SUBFOLDER), Bucket = env.AWS_S3_BUCKET;
  try { await client.send(new PutObjectCommand({ Bucket, Key, Body: `delete check ${new Date().toISOString()}` })); }
  catch (e: any) { return `couldn't write the check file: ${String(e && (e.name || e.message)).slice(0, 200)}`; }
  try { await client.send(new DeleteObjectCommand({ Bucket, Key })); }
  catch (e: any) { return `couldn't delete: ${String(e && (e.name || e.message)).slice(0, 200)}`; }
  try { await client.send(new HeadObjectCommand({ Bucket, Key })); return "the check file was still there after deleting it"; }
  catch (e: any) { return e && (e.name === "NotFound" || e.$metadata?.httpStatusCode === 404) ? "ok" : `couldn't confirm the delete: ${String(e && (e.name || e.message)).slice(0, 200)}`; }
}

/** Habitcraft: deletes the Google-data backups older than GOOGLE_RETENTION_DAYS (src/google.ts). */
const pruneGoogle = async () => {
  const client = s3(), folder = env.BUCKET_SUBFOLDER;
  const objects: Stored[] = [];
  let token: string | undefined;
  do {
    const page = await client.send(new ListObjectsV2Command({ Bucket: env.AWS_S3_BUCKET, Prefix: (folder ? folder + "/" : "") + "google-", ContinuationToken: token }));
    objects.push(...(page.Contents || []));
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  const old = toPrune(objects, Date.now(), env.GOOGLE_RETENTION_DAYS, folder);
  for (const Key of old) await client.send(new DeleteObjectCommand({ Bucket: env.AWS_S3_BUCKET, Key }));
  console.log(`Google-data backups: ${objects.length} stored, ${old.length} older than ${env.GOOGLE_RETENTION_DAYS} days deleted`);
  const left = objects.filter((o) => !old.includes(o.Key as string));
  return { stored: objects.length, deleted: old.length, oldest_days: oldestDays(left, Date.now(), folder) };
}

/** Runs one backup. Returns what it made (file names only), which GET /backup shows as last.files. */
export const backup = async () => {
  console.log("Initiating DB backup...");

  const date = new Date().toISOString();
  const timestamp = date.replace(/[:.]+/g, '-');
  const tables = googleTables(env.GOOGLE_TABLES);
  const flags = dumpFlags(tables);
  const filename = `${env.BACKUP_FILE_PREFIX}-${timestamp}.tar.gz`;
  const filepath = path.join(os.tmpdir(), filename);

  // the full backup, without the Google tables' rows (Habitcraft, 3 Nov 2026)
  await dumpToFile(filepath, flags.full);
  await uploadToS3({ name: filename, path: filepath });
  await deleteFile(filepath);

  const made: { full: string; google: string | null; google_tables: string[]; google_kept: number | null; google_deleted: number | null; google_oldest_days: number | null; retention_days: number; delete_check: string | null } =
    { full: filename, google: null, google_tables: tables, google_kept: null, google_deleted: null, google_oldest_days: null, retention_days: env.GOOGLE_RETENTION_DAYS, delete_check: null };
  if (tables.length) {
    // the Google tables on their own, kept GOOGLE_RETENTION_DAYS, then deleted
    const gname = `google-${timestamp}.tar.gz`, gpath = path.join(os.tmpdir(), gname);
    await dumpToFile(gpath, flags.google);
    await uploadToS3({ name: gname, path: gpath });
    await deleteFile(gpath);
    made.google = gname;
    const pruned = await pruneGoogle();
    made.google_kept = pruned.stored - pruned.deleted;
    made.google_deleted = pruned.deleted;
    made.google_oldest_days = pruned.oldest_days;
    made.delete_check = await deleteCheck();
    console.log(`Delete check: ${made.delete_check}`);
  }

  console.log("DB backup complete...");
  return made;
}
