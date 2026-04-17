/**
 * Tradier API Rate Limiter
 *
 * Tradier allows ~120 requests/minute on the sandbox plan.
 * This semaphore limits concurrent option chain fetches to MAX_CONCURRENT across
 * ALL scanners (CC, BCS, CSP/BPS, IC, PMCC) to prevent rate-limit timeouts.
 *
 * Raised from 6 → 12 → 20 after profiling:
 * - 6: too slow, sequential chain fetches per position were the bottleneck
 * - 12: 2x faster but still caused 30s timeouts when 62 symbols queued simultaneously
 * - 20: allows 62-symbol BPS scan to complete in ~4 batches of 20 × ~20s = ~80s total
 * Tradier allows ~120 req/min; 20 concurrent well within that limit.
 */

const MAX_CONCURRENT = 20;

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
