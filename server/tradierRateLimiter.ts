/**
 * Tradier API Rate Limiter
 *
 * Tradier allows ~200 requests/minute on the production plan.
 * This semaphore limits concurrent option chain fetches to MAX_CONCURRENT across
 * ALL scanners (CC, BCS, CSP/BPS, IC, PMCC) to prevent rate-limit timeouts.
 *
 * Raised from 6 → 12 → 20 → 30 after profiling:
 * - 6: too slow, sequential chain fetches per position were the bottleneck
 * - 12: 2x faster but still caused 30s timeouts when 62 symbols queued simultaneously
 * - 20: allows 62-symbol BPS scan to complete in ~4 batches of 20 × ~20s = ~80s total
 * - 30: ~33% faster; Tradier production allows ~200 req/min so 30 concurrent is safe
 */

const MAX_CONCURRENT = 30;

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
