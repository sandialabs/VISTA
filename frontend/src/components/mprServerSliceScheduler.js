export const MPR_SERVER_SLICE_MAX_CONCURRENCY = 4;

const scheduler = { activeCount: 0, queue: [] };

function drainQueue() {
  while (
    scheduler.activeCount < MPR_SERVER_SLICE_MAX_CONCURRENCY
    && scheduler.queue.length > 0
  ) {
    const job = scheduler.queue.shift();
    scheduler.activeCount += 1;
    Promise.resolve()
      .then(() => (job.shouldRun?.() === false ? null : job.run()))
      .then(job.resolve, job.reject)
      .finally(() => {
        scheduler.activeCount = Math.max(0, scheduler.activeCount - 1);
        drainQueue();
      });
  }
}

export function scheduleMprServerSliceTask(run, { priority = false, shouldRun } = {}) {
  return new Promise((resolve, reject) => {
    const job = { run, resolve, reject, shouldRun };
    if (priority) scheduler.queue.unshift(job);
    else scheduler.queue.push(job);
    drainQueue();
  });
}

export function getMprServerSliceSchedulerStats() {
  return { activeCount: scheduler.activeCount, queuedCount: scheduler.queue.length };
}

export function resetMprServerSliceSchedulerForTests() {
  scheduler.queue.splice(0).forEach((job) => job.resolve(null));
  scheduler.activeCount = 0;
}
