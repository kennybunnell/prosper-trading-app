/**
 * Bear Call Spread Pricing Logic
 * Calculates spread opportunities based on CC opportunities
 */

export type CCOpportunity = {
  symbol: string;
  currentPrice: number;
  strike: number;
  expiration: string;
  dte: number;
  delta: number;
  bid: number;
  ask: number;
  mid: number;
  premium: number;
  returnPct: number;
  weeklyReturn: number;
  volume: number;
  openInterest: number;
  spreadPct: number;
  rsi: number | null;
  ivRank: number | null;
  bbPctB: number | null;
  sharesOwned: number;
  maxContracts: number;
  distanceOtm: number;
  score: number;
};

export interface BearCallSpreadOpportunity extends CCOpportunity {
  // Spread-specific fields
  spreadType: 'bear-call';
  spreadWidth: number;
  longStrike: number;
  longPremium: number;
  longBid: number;
  longAsk: number;
  longDelta: number;
  netCredit: number;
  capitalAtRisk: number;
  maxProfit: number;
  maxLoss: number;
  spreadROC: number; // Return on capital at risk
  breakeven: number;
  profitZoneWidth: number;
  comparisonCC: {
    collateral: number;
    premium: number;
    roc: number;
    capitalSavings: number;
    capitalSavingsPct: number;
  };
}

/**
 * Calculate bear call spread pricing from CC opportunity
 * @param ccOpp - The short call (sold) opportunity
 * @param spreadWidth - Width of the spread in points (2, 5, or 10)
 * @param longCallQuote - Quote data for the long (protective) call
 */
export function calculateBearCallSpread(
  ccOpp: CCOpportunity,
  spreadWidth: number,
  longCallQuote: {
    bid: number;
    ask: number;
    delta: number;
  }
): BearCallSpreadOpportunity {
  const shortStrike = ccOpp.strike;
  const longStrike = shortStrike + spreadWidth;
  
  // Net credit = premium received from short call - premium paid for long call
  // Use bid for selling (short call) and ask for buying (long call)
  const shortPremium = ccOpp.bid; // What we receive
  const longPremium = longCallQuote.ask; // What we pay
  const netCredit = shortPremium - longPremium;
  
  // Capital at risk = spread width - net credit received
  const capitalAtRisk = (spreadWidth - netCredit) * 100; // Per contract
  
  // Max profit = net credit received
  const maxProfit = netCredit * 100;
  
  // Max loss = spread width - net credit
  const maxLoss = capitalAtRisk;
  
  // Return on capital = max profit / capital at risk
  const spreadROC = capitalAtRisk > 0 ? (maxProfit / capitalAtRisk) * 100 : 0;
  
  // Breakeven = short strike + net credit
  const breakeven = shortStrike + netCredit;
  
  // Profit zone width = distance from breakeven to current price
  const profitZoneWidth = breakeven - ccOpp.currentPrice;
  
  // CC comparison (for covered calls, collateral is the stock value)
  const ccCollateral = ccOpp.currentPrice * 100; // Stock value for 100 shares
  const ccPremium = shortPremium * 100;
  const ccROC = (ccPremium / ccCollateral) * 100;
  const capitalSavings = ccCollateral - capitalAtRisk;
  const capitalSavingsPct = (capitalSavings / ccCollateral) * 100;
  
  return {
    ...ccOpp,
    // Override premium to show net credit
    premium: netCredit,
    bid: shortPremium,
    ask: ccOpp.ask,
    // Spread-specific fields
    spreadType: 'bear-call',
    spreadWidth,
    longStrike,
    longPremium,
    longBid: longCallQuote.bid,
    longAsk: longCallQuote.ask,
    longDelta: longCallQuote.delta,
    netCredit,
    capitalAtRisk,
    maxProfit,
    maxLoss,
    spreadROC,
    breakeven,
    profitZoneWidth,
    comparisonCC: {
      collateral: ccCollateral,
      premium: ccPremium,
      roc: ccROC,
      capitalSavings,
      capitalSavingsPct,
    },
    // Recalculate percentages based on capital at risk
    returnPct: (netCredit / (capitalAtRisk / 100)) * 100,
    weeklyReturn: ((netCredit / (capitalAtRisk / 100)) * 100 * 7) / ccOpp.dte,
  };
}
