/**
 * Canonical list of index / broad-market ETF symbols.
 * Used by the watchlist system to auto-tag entries as index instruments
 * and by the Spread Advisor to route them to the index scoring path.
 *
 * Symbols are grouped by category for documentation purposes.
 * All comparisons should be done case-insensitively.
 */

/** S&P 500 family */
const SP500 = ['SPX', 'SPXW', 'SPXPM', 'XSP', 'NANOS', 'SPY', 'SPXL', 'SPXS', 'SSO', 'SDS', 'UPRO', 'SPXU'];

/** Nasdaq family */
const NASDAQ = ['NDX', 'XND', 'QQQ', 'TQQQ', 'SQQQ', 'QLD', 'QID', 'QQQM'];

/** Russell 2000 family */
const RUSSELL = ['RUT', 'MRUT', 'IWM', 'TNA', 'TZA', 'UWM', 'TWM'];

/** Dow Jones family */
const DOW = ['DJX', 'DIA', 'DDM', 'DXD'];

/** Volatility indexes */
const VOLATILITY = ['VIX', 'VIXW', 'VXX', 'VIXY', 'UVXY', 'SVXY', 'VIXM', 'VVIX'];

/** International / broad market */
const INTERNATIONAL = ['MXEA', 'MXEF', 'EFA', 'EEM', 'VEA', 'VWO'];

/** S&P 100 / legacy */
const SP100 = ['OEX', 'XEO'];

/** Sector ETFs commonly traded as index proxies */
const SECTOR_ETF = ['XLK', 'XLF', 'XLE', 'XLV', 'XLI', 'XLP', 'XLU', 'XLB', 'XLRE', 'XLC', 'XLY'];

/** Bond / rate indexes */
const BOND = ['TNX', 'TLT', 'TBT', 'IEF', 'SHY', 'HYG', 'LQD'];

export const INDEX_SYMBOLS: ReadonlySet<string> = new Set([
  ...SP500,
  ...NASDAQ,
  ...RUSSELL,
  ...DOW,
  ...VOLATILITY,
  ...INTERNATIONAL,
  ...SP100,
  ...SECTOR_ETF,
  ...BOND,
]);

/**
 * Returns true if the given symbol is a known index / broad-market ETF.
 * Comparison is case-insensitive.
 */
export function isIndexSymbol(symbol: string): boolean {
  return INDEX_SYMBOLS.has(symbol.toUpperCase());
}

/**
 * Metadata for each index symbol displayed in the Indexes section of the watchlist.
 * Only the most commonly traded options-eligible indexes are listed here.
 */
export const INDEX_METADATA: Record<string, { name: string; description: string; category: string }> = {
  SPXW:  { name: 'S&P 500 Index (Weekly)',   description: 'PM-settled weekly options on the S&P 500', category: 'S&P 500' },
  SPX:   { name: 'S&P 500 Index',            description: 'AM-settled monthly options on the S&P 500', category: 'S&P 500' },
  XSP:   { name: 'Mini-SPX Index',           description: '1/10th size of SPX, cash-settled',          category: 'S&P 500' },
  NDX:   { name: 'Nasdaq-100 Index',         description: 'Cash-settled Nasdaq-100 options',            category: 'Nasdaq' },
  XND:   { name: 'Mini-NDX Index',           description: '1/10th size of NDX, cash-settled',          category: 'Nasdaq' },
  RUT:   { name: 'Russell 2000 Index',       description: 'Cash-settled small-cap index options',       category: 'Russell' },
  MRUT:  { name: 'Mini-Russell 2000',        description: '1/10th size of RUT, cash-settled',          category: 'Russell' },
  DJX:   { name: 'Dow Jones Index',          description: '1/100th of DJIA, cash-settled',             category: 'Dow Jones' },
  VIX:   { name: 'CBOE Volatility Index',    description: 'Volatility index options',                  category: 'Volatility' },
  VIXW:  { name: 'VIX Weekly',              description: 'Weekly VIX options',                         category: 'Volatility' },
  SPY:   { name: 'SPDR S&P 500 ETF',        description: 'Most liquid S&P 500 ETF',                   category: 'S&P 500 ETF' },
  QQQ:   { name: 'Invesco QQQ Trust',        description: 'Nasdaq-100 tracking ETF',                   category: 'Nasdaq ETF' },
  IWM:   { name: 'iShares Russell 2000 ETF', description: 'Russell 2000 tracking ETF',                 category: 'Russell ETF' },
  DIA:   { name: 'SPDR Dow Jones ETF',       description: 'Dow Jones Industrial Average ETF',          category: 'Dow ETF' },
  OEX:   { name: 'S&P 100 Index',           description: 'American-style S&P 100 options',             category: 'S&P 100' },
  XEO:   { name: 'S&P 100 Index (Euro)',    description: 'European-style S&P 100 options',             category: 'S&P 100' },
};
