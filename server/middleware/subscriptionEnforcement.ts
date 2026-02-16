/**
 * Subscription Tier Enforcement Middleware
 * 
 * Controls access to trading strategies based on subscription tier:
 * - Tier 1 (free_trial): Paper trading only, CSP/CC/BPS/BCS/Iron Condor/PMCC (all strategies for evaluation)
 * - Tier 2 (wheel_view): Paper trading only, CSP/CC/BPS/BCS/Iron Condor/PMCC (all strategies for evaluation)
 * - Tier 3 (wheel_trading): Live trading, CSP + CC only (no spreads)
 * - Tier 4 (advanced): Live trading, all strategies unlocked
 * 
 * Owner/admin accounts bypass all subscription checks
 */

import { TRPCError } from "@trpc/server";
import { isOwnerAccount } from "../../shared/auth";

export type SubscriptionTier = 'free_trial' | 'wheel_view' | 'wheel_trading' | 'advanced' | null;
export type TradingStrategy = 'csp' | 'cc' | 'bps' | 'bcs' | 'iron_condor' | 'pmcc';
export type TradingMode = 'live' | 'paper';

/**
 * Check if a user can access a specific trading strategy
 */
export function canAccessStrategy(
  tier: SubscriptionTier,
  strategy: TradingStrategy,
  tradingMode: TradingMode,
  userRole: string
): {
  allowed: boolean;
  reason?: string;
  upgradeMessage?: string;
} {
  // Owner/admin bypass all checks
  if (userRole === 'admin' || userRole === 'owner') {
    console.log('[Subscription] Owner/admin detected - bypassing strategy access check');
    return { allowed: true };
  }

  // Tier 1 (free_trial): Paper trading only, all strategies allowed for evaluation
  if (tier === 'free_trial') {
    if (tradingMode === 'live') {
      return {
        allowed: false,
        reason: 'Live trading not available on free trial',
        upgradeMessage: 'Upgrade to Wheel View ($47/month) for paper trading with your own Tradier API, or Wheel Trading ($97/month) for live trading with CSP+CC strategies.'
      };
    }
    // Paper trading - all strategies allowed
    return { allowed: true };
  }

  // Tier 2 (wheel_view): Paper trading only, all strategies allowed for evaluation
  if (tier === 'wheel_view') {
    if (tradingMode === 'live') {
      return {
        allowed: false,
        reason: 'Live trading not available on Wheel View tier',
        upgradeMessage: 'Upgrade to Wheel Trading ($97/month) to enable live trading with CSP+CC strategies, or Advanced Spreads ($200/month) for all strategies including spreads.'
      };
    }
    // Paper trading - all strategies allowed
    return { allowed: true };
  }

  // Tier 3 (wheel_trading): Live trading, CSP + CC only
  if (tier === 'wheel_trading') {
    // Only CSP and CC allowed for live trading
    if (strategy === 'csp' || strategy === 'cc') {
      return { allowed: true };
    }
    
    // Spreads (BPS, BCS, Iron Condor, PMCC) require Tier 4
    return {
      allowed: false,
      reason: 'Advanced spread strategies require Advanced Spreads tier',
      upgradeMessage: 'Upgrade to Advanced Spreads ($200/month) to unlock Bull Put Spreads, Bear Call Spreads, Iron Condors, and PMCC strategies.'
    };
  }

  // Tier 4 (advanced): All strategies unlocked
  if (tier === 'advanced') {
    return { allowed: true };
  }

  // Default: deny access
  return {
    allowed: false,
    reason: 'Invalid subscription tier',
    upgradeMessage: 'Please upgrade your subscription to access this strategy.'
  };
}

/**
 * Check if a user can use live trading mode
 */
export function canUseLiveTrading(
  tier: SubscriptionTier,
  userRole: string
): {
  allowed: boolean;
  reason?: string;
  upgradeMessage?: string;
} {
  // Owner/admin bypass all checks
  if (userRole === 'admin' || userRole === 'owner') {
    console.log('[Subscription] Owner/admin detected - bypassing live trading check');
    return { allowed: true };
  }

  // Tier 1 and 2: Paper trading only
  if (tier === 'free_trial' || tier === 'wheel_view') {
    return {
      allowed: false,
      reason: 'Live trading not available on your current tier',
      upgradeMessage: tier === 'free_trial' 
        ? 'Upgrade to Wheel Trading ($97/month) to enable live trading with CSP+CC strategies.'
        : 'Upgrade to Wheel Trading ($97/month) to enable live trading with CSP+CC strategies, or Advanced Spreads ($200/month) for all strategies.'
    };
  }

  // Tier 3 and 4: Live trading allowed
  if (tier === 'wheel_trading' || tier === 'advanced') {
    return { allowed: true };
  }

  // Default: deny
  return {
    allowed: false,
    reason: 'Invalid subscription tier',
    upgradeMessage: 'Please upgrade your subscription to enable live trading.'
  };
}

/**
 * Check if user has required API credentials for their tier
 */
export function hasRequiredCredentials(
  tier: SubscriptionTier,
  credentials: {
    tradierApiKey?: string | null;
    tastytradeClientSecret?: string | null;
    tastytradeRefreshToken?: string | null;
  },
  userRole: string
): {
  valid: boolean;
  missing?: string[];
  message?: string;
} {
  // Owner/admin bypass all checks
  if (userRole === 'admin' || userRole === 'owner') {
    return { valid: true };
  }

  const missing: string[] = [];

  // Tier 1: Uses shared Tradier API (no credentials required)
  if (tier === 'free_trial') {
    return { valid: true };
  }

  // Tier 2: Requires own Tradier API
  if (tier === 'wheel_view') {
    if (!credentials.tradierApiKey) {
      missing.push('Tradier API Key');
    }
    
    if (missing.length > 0) {
      return {
        valid: false,
        missing,
        message: 'Please add your Tradier API key in Settings. Note: Tradier API requires a funded brokerage account.'
      };
    }
    return { valid: true };
  }

  // Tier 3 and 4: Requires Tradier + Tastytrade
  if (tier === 'wheel_trading' || tier === 'advanced') {
    if (!credentials.tradierApiKey) {
      missing.push('Tradier API Key');
    }
    if (!credentials.tastytradeClientSecret || !credentials.tastytradeRefreshToken) {
      missing.push('Tastytrade Credentials');
    }
    
    if (missing.length > 0) {
      return {
        valid: false,
        missing,
        message: 'Please add your Tradier API key and Tastytrade credentials in Settings to enable live trading.'
      };
    }
    return { valid: true };
  }

  // Default
  return { valid: true };
}

/**
 * Get tier display name
 */
export function getTierDisplayName(tier: SubscriptionTier): string {
  switch (tier) {
    case 'free_trial':
      return 'Free Trial';
    case 'wheel_view':
      return 'Wheel View';
    case 'wheel_trading':
      return 'Wheel Trading';
    case 'advanced':
      return 'Advanced Spreads';
    default:
      return 'Unknown';
  }
}

/**
 * Get available strategies for a tier
 */
export function getAvailableStrategies(tier: SubscriptionTier, tradingMode: TradingMode): TradingStrategy[] {
  // Tier 1 and 2: All strategies in paper mode
  if ((tier === 'free_trial' || tier === 'wheel_view') && tradingMode === 'paper') {
    return ['csp', 'cc', 'bps', 'bcs', 'iron_condor', 'pmcc'];
  }

  // Tier 3: CSP + CC only
  if (tier === 'wheel_trading') {
    return ['csp', 'cc'];
  }

  // Tier 4: All strategies
  if (tier === 'advanced') {
    return ['csp', 'cc', 'bps', 'bcs', 'iron_condor', 'pmcc'];
  }

  // Default: CSP only
  return ['csp'];
}
