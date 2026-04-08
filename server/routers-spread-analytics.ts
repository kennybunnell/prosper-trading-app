/**
 * Spread Analytics Router
 * Handles fetching and analyzing closed spread positions (IC, BCS, BPS)
 */

import { z } from 'zod';
import { publicProcedure, protectedProcedure, router } from './_core/trpc';
import { authenticateTastytrade } from './tastytrade';
import { getApiCredentials } from './db';
import { getContractMultiplier } from '../shared/orderUtils';

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
 * Parse option leg from transaction
 */
function parseOptionLeg(transaction: any): OptionLeg | null {
  const instType = transaction['instrument-type'];
  const subType = transaction['transaction-sub-type'] || transaction.action;
  
  // Only process Equity Option transactions
  if (instType !== 'Equity Option') {
    return null;
  }
  if (!['Buy to Close', 'Sell to Close', 'Sell to Open', 'Buy to Open'].includes(subType)) {
    return null;
  }
  
  // Parse OCC option symbol format: "NVDA  260227C00205000"
  // Format: [Symbol (6 chars)] [YYMMDD (6 chars)] [C/P (1 char)] [Strike*1000 (8 chars)]
  const occSymbol = transaction.symbol;
  if (!occSymbol || occSymbol.length < 21) {
    console.log(`[parseOptionLeg] Invalid OCC symbol: ${occSymbol}`);
    return null;
  }
  
  const underlyingSymbol = transaction['underlying-symbol'];
  const expirationYYMMDD = occSymbol.substring(6, 12); // "260227"
  const optionType = occSymbol.substring(12, 13) as 'C' | 'P'; // "C" or "P"
  const strikeStr = occSymbol.substring(13, 21); // "00205000"
  const strikePrice = parseInt(strikeStr) / 1000; // 205000 / 1000 = 205.00
  
  // Convert YYMMDD to YYYY-MM-DD
  const year = parseInt('20' + expirationYYMMDD.substring(0, 2));
  const month = expirationYYMMDD.substring(2, 4);
  const day = expirationYYMMDD.substring(4, 6);
  const expiration = `${year}-${month}-${day}`;
  
  const actionMap: Record<string, 'STO' | 'BTO' | 'STC' | 'BTC'> = {
    'Sell to Open': 'STO',
    'Buy to Open': 'BTO',
    'Sell to Close': 'STC',
    'Buy to Close': 'BTC',
  };
  
  return {
    symbol: underlyingSymbol,
    strikePrice,
    optionType,
    expiration,
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
export function groupIntoClosedPositions(transactions: any[]): ClosedSpreadPosition[] {
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
    
    // Debug: Log matching results
    if (matchedPairs.length > 0) {
      console.log(`[Spread Analytics] ${key}: Found ${matchedPairs.length} matched pairs (${openLegs.length} open, ${closeLegs.length} close)`);
      
      // Log first few pairs to see what we're matching
      if (matchedPairs.length >= 2) {
        const sample = matchedPairs.slice(0, 3).map(p => ({
          strike: p.open.strikePrice,
          type: p.open.optionType,
          openAction: p.open.action,
          closeAction: p.close.action,
        }));
        console.log(`[Spread Analytics] ${key}: Sample pairs:`, JSON.stringify(sample));
      } else if (matchedPairs.length === 1) {
        console.log(`[Spread Analytics] ${key}: Only 1 matched pair - not a spread (need 2+ legs)`);
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
      const spreadMultiplier = spreadLegs.length > 0 ? getContractMultiplier(spreadLegs[0].symbol) : 100;
      const maxRisk = spreadWidth * contracts * spreadMultiplier;
      
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
  
  console.log(`[Spread Analytics] FINAL RESULT: Found ${closedPositions.length} closed spread positions`);
  if (closedPositions.length > 0) {
    console.log('[Spread Analytics] Sample closed position:', closedPositions[0]);
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

/**
 * Classify active positions into spreads (matches Performance page logic)
 */
function classifyActiveSpreads(positions: any[]): any[] {
  console.log(`[Active Spreads] Classifying ${positions.length} positions`);
  
  // Filter for option positions only
  const optionPositions = positions.filter(pos => pos['instrument-type'] === 'Equity Option');
  console.log(`[Active Spreads] Found ${optionPositions.length} option positions`);
  
  // Separate short and long positions
  const shortOptions = optionPositions.filter(pos => pos['quantity-direction'] === 'Short');
  const longOptions = optionPositions.filter(pos => pos['quantity-direction'] === 'Long');
  console.log(`[Active Spreads] ${shortOptions.length} short, ${longOptions.length} long`);
  
  // Build a map of long positions by key (underlying + expiration + strike + type)
  const longPositionMap = new Map<string, any>();
  for (const longPos of longOptions) {
    const isPut = longPos.symbol.includes('P');
    const strikeMatch = longPos.symbol.match(/[CP](\d+)/);
    const strike = strikeMatch ? parseFloat(strikeMatch[1]) / 1000 : 0;
    const key = `${longPos['underlying-symbol']}_${longPos['expires-at']}_${strike}_${isPut ? 'P' : 'C'}`;
    longPositionMap.set(key, longPos);
    console.log(`[Active Spreads] Long position key: ${key}`);
  }
  console.log(`[Active Spreads] Built map of ${longPositionMap.size} long positions`);
  
  // Group short positions by underlying + expiration to detect spreads
  const spreadGroups = new Map<string, any[]>();
  
  for (const shortPos of shortOptions) {
    const isPut = shortPos.symbol.includes('P');
    const strikeMatch = shortPos.symbol.match(/[CP](\d+)/);
    const shortStrike = strikeMatch ? parseFloat(strikeMatch[1]) / 1000 : 0;
    const longKey = `${shortPos['underlying-symbol']}_${shortPos['expires-at']}_${shortStrike}_${isPut ? 'P' : 'C'}`;
    console.log(`[Active Spreads] Checking short key: ${longKey}`);
    
    // Check if there's a matching long position (spread)
    const matchingLong = longPositionMap.get(longKey);
    
    if (matchingLong) {
      // This is a spread position
      const groupKey = `${shortPos['underlying-symbol']}_${shortPos['expires-at']}`;
      if (!spreadGroups.has(groupKey)) {
        spreadGroups.set(groupKey, []);
      }
      spreadGroups.get(groupKey)!.push({ short: shortPos, long: matchingLong, isPut });
    }
  }
  
  console.log(`[Active Spreads] Found ${spreadGroups.size} spread groups`);
  
  // Classify each group as Iron Condor, Bear Call Spread, or Bull Put Spread
  const spreads: any[] = [];
  
  for (const [groupKey, legs] of Array.from(spreadGroups.entries())) {
    const [underlying, expiration] = groupKey.split('_');
    
    // Count calls and puts
    const calls = legs.filter(leg => !leg.isPut);
    const puts = legs.filter(leg => leg.isPut);
    
    let spreadType: string;
    let strategy: string;
    
    if (calls.length >= 1 && puts.length >= 1) {
      // Iron Condor (has both calls and puts)
      spreadType = 'Iron Condor';
      strategy = 'IC';
    } else if (calls.length >= 1) {
      // Bear Call Spread (only calls)
      spreadType = 'Bear Call Spread';
      strategy = 'BCS';
    } else if (puts.length >= 1) {
      // Bull Put Spread (only puts)
      spreadType = 'Bull Put Spread';
      strategy = 'BPS';
    } else {
      continue;
    }
    
    // Calculate metrics for the spread
    const firstLeg = legs[0];
    const shortPos = firstLeg.short;
    const longPos = firstLeg.long;
    
    // Parse strikes
    const shortStrikeMatch = shortPos.symbol.match(/[CP](\d+)/);
    const longStrikeMatch = longPos.symbol.match(/[CP](\d+)/);
    const shortStrike = shortStrikeMatch ? parseFloat(shortStrikeMatch[1]) / 1000 : 0;
    const longStrike = longStrikeMatch ? parseFloat(longStrikeMatch[1]) / 1000 : 0;
    
    // Calculate DTE
    const expirationDate = new Date(expiration);
    const today = new Date();
    const dte = Math.ceil((expirationDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    
    // Calculate P/L
    const shortPL = (shortPos['close-price'] - shortPos['average-open-price']) * shortPos.quantity * shortPos.multiplier;
    const longPL = (longPos['close-price'] - longPos['average-open-price']) * longPos.quantity * longPos.multiplier;
    const totalPL = shortPL + longPL;
    
    // Calculate premium (what we collected when opening)
    const shortPremium = Math.abs(shortPos['average-open-price'] * shortPos.quantity * shortPos.multiplier);
    const longPremium = Math.abs(longPos['average-open-price'] * longPos.quantity * longPos.multiplier);
    const netPremium = shortPremium - longPremium;
    
    // Calculate P/L%
    const profitLossPercent = netPremium > 0 ? (totalPL / netPremium) * 100 : 0;
    
    spreads.push({
      id: groupKey,
      symbol: underlying,
      spreadType,
      strategy,
      strike: shortStrike,
      longStrike,
      expiration,
      dte,
      quantity: Math.abs(shortPos.quantity),
      premium: netPremium,
      currentPrice: Math.abs(shortPos['close-price'] - longPos['close-price']),
      profitLoss: totalPL,
      profitLossPercent,
      daysHeld: 0, // TODO: Calculate from created-at
    });
  }
  
  console.log(`[Active Spreads] Classified ${spreads.length} spread positions`);
  return spreads;
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
      
      const api = await authenticateTastytrade(credentials, ctx.user.id);
      
      // Get all accounts
      const accounts = await api.getAccounts();
      if (accounts.length === 0) {
        throw new Error('No accounts found');
      }
      
      // Default date range: last 1 year if not specified
      const endDate = input.endDate || new Date().toISOString().split('T')[0];
      const startDate = input.startDate || new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      
      console.log(`[Spread Analytics] Fetching transactions from ${startDate} to ${endDate} across ${accounts.length} accounts`);
      
      // Fetch transaction history from ALL accounts
      let allTransactions: any[] = [];
      for (const account of accounts) {
        const accountNumber = account.account['account-number'];
        console.log(`[Spread Analytics] Fetching transactions for account ${accountNumber}`);
        const accountTransactions = await api.getTransactionHistory(accountNumber, startDate, endDate);
        console.log(`[Spread Analytics] Account ${accountNumber}: ${accountTransactions.length} transactions`);
        allTransactions = allTransactions.concat(accountTransactions);
      }
      
      const transactions = allTransactions;
      
      console.log(`[Spread Analytics] Fetched ${transactions.length} transactions`);
      
      // Debug: Log first transaction structure to see available fields
      if (transactions.length > 0) {
        const firstOption = transactions.find(t => t['instrument-type'] === 'Equity Option');
        if (firstOption) {
          console.log(`[Spread Analytics] Sample Equity Option transaction fields:`, Object.keys(firstOption));
          console.log(`[Spread Analytics] Sample transaction:`, JSON.stringify(firstOption, null, 2));
        }
      }
      
      // Debug: Log transaction types
      const instrumentTypes = new Map<string, number>();
      const subTypes = new Map<string, number>();
      for (const txn of transactions) {
        const instType = txn['instrument-type'] || 'unknown';
        const subType = txn['transaction-sub-type'] || 'unknown';
        instrumentTypes.set(instType, (instrumentTypes.get(instType) || 0) + 1);
        subTypes.set(subType, (subTypes.get(subType) || 0) + 1);
      }
      console.log(`[Spread Analytics] Instrument types:`, Object.fromEntries(instrumentTypes));
      console.log(`[Spread Analytics] Transaction sub-types:`, Object.fromEntries(subTypes));
      
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
      
      const api = await authenticateTastytrade(credentials, ctx.user.id);
      
      const accounts = await api.getAccounts();
      if (accounts.length === 0) {
        throw new Error('No accounts found');
      }
      
      const endDate = input.endDate || new Date().toISOString().split('T')[0];
      const startDate = input.startDate || new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      
      // Fetch transactions from ALL accounts
      let allTransactions: any[] = [];
      for (const account of accounts) {
        const accountNumber = account.account['account-number'];
        const accountTransactions = await api.getTransactionHistory(accountNumber, startDate, endDate);
        allTransactions = allTransactions.concat(accountTransactions);
      }
      const transactions = allTransactions;
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
      
      const api = await authenticateTastytrade(credentials, ctx.user.id);
      
      const accounts = await api.getAccounts();
      if (accounts.length === 0) {
        throw new Error('No accounts found');
      }
      
      const endDate = input.endDate || new Date().toISOString().split('T')[0];
      const startDate = input.startDate || new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      
      // Fetch transactions from ALL accounts
      let allTransactions: any[] = [];
      for (const account of accounts) {
        const accountNumber = account.account['account-number'];
        const accountTransactions = await api.getTransactionHistory(accountNumber, startDate, endDate);
        allTransactions = allTransactions.concat(accountTransactions);
      }
      const transactions = allTransactions;
      const closedPositions = groupIntoClosedPositions(transactions);
      const metrics = calculateSymbolMetrics(closedPositions);
      
      return metrics;
    }),
  
  /**
   * Get active spread positions (reuses getActivePositions logic)
   */
  getActiveSpreads: protectedProcedure
    .input(z.object({
      accountId: z.string().optional(),
    }))
    .query(async ({ input, ctx }) => {
      console.log('[Active Spreads] Starting getActiveSpreads procedure');
      
      // Import the performance router to reuse its getActivePositions logic
      const { performanceRouter } = await import('./routers-performance');
      
      // Get account ID (default to ALL_ACCOUNTS)
      const accountId = input.accountId || 'ALL_ACCOUNTS';
      console.log(`[Active Spreads] Fetching for account: ${accountId}`);
      
      // Call getActivePositions to get all positions with spread detection already done
      const caller = performanceRouter.createCaller(ctx);
      const result = await caller.getActivePositions({ accountId });
      
      console.log(`[Active Spreads] Retrieved ${result.positions.length} total positions from getActivePositions`);
      
      // Filter for only spread positions (those with spreadType defined)
      const spreads = result.positions.filter(pos => pos.spreadType);
      console.log(`[Active Spreads] Found ${spreads.length} spread positions after filtering`);
      
      // Transform to the format expected by the frontend
      return spreads.map(pos => {
        // Debug: Log spreadType for Unknown cases
        const strategy = pos.spreadType === 'bull_put' ? 'Bull Put Spread' : 
                        pos.spreadType === 'bear_call' ? 'Bear Call Spread' :
                        pos.spreadType === 'iron_condor' ? 'Iron Condor' : 'Unknown';
        
        if (strategy === 'Unknown') {
          console.log(`[Active Spreads] Unknown spread type for ${pos.symbol}: spreadType=${pos.spreadType}, strike=${pos.strike}, longStrike=${pos.longStrike}`);
        }
        
        return {
        symbol: pos.symbol,
        strategy,
        shortStrike: pos.strike,
        longStrike: pos.longStrike!,
        spreadWidth: pos.spreadWidth!,
        underlyingPrice: pos.underlyingPrice, // Underlying stock price
        expiration: pos.expiration,
        dte: pos.dte,
        quantity: pos.quantity,
        premiumReceived: pos.premium,
        currentValue: pos.current,
        profitLoss: pos.premium - pos.current,
        profitLossPercent: pos.realizedPercent,
        capitalAtRisk: pos.capitalAtRisk!,
        roc: pos.capitalAtRisk ? ((pos.premium - pos.current) / pos.capitalAtRisk) * 100 : 0,
        // Iron Condor specific fields
        putShortStrike: pos.putShortStrike,
        putLongStrike: pos.putLongStrike,
        callShortStrike: pos.callShortStrike,
        callLongStrike: pos.callLongStrike,
        };
      });
    }),
});
