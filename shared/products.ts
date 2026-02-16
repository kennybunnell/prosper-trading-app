/**
 * Stripe Products and Prices Configuration
 * 
 * This file contains all Stripe product and price IDs for the Prosper Trading App.
 * These IDs are used for checkout, subscription management, and feature access control.
 */

export const STRIPE_PRODUCTS = {
  // Subscription Tiers
  TIER_2_WHEEL_ACCESS: {
    productId: 'prod_TzT1m872HJoFYB',
    priceId: 'price_1T1U5l6CoinGQAjo37JjN7uu',
    name: 'Tier 2: Wheel Access CSP-CC',
    amount: 47.00,
    interval: 'month',
    description: 'View all strategies with unlimited scans. Paper trading only. Requires your own Tradier API key.',
    features: [
      'Unlimited scans',
      'Paper trading only',
      'View all strategies',
      'Requires Tradier API key'
    ]
  },
  
  TIER_3_LIVE_TRADING: {
    productId: 'prod_TzVWvWSFMWV2Qo',
    priceId: 'price_1T1WVi6CoinGQAjoY5DJ4sOz',
    name: 'Tier 3: Live Trading CSP, CC',
    amount: 97.00,
    interval: 'month',
    description: 'View all strategies, live trade CSP and Covered Calls. Requires Tradier + Tastytrade credentials.',
    features: [
      'View all strategies',
      'Live trade CSP and Covered Calls',
      'Unlimited scans',
      'Requires Tradier + Tastytrade credentials'
    ]
  },
  
  TIER_4_ADVANCED_TRADING: {
    productId: 'prod_TzWDirSCZ53EZE',
    priceId: 'price_1T1XBM6CoinGQAjoxn9aoyDs',
    name: 'Tier 4: Advanced Trading - All Strategies',
    amount: 197.00,
    interval: 'month',
    description: 'Full access to view and live trade advanced options strategies including Bull Put Spreads, Bear Call Spreads, Iron Condors, and PMCC.',
    features: [
      'View all strategies',
      'Live trade all strategies',
      'Advanced spreads (BPS, BCS, Iron Condors, PMCC)',
      'Unlimited scans',
      'Requires Tradier + Tastytrade credentials'
    ]
  },
  
  VIP_LIFETIME: {
    productId: 'prod_TzWSUAWAgMBPiL',
    priceId: 'price_1T1XPH6CoinGQAjoyZ86VnpR',
    name: 'VIP/Partner Lifetime Access',
    amount: 5000.00,
    interval: 'one_time',
    description: 'Unlock lifetime access to all trading strategies with no recurring fees. Includes setup assistance.',
    features: [
      'Lifetime access to all strategies',
      'No recurring fees',
      'Priority support',
      'Setup assistance included',
      'All future updates included'
    ]
  },
  
  // Setup Fees
  SETUP_TRADIER: {
    productId: 'prod_TzViJliTBnz55l',
    priceId: 'price_1T1WhC6CoinGQAjo5ZXf9jhi',
    name: 'Tier 2 Setup Fee (Tradier)',
    amount: 99.00,
    interval: 'one_time',
    description: 'One-time setup fee for Tradier API configuration. Optional - you can set up Tradier yourself for free.',
    features: [
      'Tradier API setup assistance',
      'Account verification',
      'API key configuration',
      'Guided setup call'
    ]
  },
  
  SETUP_TASTYTRADE: {
    productId: 'prod_TzVxansMyvrEfh',
    priceId: 'price_1T1WvV6CoinGQAjofPZV0rxT',
    name: 'Tier 3/4 Setup Fee (Tastytrade)',
    amount: 99.00,
    interval: 'one_time',
    description: 'One-time setup fee for Tastytrade OAuth2 configuration. Optional - you can set up Tastytrade yourself for free.',
    features: [
      'Tastytrade OAuth2 setup',
      'Account verification',
      'Credential configuration',
      'Guided setup call'
    ]
  }
} as const;

/**
 * Map database subscription tier to Stripe product
 */
export type SubscriptionTier = 'free_trial' | 'wheel_trading' | 'live_trading_csp_cc' | 'advanced' | 'vip';

export const TIER_TO_PRODUCT: Record<SubscriptionTier, typeof STRIPE_PRODUCTS[keyof typeof STRIPE_PRODUCTS] | null> = {
  free_trial: null, // No Stripe product for free trial
  wheel_trading: STRIPE_PRODUCTS.TIER_2_WHEEL_ACCESS,
  live_trading_csp_cc: STRIPE_PRODUCTS.TIER_3_LIVE_TRADING,
  advanced: STRIPE_PRODUCTS.TIER_4_ADVANCED_TRADING,
  vip: STRIPE_PRODUCTS.VIP_LIFETIME
};

/**
 * Calculate required setup fees based on user's current credentials and target tier
 */
export function calculateSetupFees(params: {
  hasTradierApiKey: boolean;
  hasTastytradeRefreshToken: boolean;
  targetTier: SubscriptionTier;
  wantsAssistedSetup: boolean;
}): {
  tradierSetupFee: number;
  tastytradeSetupFee: number;
  totalSetupFees: number;
} {
  const { hasTradierApiKey, hasTastytradeRefreshToken, targetTier, wantsAssistedSetup } = params;
  
  // VIP includes all setup, no separate fees
  if (targetTier === 'vip') {
    return { tradierSetupFee: 0, tastytradeSetupFee: 0, totalSetupFees: 0 };
  }
  
  // Free trial doesn't require any credentials
  if (targetTier === 'free_trial') {
    return { tradierSetupFee: 0, tastytradeSetupFee: 0, totalSetupFees: 0 };
  }
  
  let tradierSetupFee = 0;
  let tastytradeSetupFee = 0;
  
  // Only charge setup fees if user wants assisted setup
  if (wantsAssistedSetup) {
    // Tier 2+ requires Tradier
    if (!hasTradierApiKey && (targetTier === 'wheel_trading' || targetTier === 'live_trading_csp_cc' || targetTier === 'advanced')) {
      tradierSetupFee = STRIPE_PRODUCTS.SETUP_TRADIER.amount;
    }
    
    // Tier 3+ requires Tastytrade
    if (!hasTastytradeRefreshToken && (targetTier === 'live_trading_csp_cc' || targetTier === 'advanced')) {
      tastytradeSetupFee = STRIPE_PRODUCTS.SETUP_TASTYTRADE.amount;
    }
  }
  
  return {
    tradierSetupFee,
    tastytradeSetupFee,
    totalSetupFees: tradierSetupFee + tastytradeSetupFee
  };
}

/**
 * Get all available upgrade options for a user based on their current tier
 */
export function getUpgradeOptions(currentTier: SubscriptionTier): Array<{
  tier: SubscriptionTier;
  product: typeof STRIPE_PRODUCTS[keyof typeof STRIPE_PRODUCTS];
  isUpgrade: boolean;
}> {
  const tierOrder: SubscriptionTier[] = ['free_trial', 'wheel_trading', 'live_trading_csp_cc', 'advanced', 'vip'];
  const currentIndex = tierOrder.indexOf(currentTier);
  
  const options: Array<{
    tier: SubscriptionTier;
    product: typeof STRIPE_PRODUCTS[keyof typeof STRIPE_PRODUCTS];
    isUpgrade: boolean;
  }> = [];
  
  // Add all tiers except free_trial
  tierOrder.forEach((tier, index) => {
    if (tier === 'free_trial') return;
    
    const product = TIER_TO_PRODUCT[tier];
    if (product) {
      options.push({
        tier,
        product,
        isUpgrade: index > currentIndex
      });
    }
  });
  
  return options;
}
