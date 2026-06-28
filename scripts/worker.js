const { createServer, processDueJobs, startBullMqWorker, closeBullMq } = require('../src/server');

const intervalMs = Math.max(1000, Number(process.env.JOB_POLL_INTERVAL_MS || 5000));
const server = createServer({ disableWorker: true });
const state = server.state;
let timer = null;
let stopping = false;

async function syncDueJobs() {
  if (stopping) return;
  try {
    const result = await processDueJobs(state);
    if (result.enqueuedExternal) {
      console.log(`BullMQ sync enqueued ${result.enqueuedExternal} job(s).`);
    }
  } catch (error) {
    console.error('BullMQ sync failed', error);
  }
}

async function main() {
  if (!process.env.REDIS_URL) {
    throw new Error('REDIS_URL is required to run the BullMQ worker.');
  }
  await startBullMqWorker(state);
  await syncDueJobs();
  timer = setInterval(syncDueJobs, intervalMs);
  timer.unref?.();
  console.log(`FeedbackOS BullMQ worker running on queue ${process.env.BULLMQ_QUEUE_NAME || 'feedbackos-jobs'}.`);
}

async function shutdown() {
  if (stopping) return;
  stopping = true;
  if (timer) clearInterval(timer);
  await closeBullMq(state);
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
