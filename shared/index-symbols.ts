/**
 * Canonical symbol classification for index and ETF instruments.
 *
 * KEY DISTINCTION (Tastytrade / CBOE rules):
 *   TRUE_CASH_SETTLED_INDEXES  — European-style, cash-settled, Section 1256 tax treatment,
 *                                 no early-assignment risk, special margin treatment.
 *                                 Examples: SPX, SPXW, NDX, RUT, VIX
 *
 *   ETF_PROXIES                — American-style, equity-settled, standard equity margin,
 *                                 early-assignment risk, no Section 1256 benefit.
 *                                 Examples: SPY, QQQ, IWM, DIA
 *
 * Only TRUE_CASH_SETTLED_INDEXES should be flagged as isIndex=true in the watchlist.
 * ETF_PROXIES must be treated as equities for spread rules, margin, and scoring.
 *
 * All comparisons are case-insensitive.
 */

// ─── True Cash-Settled Index Options ─────────────────────────────────────────
// These are the ONLY symbols that should be marked isIndex=true.

/** S&P 500 cash-settled index family */
const SP500_INDEX = ['SPX', 'SPXW', 'SPXPM', 'XSP', 'NANOS'];

/** Nasdaq-100 cash-settled index family */
const NASDAQ_INDEX = ['NDX', 'NDXP', 'XND'];

/** Russell 2000 cash-settled index family */
const RUSSELL_INDEX = ['RUT', 'RUTW', 'MRUT'];

/** Dow Jones cash-settled index family */
const DOW_INDEX = ['DJX'];

/** CBOE Volatility Index family */
const VOLATILITY_INDEX = ['VIX', 'VIXW', 'VVIX'];

/** S&P 100 cash-settled index (legacy) */
const SP100_INDEX = ['OEX', 'XEO'];

/**
 * Set of TRUE cash-settled index symbols.
 * Use this to determine isIndex=true in the watchlist and to route
 * to the index scoring/margin path in the spread scanner.
 */
export const TRUE_CASH_SETTLED_INDEXES: ReadonlySet<string> = new Set([
  ...SP500_INDEX,
  ...NASDAQ_INDEX,
  ...RUSSELL_INDEX,
  ...DOW_INDEX,
  ...VOLATILITY_INDEX,
  ...SP100_INDEX,
]);

// ─── ETF Proxies (Equity-Settled) ────────────────────────────────────────────
// These track indexes but are equity-settled with early-assignment risk.
// They must NOT be marked isIndex=true.

/** S&P 500 ETFs and leveraged variants */
const SP500_ETF = ['SPY', 'SPXL', 'SPXS', 'SSO', 'SDS', 'UPRO', 'SPXU'];

/** Nasdaq ETFs and leveraged variants */
const NASDAQ_ETF = ['QQQ', 'TQQQ', 'SQQQ', 'QLD', 'QID', 'QQQM'];

/** Russell 2000 ETFs and leveraged variants */
const RUSSELL_ETF = ['IWM', 'TNA', 'TZA', 'UWM', 'TWM'];

/** Dow Jones ETFs */
const DOW_ETF = ['DIA', 'DDM', 'DXD'];

/** Volatility ETFs/ETNs */
const VOLATILITY_ETF = ['VXX', 'VIXY', 'UVXY', 'SVXY', 'VIXM'];

/** International / broad market ETFs */
const INTERNATIONAL_ETF = ['MXEA', 'MXEF', 'EFA', 'EEM', 'VEA', 'VWO'];

/** Sector ETFs commonly traded as index proxies */
const SECTOR_ETF = ['XLK', 'XLF', 'XLE', 'XLV', 'XLI', 'XLP', 'XLU', 'XLB', 'XLRE', 'XLC', 'XLY'];

/** Bond / rate ETFs */
const BOND_ETF = ['TNX', 'TLT', 'TBT', 'IEF', 'SHY', 'HYG', 'LQD'];

/**
 * Set of ETF proxy symbols that track indexes but are equity-settled.
 * These should NOT be marked isIndex=true.
 */
export const ETF_PROXIES: ReadonlySet<string> = new Set([
  ...SP500_ETF,
  ...NASDAQ_ETF,
  ...RUSSELL_ETF,
  ...DOW_ETF,
  ...VOLATILITY_ETF,
  ...INTERNATIONAL_ETF,
  ...SECTOR_ETF,
  ...BOND_ETF,
]);

// ─── Combined set (for watchlist display / search) ───────────────────────────
/**
 * All known index-family symbols (both cash-settled and ETF proxies).
 * Use this only for display purposes (e.g., showing an "Index" section in the watchlist UI).
 * Do NOT use this to determine isIndex=true — use TRUE_CASH_SETTLED_INDEXES for that.
 */
export const INDEX_SYMBOLS: ReadonlySet<string> = new Set([
  ...Array.from(TRUE_CASH_SETTLED_INDEXES),
  ...Array.from(ETF_PROXIES),
]);

// ─── Helper functions ─────────────────────────────────────────────────────────

/**
 * Returns true ONLY for true cash-settled index options (SPX, NDX, RUT, VIX family).
 * Use this to determine isIndex=true in the watchlist and spread scanner routing.
 * ETFs (SPY, QQQ, IWM, etc.) return false.
 */
export function isTrueCashSettledIndex(symbol: string): boolean {
  return TRUE_CASH_SETTLED_INDEXES.has(symbol.toUpperCase());
}

/**
 * Returns true if the symbol is a known ETF proxy (equity-settled, tracks an index).
 * These should be treated as equities for margin, spread rules, and scoring.
 */
export function isEtfProxy(symbol: string): boolean {
  return ETF_PROXIES.has(symbol.toUpperCase());
}

/**
 * Returns true if the given symbol is any known index-family symbol
 * (either cash-settled index or ETF proxy).
 * Use for display grouping only — NOT for isIndex classification.
 *
 * @deprecated For isIndex classification, use isTrueCashSettledIndex() instead.
 */
export function isIndexSymbol(symbol: string): boolean {
  return INDEX_SYMBOLS.has(symbol.toUpperCase());
}

/**
 * Metadata for index symbols displayed in the Indexes section of the watchlist.
 * Only the most commonly traded options-eligible indexes are listed here.
 */
export const INDEX_METADATA: Record<string, { name: string; description: string; category: string }> = {
  // True cash-settled indexes
  SPXW:  { name: 'S&P 500 Index (Weekly)',        description: 'PM-settled weekly options on the S&P 500',     category: 'S&P 500 Index' },
  SPX:   { name: 'S&P 500 Index',                 description: 'AM-settled monthly options on the S&P 500',    category: 'S&P 500 Index' },
  XSP:   { name: 'Mini-SPX Index',                description: '1/10th size of SPX, cash-settled',             category: 'S&P 500 Index' },
  NDX:   { name: 'Nasdaq-100 Index',              description: 'Cash-settled Nasdaq-100 options',               category: 'Nasdaq Index' },
  NDXP:  { name: 'Nasdaq-100 Index (PM Weekly)',  description: 'PM-settled weekly options on the Nasdaq-100',  category: 'Nasdaq Index' },
  XND:   { name: 'Mini-NDX Index',                description: '1/10th size of NDX, cash-settled',             category: 'Nasdaq Index' },
  RUT:   { name: 'Russell 2000 Index',            description: 'Cash-settled small-cap index options',          category: 'Russell Index' },
  MRUT:  { name: 'Mini-Russell 2000',             description: '1/10th size of RUT, cash-settled',             category: 'Russell Index' },
  DJX:   { name: 'Dow Jones Index',               description: '1/100th of DJIA, cash-settled',                category: 'Dow Jones Index' },
  VIX:   { name: 'CBOE Volatility Index',         description: 'Volatility index options',                     category: 'Volatility Index' },
  VIXW:  { name: 'VIX Weekly',                   description: 'Weekly VIX options',                            category: 'Volatility Index' },
  OEX:   { name: 'S&P 100 Index',                description: 'American-style S&P 100 options',                category: 'S&P 100 Index' },
  XEO:   { name: 'S&P 100 Index (Euro)',          description: 'European-style S&P 100 options',               category: 'S&P 100 Index' },
  // ETF proxies (equity-settled — shown in watchlist but NOT treated as index for trading)
  SPY:   { name: 'SPDR S&P 500 ETF',             description: 'Equity-settled ETF — treated as equity for spreads', category: 'S&P 500 ETF' },
  QQQ:   { name: 'Invesco QQQ Trust',             description: 'Equity-settled ETF — treated as equity for spreads', category: 'Nasdaq ETF' },
  IWM:   { name: 'iShares Russell 2000 ETF',      description: 'Equity-settled ETF — treated as equity for spreads', category: 'Russell ETF' },
  DIA:   { name: 'SPDR Dow Jones ETF',            description: 'Equity-settled ETF — treated as equity for spreads', category: 'Dow ETF' },
};
