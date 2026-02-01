/**
 * Master Onboarding Configuration
 * 
 * This file serves as the single source of truth for all default data
 * that should be seeded for new users during onboarding.
 * 
 * When updating these values:
 * 1. Test thoroughly in dev environment
 * 2. Export from a "golden" user account if possible
 * 3. Update version number and changelog below
 * 
 * Version: 1.0.0
 * Last Updated: 2026-02-01
 * Changelog:
 * - v1.0.0: Initial configuration with dev environment values
 */

/**
 * Default watchlist symbols for new users
 * These are the core symbols that every new user should have in their watchlist
 */
export const DEFAULT_WATCHLIST_SYMBOLS = [
  "AAPL", "MSFT", "GOOGL", "AMZN", "META", "TSLA", "NVDA", // Mag 7
  "NFLX", "AMD", "INTC", "QCOM", "AVGO", "ORCL", "CRM", "ADBE",
  "PYPL", "SQ", "SHOP", "UBER", "LYFT", "ABNB", "COIN",
  "BA", "CAT", "DE", "GE", "HON", "LMT", "MMM", "RTX",
  "JPM", "BAC", "WFC", "GS", "MS"
];

/**
 * Default filter presets for Cash-Secured Puts (CSP) strategy
 */
export const CSP_PRESETS = {
  conservative: {
    minDte: 14,
    maxDte: 45,
    minDelta: "0.10",
    maxDelta: "0.25",
    minOpenInterest: 50,
    minVolume: 30,
    minRsi: 20,
    maxRsi: 70,
    minIvRank: 20,
    maxIvRank: 100,
    minBbPercent: "0",
    maxBbPercent: "0.7",
    minScore: 50,
    maxStrikePercent: 100,
  },
  medium: {
    minDte: 7,
    maxDte: 45,
    minDelta: "0.15",
    maxDelta: "0.35",
    minOpenInterest: 50,
    minVolume: 25,
    minRsi: 15,
    maxRsi: 80,
    minIvRank: 10,
    maxIvRank: 100,
    minBbPercent: "0",
    maxBbPercent: "0.8",
    minScore: 40,
    maxStrikePercent: 105,
  },
  aggressive: {
    minDte: 7,
    maxDte: 30,
    minDelta: "0.20",
    maxDelta: "0.45",
    minOpenInterest: 30,
    minVolume: 20,
    minRsi: 10,
    maxRsi: 90,
    minIvRank: 0,
    maxIvRank: 100,
    minBbPercent: "0",
    maxBbPercent: "1.0",
    minScore: 30,
    maxStrikePercent: 110,
  },
};

/**
 * Default filter presets for Covered Calls (CC) strategy
 */
export const CC_PRESETS = {
  conservative: {
    minDte: 14,
    maxDte: 45,
    minDelta: "0.15",
    maxDelta: "0.25",
    minOpenInterest: 100,
    minVolume: 50,
    minRsi: 65,
    maxRsi: 80,
    minIvRank: 40,
    maxIvRank: 100,
    minBbPercent: "0.7",
    maxBbPercent: "1.0",
    minScore: 60,
    maxStrikePercent: 105,
  },
  medium: {
    minDte: 10,
    maxDte: 20,
    minDelta: "0.20",
    maxDelta: "0.28",
    minOpenInterest: 75,
    minVolume: 40,
    minRsi: 55,
    maxRsi: 75,
    minIvRank: 30,
    maxIvRank: 100,
    minBbPercent: "0.5",
    maxBbPercent: "1.0",
    minScore: 50,
    maxStrikePercent: 110,
  },
  aggressive: {
    minDte: 7,
    maxDte: 21,
    minDelta: "0.25",
    maxDelta: "0.35",
    minOpenInterest: 50,
    minVolume: 30,
    minRsi: 50,
    maxRsi: 70,
    minIvRank: 20,
    maxIvRank: 100,
    minBbPercent: "0.3",
    maxBbPercent: "1.0",
    minScore: 40,
    maxStrikePercent: 115,
  },
};

/**
 * Default filter presets for Poor Man's Covered Calls (PMCC) strategy
 */
export const PMCC_PRESETS = {
  conservative: {
    minDte: 270,
    maxDte: 450,
    minDelta: "0.75",
    maxDelta: "0.90",
    minOpenInterest: 50,
    minVolume: 20,
    minRsi: 30,
    maxRsi: 70,
    minIvRank: 20,
    maxIvRank: 100,
    minBbPercent: "0",
    maxBbPercent: "1.0",
    minScore: 60,
    maxStrikePercent: 90,
  },
  medium: {
    minDte: 300,
    maxDte: 420,
    minDelta: "0.70",
    maxDelta: "0.85",
    minOpenInterest: 500,
    minVolume: 25,
    minRsi: 25,
    maxRsi: 75,
    minIvRank: 15,
    maxIvRank: 100,
    minBbPercent: "0",
    maxBbPercent: "0.025",
    minScore: 55,
    maxStrikePercent: 95,
  },
  aggressive: {
    minDte: 270,
    maxDte: 450,
    minDelta: "0.70",
    maxDelta: "0.85",
    minOpenInterest: 100,
    minVolume: 10,
    minRsi: 20,
    maxRsi: 80,
    minIvRank: 10,
    maxIvRank: 100,
    minBbPercent: "0",
    maxBbPercent: "0.05",
    minScore: 45,
    maxStrikePercent: 100,
  },
};

/**
 * Default filter presets for Bull Put Spreads (BPS) strategy
 */
export const BPS_PRESETS = {
  conservative: {
    minDte: 7,
    maxDte: 60,
    minDelta: "0.05",
    maxDelta: "0.40",
    minOpenInterest: 10,
    minVolume: 10,
    minRsi: 0,
    maxRsi: 100,
    minIvRank: 0,
    maxIvRank: 100,
    minBbPercent: "0",
    maxBbPercent: "1.0",
    minScore: 50,
    maxStrikePercent: 110,
  },
  medium: {
    minDte: 7,
    maxDte: 60,
    minDelta: "0.05",
    maxDelta: "0.40",
    minOpenInterest: 10,
    minVolume: 10,
    minRsi: 0,
    maxRsi: 100,
    minIvRank: 0,
    maxIvRank: 100,
    minBbPercent: "0",
    maxBbPercent: "1.0",
    minScore: 40,
    maxStrikePercent: 110,
  },
  aggressive: {
    minDte: 7,
    maxDte: 60,
    minDelta: "0.05",
    maxDelta: "0.40",
    minOpenInterest: 10,
    minVolume: 10,
    minRsi: 0,
    maxRsi: 100,
    minIvRank: 0,
    maxIvRank: 100,
    minBbPercent: "0",
    maxBbPercent: "1.0",
    minScore: 30,
    maxStrikePercent: 110,
  },
};

/**
 * Default filter presets for Bear Call Spreads (BCS) strategy
 */
export const BCS_PRESETS = {
  conservative: {
    minDte: 14,
    maxDte: 45,
    minDelta: "0.10",
    maxDelta: "0.25",
    minOpenInterest: 50,
    minVolume: 50,
    minRsi: 65,
    maxRsi: 90,
    minIvRank: 40,
    maxIvRank: 100,
    minBbPercent: "0.7",
    maxBbPercent: "1.0",
    minScore: 60,
    maxStrikePercent: 105,
  },
  medium: {
    minDte: 10,
    maxDte: 30,
    minDelta: "0.15",
    maxDelta: "0.30",
    minOpenInterest: 75,
    minVolume: 40,
    minRsi: 55,
    maxRsi: 75,
    minIvRank: 30,
    maxIvRank: 100,
    minBbPercent: "0.5",
    maxBbPercent: "1.0",
    minScore: 50,
    maxStrikePercent: 110,
  },
  aggressive: {
    minDte: 7,
    maxDte: 21,
    minDelta: "0.20",
    maxDelta: "0.35",
    minOpenInterest: 50,
    minVolume: 30,
    minRsi: 50,
    maxRsi: 70,
    minIvRank: 20,
    maxIvRank: 100,
    minBbPercent: "0.3",
    maxBbPercent: "1.0",
    minScore: 40,
    maxStrikePercent: 115,
  },
};

/**
 * Get all onboarding configuration
 * This is the main export that the onboarding service will use
 */
export const ONBOARDING_CONFIG = {
  version: "1.0.0",
  lastUpdated: "2026-02-01",
  
  // Default watchlist
  watchlist: DEFAULT_WATCHLIST_SYMBOLS,
  
  // Filter presets for all strategies
  presets: {
    csp: CSP_PRESETS,
    cc: CC_PRESETS,
    pmcc: PMCC_PRESETS,
    bps: BPS_PRESETS,
    bcs: BCS_PRESETS,
  },
  
  // Add more default data here as needed
  // For example:
  // - Default user preferences
  // - Default notification settings
  // - Default dashboard layout
  // - etc.
};
