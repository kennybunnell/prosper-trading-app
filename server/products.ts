/**
 * Stripe Product and Price Configuration
 * 
 * Three-tier subscription model:
 * 1. Demo Mode: $47/month (after 14-day free trial)
 * 2. Wheel Strategies: $97/month (CSP + CC live trading)
 * 3. Advanced Strategies: $197/month (all strategies including PMCC, BPS, BCS)
 */

export const SUBSCRIPTION_PRODUCTS = {
  demo: {
    name: "Demo Mode",
    description: "Unlimited demo trading with all dashboards and gamification",
    tier: "free_trial" as const,
    price: 47,
    priceId: process.env.STRIPE_PRICE_ID_DEMO || "price_demo_47", // Replace with actual Stripe Price ID
    features: [
      "Unlimited demo trading",
      "All strategy dashboards",
      "Gamification & achievements",
      "$100,000 simulated balance",
      "Progress tracking",
      "Guided tutorials",
    ],
    limitations: [
      "No real money trading",
      "No Tastytrade account connection",
    ],
  },
  wheel: {
    name: "Wheel Strategies",
    description: "Live trading with Cash-Secured Puts and Covered Calls",
    tier: "wheel" as const,
    price: 97,
    priceId: process.env.STRIPE_PRICE_ID_WHEEL || "price_wheel_97", // Replace with actual Stripe Price ID
    features: [
      "Everything in Demo Mode",
      "Connect Tastytrade account",
      "Paper trading with real data",
      "Live trading (real money)",
      "CSP Dashboard (live)",
      "CC Dashboard (live)",
      "Real-time market data",
      "Order execution",
    ],
    limitations: [
      "PMCC Dashboard locked",
      "Bull/Bear Put Spreads locked",
    ],
  },
  advanced: {
    name: "Advanced Strategies",
    description: "Full access to all strategies including PMCC and credit spreads",
    tier: "advanced" as const,
    price: 197,
    priceId: process.env.STRIPE_PRICE_ID_ADVANCED || "price_advanced_197", // Replace with actual Stripe Price ID
    features: [
      "Everything in Wheel Strategies",
      "PMCC Dashboard (unlocked)",
      "Bull Put Spreads (unlocked)",
      "Bear Call Spreads (unlocked)",
      "Advanced analytics",
      "Priority support",
      "All future features",
    ],
    limitations: [],
  },
} as const;

export type SubscriptionTier = "free_trial" | "wheel" | "advanced";

/**
 * Get product configuration by tier
 */
export function getProductByTier(tier: SubscriptionTier) {
  switch (tier) {
    case "free_trial":
      return SUBSCRIPTION_PRODUCTS.demo;
    case "wheel":
      return SUBSCRIPTION_PRODUCTS.wheel;
    case "advanced":
      return SUBSCRIPTION_PRODUCTS.advanced;
  }
}

/**
 * Get all available upgrade options for a given tier
 */
export function getUpgradeOptions(currentTier: SubscriptionTier) {
  const tiers: SubscriptionTier[] = ["free_trial", "wheel", "advanced"];
  const currentIndex = tiers.indexOf(currentTier);
  
  return tiers
    .slice(currentIndex + 1)
    .map(tier => getProductByTier(tier));
}

/**
 * Check if a user has access to a specific tier level
 */
export function hasAccessToTier(userTier: SubscriptionTier, requiredTier: SubscriptionTier): boolean {
  const tierHierarchy: Record<SubscriptionTier, number> = {
    free_trial: 0,
    wheel: 1,
    advanced: 2,
  };
  
  return tierHierarchy[userTier] >= tierHierarchy[requiredTier];
}
