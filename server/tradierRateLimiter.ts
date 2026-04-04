/**
 * Tradier API Rate Limiter
 *
 * Tradier allows ~120 requests/minute on the sandbox plan.
 * This semaphore limits concurrent option chain fetches to MAX_CONCURRENT across
 * ALL scanners (CC, BCS, CSP/BPS, IC, PMCC) to prevent rate-limit timeouts.
 *
 * Raised from 6 → 12 after profiling showed sequential chain fetches per position
 * were the primary bottleneck. 12 concurrent = ~2x faster without overwhelming Tradier.
 */

const MAX_CONCURRENT = 12;

let activeCount = 0;
const queue: Array<() => void> = [];

function release() {
  activeCount--;
  if (queue.length > 0) {
    const next = queue.shift()!;
    activeCount++;
    next();
  }
}

/**
 * Wrap any async Tradier API call with the rate limiter.
 * Usage: await withRateLimit(() => api.getOptionChain(symbol, expiration, true))
 */
export async function withRateLimit<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      fn().then(resolve, reject).finally(release);
    };

    if (activeCount < MAX_CONCURRENT) {
      activeCount++;
      run();
    } else {
      queue.push(run);
    }
  });
}
