import { useEffect, useRef } from 'react';

/**
 * Client-side heartbeat hook to keep the development server awake
 * Pings /api/heartbeat at randomized intervals (3-7 minutes) to mimic human activity
 */
export function useHeartbeat(enabled: boolean = true) {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastPingRef = useRef<number>(0);

  useEffect(() => {
    if (!enabled) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      return;
    }

    const scheduleNextPing = () => {
      // Random interval between 3-7 minutes (180-420 seconds)
      const minInterval = 3 * 60 * 1000; // 3 minutes
      const maxInterval = 7 * 60 * 1000; // 7 minutes
      const randomInterval = Math.floor(Math.random() * (maxInterval - minInterval + 1)) + minInterval;
      
      timeoutRef.current = setTimeout(async () => {
        try {
          const response = await fetch('/api/heartbeat');
          const data = await response.json();
          const now = Date.now();
          const timeSinceLastPing = lastPingRef.current ? Math.floor((now - lastPingRef.current) / 1000) : 0;
          const nextPingIn = Math.floor(randomInterval / 60000);
          
          console.log(`[Heartbeat] Client ping successful - server uptime: ${Math.floor(data.uptime)}s, time since last ping: ${timeSinceLastPing}s, next ping in ~${nextPingIn} minutes`);
          lastPingRef.current = now;
        } catch (error) {
          console.error('[Heartbeat] Client ping failed:', error);
        }
        
        // Schedule next ping with new random interval
        scheduleNextPing();
      }, randomInterval);
    };

    // Initial ping after a short delay
    setTimeout(() => {
      console.log('[Heartbeat] Client-side heartbeat started (randomized 3-7 minute intervals)');
      scheduleNextPing();
    }, 5000); // Wait 5 seconds before first ping

    // Cleanup on unmount or when enabled changes
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
        console.log('[Heartbeat] Client-side heartbeat stopped');
      }
    };
  }, [enabled]);
}
