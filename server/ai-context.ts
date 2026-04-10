/**
 * AI Context Assembler — Prosper Trading
 *
 * Prosper AI Philosophy:
 * AI should never just summarize what's already on screen.
 * It should pull from the full portfolio context — cost basis, transaction history,
 * position P&L, watchlist, trade patterns — and return insights the trader
 * cannot easily compute themselves.
 *
 * This module provides getSymbolContext() which assembles a rich, structured
 * context block for any symbol, drawing from ALL available data sources.
 * This context is injected into every LLM call so the AI can answer deep
 * portfolio questions, not just describe the current view.
 */



export interface SymbolContext {
  symbol: string;
  // Stock position data
  stockPosition: {
    quantity: number;
    averageOpenPrice: number;
    currentPrice?: number;
    unrealizedPnl?: number;
    unrealizedPnlPercent?: number;
    totalCostBasis: number;
  } | null;
  // Options positions currently open for this symbol
  openOptions: Array<{
    symbol: string;
    type: 'Put' | 'Call' | 'Other';
    strike: number;
    expiration: string;
    quantity: number;
    averageOpenPrice: number;
  }>;
  // Historical options transactions for this symbol
  optionHistory: {
    totalPremiumCollected: number;   // Sum of all credits received (STO + rolls)
    totalPremiumPaid: number;        // Sum of all debits paid (BTC + closing)
    netPremiumIncome: number;        // totalPremiumCollected - totalPremiumPaid
    effectiveCostBasis: number;      // stockCostBasis - netPremiumIncome (per share)
    tradeCount: number;              // Number of completed option cycles
    winCount: number;                // Trades closed for profit
    lossCount: number;               // Trades closed for loss
    assignmentCount: number;         // Times assigned/exercised
    recentTrades: Array<{
      date: string;
      action: string;
      description: string;
      value: number;
      type: 'credit' | 'debit';
    }>;
  };
  // Formatted text block ready to inject into LLM system prompt
  contextBlock: string;
}

/**
 * Assemble full portfolio context for a given symbol.
 * Fetches cost basis, transaction history, open positions, and computes
 * derived metrics (effective cost basis, total premium income, win rate).
 *
 * @param userId - The authenticated user's DB id
 * @param symbol - The underlying stock symbol (e.g. 'APLD', 'MSFT')
 * @param currentStockPrice - Optional current stock price for P&L calculation
 */
export async function getSymbolContext(
  userId: number,
  symbol: string,
  currentStockPrice?: number
): Promise<SymbolContext> {
  const symbolUpper = symbol.toUpperCase();

  try {
    const { getApiCredentials } = await import('./db');
    const { authenticateTastytrade } = await import('./tastytrade');

    const credentials = await getApiCredentials(userId);
    if (!credentials) {
      return buildEmptyContext(symbolUpper, 'No API credentials configured');
    }

    const tt = await authenticateTastytrade(credentials, userId);
    if (!tt) {
      return buildEmptyContext(symbolUpper, 'Failed to authenticate with Tastytrade');
    }

    // Get accounts
    const accounts = await tt.getAccounts();
    const accountNumbers: string[] = accounts
      .map((acc: any) => acc.account?.['account-number'] || acc['account-number'] || acc.accountNumber)
      .filter(Boolean);

    if (accountNumbers.length === 0) {
      return buildEmptyContext(symbolUpper, 'No accounts found');
    }

    const accountNumber = accountNumbers[0];

    // Fetch in parallel: positions + transaction history (last 2 years)
    const today = new Date();
    const twoYearsAgo = new Date(today);
    twoYearsAgo.setFullYear(today.getFullYear() - 2);
    const startDate = twoYearsAgo.toISOString().split('T')[0];
    const endDate = today.toISOString().split('T')[0];

    const [allPositions, allTransactions] = await Promise.all([
      tt.getPositions(accountNumber).catch(() => [] as any[]),
      tt.getTransactionHistory(accountNumber, startDate, endDate).catch(() => [] as any[]),
    ]);

    // --- Stock position ---
    const stockPos = allPositions.find(
      (p: any) => p['underlying-symbol'] === symbolUpper && p['instrument-type'] === 'Equity'
    );

    let stockPosition: SymbolContext['stockPosition'] = null;
    if (stockPos) {
      const qty = stockPos.quantity;
      const avgOpen = parseFloat(stockPos['average-open-price'] || '0');
      const totalCostBasis = qty * avgOpen;
      const unrealizedPnl = currentStockPrice
        ? (currentStockPrice - avgOpen) * qty
        : undefined;
      const unrealizedPnlPercent = currentStockPrice && avgOpen > 0
        ? ((currentStockPrice - avgOpen) / avgOpen) * 100
        : undefined;

      stockPosition = {
        quantity: qty,
        averageOpenPrice: avgOpen,
        currentPrice: currentStockPrice,
        unrealizedPnl,
        unrealizedPnlPercent,
        totalCostBasis,
      };
    }

    // --- Open options positions ---
    const openOptions: SymbolContext['openOptions'] = allPositions
      .filter(
        (p: any) =>
          p['underlying-symbol'] === symbolUpper &&
          p['instrument-type'] === 'Equity Option'
      )
      .map((p: any) => {
        const sym = p.symbol || '';
        // Parse OCC symbol: AAPL  250117C00200000
        const occMatch = sym.match(/([A-Z\s]+)(\d{6})([CP])(\d{8})/);
        const strike = occMatch ? parseInt(occMatch[4]) / 1000 : 0;
        const expRaw = occMatch ? occMatch[2] : '';
        const expiration = expRaw
          ? `20${expRaw.slice(0, 2)}-${expRaw.slice(2, 4)}-${expRaw.slice(4, 6)}`
          : 'unknown';
        const optType = occMatch?.[3] === 'C' ? 'Call' : occMatch?.[3] === 'P' ? 'Put' : 'Other';

        return {
          symbol: sym.trim(),
          type: optType as 'Put' | 'Call' | 'Other',
          strike,
          expiration,
          quantity: p.quantity,
          averageOpenPrice: parseFloat(p['average-open-price'] || '0'),
        };
      });

    // --- Transaction history for this symbol ---
    const symbolTxns: any[] = allTransactions.filter(
      (t: any) =>
        (t['underlying-symbol'] === symbolUpper ||
          t.symbol === symbolUpper ||
          (t.symbol && (t.symbol as string).startsWith(symbolUpper))) &&
        t['instrument-type'] === 'Equity Option'
    );

    let totalPremiumCollected = 0;
    let totalPremiumPaid = 0;
    let tradeCount = 0;
    let winCount = 0;
    let lossCount = 0;
    let assignmentCount = 0;
    const recentTrades: SymbolContext['optionHistory']['recentTrades'] = [];

    for (const txn of symbolTxns as any[]) {
      const value = parseFloat(txn['value'] || txn['net-value'] || '0');
      const effect = txn['value-effect'] || txn['net-value-effect'] || '';
      const action = txn['action'] || txn['transaction-sub-type'] || '';
      const txnType = txn['transaction-type'] || '';
      const description = txn['description'] || '';
      const date = txn['executed-at'] || txn['transaction-date'] || '';

      // Credits (STO, roll open leg)
      if (effect === 'Credit') {
        totalPremiumCollected += Math.abs(value);
        if (action === 'Sell to Open' || action === 'STO') tradeCount++;
      }
      // Debits (BTC, roll close leg)
      if (effect === 'Debit') {
        totalPremiumPaid += Math.abs(value);
        if (action === 'Buy to Close' || action === 'BTC') {
          // Determine win/loss: if we collected more than we paid, it's a win
          // (simplified — a full win/loss calc needs to match open/close pairs)
          if (value < totalPremiumCollected * 0.5) winCount++;
          else lossCount++;
        }
      }
      // Assignments
      if (
        txnType === 'Receive Deliver' ||
        description.toLowerCase().includes('assignment') ||
        description.toLowerCase().includes('exercise')
      ) {
        assignmentCount++;
      }

      // Collect recent trades (last 10)
      if (recentTrades.length < 10 && date) {
        recentTrades.push({
          date: date.split('T')[0],
          action: action || txnType,
          description: description.slice(0, 80),
          value: Math.abs(value),
          type: effect === 'Credit' ? 'credit' : 'debit',
        });
      }
    }

    const netPremiumIncome = totalPremiumCollected - totalPremiumPaid;
    const effectiveCostBasis = stockPosition
      ? stockPosition.averageOpenPrice - (netPremiumIncome / Math.max(stockPosition.quantity, 1))
      : 0;

    const optionHistory: SymbolContext['optionHistory'] = {
      totalPremiumCollected,
      totalPremiumPaid,
      netPremiumIncome,
      effectiveCostBasis,
      tradeCount,
      winCount,
      lossCount,
      assignmentCount,
      recentTrades: recentTrades.sort((a, b) => b.date.localeCompare(a.date)),
    };

    // --- Build the context block for LLM injection ---
    const contextBlock = buildContextBlock(symbolUpper, stockPosition, openOptions, optionHistory);

    return {
      symbol: symbolUpper,
      stockPosition,
      openOptions,
      optionHistory,
      contextBlock,
    };
  } catch (err: any) {
    console.error(`[AI Context] Failed to assemble context for ${symbolUpper}:`, err.message);
    return buildEmptyContext(symbolUpper, err.message);
  }
}

function buildContextBlock(
  symbol: string,
  stock: SymbolContext['stockPosition'],
  options: SymbolContext['openOptions'],
  history: SymbolContext['optionHistory']
): string {
  const lines: string[] = [
    `=== FULL PORTFOLIO CONTEXT FOR ${symbol} ===`,
    '',
  ];

  // Stock position
  if (stock) {
    const pnlStr = stock.unrealizedPnl !== undefined
      ? `${stock.unrealizedPnl >= 0 ? '+' : ''}$${stock.unrealizedPnl.toFixed(2)} (${stock.unrealizedPnlPercent?.toFixed(1)}%)`
      : 'unknown (no current price)';
    lines.push('STOCK POSITION:');
    lines.push(`  Shares owned: ${stock.quantity}`);
    lines.push(`  Average acquisition price: $${stock.averageOpenPrice.toFixed(2)}/share`);
    lines.push(`  Total cost basis: $${stock.totalCostBasis.toFixed(2)}`);
    if (stock.currentPrice) {
      lines.push(`  Current price: $${stock.currentPrice.toFixed(2)}`);
      lines.push(`  Unrealized P&L on shares: ${pnlStr}`);
    }
    lines.push('');
  } else {
    lines.push('STOCK POSITION: No equity position found for this symbol.');
    lines.push('');
  }

  // Options income history
  lines.push('OPTIONS INCOME HISTORY (last 2 years):');
  if (history.tradeCount > 0 || history.totalPremiumCollected > 0) {
    lines.push(`  Total premium collected (all STO/rolls): $${history.totalPremiumCollected.toFixed(2)}`);
    lines.push(`  Total premium paid to close (BTC): $${history.totalPremiumPaid.toFixed(2)}`);
    lines.push(`  Net premium income: $${history.netPremiumIncome.toFixed(2)}`);
    if (stock && stock.averageOpenPrice > 0) {
      lines.push(`  Effective cost basis after premiums: $${history.effectiveCostBasis.toFixed(2)}/share`);
      const reduction = ((stock.averageOpenPrice - history.effectiveCostBasis) / stock.averageOpenPrice * 100);
      lines.push(`  Premium income has reduced cost basis by ${reduction.toFixed(1)}%`);
    }
    lines.push(`  Option cycles completed: ${history.tradeCount}`);
    if (history.winCount + history.lossCount > 0) {
      lines.push(`  Win/Loss: ${history.winCount}W / ${history.lossCount}L`);
    }
    if (history.assignmentCount > 0) {
      lines.push(`  Assignments/exercises: ${history.assignmentCount}`);
    }
  } else {
    lines.push('  No option transaction history found for this symbol in the last 2 years.');
  }
  lines.push('');

  // Recent trades
  if (history.recentTrades.length > 0) {
    lines.push('RECENT OPTION TRANSACTIONS (most recent first):');
    for (const t of history.recentTrades.slice(0, 8)) {
      const sign = t.type === 'credit' ? '+' : '-';
      lines.push(`  ${t.date} | ${t.action} | ${sign}$${t.value.toFixed(2)} | ${t.description}`);
    }
    lines.push('');
  }

  // Open options
  if (options.length > 0) {
    lines.push('CURRENTLY OPEN OPTIONS:');
    for (const o of options) {
      lines.push(`  ${o.type} $${o.strike} exp ${o.expiration} | qty: ${o.quantity} | avg open: $${o.averageOpenPrice.toFixed(2)}`);
    }
    lines.push('');
  }

  lines.push('=== END PORTFOLIO CONTEXT ===');
  return lines.join('\n');
}

function buildEmptyContext(symbol: string, reason?: string): SymbolContext {
  const msg = reason ? `Portfolio context unavailable: ${reason}` : 'Portfolio context unavailable.';
  return {
    symbol,
    stockPosition: null,
    openOptions: [],
    optionHistory: {
      totalPremiumCollected: 0,
      totalPremiumPaid: 0,
      netPremiumIncome: 0,
      effectiveCostBasis: 0,
      tradeCount: 0,
      winCount: 0,
      lossCount: 0,
      assignmentCount: 0,
      recentTrades: [],
    },
    contextBlock: `=== PORTFOLIO CONTEXT FOR ${symbol} ===\n${msg}\n=== END ===`,
  };
}
