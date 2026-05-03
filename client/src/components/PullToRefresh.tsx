import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";

const PULL_THRESHOLD = 80; // px to pull before triggering refresh
const MAX_PULL = 120; // max visual pull distance

export function PullToRefresh() {
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isTriggered, setIsTriggered] = useState(false);
  const startYRef = useRef<number | null>(null);
  const isPullingRef = useRef(false);

  useEffect(() => {
    // Only activate in PWA standalone mode or on touch devices
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as any).standalone === true;

    // Allow on all touch devices (mobile browser + PWA)
    const isTouchDevice = "ontouchstart" in window;
    if (!isTouchDevice) return;

    const handleTouchStart = (e: TouchEvent) => {
      // Only start pull-to-refresh when at the very top of the page
      const scrollTop =
        document.documentElement.scrollTop || document.body.scrollTop;
      if (scrollTop > 0) return;

      startYRef.current = e.touches[0].clientY;
      isPullingRef.current = false;
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (startYRef.current === null || isRefreshing) return;

      const currentY = e.touches[0].clientY;
      const diff = currentY - startYRef.current;

      // Only pull downward
      if (diff <= 0) {
        startYRef.current = null;
        setPullDistance(0);
        setIsTriggered(false);
        return;
      }

      // Check we're still at the top
      const scrollTop =
        document.documentElement.scrollTop || document.body.scrollTop;
      if (scrollTop > 0) {
        startYRef.current = null;
        setPullDistance(0);
        setIsTriggered(false);
        return;
      }

      isPullingRef.current = true;

      // Apply rubber-band resistance: slow down pull as it extends
      const resistance = 0.5;
      const visualDist = Math.min(diff * resistance, MAX_PULL);
      setPullDistance(visualDist);
      setIsTriggered(visualDist >= PULL_THRESHOLD);

      // Prevent default scroll only when actively pulling
      if (diff > 5) {
        e.preventDefault();
      }
    };

    const handleTouchEnd = () => {
      if (!isPullingRef.current) return;

      if (pullDistance >= PULL_THRESHOLD) {
        // Trigger refresh
        setIsRefreshing(true);
        setPullDistance(50); // hold spinner in place briefly
        setTimeout(() => {
          window.location.reload();
        }, 600);
      } else {
        // Snap back
        setPullDistance(0);
        setIsTriggered(false);
      }

      startYRef.current = null;
      isPullingRef.current = false;
    };

    document.addEventListener("touchstart", handleTouchStart, { passive: true });
    document.addEventListener("touchmove", handleTouchMove, { passive: false });
    document.addEventListener("touchend", handleTouchEnd, { passive: true });

    return () => {
      document.removeEventListener("touchstart", handleTouchStart);
      document.removeEventListener("touchmove", handleTouchMove);
      document.removeEventListener("touchend", handleTouchEnd);
    };
  }, [pullDistance, isRefreshing]);

  if (pullDistance === 0 && !isRefreshing) return null;

  const progress = Math.min(pullDistance / PULL_THRESHOLD, 1);
  const rotation = progress * 360;

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[9999] flex items-center justify-center pointer-events-none"
      style={{
        height: `${pullDistance}px`,
        transition: isRefreshing ? "height 0.2s ease" : "none",
      }}
    >
      <div
        className="flex flex-col items-center gap-1"
        style={{
          opacity: progress,
          transform: `translateY(${Math.max(pullDistance - 40, 0)}px)`,
          transition: isRefreshing ? "transform 0.2s ease, opacity 0.2s ease" : "none",
        }}
      >
        <div
          className={`w-9 h-9 rounded-full flex items-center justify-center shadow-lg ${
            isTriggered || isRefreshing
              ? "bg-amber-500 text-black"
              : "bg-zinc-800 text-amber-400"
          }`}
          style={{
            border: "2px solid rgba(245, 158, 11, 0.4)",
          }}
        >
          <RefreshCw
            className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`}
            style={{
              transform: isRefreshing ? undefined : `rotate(${rotation}deg)`,
              transition: isRefreshing ? undefined : "transform 0.05s linear",
            }}
          />
        </div>
        <span
          className="text-[10px] font-medium text-amber-400/80"
          style={{ opacity: progress }}
        >
          {isRefreshing
            ? "Refreshing…"
            : isTriggered
            ? "Release to refresh"
            : "Pull to refresh"}
        </span>
      </div>
    </div>
  );
}
