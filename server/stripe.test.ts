import { describe, it, expect } from "vitest";
import { calculateSetupFees, getUpgradeOptions, STRIPE_PRODUCTS } from "../shared/products.js";

describe("Stripe Integration - Setup Fee Calculation", () => {
  describe("calculateSetupFees", () => {
    it("should return no fees for VIP tier", () => {
      const result = calculateSetupFees({
        targetTier: "vip",
        hasTradierApiKey: false,
        hasTastytradeRefreshToken: false,
        wantsAssistedSetup: true
      });
      expect(result.tradierSetupFee).toBe(0);
      expect(result.tastytradeSetupFee).toBe(0);
      expect(result.totalSetupFees).toBe(0);
    });

    it("should charge Tradier setup fee when upgrading to wheel_trading without Tradier and wants assisted setup", () => {
      const result = calculateSetupFees({
        targetTier: "wheel_trading",
        hasTradierApiKey: false,
        hasTastytradeRefreshToken: false,
        wantsAssistedSetup: true
      });
      expect(result.tradierSetupFee).toBe(99);
      expect(result.tastytradeSetupFee).toBe(0);
      expect(result.totalSetupFees).toBe(99);
    });

    it("should not charge Tradier setup fee when user already has Tradier", () => {
      const result = calculateSetupFees({
        targetTier: "wheel_trading",
        hasTradierApiKey: true,
        hasTastytradeRefreshToken: false,
        wantsAssistedSetup: true
      });
      expect(result.tradierSetupFee).toBe(0);
      expect(result.tastytradeSetupFee).toBe(0);
      expect(result.totalSetupFees).toBe(0);
    });

    it("should not charge setup fees when user doesn't want assisted setup", () => {
      const result = calculateSetupFees({
        targetTier: "wheel_trading",
        hasTradierApiKey: false,
        hasTastytradeRefreshToken: false,
        wantsAssistedSetup: false
      });
      expect(result.tradierSetupFee).toBe(0);
      expect(result.tastytradeSetupFee).toBe(0);
      expect(result.totalSetupFees).toBe(0);
    });

    it("should charge both setup fees when upgrading to live_trading_csp_cc without any credentials and wants assisted setup", () => {
      const result = calculateSetupFees({
        targetTier: "live_trading_csp_cc",
        hasTradierApiKey: false,
        hasTastytradeRefreshToken: false,
        wantsAssistedSetup: true
      });
      expect(result.tradierSetupFee).toBe(99);
      expect(result.tastytradeSetupFee).toBe(99);
      expect(result.totalSetupFees).toBe(198);
    });

    it("should charge only Tastytrade setup fee when upgrading to live_trading_csp_cc with Tradier", () => {
      const result = calculateSetupFees({
        targetTier: "live_trading_csp_cc",
        hasTradierApiKey: true,
        hasTastytradeRefreshToken: false,
        wantsAssistedSetup: true
      });
      expect(result.tradierSetupFee).toBe(0);
      expect(result.tastytradeSetupFee).toBe(99);
      expect(result.totalSetupFees).toBe(99);
    });

    it("should not charge any setup fees when user has both credentials", () => {
      const result = calculateSetupFees({
        targetTier: "live_trading_csp_cc",
        hasTradierApiKey: true,
        hasTastytradeRefreshToken: true,
        wantsAssistedSetup: true
      });
      expect(result.tradierSetupFee).toBe(0);
      expect(result.tastytradeSetupFee).toBe(0);
      expect(result.totalSetupFees).toBe(0);
    });

    it("should charge both setup fees for advanced tier without credentials and wants assisted setup", () => {
      const result = calculateSetupFees({
        targetTier: "advanced",
        hasTradierApiKey: false,
        hasTastytradeRefreshToken: false,
        wantsAssistedSetup: true
      });
      expect(result.tradierSetupFee).toBe(99);
      expect(result.tastytradeSetupFee).toBe(99);
      expect(result.totalSetupFees).toBe(198);
    });

    it("should not charge setup fees for free_trial tier", () => {
      const result = calculateSetupFees({
        targetTier: "free_trial",
        hasTradierApiKey: false,
        hasTastytradeRefreshToken: false,
        wantsAssistedSetup: true
      });
      expect(result.tradierSetupFee).toBe(0);
      expect(result.tastytradeSetupFee).toBe(0);
      expect(result.totalSetupFees).toBe(0);
    });
  });

  describe("getUpgradeOptions", () => {
    it("should return all paid tiers for free_trial user", () => {
      const options = getUpgradeOptions("free_trial");
      expect(options.length).toBe(4); // wheel_trading, live_trading_csp_cc, advanced, vip
      expect(options.every(opt => opt.isUpgrade)).toBe(true);
    });

    it("should return correct upgrade options for wheel_trading user", () => {
      const options = getUpgradeOptions("wheel_trading");
      expect(options.length).toBe(4);
      const upgrades = options.filter(opt => opt.isUpgrade);
      expect(upgrades.length).toBe(3); // live_trading_csp_cc, advanced, vip
    });

    it("should return correct upgrade options for live_trading_csp_cc user", () => {
      const options = getUpgradeOptions("live_trading_csp_cc");
      const upgrades = options.filter(opt => opt.isUpgrade);
      expect(upgrades.length).toBe(2); // advanced, vip
    });

    it("should return correct upgrade options for advanced user", () => {
      const options = getUpgradeOptions("advanced");
      const upgrades = options.filter(opt => opt.isUpgrade);
      expect(upgrades.length).toBe(1); // only vip
    });

    it("should return all tiers for vip user (no upgrades available)", () => {
      const options = getUpgradeOptions("vip");
      const upgrades = options.filter(opt => opt.isUpgrade);
      expect(upgrades.length).toBe(0); // VIP is highest tier
    });
  });
});

describe("Stripe Integration - Tier Upgrade Paths", () => {
  it("should calculate correct fees for Trial → Tier 2 (no credentials, DIY)", () => {
    const result = calculateSetupFees({
      targetTier: "wheel_trading",
      hasTradierApiKey: false,
      hasTastytradeRefreshToken: false,
      wantsAssistedSetup: false
    });
    expect(result.totalSetupFees).toBe(0); // DIY = free
  });

  it("should calculate correct fees for Trial → Tier 2 (no credentials, assisted)", () => {
    const result = calculateSetupFees({
      targetTier: "wheel_trading",
      hasTradierApiKey: false,
      hasTastytradeRefreshToken: false,
      wantsAssistedSetup: true
    });
    expect(result.totalSetupFees).toBe(99); // Assisted = $99
  });

  it("should calculate correct fees for Trial → Tier 3 (no credentials, assisted)", () => {
    const result = calculateSetupFees({
      targetTier: "live_trading_csp_cc",
      hasTradierApiKey: false,
      hasTastytradeRefreshToken: false,
      wantsAssistedSetup: true
    });
    expect(result.totalSetupFees).toBe(198); // Both APIs = $198
  });

  it("should calculate correct fees for Trial → Tier 4 (no credentials, assisted)", () => {
    const result = calculateSetupFees({
      targetTier: "advanced",
      hasTradierApiKey: false,
      hasTastytradeRefreshToken: false,
      wantsAssistedSetup: true
    });
    expect(result.totalSetupFees).toBe(198); // Both APIs = $198
  });

  it("should calculate correct fees for Tier 2 → Tier 3 (has Tradier, assisted)", () => {
    const result = calculateSetupFees({
      targetTier: "live_trading_csp_cc",
      hasTradierApiKey: true,
      hasTastytradeRefreshToken: false,
      wantsAssistedSetup: true
    });
    expect(result.totalSetupFees).toBe(99); // Only Tastytrade setup
  });

  it("should calculate correct fees for Tier 2 → Tier 4 (has Tradier, assisted)", () => {
    const result = calculateSetupFees({
      targetTier: "advanced",
      hasTradierApiKey: true,
      hasTastytradeRefreshToken: false,
      wantsAssistedSetup: true
    });
    expect(result.totalSetupFees).toBe(99); // Only Tastytrade setup
  });

  it("should calculate correct fees for Tier 3 → Tier 4 (has both)", () => {
    const result = calculateSetupFees({
      targetTier: "advanced",
      hasTradierApiKey: true,
      hasTastytradeRefreshToken: true,
      wantsAssistedSetup: true
    });
    expect(result.totalSetupFees).toBe(0); // No setup fees needed
  });
});

describe("Stripe Integration - Edge Cases", () => {
  it("should handle missing credentials gracefully with DIY setup", () => {
    const result = calculateSetupFees({
      targetTier: "live_trading_csp_cc",
      hasTradierApiKey: false,
      hasTastytradeRefreshToken: false,
      wantsAssistedSetup: false
    });
    expect(result.totalSetupFees).toBe(0); // DIY is always free
  });

  it("should not charge setup fees when downgrading", () => {
    // Downgrade scenarios don't charge setup fees
    const result = calculateSetupFees({
      targetTier: "wheel_trading",
      hasTradierApiKey: true,
      hasTastytradeRefreshToken: true,
      wantsAssistedSetup: true
    });
    expect(result.totalSetupFees).toBe(0);
  });

  it("should handle VIP upgrade from any tier", () => {
    const result = calculateSetupFees({
      targetTier: "vip",
      hasTradierApiKey: false,
      hasTastytradeRefreshToken: false,
      wantsAssistedSetup: true
    });
    expect(result.totalSetupFees).toBe(0); // VIP includes all setup
  });
});

describe("Stripe Products Configuration", () => {
  it("should have valid Stripe product IDs", () => {
    expect(STRIPE_PRODUCTS.TIER_2_WHEEL_ACCESS.productId).toBe('prod_TzT1m872HJoFYB');
    expect(STRIPE_PRODUCTS.TIER_3_LIVE_TRADING.productId).toBe('prod_TzVWvWSFMWV2Qo');
    expect(STRIPE_PRODUCTS.TIER_4_ADVANCED_TRADING.productId).toBe('prod_TzWDirSCZ53EZE');
    expect(STRIPE_PRODUCTS.VIP_LIFETIME.productId).toBe('prod_TzWSUAWAgMBPiL');
  });

  it("should have valid Stripe price IDs", () => {
    expect(STRIPE_PRODUCTS.TIER_2_WHEEL_ACCESS.priceId).toBe('price_1T1U5l6CoinGQAjo37JjN7uu');
    expect(STRIPE_PRODUCTS.TIER_3_LIVE_TRADING.priceId).toBe('price_1T1WVi6CoinGQAjoY5DJ4sOz');
    expect(STRIPE_PRODUCTS.TIER_4_ADVANCED_TRADING.priceId).toBe('price_1T1XBM6CoinGQAjoxn9aoyDs');
    expect(STRIPE_PRODUCTS.VIP_LIFETIME.priceId).toBe('price_1T1XPH6CoinGQAjoyZ86VnpR');
  });

  it("should have correct pricing amounts", () => {
    expect(STRIPE_PRODUCTS.TIER_2_WHEEL_ACCESS.amount).toBe(47.00);
    expect(STRIPE_PRODUCTS.TIER_3_LIVE_TRADING.amount).toBe(97.00);
    expect(STRIPE_PRODUCTS.TIER_4_ADVANCED_TRADING.amount).toBe(197.00);
    expect(STRIPE_PRODUCTS.VIP_LIFETIME.amount).toBe(5000.00);
    expect(STRIPE_PRODUCTS.SETUP_TRADIER.amount).toBe(99.00);
    expect(STRIPE_PRODUCTS.SETUP_TASTYTRADE.amount).toBe(99.00);
  });
});
