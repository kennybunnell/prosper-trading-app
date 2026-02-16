/**
 * Subscription Tier Enforcement Middleware
 * 
 * NEW TIER STRUCTURE: "View All, Trade by Tier"
 * 
 * All users can VIEW all strategies (CSP, CC, BPS, BCS, Iron Condor, PMCC) in all tiers.
 * Trading restrictions apply based on tier:
 * 
 * - Tier 1 (free_trial): View all strategies, paper trading only, 10 scans/day, shared Tradier
 * - Tier 2 (wheel_trading): View all strategies, paper trading only, unlimited scans, requires own Tradier
 * - Tier 3 (live_trading_csp_cc): View all strategies, TRADE CSP + CC only (live trading), requires Tradier + Tastytrade
 * - Tier 4 (advanced): View all strategies, TRADE all strategies (live trading), requires Tradier + Tastytrade
 * - VIP (vip): Lifetime access, all strategies, all features
 * 
 * Special roles (admin, owner, vip, partner, beta_tester, lifetime) bypass all checks
 */

import { TRPCError } from "@trpc/server";
import { isOwnerAccount } from "../../shared/auth";

export type SubscriptionTier = 'free_trial' | 'wheel_trading' | 'live_trading_csp_cc' | 'advanced' | 'vip' | null;
export type TradingStrategy = 'csp' | 'cc' | 'bps' | 'bcs' | 'iron_condor' | 'pmcc';
export type TradingMode = 'live' | 'paper';

/**
 * Check if a user can VIEW a specific trading strategy
 * NEW: All users can view all strategies in all tiers
 */
export function canViewStrategy(
  tier: SubscriptionTier,
  strategy: TradingStrategy,
  userRole: string
): {
  allowed: boolean;
  reason?: string;
} {
  // Owner/admin/special roles bypass all checks
  if (userRole === 'admin' || userRole === 'owner' || userRole === 'vip' || userRole === 'partner' || userRole === 'beta_tester' || userRole === 'lifetime') {
    return { allowed: true };
  }

  // All users can view all strategies
  return { allowed: true };
}

/**
 * Check if a user can TRADE a specific trading strategy
 * Trading restrictions apply based on tier
 */
export function canTradeStrategy(
  tier: SubscriptionTier,
  strategy: TradingStrategy,
  tradingMode: TradingMode,
  userRole: string
): {
  allowed: boolean;
  reason?: string;
  upgradeMessage?: string;
  viewOnly?: boolean;
} {
  // Owner/admin/special roles bypass all checks
  if (userRole === 'admin' || userRole === 'owner' || userRole === 'vip' || userRole === 'partner' || userRole === 'beta_tester' || userRole === 'lifetime') {
    console.log('[Subscription] Special role detected (%s) - bypassing strategy trading check', userRole);
    return { allowed: true };
  }

  // Tier 1 (free_trial): Paper trading only, all strategies
  if (tier === 'free_trial') {
    if (tradingMode === 'live') {
      return {
        allowed: false,
        viewOnly: true,
        reason: 'Live trading not available on free trial',
        upgradeMessage: 'Upgrade to Wheel Trading ($97/month + $99 setup) to enable live trading with CSP+CC strategies.'
      };
    }
    // Paper trading - all strategies allowed
    return { allowed: true };
  }

  // Tier 2 (wheel_trading): Paper trading only, all strategies
  if (tier === 'wheel_trading') {
    if (tradingMode === 'live') {
      return {
        allowed: false,
        viewOnly: true,
        reason: 'Live trading not available on Wheel View tier',
        upgradeMessage: 'Upgrade to Wheel Trading ($97/month + $99 setup) to enable live trading with CSP+CC strategies, or Advanced Spreads ($200/month) to trade all strategies.'
      };
    }
    // Paper trading - all strategies allowed
    return { allowed: true };
  }

  // Tier 3 (live_trading_csp_cc): Live trading, CSP + CC only
  if (tier === 'live_trading_csp_cc') {
    // CSP and CC allowed for live trading
    if (strategy === 'csp' || strategy === 'cc') {
      return { allowed: true };
    }
    
    // Spreads (BPS, BCS, Iron Condor, PMCC) require Tier 4
    // But user can still VIEW them
    if (tradingMode === 'live') {
      return {
        allowed: false,
        viewOnly: true,
        reason: 'Advanced spread strategies require Advanced Spreads tier',
        upgradeMessage: 'Upgrade to Advanced Spreads ($200/month) to unlock live trading for Bull Put Spreads, Bear Call Spreads, Iron Condors, and PMCC.'
      };
    }
    
    // Paper trading - all strategies allowed
    return { allowed: true };
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
  // Owner/admin/special roles bypass all checks
  if (userRole === 'admin' || userRole === 'owner' || userRole === 'vip' || userRole === 'partner' || userRole === 'beta_tester' || userRole === 'lifetime') {
    console.log('[Subscription] Special role detected (%s) - bypassing live trading check', userRole);
    return { allowed: true };
  }

  // Tier 1 and 2: Paper trading only
  if (tier === 'free_trial' || tier === 'wheel_trading') {
    return {
      allowed: false,
      reason: 'Live trading not available on your current tier',
      upgradeMessage: tier === 'free_trial' 
        ? 'Upgrade to Wheel Trading ($97/month + $99 setup) to enable live trading with CSP+CC strategies.'
        : 'Upgrade to Wheel Trading ($97/month + $99 setup) to enable live trading with CSP+CC strategies, or Advanced Spreads ($200/month) for all strategies.'
    };
  }

  // Tier 3, 4, and VIP: Live trading allowed
  if (tier === 'live_trading_csp_cc' || tier === 'advanced' || tier === 'vip') {
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
  // Owner/admin/special roles bypass all checks
  if (userRole === 'admin' || userRole === 'owner' || userRole === 'vip' || userRole === 'partner' || userRole === 'beta_tester' || userRole === 'lifetime') {
    return { valid: true };
  }

  const missing: string[] = [];

  // Tier 1: Uses shared Tradier API (no credentials required)
  if (tier === 'free_trial') {
    return { valid: true };
  }

  // Tier 2: Requires own Tradier API
  if (tier === 'wheel_trading') {
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

  // Tier 3, 4, and VIP: Requires Tradier + Tastytrade
  if (tier === 'live_trading_csp_cc' || tier === 'advanced' || tier === 'vip') {
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
    case 'wheel_trading':
      return 'Wheel Trading';
    case 'live_trading_csp_cc':
      return 'Live Trading (CSP + CC)';
    case 'vip':
      return 'VIP/Partner';
    case 'advanced':
      return 'Advanced Spreads';
    default:
      return 'Unknown';
  }
}

/**
 * Get strategies available for VIEWING (all users can view all strategies)
 */
export function getViewableStrategies(tier: SubscriptionTier): TradingStrategy[] {
  // All users can view all strategies
  return ['csp', 'cc', 'bps', 'bcs', 'iron_condor', 'pmcc'];
}

/**
 * Get strategies available for TRADING based on tier
 */
export function getTradableStrategies(tier: SubscriptionTier, tradingMode: TradingMode): TradingStrategy[] {
  // Tier 1 and 2: All strategies in paper mode only
  if ((tier === 'free_trial' || tier === 'wheel_trading') && tradingMode === 'paper') {
    return ['csp', 'cc', 'bps', 'bcs', 'iron_condor', 'pmcc'];
  }

  // Tier 1 and 2: No live trading
  if ((tier === 'free_trial' || tier === 'wheel_trading') && tradingMode === 'live') {
    return [];
  }

  // Tier 3: CSP + CC only (live or paper)
  if (tier === 'wheel_trading') {
    return ['csp', 'cc'];
  }

  // Tier 4: All strategies (live or paper)
  if (tier === 'advanced') {
    return ['csp', 'cc', 'bps', 'bcs', 'iron_condor', 'pmcc'];
  }

  // Default: CSP only
  return ['csp'];
}

/**
 * Check if a strategy is locked for trading (view-only) for a given tier
 */
export function isStrategyLocked(
  tier: SubscriptionTier,
  strategy: TradingStrategy,
  tradingMode: TradingMode
): boolean {
  const tradableStrategies = getTradableStrategies(tier, tradingMode);
  return !tradableStrategies.includes(strategy);
}
