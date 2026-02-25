/**
 * Risk Badge System Types
 * Defines badge types and risk assessment for trading opportunities
 */

export type RiskBadgeType = 
  | 'extreme-volatility'
  | 'below-support'
  | 'earnings-soon'
  | 'earnings-this-week'
  | 'momentum-reversal'
  | 'blue-chip';

export interface RiskBadge {
  type: RiskBadgeType;
  label: string;
  tooltip: string;
  severity: 'positive' | 'warning' | 'danger';
  emoji: string;
}

export interface EarningsDate {
  symbol: string;
  date: string; // ISO date string
  daysUntil: number;
}

export interface RiskAssessment {
  symbol: string;
  badges: RiskBadge[];
  overallRisk: 'low' | 'medium' | 'high' | 'extreme';
}

/**
 * Magnificent 7 stocks (large-cap tech leaders)
 */
export const MAG_7 = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA'];

/**
 * S&P 100 stocks (largest US companies)
 * Subset of most liquid, high market cap stocks
 */
export const SP_100 = [
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'BRK.B', 'JPM', 'JNJ',
  'V', 'UNH', 'XOM', 'PG', 'MA', 'HD', 'CVX', 'MRK', 'ABBV', 'PEP',
  'COST', 'KO', 'AVGO', 'WMT', 'MCD', 'CSCO', 'ACN', 'LLY', 'TMO', 'ABT',
  'DHR', 'NKE', 'DIS', 'VZ', 'ADBE', 'NFLX', 'CRM', 'TXN', 'PM', 'CMCSA',
  'NEE', 'UPS', 'RTX', 'ORCL', 'HON', 'INTC', 'QCOM', 'T', 'INTU', 'IBM',
  'AMD', 'AMGN', 'BA', 'CAT', 'GE', 'SBUX', 'LOW', 'SPGI', 'BLK', 'AXP',
  'DE', 'MDLZ', 'GILD', 'PLD', 'MMM', 'TJX', 'BKNG', 'SYK', 'ADI', 'CI',
  'AMT', 'ISRG', 'ZTS', 'CB', 'MO', 'LRCX', 'CVS', 'DUK', 'SO', 'PGR',
  'TGT', 'USB', 'BDX', 'REGN', 'CL', 'MMC', 'EOG', 'NSC', 'BSX', 'ITW',
  'HCA', 'APD', 'GD', 'SHW', 'CME', 'AON', 'EL', 'ICE', 'MCO', 'FCX'
];

/**
 * Major Financial Institutions (blue-chip banks, investment firms)
 */
export const MAJOR_FINANCIALS = [
  'GS', 'MS', 'C', 'BAC', 'WFC', 'SCHW', 'BX', 'KKR', 'COF', 'PNC',
  'TFC', 'GS', 'MS', 'MUFG', 'TD', 'RY', 'BMO', 'BNS', 'CM'
];

/**
 * Create risk badge based on type
 */
export function createRiskBadge(type: RiskBadgeType, customTooltip?: string): RiskBadge {
  switch (type) {
    case 'extreme-volatility':
      return {
        type,
        label: 'High Vol',
        tooltip: customTooltip || 'This stock has extreme volatility (IV Rank > 70%). Assignment risk is high. Consider spreads instead.',
        severity: 'danger',
        emoji: '🔴',
      };
    
    case 'below-support':
      return {
        type,
        label: 'Below Support',
        tooltip: customTooltip || 'Stock is significantly below 52-week high (< 40%). May continue falling if assigned.',
        severity: 'danger',
        emoji: '📉',
      };
    
    case 'earnings-soon':
      return {
        type,
        label: 'Earnings Soon',
        tooltip: customTooltip || 'Earnings announcement within 14 days. Expect increased volatility and gap risk.',
        severity: 'warning',
        emoji: '📊',
      };
    
    case 'earnings-this-week':
      return {
        type,
        label: 'Earnings This Week',
        tooltip: customTooltip || 'Earnings announcement within 7 days. Extreme volatility and gap risk. Avoid new positions.',
        severity: 'danger',
        emoji: '📊',
      };
    
    case 'momentum-reversal':
      return {
        type,
        label: 'Downtrend',
        tooltip: customTooltip || 'Recent 20-day momentum turned negative. Assignment risk elevated.',
        severity: 'warning',
        emoji: '⚡',
      };
    
    case 'blue-chip':
      return {
        type,
        label: 'Blue Chip',
        tooltip: customTooltip || 'Large-cap, liquid, assignment-worthy stock. Lower risk for Wheel strategy.',
        severity: 'positive',
        emoji: '✅',
      };
    
    default:
      throw new Error(`Unknown risk badge type: ${type}`);
  }
}

/**
 * Calculate overall risk level based on badges
 */
export function calculateOverallRisk(badges: RiskBadge[]): 'low' | 'medium' | 'high' | 'extreme' {
  const dangerCount = badges.filter(b => b.severity === 'danger').length;
  const warningCount = badges.filter(b => b.severity === 'warning').length;
  const positiveCount = badges.filter(b => b.severity === 'positive').length;
  const hasEarnings = badges.some(b => b.type === 'earnings-soon' || b.type === 'earnings-this-week');
  
  // Extreme risk: 2+ danger badges
  if (dangerCount >= 2) return 'extreme';
  
  // High risk: 1 danger badge
  if (dangerCount >= 1) return 'high';
  
  // High risk: earnings warning (even with positive badges)
  if (hasEarnings) return 'high';
  
  // Medium risk: 2+ warning badges
  if (warningCount >= 2) return 'medium';
  
  // Medium risk: 1 warning badge and no positive badges
  if (warningCount >= 1 && positiveCount === 0) return 'medium';
  
  // Low risk: positive badges or minimal warnings
  return 'low';
}
