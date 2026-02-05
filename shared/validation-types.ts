/**
 * Order Validation Framework
 * 
 * Unified validation engine for dry run preview across all strategies:
 * - Covered Calls (CC)
 * - Cash-Secured Puts (CSP)
 * - Bear Call Spreads (BCS)
 * - Bull Put Spreads (BPS)
 * - Poor Man's Covered Calls (PMCC)
 */

export type StrategyType = 'cc' | 'csp' | 'bcs' | 'bps' | 'pmcc';

export type ValidationSeverity = 'success' | 'warning' | 'error' | 'info';

export type ValidationStatus = 
  | 'valid'                    // ✅ All checks passed
  | 'warning'                  // ⚠️ Potential issues, but tradeable
  | 'error'                    // ❌ Critical issues, cannot trade
  | 'pending';                 // 🕐 Validation in progress

/**
 * Individual validation check result
 */
export interface ValidationCheck {
  /** Check identifier (e.g., 'price_in_spread', 'strike_available') */
  id: string;
  
  /** Human-readable check name */
  name: string;
  
  /** Check result status */
  status: ValidationStatus;
  
  /** Severity level */
  severity: ValidationSeverity;
  
  /** Detailed message explaining the result */
  message: string;
  
  /** Optional additional context */
  details?: Record<string, any>;
}

/**
 * Complete validation result for a single order
 */
export interface OrderValidationResult {
  /** Unique order identifier */
  orderId: string;
  
  /** Overall validation status (worst status from all checks) */
  status: ValidationStatus;
  
  /** Individual validation checks */
  checks: ValidationCheck[];
  
  /** When the validation was performed */
  timestamp: Date;
  
  /** Market data freshness (seconds since last update) */
  dataAge?: number;
}

/**
 * Current market data for an option
 */
export interface OptionMarketData {
  /** Underlying symbol */
  symbol: string;
  
  /** Strike price */
  strike: number;
  
  /** Expiration date (YYYY-MM-DD) */
  expiration: string;
  
  /** Option type */
  optionType: 'call' | 'put';
  
  /** Current bid price */
  bid: number;
  
  /** Current ask price */
  ask: number;
  
  /** Mid price (bid + ask) / 2 */
  mid: number;
  
  /** Current underlying price */
  underlyingPrice: number;
  
  /** When this data was fetched */
  timestamp: Date;
  
  /** Whether the option is available for trading */
  isAvailable: boolean;
}

/**
 * Order details for validation
 */
export interface OrderToValidate {
  /** Unique order identifier */
  id: string;
  
  /** Strategy type */
  strategy: StrategyType;
  
  /** Underlying symbol */
  symbol: string;
  
  /** Strike price (or short strike for spreads) */
  strike: number;
  
  /** Long strike (for spreads only) */
  longStrike?: number;
  
  /** Expiration date (YYYY-MM-DD) */
  expiration: string;
  
  /** Option type */
  optionType: 'call' | 'put';
  
  /** User's adjusted limit price */
  limitPrice: number;
  
  /** Number of contracts */
  quantity: number;
  
  /** Original bid price when order was created */
  originalBid: number;
  
  /** Original ask price when order was created */
  originalAsk: number;
  
  /** Original mid price when order was created */
  originalMid: number;
}

/**
 * Validation summary for all orders
 */
export interface ValidationSummary {
  /** Total number of orders */
  total: number;
  
  /** Number of valid orders */
  valid: number;
  
  /** Number of orders with warnings */
  warnings: number;
  
  /** Number of orders with errors */
  errors: number;
  
  /** Number of orders pending validation */
  pending: number;
  
  /** When the validation was performed */
  timestamp: Date;
  
  /** Average market data age (seconds) */
  avgDataAge: number;
}
