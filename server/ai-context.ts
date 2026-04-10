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
 * context block for any symbol, drawing from the LOCAL DATABASE CACHE.
 *
 * Data flow:
 *   Tastytrade API → portfolio-sync.ts → DB cache (cached_positions, cached_transactions)
 *   DB cache → getSymbolContext() → LLM system prompt
 *
 * This means AI calls are instant (DB read, not API call) and always reflect
 * the most recently synced portfolio state.
 */

import { getCachedPositions, getCachedTransactions } from './portfolio-sync';

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
    tradeCount: number;              // Number of STO transactions
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
  // Whether data came from cache or was unavailable
  dataSource: 'cache' | 'empty';
  cacheAge?: string;
  // Formatted text block ready to inject into LLM system prompt
  contextBlock: string;
}

/**
 * Assemble full portfolio context for a given symbol from the DB cache.
 *
 * Reads from cached_positions and cached_transactions tables — no live API calls.
 * Call syncPortfolio() first to populate the cache (done automatically on login).
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
    // ── Read from DB cache (fast, no API call) ────────────────────────────────
    const [allPositions, allTransactions] = await Promise.all([
      getCachedPositions(userId, symbolUpper),
      getCachedTransactions(userId, symbolUpper),
    ]);

    // ── Stock position ────────────────────────────────────────────────────────
    const stockPos = allPositions.find(
      (p) => p.instrumentType === 'Equity' || p.instrumentType === 'Equity'
    );

    let stockPosition: SymbolContext['stockPosition'] = null;
    if (stockPos) {
      const qty = parseFloat(stockPos.quantity || '0');
      const avgOpen = parseFloat(stockPos.averageOpenPrice || '0');
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

    // ── Open options positions ────────────────────────────────────────────────
    const openOptions: SymbolContext['openOptions'] = allPositions
      .filter((p) => p.instrumentType === 'Equity Option' || p.instrumentType === 'Index Option')
      .map((p) => {
        const sym = (p.symbol || '').trim();
        const strike = parseFloat(p.strikePrice || '0');
        const expiration = p.expiresAt || 'unknown';
        const optType = p.optionType === 'C' ? 'Call' : p.optionType === 'P' ? 'Put' : 'Other';

        return {
          symbol: sym,
          type: optType as 'Put' | 'Call' | 'Other',
          strike,
          expiration,
          quantity: parseFloat(p.quantity || '0'),
          averageOpenPrice: parseFloat(p.averageOpenPrice || '0'),
        };
      });

    // ── Transaction history ───────────────────────────────────────────────────
    // Filter to option transactions only
    const optionTxns = allTransactions.filter(
      (t) => t.instrumentType === 'Equity Option' || t.instrumentType === 'Index Option'
    );

    let totalPremiumCollected = 0;
    let totalPremiumPaid = 0;
    let tradeCount = 0;
    let winCount = 0;
    let lossCount = 0;
    let assignmentCount = 0;
    const recentTrades: SymbolContext['optionHistory']['recentTrades'] = [];

    for (const txn of optionTxns) {
      // Tastytrade stores value as a signed decimal string:
      //   positive = money received (credit, e.g. STO)
      //   negative = money paid (debit, e.g. BTC)
      // The 'value' field is the net cash impact of the transaction.
      const rawValue = parseFloat(txn.value || txn.netValue || '0');
      const action = txn.action || txn.transactionSubType || '';
      const txnType = txn.transactionType || '';
      const description = txn.description || '';
      const date = txn.executedAt
        ? txn.executedAt.toISOString().split('T')[0]
        : '';

      // Positive value = credit (STO, roll credit leg)
      if (rawValue > 0) {
        totalPremiumCollected += rawValue;
        // Count STO as a new trade cycle
        if (
          action === 'Sell to Open' ||
          action === 'STO' ||
          action.toLowerCase().includes('sell to open')
        ) {
          tradeCount++;
        }
      }

      // Negative value = debit (BTC, roll debit leg)
      if (rawValue < 0) {
        totalPremiumPaid += Math.abs(rawValue);
        if (
          action === 'Buy to Close' ||
          action === 'BTC' ||
          action.toLowerCase().includes('buy to close')
        ) {
          // Win: closed for less than 50% of original premium (simplified heuristic)
          if (Math.abs(rawValue) < totalPremiumCollected * 0.5) winCount++;
          else lossCount++;
        }
      }

      // Assignments / exercises
      if (
        txnType === 'Receive Deliver' ||
        description.toLowerCase().includes('assignment') ||
        description.toLowerCase().includes('exercise')
      ) {
        assignmentCount++;
      }

      // Collect recent trades (most recent 10)
      if (recentTrades.length < 10 && date) {
        recentTrades.push({
          date,
          action: action || txnType,
          description: description.slice(0, 80),
          value: Math.abs(rawValue),
          type: rawValue >= 0 ? 'credit' : 'debit',
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

    const dataSource = (allPositions.length > 0 || allTransactions.length > 0) ? 'cache' : 'empty';

    // ── Build the context block for LLM injection ─────────────────────────────
    const contextBlock = buildContextBlock(symbolUpper, stockPosition, openOptions, optionHistory, dataSource);

    return {
      symbol: symbolUpper,
      stockPosition,
      openOptions,
      optionHistory,
      dataSource,
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
  history: SymbolContext['optionHistory'],
  dataSource: 'cache' | 'empty'
): string {
  const lines: string[] = [
    `=== FULL PORTFOLIO CONTEXT FOR ${symbol} ===`,
    `Data source: ${dataSource === 'cache' ? 'Local DB cache (fast, current as of last sync)' : 'Cache empty — sync may be needed'}`,
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
    lines.push('STOCK POSITION: No equity position found in cache for this symbol.');
    lines.push('  NOTE: If this is a covered call, the stock position may not have synced yet.');
    lines.push('  Recommend the user trigger a portfolio sync from the dashboard.');
    lines.push('');
  }

  // Options income history
  lines.push('OPTIONS INCOME HISTORY (from DB cache):');
  if (history.tradeCount > 0 || history.totalPremiumCollected > 0) {
    lines.push(`  Total premium collected (all STO/rolls): $${history.totalPremiumCollected.toFixed(2)}`);
    lines.push(`  Total premium paid to close (BTC): $${history.totalPremiumPaid.toFixed(2)}`);
    lines.push(`  Net premium income: $${history.netPremiumIncome.toFixed(2)}`);
    if (stock && stock.averageOpenPrice > 0) {
      lines.push(`  Effective cost basis after premiums: $${history.effectiveCostBasis.toFixed(2)}/share`);
      const reduction = ((stock.averageOpenPrice - history.effectiveCostBasis) / stock.averageOpenPrice * 100);
      lines.push(`  Premium income has reduced cost basis by ${reduction.toFixed(1)}%`);
    }
    lines.push(`  Option cycles opened (STO count): ${history.tradeCount}`);
    if (history.winCount + history.lossCount > 0) {
      lines.push(`  Win/Loss on closed trades: ${history.winCount}W / ${history.lossCount}L`);
    }
    if (history.assignmentCount > 0) {
      lines.push(`  Assignments/exercises: ${history.assignmentCount}`);
    }
  } else {
    lines.push('  No option transactions found in cache for this symbol.');
    lines.push('  This may mean: (1) no history exists, or (2) portfolio sync has not run yet.');
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
    lines.push('CURRENTLY OPEN OPTIONS (from cache):');
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
    dataSource: 'empty',
    contextBlock: `=== PORTFOLIO CONTEXT FOR ${symbol} ===\n${msg}\n=== END ===`,
  };
}
