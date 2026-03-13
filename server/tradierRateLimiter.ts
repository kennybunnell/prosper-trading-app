/**
 * Tradier API Rate Limiter
 * 
 * Tradier allows ~120 requests/minute but simultaneous connections cause timeouts.
 * This semaphore limits concurrent option chain fetches to MAX_CONCURRENT across
 * ALL scanners (CC, BCS, CSP/BPS, IC, PMCC) to prevent rate-limit timeouts.
 * 
 * Sweet spot: 6 concurrent = fast (6x faster than sequential) without overwhelming Tradier.
 */

const MAX_CONCURRENT = 6;

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
