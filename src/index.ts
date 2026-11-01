import { CronJob } from "cron";
import { backup } from "./backup.js";
import { env } from "./env.js";
import { Runner, startTrigger } from "./trigger.js";

console.log("NodeJS Version: " + process.version);

// Habitcraft (1 Nov 2026): every backup goes through one runner, so the cron, startup and the button never overlap.
const runner = new Runner(backup);

if (env.RUN_ON_STARTUP || env.SINGLE_SHOT_MODE) {
  console.log("Running on start backup...");

  await runner.run("startup");

  if (env.SINGLE_SHOT_MODE) {
    console.log("Database backup complete, exiting...");
    process.exit(runner.last?.ok ? 0 : 1);
  }
}

const job = new CronJob(env.BACKUP_CRON_SCHEDULE, async () => {
  await runner.run("cron");
});

job.start();

console.log("Backup cron scheduled...");

startTrigger(runner, env.BACKUP_TRIGGER_SECRET, env.TRIGGER_PORT);
