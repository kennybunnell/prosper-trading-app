/**
 * Spread Analytics Router
 * Handles fetching and analyzing closed spread positions (IC, BCS, BPS)
 */

import { z } from 'zod';
import { publicProcedure, protectedProcedure, router } from './_core/trpc';
import { getTastytradeAPI, authenticateTastytrade } from './tastytrade';
import { getApiCredentials } from './db';

// Types for spread classification
export type SpreadType = 'Iron Condor' | 'Bear Call Spread' | 'Bull Put Spread' | 'Unknown';

export interface ClosedSpreadPosition {
  id: string;
  symbol: string;
  spreadType: SpreadType;
  openDate: string;
  closeDate: string;
  daysHeld: number;
  profitLoss: number;
  spreadWidth: number;
  contracts: number;
  maxRisk: number;
  roc: number; // Return on Capital %
  premiumCollected: number;
  closeCost: number;
  strikes: string; // e.g., "580/590" or "450/460/490/500"
  isWinner: boolean;
}

export interface StrategyMetrics {
  strategy: SpreadType;
  totalPositions: number;
  totalProfitLoss: number;
  totalCapitalUsed: number;
  roc: number; // Overall ROC %
  winRate: number; // % of winning trades
  avgWin: number;
  avgLoss: number;
  avgDaysHeld: number;
  bestSymbol: string | null;
  worstSymbol: string | null;
}

export interface SymbolMetrics {
  symbol: string;
  totalProfitLoss: number;
  totalCapitalUsed: number;
  roc: number;
  totalPositions: number;
  ironCondorPL: number;
  bearCallSpreadPL: number;
  bullPutSpreadPL: number;
  bestStrategy: SpreadType;
}

/**
 * Classify spread type based on transaction legs
 */
function classifySpreadType(legs: any[]): SpreadType {
  if (legs.length === 4) {
    // Iron Condor: 4 legs (2 calls, 2 puts, same expiration)
    const calls = legs.filter(l => l['option-type'] === 'C');
    const puts = legs.filter(l => l['option-type'] === 'P');
    if (calls.length === 2 && puts.length === 2) {
      return 'Iron Condor';
    }
  } else if (legs.length === 2) {
    // Vertical spread: 2 legs, same type, same expiration
    const allCalls = legs.every(l => l['option-type'] === 'C');
    const allPuts = legs.every(l => l['option-type'] === 'P');
    
    if (allCalls) {
      // Bear Call Spread: Sell higher strike call, Buy lower strike call
      // (but in transaction history, we see BTC and STC)
      return 'Bear Call Spread';
    } else if (allPuts) {
      // Bull Put Spread: Sell higher strike put, Buy lower strike put
      return 'Bull Put Spread';
    }
  }
  
  return 'Unknown';
}

/**
 * Calculate spread width from legs
 */
function calculateSpreadWidth(legs: any[]): number {
  const strikes = legs.map(l => parseFloat(l['strike-price'])).sort((a, b) => a - b);
  
  if (legs.length === 4) {
    // Iron Condor: width of one side (they should be equal)
    const putWidth = strikes[1] - strikes[0];
    const callWidth = strikes[3] - strikes[2];
    return Math.max(putWidth, callWidth);
  } else if (legs.length === 2) {
    // Vertical spread: difference between strikes
    return strikes[1] - strikes[0];
  }
  
  return 0;
}

/**
 * Extract strikes string for display
 */
function extractStrikes(legs: any[]): string {
  const strikes = legs.map(l => parseFloat(l['strike-price'])).sort((a, b) => a - b);
  return strikes.join('/');
}

/**
 * Group transactions into closed positions
 * A closed position has both opening (STO/BTO) and closing (BTC/STC) transactions
 */
function groupIntoClosedPositions(transactions: any[]): ClosedSpreadPosition[] {
  const closedPositions: ClosedSpreadPosition[] = [];
  
  // Filter for option trades only
  const optionTrades = transactions.filter(t => 
    t['transaction-sub-type'] === 'Buy to Close' ||
    t['transaction-sub-type'] === 'Sell to Close' ||
    t['transaction-sub-type'] === 'Sell to Open' ||
    t['transaction-sub-type'] === 'Buy to Open'
  );
  
  // Group by underlying symbol and expiration
  const positionGroups = new Map<string, any[]>();
  
  for (const trade of optionTrades) {
    const symbol = trade['underlying-symbol'];
    const expiration = trade.legs?.[0]?.['expires-at'] || '';
    const key = `${symbol}-${expiration}`;
    
    if (!positionGroups.has(key)) {
      positionGroups.set(key, []);
    }
    positionGroups.get(key)!.push(trade);
  }
  
  // For each group, find matching open/close pairs
  for (const [key, trades] of Array.from(positionGroups.entries())) {
    const opens = trades.filter((t: any) => 
      t['transaction-sub-type'] === 'Sell to Open' || 
      t['transaction-sub-type'] === 'Buy to Open'
    );
    const closes = trades.filter((t: any) => 
      t['transaction-sub-type'] === 'Buy to Close' || 
      t['transaction-sub-type'] === 'Sell to Close'
    );
    
    // Match opens with closes (simplified - assumes 1:1 matching)
    if (opens.length > 0 && closes.length > 0) {
      const openTrade = opens[0];
      const closeTrade = closes[0];
      
      const symbol = openTrade['underlying-symbol'];
      const legs = openTrade.legs || [];
      const spreadType = classifySpreadType(legs);
      
      // Only include recognized spread types
      if (spreadType === 'Unknown') continue;
      
      const spreadWidth = calculateSpreadWidth(legs);
      const contracts = Math.abs(parseInt(openTrade.quantity || '1'));
      const maxRisk = spreadWidth * contracts * 100;
      
      const premiumCollected = Math.abs(parseFloat(openTrade.value || '0'));
      const closeCost = Math.abs(parseFloat(closeTrade.value || '0'));
      const profitLoss = premiumCollected - closeCost;
      
      const openDate = openTrade['executed-at'] || openTrade['transaction-date'];
      const closeDate = closeTrade['executed-at'] || closeTrade['transaction-date'];
      const daysHeld = Math.round(
        (new Date(closeDate).getTime() - new Date(openDate).getTime()) / (1000 * 60 * 60 * 24)
      );
      
      const roc = maxRisk > 0 ? (profitLoss / maxRisk) * 100 : 0;
      
      closedPositions.push({
        id: closeTrade.id,
        symbol,
        spreadType,
        openDate,
        closeDate,
        daysHeld,
        profitLoss,
        spreadWidth,
        contracts,
        maxRisk,
        roc,
        premiumCollected,
        closeCost,
        strikes: extractStrikes(legs),
        isWinner: profitLoss > 0,
      });
    }
  }
  
  return closedPositions;
}

/**
 * Calculate strategy-level metrics
 */
function calculateStrategyMetrics(positions: ClosedSpreadPosition[]): StrategyMetrics[] {
  const strategies: SpreadType[] = ['Iron Condor', 'Bear Call Spread', 'Bull Put Spread'];
  const metrics: StrategyMetrics[] = [];
  
  for (const strategy of strategies) {
    const strategyPositions = positions.filter(p => p.spreadType === strategy);
    
    if (strategyPositions.length === 0) {
      metrics.push({
        strategy,
        totalPositions: 0,
        totalProfitLoss: 0,
        totalCapitalUsed: 0,
        roc: 0,
        winRate: 0,
        avgWin: 0,
        avgLoss: 0,
        avgDaysHeld: 0,
        bestSymbol: null,
        worstSymbol: null,
      });
      continue;
    }
    
    const totalProfitLoss = strategyPositions.reduce((sum, p) => sum + p.profitLoss, 0);
    const totalCapitalUsed = strategyPositions.reduce((sum, p) => sum + p.maxRisk, 0);
    const roc = totalCapitalUsed > 0 ? (totalProfitLoss / totalCapitalUsed) * 100 : 0;
    
    const winners = strategyPositions.filter(p => p.isWinner);
    const losers = strategyPositions.filter(p => !p.isWinner);
    const winRate = (winners.length / strategyPositions.length) * 100;
    
    const avgWin = winners.length > 0 
      ? winners.reduce((sum, p) => sum + p.profitLoss, 0) / winners.length 
      : 0;
    const avgLoss = losers.length > 0 
      ? losers.reduce((sum, p) => sum + p.profitLoss, 0) / losers.length 
      : 0;
    
    const avgDaysHeld = strategyPositions.reduce((sum, p) => sum + p.daysHeld, 0) / strategyPositions.length;
    
    // Find best/worst symbols
    const symbolPL = new Map<string, number>();
    for (const pos of strategyPositions) {
      symbolPL.set(pos.symbol, (symbolPL.get(pos.symbol) || 0) + pos.profitLoss);
    }
    const sortedSymbols = Array.from(symbolPL.entries()).sort((a, b) => b[1] - a[1]);
    const bestSymbol = sortedSymbols[0]?.[0] || null;
    const worstSymbol = sortedSymbols[sortedSymbols.length - 1]?.[0] || null;
    
    metrics.push({
      strategy,
      totalPositions: strategyPositions.length,
      totalProfitLoss,
      totalCapitalUsed,
      roc,
      winRate,
      avgWin,
      avgLoss,
      avgDaysHeld,
      bestSymbol,
      worstSymbol,
    });
  }
  
  return metrics;
}

/**
 * Calculate symbol-level metrics
 */
function calculateSymbolMetrics(positions: ClosedSpreadPosition[]): SymbolMetrics[] {
  const symbolMap = new Map<string, ClosedSpreadPosition[]>();
  
  for (const pos of positions) {
    if (!symbolMap.has(pos.symbol)) {
      symbolMap.set(pos.symbol, []);
    }
    symbolMap.get(pos.symbol)!.push(pos);
  }
  
  const metrics: SymbolMetrics[] = [];
  
  for (const [symbol, symbolPositions] of Array.from(symbolMap.entries())) {
    const totalProfitLoss = symbolPositions.reduce((sum: number, p: ClosedSpreadPosition) => sum + p.profitLoss, 0);
    const totalCapitalUsed = symbolPositions.reduce((sum: number, p: ClosedSpreadPosition) => sum + p.maxRisk, 0);
    const roc = totalCapitalUsed > 0 ? (totalProfitLoss / totalCapitalUsed) * 100 : 0;
    
    const ironCondorPL = symbolPositions
      .filter((p: ClosedSpreadPosition) => p.spreadType === 'Iron Condor')
      .reduce((sum: number, p: ClosedSpreadPosition) => sum + p.profitLoss, 0);
    const bearCallSpreadPL = symbolPositions
      .filter((p: ClosedSpreadPosition) => p.spreadType === 'Bear Call Spread')
      .reduce((sum: number, p: ClosedSpreadPosition) => sum + p.profitLoss, 0);
    const bullPutSpreadPL = symbolPositions
      .filter((p: ClosedSpreadPosition) => p.spreadType === 'Bull Put Spread')
      .reduce((sum: number, p: ClosedSpreadPosition) => sum + p.profitLoss, 0);
    
    // Determine best strategy for this symbol
    const strategyPLs = [
      { strategy: 'Iron Condor' as SpreadType, pl: ironCondorPL },
      { strategy: 'Bear Call Spread' as SpreadType, pl: bearCallSpreadPL },
      { strategy: 'Bull Put Spread' as SpreadType, pl: bullPutSpreadPL },
    ];
    const bestStrategy = strategyPLs.sort((a, b) => b.pl - a.pl)[0].strategy;
    
    metrics.push({
      symbol,
      totalProfitLoss,
      totalCapitalUsed,
      roc,
      totalPositions: symbolPositions.length,
      ironCondorPL,
      bearCallSpreadPL,
      bullPutSpreadPL,
      bestStrategy,
    });
  }
  
  // Sort by total P/L descending
  return metrics.sort((a, b) => b.totalProfitLoss - a.totalProfitLoss);
}

export const spreadAnalyticsRouter = router({
  /**
   * Get closed spread positions with metrics
   */
  getClosedSpreads: protectedProcedure
    .input(z.object({
      startDate: z.string().optional(), // YYYY-MM-DD
      endDate: z.string().optional(),   // YYYY-MM-DD
    }))
    .query(async ({ ctx, input }) => {
      const credentials = await getApiCredentials(ctx.user.id);
      if (!credentials) {
        throw new Error('Tastytrade credentials not configured');
      }
      
      await authenticateTastytrade(credentials, ctx.user.id);
      const api = getTastytradeAPI();
      
      // Get account number
      const accounts = await api.getAccounts();
      if (accounts.length === 0) {
        throw new Error('No accounts found');
      }
      const accountNumber = accounts[0].account['account-number'];
      
      // Default date range: last 1 year if not specified
      const endDate = input.endDate || new Date().toISOString().split('T')[0];
      const startDate = input.startDate || new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      
      console.log(`[Spread Analytics] Fetching transactions from ${startDate} to ${endDate}`);
      
      // Fetch transaction history
      const transactions = await api.getTransactionHistory(accountNumber, startDate, endDate);
      
      console.log(`[Spread Analytics] Fetched ${transactions.length} transactions`);
      
      // Group into closed positions
      const closedPositions = groupIntoClosedPositions(transactions);
      
      console.log(`[Spread Analytics] Found ${closedPositions.length} closed spread positions`);
      
      return closedPositions;
    }),
  
  /**
   * Get strategy-level metrics
   */
  getStrategyMetrics: protectedProcedure
    .input(z.object({
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const credentials = await getApiCredentials(ctx.user.id);
      if (!credentials) {
        throw new Error('Tastytrade credentials not configured');
      }
      
      await authenticateTastytrade(credentials, ctx.user.id);
      const api = getTastytradeAPI();
      
      const accounts = await api.getAccounts();
      if (accounts.length === 0) {
        throw new Error('No accounts found');
      }
      const accountNumber = accounts[0].account['account-number'];
      
      const endDate = input.endDate || new Date().toISOString().split('T')[0];
      const startDate = input.startDate || new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      
      const transactions = await api.getTransactionHistory(accountNumber, startDate, endDate);
      const closedPositions = groupIntoClosedPositions(transactions);
      const metrics = calculateStrategyMetrics(closedPositions);
      
      return metrics;
    }),
  
  /**
   * Get symbol-level metrics
   */
  getSymbolMetrics: protectedProcedure
    .input(z.object({
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const credentials = await getApiCredentials(ctx.user.id);
      if (!credentials) {
        throw new Error('Tastytrade credentials not configured');
      }
      
      await authenticateTastytrade(credentials, ctx.user.id);
      const api = getTastytradeAPI();
      
      const accounts = await api.getAccounts();
      if (accounts.length === 0) {
        throw new Error('No accounts found');
      }
      const accountNumber = accounts[0].account['account-number'];
      
      const endDate = input.endDate || new Date().toISOString().split('T')[0];
      const startDate = input.startDate || new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      
      const transactions = await api.getTransactionHistory(accountNumber, startDate, endDate);
      const closedPositions = groupIntoClosedPositions(transactions);
      const metrics = calculateSymbolMetrics(closedPositions);
      
      return metrics;
    }),
});
