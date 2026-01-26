/**
 * Performance Overview Utilities
 * Handles transaction aggregation, option symbol parsing, and performance calculations
 */

export interface Transaction {
  'transaction-type': string;
  symbol?: string;
  action?: string;
  value: string | number;
  'executed-at'?: string;
  'underlying-symbol'?: string;
  [key: string]: any;
}

export interface MonthlyData {
  month: number;
  year: number;
  monthName: string;
  monthKey: string;
  cspCredits: number;
  cspDebits: number;
  ccCredits: number;
  ccDebits: number;
  cspNet: number;
  ccNet: number;
  totalNet: number;
  cspTrades: number;
  ccTrades: number;
  assignments: number;
  calledAway: number;
}

export interface SymbolPerformance {
  symbol: string;
  trades: number;
  netPremium: number;
  wins: number;
  losses: number;
  winRate: number;
  avgPremiumPerTrade: number;
  cspTrades: number;
  ccTrades: number;
  cspNet: number;
  ccNet: number;
}

export interface PerformanceMetrics {
  totalTrades: number;
  closedTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  bestMonth: { month: string; value: number } | null;
  worstMonth: { month: string; value: number } | null;
  totalWinAmount: number;
  totalLossAmount: number;
}

/**
 * Parse OCC option symbol to extract option type (PUT/CALL)
 * Format: SYMBOL (6 chars padded) + YYMMDD + C/P + Strike (8 digits)
 * Example: "SPY   260117P00580000" -> PUT
 */
export function parseOptionType(symbol: string): 'PUT' | 'CALL' | null {
  if (!symbol || symbol.length < 10) return null;

  // Remove spaces and find C or P indicator
  const cleanSymbol = symbol.replace(/\s+/g, '');
  
  // Look for C or P after the date portion (position 6-12)
  for (let i = 6; i < cleanSymbol.length && i < 15; i++) {
    const char = cleanSymbol[i];
    if (char === 'C') return 'CALL';
    if (char === 'P') return 'PUT';
  }

  return null;
}

/**
 * Parse full option symbol details
 */
export function parseOptionSymbol(symbol: string): {
  underlying: string;
  expiration: string;
  optionType: 'PUT' | 'CALL';
  strike: number;
} | null {
  try {
    const cleanSymbol = symbol.replace(/\s+/g, '');
    const match = cleanSymbol.match(/^([A-Z]+)(\d{6})([CP])(\d+)$/);
    
    if (!match) return null;

    const underlying = match[1];
    const dateStr = match[2];
    const optionType = match[3] === 'P' ? 'PUT' : 'CALL';
    const strike = parseInt(match[4]) / 1000;

    const year = 2000 + parseInt(dateStr.substring(0, 2));
    const month = dateStr.substring(2, 4);
    const day = dateStr.substring(4, 6);
    const expiration = `${year}-${month}-${day}`;

    return { underlying, expiration, optionType, strike };
  } catch {
    return null;
  }
}

/**
 * Aggregate transactions by month
 */
export function aggregateMonthlyData(transactions: Transaction[]): MonthlyData[] {
  const monthlyTotals = new Map<string, {
    month: number;
    year: number;
    cspCredits: number;
    cspDebits: number;
    ccCredits: number;
    ccDebits: number;
    cspTrades: number;
    ccTrades: number;
    assignments: number;
    calledAway: number;
  }>();

  for (const txn of transactions) {
    const txnType = txn['transaction-type'] || '';
    const symbol = txn.symbol || '';
    const action = txn.action || '';
    const value = Math.abs(parseFloat(String(txn.value || 0)));
    const executedAt = txn['executed-at'] || '';

    if (!executedAt) continue;

    // Parse date
    let txnDate: Date;
    try {
      txnDate = new Date(executedAt.replace('Z', '+00:00'));
    } catch {
      continue;
    }

    const month = txnDate.getMonth() + 1; // 1-12
    const year = txnDate.getFullYear();
    const monthKey = `${year}-${String(month).padStart(2, '0')}`;

    // Initialize month if not exists
    if (!monthlyTotals.has(monthKey)) {
      monthlyTotals.set(monthKey, {
        month,
        year,
        cspCredits: 0,
        cspDebits: 0,
        ccCredits: 0,
        ccDebits: 0,
        cspTrades: 0,
        ccTrades: 0,
        assignments: 0,
        calledAway: 0,
      });
    }

    const monthData = monthlyTotals.get(monthKey)!;

    // Determine option type
    const optionType = parseOptionType(symbol);
    if (!optionType) continue;

    // Track trades
    if (txnType === 'Trade') {
      if (action === 'Sell to Open') {
        if (optionType === 'PUT') {
          monthData.cspCredits += value;
          monthData.cspTrades += 1;
        } else if (optionType === 'CALL') {
          monthData.ccCredits += value;
          monthData.ccTrades += 1;
        }
      } else if (action === 'Buy to Close') {
        if (optionType === 'PUT') {
          monthData.cspDebits += value;
        } else if (optionType === 'CALL') {
          monthData.ccDebits += value;
        }
      }
    }
    // Track assignments and called away
    else if (txnType === 'Receive Deliver') {
      if (optionType === 'PUT' && (action === 'Buy' || action === 'Receive')) {
        monthData.assignments += 1;
      } else if (optionType === 'CALL' && (action === 'Sell' || action === 'Deliver')) {
        monthData.calledAway += 1;
      }
    }
  }

  // Convert to array and sort (newest to oldest)
  const results: MonthlyData[] = [];
  const sortedKeys = Array.from(monthlyTotals.keys()).sort((a, b) => b.localeCompare(a));

  for (const monthKey of sortedKeys) {
    const data = monthlyTotals.get(monthKey)!;
    
    const cspNet = data.cspCredits - data.cspDebits;
    const ccNet = data.ccCredits - data.ccDebits;
    const totalNet = cspNet + ccNet;

    // Only include months with actual data
    if (data.cspCredits > 0 || data.ccCredits > 0) {
      const monthDate = new Date(data.year, data.month - 1, 1);
      const monthName = monthDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

      results.push({
        month: data.month,
        year: data.year,
        monthName,
        monthKey,
        cspCredits: data.cspCredits,
        cspDebits: data.cspDebits,
        ccCredits: data.ccCredits,
        ccDebits: data.ccDebits,
        cspNet,
        ccNet,
        totalNet,
        cspTrades: data.cspTrades,
        ccTrades: data.ccTrades,
        assignments: data.assignments,
        calledAway: data.calledAway,
      });
    }
  }

  return results;
}

/**
 * Aggregate performance by symbol
 */
export function aggregateBySymbol(transactions: Transaction[]): SymbolPerformance[] {
  const symbolData = new Map<string, {
    openTrades: Map<string, { value: number; type: 'CSP' | 'CC' }>;
    closedTrades: Array<{ profit: number; type: 'CSP' | 'CC' }>;
    cspTrades: number;
    ccTrades: number;
    cspNet: number;
    ccNet: number;
  }>();

  // Process transactions chronologically
  const sortedTxns = [...transactions].sort((a, b) => {
    const dateA = new Date(a['executed-at'] || 0).getTime();
    const dateB = new Date(b['executed-at'] || 0).getTime();
    return dateA - dateB;
  });

  for (const txn of sortedTxns) {
    const txnType = txn['transaction-type'] || '';
    const symbol = txn.symbol || '';
    const action = txn.action || '';
    const value = parseFloat(String(txn.value || 0));

    if (txnType !== 'Trade') continue;

    const optionDetails = parseOptionSymbol(symbol);
    if (!optionDetails) continue;

    const underlying = optionDetails.underlying;
    const optionType = optionDetails.optionType;
    const strategyType = optionType === 'PUT' ? 'CSP' : 'CC';

    // Initialize symbol if not exists
    if (!symbolData.has(underlying)) {
      symbolData.set(underlying, {
        openTrades: new Map(),
        closedTrades: [],
        cspTrades: 0,
        ccTrades: 0,
        cspNet: 0,
        ccNet: 0,
      });
    }

    const data = symbolData.get(underlying)!;

    if (action === 'Sell to Open') {
      // Opening trade - store the credit received
      data.openTrades.set(symbol, { value: Math.abs(value), type: strategyType });
      if (strategyType === 'CSP') {
        data.cspTrades += 1;
        data.cspNet += Math.abs(value);
      } else {
        data.ccTrades += 1;
        data.ccNet += Math.abs(value);
      }
    } else if (action === 'Buy to Close') {
      // Closing trade - calculate profit/loss
      const openTrade = data.openTrades.get(symbol);
      if (openTrade) {
        const profit = openTrade.value - Math.abs(value);
        data.closedTrades.push({ profit, type: openTrade.type });
        data.openTrades.delete(symbol);

        if (strategyType === 'CSP') {
          data.cspNet -= Math.abs(value);
        } else {
          data.ccNet -= Math.abs(value);
        }
      }
    }
  }

  // Convert to array with calculated metrics
  const results: SymbolPerformance[] = [];
  
  for (const [symbol, data] of Array.from(symbolData.entries())) {
    const wins = data.closedTrades.filter((t: { profit: number; type: 'CSP' | 'CC' }) => t.profit > 0).length;
    const losses = data.closedTrades.filter((t: { profit: number; type: 'CSP' | 'CC' }) => t.profit <= 0).length;
    const totalClosed = wins + losses;
    const winRate = totalClosed > 0 ? (wins / totalClosed) * 100 : 0;

    const totalTrades = data.cspTrades + data.ccTrades;
    const netPremium = data.cspNet + data.ccNet;
    const avgPremiumPerTrade = totalTrades > 0 ? netPremium / totalTrades : 0;

    if (totalTrades > 0) {
      results.push({
        symbol,
        trades: totalTrades,
        netPremium,
        wins,
        losses,
        winRate,
        avgPremiumPerTrade,
        cspTrades: data.cspTrades,
        ccTrades: data.ccTrades,
        cspNet: data.cspNet,
        ccNet: data.ccNet,
      });
    }
  }

  // Sort by net premium (descending)
  results.sort((a, b) => b.netPremium - a.netPremium);

  return results;
}

/**
 * Calculate overall performance metrics
 */
export function calculatePerformanceMetrics(
  transactions: Transaction[],
  monthlyData: MonthlyData[]
): PerformanceMetrics {
  const symbolPerf = aggregateBySymbol(transactions);

  let totalWins = 0;
  let totalLosses = 0;
  let totalWinAmount = 0;
  let totalLossAmount = 0;

  for (const symbol of symbolPerf) {
    totalWins += symbol.wins;
    totalLosses += symbol.losses;
  }

  // Calculate win/loss amounts from monthly data
  for (const month of monthlyData) {
    const monthNet = month.totalNet;
    if (monthNet > 0) {
      totalWinAmount += monthNet;
    } else if (monthNet < 0) {
      totalLossAmount += Math.abs(monthNet);
    }
  }

  const totalClosed = totalWins + totalLosses;
  const winRate = totalClosed > 0 ? (totalWins / totalClosed) * 100 : 0;
  const avgWin = totalWins > 0 ? totalWinAmount / totalWins : 0;
  const avgLoss = totalLosses > 0 ? totalLossAmount / totalLosses : 0;
  const profitFactor = totalLossAmount > 0 ? totalWinAmount / totalLossAmount : totalWinAmount > 0 ? 999 : 0;

  // Find best and worst months
  let bestMonth: { month: string; value: number } | null = null;
  let worstMonth: { month: string; value: number } | null = null;

  for (const month of monthlyData) {
    if (!bestMonth || month.totalNet > bestMonth.value) {
      bestMonth = { month: month.monthName, value: month.totalNet };
    }
    if (!worstMonth || month.totalNet < worstMonth.value) {
      worstMonth = { month: month.monthName, value: month.totalNet };
    }
  }

  const totalTrades = monthlyData.reduce((sum, m) => sum + m.cspTrades + m.ccTrades, 0);

  return {
    totalTrades,
    closedTrades: totalClosed,
    wins: totalWins,
    losses: totalLosses,
    winRate,
    avgWin,
    avgLoss,
    profitFactor,
    bestMonth,
    worstMonth,
    totalWinAmount,
    totalLossAmount,
  };
}
