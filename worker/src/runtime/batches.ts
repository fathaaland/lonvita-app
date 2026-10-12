/** Bounded batches for the scheduled jobs: a backlog that built up over months (the worker was down
 * for a week) shouldn't turn into one huge statement that outlives the job's lock. */
export const BATCH_SIZE = 500
/** A stop so a runaway loop can't spin forever — 100 full batches is far past any real backlog, and
 * whatever is left gets picked up by the next run. */
export const MAX_BATCHES = 100

/** Runs `batch` until it handles fewer than BATCH_SIZE rows (or MAX_BATCHES times); returns how many
 * it handled in all. `batch` takes up to BATCH_SIZE rows and says how many it took. */
export async function inBatches(batch: () => Promise<number>): Promise<number> {
  let total = 0
  for (let run = 0; run < MAX_BATCHES; run++) {
    const handled = await batch()
    total += handled
    if (handled < BATCH_SIZE) break
  }
  return total
}
