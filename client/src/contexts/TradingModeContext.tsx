import React, { createContext, useContext, useState, useEffect } from 'react';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/_core/hooks/useAuth';

type TradingMode = 'live' | 'paper';

interface TradingModeContextType {
  mode: TradingMode;
  setMode: (mode: TradingMode) => void;
  isLoading: boolean;
}

const TradingModeContext = createContext<TradingModeContextType | undefined>(undefined);

export function TradingModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<TradingMode>('paper');
  const { user, loading: authLoading } = useAuth();
  const updateModeMutation = trpc.user.setTradingMode.useMutation();
  const seedMockPositionsMutation = trpc.paperTrading.seedMockPositions.useMutation();

  // Initialize mode from user data
  useEffect(() => {
    if (user && !authLoading) {
      setModeState((user as any).tradingMode || 'paper');
    }
  }, [user, authLoading]);

  // Update mode both locally and in database
  const setMode = async (newMode: TradingMode) => {
    setModeState(newMode);
    try {
      await updateModeMutation.mutateAsync({ mode: newMode });
      
      // Auto-seed mock positions when switching to paper mode for the first time
      if (newMode === 'paper') {
        try {
          await seedMockPositionsMutation.mutateAsync();
          console.log('Mock positions seeded successfully');
        } catch (seedError) {
          console.error('Failed to seed mock positions:', seedError);
          // Don't revert mode on seed failure - user can still use paper mode
        }
      }
    } catch (error) {
      console.error('Failed to update trading mode:', error);
      // Revert on error
      setModeState(mode);
    }
  };

  return (
    <TradingModeContext.Provider value={{ mode, setMode, isLoading: authLoading }}>
      {children}
    </TradingModeContext.Provider>
  );
}

export function useTradingMode() {
  const context = useContext(TradingModeContext);
  if (context === undefined) {
    throw new Error('useTradingMode must be used within a TradingModeProvider');
  }
  return context;
}
