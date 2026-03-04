import { useState, useCallback } from 'react';

interface EarningsWarning {
  symbol: string;
  earningsDate: string;
  daysUntil: number;
  severity: 'blocked' | 'warned';
}

interface EarningsCheckResult {
  warnings: EarningsWarning[];
  hasBlocked: boolean;
  hasWarned: boolean;
  isChecking: boolean;
  checkSymbols: (symbols: string[]) => Promise<EarningsWarning[]>;
  clear: () => void;
}

/**
 * Frontend hook that calls the backend earnings check endpoint.
 * Usage: const { warnings, hasBlocked, checkSymbols } = useEarningsCheck();
 * Call checkSymbols(['AAPL','MSFT']) before showing the order confirmation dialog.
 */
export function useEarningsCheck(): EarningsCheckResult {
  const [warnings, setWarnings] = useState<EarningsWarning[]>([]);
  const [isChecking, setIsChecking] = useState(false);

  const checkSymbols = useCallback(async (symbols: string[]): Promise<EarningsWarning[]> => {
    if (!symbols.length) return [];
    setIsChecking(true);
    try {
      const resp = await fetch('/api/earnings-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols }),
      });
      if (!resp.ok) {
        console.warn('[EarningsCheck] API returned', resp.status);
        return [];
      }
      const data = await resp.json();
      const result: EarningsWarning[] = [
        ...(data.blocked || []).map((h: any) => ({ ...h, severity: 'blocked' as const })),
        ...(data.warned || []).map((h: any) => ({ ...h, severity: 'warned' as const })),
      ];
      setWarnings(result);
      return result;
    } catch (err) {
      console.warn('[EarningsCheck] Failed:', err);
      return [];
    } finally {
      setIsChecking(false);
    }
  }, []);

  const clear = useCallback(() => setWarnings([]), []);

  return {
    warnings,
    hasBlocked: warnings.some(w => w.severity === 'blocked'),
    hasWarned: warnings.some(w => w.severity === 'warned'),
    isChecking,
    checkSymbols,
    clear,
  };
}
