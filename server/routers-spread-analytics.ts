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

interface OptionLeg {
  symbol: string;
  strikePrice: number;
  optionType: 'C' | 'P';
  expiration: string;
  action: 'STO' | 'BTO' | 'STC' | 'BTC';
  quantity: number;
  value: number;
  date: string;
}

/**
 * Parse individual option transaction into a leg
 */
function parseOptionLeg(transaction: any): OptionLeg | null {
  // Check if this is an option trade
  if (transaction['instrument-type'] !== 'Equity Option') {
    return null;
  }
  
  const subType = transaction['transaction-sub-type'];
  if (!['Buy to Close', 'Sell to Close', 'Sell to Open', 'Buy to Open'].includes(subType)) {
    return null;
  }
  
  const actionMap: Record<string, 'STO' | 'BTO' | 'STC' | 'BTC'> = {
    'Sell to Open': 'STO',
    'Buy to Open': 'BTO',
    'Sell to Close': 'STC',
    'Buy to Close': 'BTC',
  };
  
  return {
    symbol: transaction['underlying-symbol'],
    strikePrice: parseFloat(transaction['strike-price'] || '0'),
    optionType: transaction['call-or-put'] as 'C' | 'P',
    expiration: transaction['expiration-date'] || '',
    action: actionMap[subType],
    quantity: Math.abs(parseInt(transaction.quantity || '1')),
    value: Math.abs(parseFloat(transaction.value || '0')),
    date: transaction['executed-at'] || transaction['transaction-date'],
  };
}

/**
 * Classify spread type based on legs
 */
function classifySpreadFromLegs(legs: OptionLeg[]): SpreadType {
  if (legs.length === 4) {
    // Iron Condor: 4 legs (2 calls, 2 puts, same expiration)
    const calls = legs.filter(l => l.optionType === 'C');
    const puts = legs.filter(l => l.optionType === 'P');
    if (calls.length === 2 && puts.length === 2) {
      return 'Iron Condor';
    }
  } else if (legs.length === 2) {
    // Vertical spread: 2 legs, same type, same expiration
    const allCalls = legs.every(l => l.optionType === 'C');
    const allPuts = legs.every(l => l.optionType === 'P');
    
    if (allCalls) {
      return 'Bear Call Spread';
    } else if (allPuts) {
      return 'Bull Put Spread';
    }
  }
  
  return 'Unknown';
}

/**
 * Calculate spread width from legs
 */
function calculateSpreadWidthFromLegs(legs: OptionLeg[]): number {
  const strikes = legs.map(l => l.strikePrice).sort((a, b) => a - b);
  
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
 * Extract strikes string from legs
 */
function extractStrikesFromLegs(legs: OptionLeg[]): string {
  const strikes = legs.map(l => l.strikePrice).sort((a, b) => a - b);
  return strikes.join('/');
}

/**
 * Group transactions into closed positions
 * NEW APPROACH: Group individual option transactions by symbol + expiration,
 * then match opening and closing legs to form complete spreads
 */
function groupIntoClosedPositions(transactions: any[]): ClosedSpreadPosition[] {
  const closedPositions: ClosedSpreadPosition[] = [];
  
  // Parse all option legs
  const legs: OptionLeg[] = [];
  for (const txn of transactions) {
    const leg = parseOptionLeg(txn);
    if (leg) {
      legs.push(leg);
    }
  }
  
  console.log(`[Spread Analytics] Parsed ${legs.length} option legs from ${transactions.length} transactions`);
  
  // Group legs by symbol + expiration
  const positionGroups = new Map<string, OptionLeg[]>();
  for (const leg of legs) {
    const key = `${leg.symbol}-${leg.expiration}`;
    if (!positionGroups.has(key)) {
      positionGroups.set(key, []);
    }
    positionGroups.get(key)!.push(leg);
  }
  
  console.log(`[Spread Analytics] Found ${positionGroups.size} unique symbol-expiration groups`);
  
  // For each group, find matching open/close pairs
  for (const [key, groupLegs] of Array.from(positionGroups.entries())) {
    // Separate opening and closing legs
    const openLegs = groupLegs.filter(l => l.action === 'STO' || l.action === 'BTO');
    const closeLegs = groupLegs.filter(l => l.action === 'STC' || l.action === 'BTC');
    
    // We need both opening and closing to have a closed position
    if (openLegs.length === 0 || closeLegs.length === 0) {
      continue;
    }
    
    // Try to match opening and closing legs by strike + type
    const matchedPairs: { open: OptionLeg; close: OptionLeg }[] = [];
    
    for (const openLeg of openLegs) {
      // Find corresponding close leg (same strike, same type)
      const closeLeg = closeLegs.find(c => 
        c.strikePrice === openLeg.strikePrice && 
        c.optionType === openLeg.optionType &&
        !matchedPairs.some(p => p.close === c) // Not already matched
      );
      
      if (closeLeg) {
        matchedPairs.push({ open: openLeg, close: closeLeg });
      }
    }
    
    // If we have at least 2 matched pairs, it's a spread
    if (matchedPairs.length >= 2) {
      const spreadLegs = matchedPairs.map(p => p.open);
      const spreadType = classifySpreadFromLegs(spreadLegs);
      
      // Only include recognized spread types
      if (spreadType === 'Unknown') continue;
      
      const spreadWidth = calculateSpreadWidthFromLegs(spreadLegs);
      const contracts = Math.min(...spreadLegs.map(l => l.quantity));
      const maxRisk = spreadWidth * contracts * 100;
      
      // Calculate premium collected (opening trades)
      const premiumCollected = matchedPairs.reduce((sum, p) => {
        // STO = credit (positive), BTO = debit (negative)
        return sum + (p.open.action === 'STO' ? p.open.value : -p.open.value);
      }, 0);
      
      // Calculate close cost (closing trades)
      const closeCost = matchedPairs.reduce((sum, p) => {
        // STC = debit (positive), BTC = credit (negative)
        return sum + (p.close.action === 'BTC' ? p.close.value : -p.close.value);
      }, 0);
      
      const profitLoss = premiumCollected - closeCost;
      
      const openDate = Math.min(...matchedPairs.map(p => new Date(p.open.date).getTime()));
      const closeDate = Math.max(...matchedPairs.map(p => new Date(p.close.date).getTime()));
      const daysHeld = Math.round((closeDate - openDate) / (1000 * 60 * 60 * 24));
      
      const roc = maxRisk > 0 ? (profitLoss / maxRisk) * 100 : 0;
      
      closedPositions.push({
        id: `${key}-${openDate}`,
        symbol: spreadLegs[0].symbol,
        spreadType,
        openDate: new Date(openDate).toISOString(),
        closeDate: new Date(closeDate).toISOString(),
        daysHeld,
        profitLoss,
        spreadWidth,
        contracts,
        maxRisk,
        roc,
        premiumCollected,
        closeCost,
        strikes: extractStrikesFromLegs(spreadLegs),
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
      const current = symbolPL.get(pos.symbol) || 0;
      symbolPL.set(pos.symbol, current + pos.profitLoss);
    }
    
    let bestSymbol: string | null = null;
    let bestPL = -Infinity;
    let worstSymbol: string | null = null;
    let worstPL = Infinity;
    
    for (const [symbol, pl] of Array.from(symbolPL.entries())) {
      if (pl > bestPL) {
        bestPL = pl;
        bestSymbol = symbol;
      }
      if (pl < worstPL) {
        worstPL = pl;
        worstSymbol = symbol;
      }
    }
    
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
  const symbols = Array.from(new Set(positions.map(p => p.symbol)));
  const metrics: SymbolMetrics[] = [];
  
  for (const symbol of symbols) {
    const symbolPositions = positions.filter(p => p.symbol === symbol);
    
    const totalProfitLoss = symbolPositions.reduce((sum, p) => sum + p.profitLoss, 0);
    const totalCapitalUsed = symbolPositions.reduce((sum, p) => sum + p.maxRisk, 0);
    const roc = totalCapitalUsed > 0 ? (totalProfitLoss / totalCapitalUsed) * 100 : 0;
    
    const ironCondorPL = symbolPositions
      .filter(p => p.spreadType === 'Iron Condor')
      .reduce((sum, p) => sum + p.profitLoss, 0);
    
    const bearCallSpreadPL = symbolPositions
      .filter(p => p.spreadType === 'Bear Call Spread')
      .reduce((sum, p) => sum + p.profitLoss, 0);
    
    const bullPutSpreadPL = symbolPositions
      .filter(p => p.spreadType === 'Bull Put Spread')
      .reduce((sum, p) => sum + p.profitLoss, 0);
    
    // Determine best strategy for this symbol
    const strategyPLs = [
      { strategy: 'Iron Condor' as SpreadType, pl: ironCondorPL },
      { strategy: 'Bear Call Spread' as SpreadType, pl: bearCallSpreadPL },
      { strategy: 'Bull Put Spread' as SpreadType, pl: bullPutSpreadPL },
    ];
    const bestStrategy = strategyPLs.reduce((best, current) => 
      current.pl > best.pl ? current : best
    ).strategy;
    
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
