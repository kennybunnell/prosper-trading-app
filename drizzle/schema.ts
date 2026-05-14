import { bigint, boolean, decimal, index, int, mysqlEnum, mysqlTable, text, timestamp, unique, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin", "vip", "partner", "beta_tester", "lifetime"]).default("user").notNull(),
  /** Trading mode: 'live' uses Tastytrade API, 'paper' uses Tradier API (read-only) */
  tradingMode: mysqlEnum("tradingMode", ["live", "paper"]).default("paper").notNull(),
  /** Paper trading balance for simulation (default $100,000) */
  paperTradingBalance: int("paperTradingBalance").default(100000).notNull(),
  /** Subscription tier: free_trial (14-day trial), wheel_trading (paper trading $47/mo), live_trading_csp_cc (live CSP/CC $97/mo), advanced (all strategies $197/mo), vip (lifetime $5000) */
  subscriptionTier: mysqlEnum("subscriptionTier", ["free_trial", "wheel_trading", "live_trading_csp_cc", "advanced", "vip"]).default("free_trial"),
  /** Trial end date - 14 days from signup for new users */
  trialEndsAt: timestamp("trialEndsAt"),
  /** Stripe customer ID for subscription management */
  stripeCustomerId: varchar("stripeCustomerId", { length: 255 }),
  /** Stripe subscription ID */
  stripeSubscriptionId: varchar("stripeSubscriptionId", { length: 255 }),
  /** Legal agreements acceptance */
  acceptedTermsAt: timestamp("acceptedTermsAt"),
  acceptedRiskDisclosureAt: timestamp("acceptedRiskDisclosureAt"),
  /** IP address when legal agreements were accepted (for audit trail) */
  acceptedTermsIp: varchar("acceptedTermsIp", { length: 45 }),
  /** Access control: user must be approved by admin to access the app */
  isApproved: boolean("isApproved").default(false).notNull(),
  /** When the user was approved by admin */
  approvedAt: timestamp("approvedAt"),
  /** Admin user ID who approved this user */
  approvedBy: int("approvedBy"),
  /** Whether the user has seen the paper trading onboarding walkthrough */
  hasSeenPaperOnboarding: boolean("hasSeenPaperOnboarding").default(false).notNull(),
  /**
   * VIP Mode — admin-granted full access override.
   * When vipMode=true and (vipExpiresAt is null OR vipExpiresAt > now()), the user
   * gets full advanced-tier access regardless of their subscriptionTier.
   * Once expired or revoked (vipMode=false), they revert to their actual tier.
   */
  vipMode: boolean("vipMode").default(false).notNull(),
  /** VIP expiry timestamp (UTC). NULL = unlimited. Set to a future date for time-limited VIP. */
  vipExpiresAt: timestamp("vipExpiresAt"),
  /** When VIP was granted (for audit trail) */
  vipGrantedAt: timestamp("vipGrantedAt"),
  /** Admin user ID who granted VIP */
  vipGrantedBy: int("vipGrantedBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Watchlists for different trading strategies
 */
export const watchlists = mysqlTable("watchlists", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  symbol: varchar("symbol", { length: 10 }).notNull(),
  strategy: mysqlEnum("strategy", ["csp", "cc", "pmcc", "bps", "bcs"]).notNull(),
  // Metadata columns for enhanced watchlist management
  company: text("company"),
  type: varchar("type", { length: 20 }), // Growth, Value, Blend
  sector: varchar("sector", { length: 100 }),
  reason: text("reason"),
  rank: int("rank"),
  portfolioSize: mysqlEnum("portfolioSize", ["small", "medium", "large"]), // Portfolio size category
  price: varchar("price", { length: 20 }), // Current stock price
  isIndex: boolean("isIndex").notNull().default(false), // true = index/ETF (SPXW, NDX, RUT, etc.), false = equity
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index("watchlists_userId_idx").on(table.userId),
}));

export type Watchlist = typeof watchlists.$inferSelect;
export type InsertWatchlist = typeof watchlists.$inferInsert;

/**
 * Trades executed through the platform
 */
export const trades = mysqlTable("trades", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  accountId: varchar("accountId", { length: 64 }).notNull(),
  symbol: varchar("symbol", { length: 10 }).notNull(),
  strategy: mysqlEnum("strategy", ["csp", "cc", "pmcc", "bps", "bcs"]).notNull(),
  action: mysqlEnum("action", ["STO", "BTC", "BTO", "STC"]).notNull(),
  strike: varchar("strike", { length: 20 }).notNull(),
  expiration: varchar("expiration", { length: 20 }).notNull(),
  quantity: int("quantity").notNull(),
  premium: varchar("premium", { length: 20 }).notNull(),
  orderId: varchar("orderId", { length: 64 }),
  status: mysqlEnum("status", ["pending", "filled", "cancelled", "rejected"]).default("pending").notNull(),
  executedAt: timestamp("executedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Trade = typeof trades.$inferSelect;
export type InsertTrade = typeof trades.$inferInsert;

/**
 * Active and closed positions
 */
export const positions = mysqlTable("positions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  accountId: varchar("accountId", { length: 64 }).notNull(),
  symbol: varchar("symbol", { length: 10 }).notNull(),
  positionType: mysqlEnum("positionType", ["option", "stock"]).notNull(),
  strategy: mysqlEnum("strategy", ["csp", "cc", "pmcc", "stock"]),
  strike: varchar("strike", { length: 20 }),
  expiration: varchar("expiration", { length: 20 }),
  quantity: int("quantity").notNull(),
  costBasis: varchar("costBasis", { length: 20 }).notNull(),
  currentValue: varchar("currentValue", { length: 20 }),
  unrealizedPnL: varchar("unrealizedPnL", { length: 20 }),
  realizedPnL: varchar("realizedPnL", { length: 20 }),
  status: mysqlEnum("status", ["open", "closed"]).default("open").notNull(),
  // Spread-specific fields (nullable for backward compatibility)
  spreadType: mysqlEnum("spreadType", ["bull_put", "bear_call", "iron_condor"]),
  longStrike: varchar("longStrike", { length: 20 }), // For spreads: the protective leg strike
  spreadWidth: int("spreadWidth"), // Spread width in points (e.g., 5 for 5-point spread)
  capitalAtRisk: varchar("capitalAtRisk", { length: 20 }), // For spreads: max loss amount
  openedAt: timestamp("openedAt").defaultNow().notNull(),
  closedAt: timestamp("closedAt"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Position = typeof positions.$inferSelect;
export type InsertPosition = typeof positions.$inferInsert;

/**
 * Premium tracking for performance analytics
 */
export const premiumTracking = mysqlTable("premiumTracking", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  accountId: varchar("accountId", { length: 64 }).notNull(),
  tradeId: int("tradeId").references(() => trades.id, { onDelete: "set null" }),
  amount: varchar("amount", { length: 20 }).notNull(),
  type: mysqlEnum("type", ["collected", "paid"]).notNull(),
  strategy: mysqlEnum("strategy", ["csp", "cc", "pmcc", "bps", "bcs"]).notNull(),
  recordedAt: timestamp("recordedAt").defaultNow().notNull(),
});

export type PremiumTracking = typeof premiumTracking.$inferSelect;
export type InsertPremiumTracking = typeof premiumTracking.$inferInsert;

/**
 * API credentials for Tastytrade and Tradier
 */
export const apiCredentials = mysqlTable("apiCredentials", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  // Tastytrade OAuth2 credentials (new authentication method)
  tastytradeClientId: varchar("tastytradeClientId", { length: 255 }),
  tastytradeClientSecret: varchar("tastytradeClientSecret", { length: 255 }),
  tastytradeRefreshToken: text("tastytradeRefreshToken"),
  // Tastytrade OAuth2 access token (persisted to survive restarts)
  tastytradeAccessToken: text("tastytradeAccessToken"),
  tastytradeAccessTokenExpiresAt: timestamp("tastytradeAccessTokenExpiresAt"),
  // Legacy fields (deprecated - kept for backward compatibility during migration)
  tastytradeUsername: varchar("tastytradeUsername", { length: 255 }),
  tastytradePassword: varchar("tastytradePassword", { length: 255 }),
  // Tradier API credentials
  tradierApiKey: varchar("tradierApiKey", { length: 255 }),
  tradierAccountId: varchar("tradierAccountId", { length: 255 }),
  // Tradier account health monitoring
  tradierAccountBalance: varchar("tradierAccountBalance", { length: 20 }), // Current account balance
  tradierAccountStatus: varchar("tradierAccountStatus", { length: 50 }), // Account status (active, error, unknown)
  tradierBuyingPower: varchar("tradierBuyingPower", { length: 20 }), // Available buying power
  tradierLastHealthCheck: timestamp("tradierLastHealthCheck"), // Last time we checked account health
  defaultTastytradeAccountId: varchar("defaultTastytradeAccountId", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ApiCredentials = typeof apiCredentials.$inferSelect;
export type InsertApiCredentials = typeof apiCredentials.$inferInsert;

/**
 * User's Tastytrade accounts (IRA, Cash, etc.)
 */
export const tastytradeAccounts = mysqlTable("tastytradeAccounts", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  accountId: varchar("accountId", { length: 64 }).notNull().unique(),
  accountNumber: varchar("accountNumber", { length: 64 }).notNull(),
  accountType: varchar("accountType", { length: 64 }),
  nickname: varchar("nickname", { length: 128 }),
  isActive: int("isActive").default(1).notNull(),
  /** Demo account flag - true for simulated accounts, false/null for real Tastytrade accounts */
  isDemoAccount: int("isDemoAccount").default(0).notNull(),
  /** Demo account balance - only used when isDemoAccount = true */
  demoBalance: int("demoBalance").default(100000),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type TastytradeAccount = typeof tastytradeAccounts.$inferSelect;
export type InsertTastytradeAccount = typeof tastytradeAccounts.$inferInsert;

/**
 * Filter preset configurations for different strategies (CSP, CC, PMCC)
 * Each strategy has conservative, medium, and aggressive presets
 */
export const filterPresets = mysqlTable("filterPresets", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  strategy: mysqlEnum("strategy", ["csp", "cc", "pmcc", "bps", "bcs"]).notNull(),
  presetName: mysqlEnum("presetName", ["conservative", "medium", "aggressive"]).notNull(),
  
  // DTE (Days to Expiration) range
  minDte: int("minDte").notNull().default(7),
  maxDte: int("maxDte").notNull().default(45),
  
  // Delta range for put options
  minDelta: varchar("minDelta", { length: 10 }).notNull().default("0.15"),
  maxDelta: varchar("maxDelta", { length: 10 }).notNull().default("0.35"),
  
  // Open Interest minimum
  minOpenInterest: int("minOpenInterest").notNull().default(100),
  
  // Volume minimum
  minVolume: int("minVolume").notNull().default(50),
  
  // RSI (Relative Strength Index) range
  minRsi: int("minRsi").default(0),
  maxRsi: int("maxRsi").default(100),
  
  // IV Rank (Implied Volatility Rank) range
  minIvRank: int("minIvRank").default(0),
  maxIvRank: int("maxIvRank").default(100),
  
  // Bollinger Band %B range
  minBbPercent: varchar("minBbPercent", { length: 10 }).default("0"),
  maxBbPercent: varchar("maxBbPercent", { length: 10 }).default("1"),
  
  // Minimum combined score
  minScore: int("minScore").notNull().default(50),
  
  // Maximum strike price as percentage of stock price
  maxStrikePercent: int("maxStrikePercent").notNull().default(100),
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type FilterPreset = typeof filterPresets.$inferSelect;
export type InsertFilterPreset = typeof filterPresets.$inferInsert;

// Legacy type aliases for backward compatibility
export type CspFilterPreset = FilterPreset;
export type InsertCspFilterPreset = InsertFilterPreset;
/**
 * User preferences for trading settings
 */
export const userPreferences = mysqlTable("userPreferences", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  
  // Default Tastytrade account for trading
  defaultTastytradeAccountId: varchar("defaultTastytradeAccountId", { length: 64 }),
  
  // Background texture settings
  damascusOpacity: int("damascusOpacity").notNull().default(8),
  backgroundPattern: mysqlEnum("backgroundPattern", ["diagonal", "crosshatch", "dots", "woven", "none"]).notNull().default("diagonal"),
  
  // Strategy Advisor auto-refresh settings
  strategyAdvisorAutoRefresh: boolean("strategyAdvisorAutoRefresh").notNull().default(false),
  strategyAdvisorRefreshInterval: int("strategyAdvisorRefreshInterval").notNull().default(30), // minutes (15, 30, 60)
  
  // Tax settings
  taxRate: int("taxRate").notNull().default(24), // User's marginal tax rate percentage (e.g., 24, 32, 37)
  
  // Monthly premium income target (in dollars, e.g. 150000 = $150,000)
  monthlyIncomeTarget: int("monthlyIncomeTarget").notNull().default(150000),
  
  // Friday expiration sweep schedule toggle
  fridaySweepEnabled: boolean("fridaySweepEnabled").notNull().default(true), // Auto-run sweep every Friday at 9:30 AM ET
  // Daily ITM scan schedule toggle
  dailyScanEnabled: boolean("dailyScanEnabled").notNull().default(true), // Auto-run daily ITM scan every weekday at 9:00 AM ET
  // Last sweep audit trail
  lastSweepAt: bigint("lastSweepAt", { mode: "number" }), // UTC ms timestamp of last sweep run
  lastSweepAlertCount: int("lastSweepAlertCount").notNull().default(0), // Number of alerts found in last sweep
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type UserPreference = typeof userPreferences.$inferSelect;
export type InsertUserPreference = typeof userPreferences.$inferInsert;

/**
 * PMCC LEAP positions - tracks purchased LEAP call options used for Poor Man's Covered Calls
 */
export const pmccLeapPositions = mysqlTable("pmccLeapPositions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  accountId: varchar("accountId", { length: 64 }).notNull(),
  symbol: varchar("symbol", { length: 10 }).notNull(),
  strike: varchar("strike", { length: 20 }).notNull(),
  expiration: varchar("expiration", { length: 20 }).notNull(), // LEAP expiration (9-15 months out)
  quantity: int("quantity").notNull(), // Number of LEAP contracts owned
  purchasePrice: varchar("purchasePrice", { length: 20 }).notNull(), // Price paid per contract
  currentPrice: varchar("currentPrice", { length: 20 }), // Current market price
  delta: varchar("delta", { length: 10 }), // Delta at purchase time
  score: int("score"), // Opportunity score at purchase time
  availableContracts: int("availableContracts").notNull(), // Contracts available for selling calls (quantity - active short calls)
  status: mysqlEnum("status", ["active", "closed"]).default("active").notNull(),
  purchasedAt: timestamp("purchasedAt").defaultNow().notNull(),
  closedAt: timestamp("closedAt"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type PmccLeapPosition = typeof pmccLeapPositions.$inferSelect;
export type InsertPmccLeapPosition = typeof pmccLeapPositions.$inferInsert;

/**
 * Order history tracking for fill rate analytics and order lifecycle management
 * Tracks when orders are submitted, replaced, filled, or canceled
 */
export const orderHistory = mysqlTable("orderHistory", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  accountId: varchar("accountId", { length: 64 }).notNull(),
  
  // Order identification
  orderId: varchar("orderId", { length: 64 }).notNull(),
  symbol: varchar("symbol", { length: 10 }).notNull(),
  underlyingSymbol: varchar("underlyingSymbol", { length: 10 }).notNull(),
  action: varchar("action", { length: 20 }).notNull(), // "Buy to Close", "Sell to Open", etc.
  strategy: varchar("strategy", { length: 50 }), // e.g., "Buy-side: Ask + $0.01 (working order)"
  
  // Order details
  strike: varchar("strike", { length: 20 }).notNull(),
  expiration: varchar("expiration", { length: 20 }).notNull(),
  quantity: int("quantity").notNull(),
  submittedPrice: varchar("submittedPrice", { length: 20 }).notNull(),
  finalPrice: varchar("finalPrice", { length: 20 }), // Price at which order filled
  
  // Lifecycle tracking
  submittedAt: timestamp("submittedAt").notNull(),
  filledAt: timestamp("filledAt"),
  canceledAt: timestamp("canceledAt"),
  replacementCount: int("replacementCount").notNull().default(0), // How many times this order was replaced
  
  // Fill rate metrics
  fillDurationMinutes: int("fillDurationMinutes"), // Time from submission to fill
  wasAutoCanceled: int("wasAutoCanceled").default(0).notNull(), // 1 if auto-canceled for being stuck
  
  // Status
  status: mysqlEnum("status", ["working", "filled", "canceled", "rejected"]).default("working").notNull(),
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type OrderHistory = typeof orderHistory.$inferSelect;
export type InsertOrderHistory = typeof orderHistory.$inferInsert;

/**
 * Submitted roll tracking
 * Records every roll order submitted (non-dry-run) so the Roll Dashboard
 * can flag positions that have already been rolled today and avoid re-rolling.
 */
export const submittedRolls = mysqlTable("submittedRolls", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  accountId: varchar("accountId", { length: 64 }).notNull(),
  /** The positionId used by the Roll Dashboard (e.g. "5WZ80418::SPY::2026-04-06::CC::644") */
  positionId: varchar("positionId", { length: 200 }).notNull(),
  symbol: varchar("symbol", { length: 10 }).notNull(),
  strategy: varchar("strategy", { length: 10 }).notNull(), // cc, csp, bps, bcs, ic
  /** tastytrade order ID returned after successful submission */
  orderId: varchar("orderId", { length: 64 }).notNull(),
  /** The new expiry the position was rolled to */
  newExpiration: varchar("newExpiration", { length: 20 }),
  /** The new strike the position was rolled to */
  newStrike: varchar("newStrike", { length: 20 }),
  /** Net credit/debit received for the roll */
  netCredit: varchar("netCredit", { length: 20 }),
  rolledAt: timestamp("rolledAt").defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index("submittedRolls_userId_idx").on(table.userId),
  positionDateIdx: index("submittedRolls_positionId_date_idx").on(table.positionId, table.rolledAt),
}));

export type SubmittedRoll = typeof submittedRolls.$inferSelect;
export type InsertSubmittedRoll = typeof submittedRolls.$inferInsert;

/**
 * Watchlist ticker selections
 * Stores which tickers are selected for scanning across all dashboards
 */
export const watchlistSelections = mysqlTable("watchlistSelections", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  symbol: varchar("symbol", { length: 10 }).notNull(),
  isSelected: int("isSelected").default(1).notNull(), // 1 = selected, 0 = not selected
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  userIdIdx: index("watchlistSelections_userId_idx").on(table.userId),
}));

export type WatchlistSelection = typeof watchlistSelections.$inferSelect;
export type InsertWatchlistSelection = typeof watchlistSelections.$inferInsert;

/**
 * Paper trading mock stock positions
 * Stores simulated stock positions for users in paper trading mode
 */
export const paperTradingPositions = mysqlTable("paperTradingPositions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  symbol: varchar("symbol", { length: 10 }).notNull(),
  companyName: text("companyName"),
  quantity: int("quantity").notNull(), // Number of shares
  costBasis: varchar("costBasis", { length: 20 }).notNull(), // Average cost per share
  currentPrice: varchar("currentPrice", { length: 20 }), // Current market price
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  userIdIdx: index("paperTradingPositions_userId_idx").on(table.userId),
}));

export type PaperTradingPosition = typeof paperTradingPositions.$inferSelect;
export type InsertPaperTradingPosition = typeof paperTradingPositions.$inferInsert;

/**
 * Paper trading performance data
 * Stores mock monthly premium earnings for users in paper trading mode
 */
export const paperTradingPerformance = mysqlTable("paperTradingPerformance", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  month: varchar("month", { length: 7 }).notNull(), // Format: YYYY-MM
  netPremium: int("netPremium").notNull(), // Net premium earned in cents
  cumulativeTotal: int("cumulativeTotal").notNull(), // Cumulative total in cents
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index("paperTradingPerformance_userId_idx").on(table.userId),
  monthIdx: index("paperTradingPerformance_month_idx").on(table.month),
}));

export type PaperTradingPerformance = typeof paperTradingPerformance.$inferSelect;
export type InsertPaperTradingPerformance = typeof paperTradingPerformance.$inferInsert;

/**
 * User feedback and support tickets
 */
export const feedback = mysqlTable("feedback", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: mysqlEnum("type", ["bug", "feature", "question", "feedback"]).notNull(),
  priority: mysqlEnum("priority", ["low", "medium", "high", "urgent"]).default("medium").notNull(),
  status: mysqlEnum("status", ["new", "in_progress", "resolved", "closed"]).default("new").notNull(),
  subject: varchar("subject", { length: 255 }).notNull(),
  description: text("description").notNull(),
  pageUrl: varchar("pageUrl", { length: 500 }), // Where user was when submitting
  screenshotUrl: varchar("screenshotUrl", { length: 500 }),
  userAgent: text("userAgent"), // Browser/device info
  assignedToAdminId: int("assignedToAdminId").references(() => users.id),
  resolvedAt: timestamp("resolvedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  userIdIdx: index("feedback_userId_idx").on(table.userId),
  statusIdx: index("feedback_status_idx").on(table.status),
  createdAtIdx: index("feedback_createdAt_idx").on(table.createdAt),
}));

export type Feedback = typeof feedback.$inferSelect;
export type InsertFeedback = typeof feedback.$inferInsert;

/**
 * Feedback replies and conversation thread
 */
export const feedbackReplies = mysqlTable("feedbackReplies", {
  id: int("id").autoincrement().primaryKey(),
  feedbackId: int("feedbackId").notNull().references(() => feedback.id, { onDelete: "cascade" }),
  userId: int("userId").notNull().references(() => users.id), // Who replied (user or admin)
  isAdminReply: boolean("isAdminReply").default(false).notNull(),
  message: text("message").notNull(),
  videoUrl: varchar("videoUrl", { length: 500 }), // Video attachment for replies
  isInternalNote: boolean("isInternalNote").default(false).notNull(), // Admin-only notes
  readByUser: boolean("readByUser").default(false).notNull(), // Track if user has read admin reply
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  feedbackIdIdx: index("feedbackReplies_feedbackId_idx").on(table.feedbackId),
}));

export type FeedbackReply = typeof feedbackReplies.$inferSelect;
export type InsertFeedbackReply = typeof feedbackReplies.$inferInsert;

/**
 * User activity tracking for analytics
 */
export const userActivity = mysqlTable("userActivity", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  activityType: mysqlEnum("activityType", [
    "login",
    "logout",
    "page_view",
    "api_call",
    "strategy_view",
    "opportunity_fetch",
    "trade_submit",
    "preset_change",
    "watchlist_update",
  ]).notNull(),
  metadata: text("metadata"), // JSON string for additional context
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index("userActivity_userId_idx").on(table.userId),
  activityTypeIdx: index("userActivity_activityType_idx").on(table.activityType),
  createdAtIdx: index("userActivity_createdAt_idx").on(table.createdAt),
}));

export type UserActivity = typeof userActivity.$inferSelect;
export type InsertUserActivity = typeof userActivity.$inferInsert;

/**
 * Broadcast messages sent by admins
 */
export const broadcasts = mysqlTable("broadcasts", {
  id: int("id").autoincrement().primaryKey(),
  sentByAdminId: int("sentByAdminId").notNull().references(() => users.id),
  targetTier: mysqlEnum("targetTier", ["all", "free_trial", "wheel_trading", "live_trading_csp_cc", "advanced", "vip"]).default("all").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  message: text("message").notNull(),
  videoUrl: varchar("videoUrl", { length: 500 }), // Optional video link for tutorials/walkthroughs
  recipientCount: int("recipientCount").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  createdAtIdx: index("broadcasts_createdAt_idx").on(table.createdAt),
}));

export type Broadcast = typeof broadcasts.$inferSelect;
export type InsertBroadcast = typeof broadcasts.$inferInsert;

/**
 * Track which users have read or deleted broadcast messages
 */
export const broadcastReads = mysqlTable("broadcastReads", {
  id: int("id").autoincrement().primaryKey(),
  broadcastId: int("broadcastId").notNull().references(() => broadcasts.id, { onDelete: "cascade" }),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  isRead: boolean("isRead").default(false).notNull(),
  isDeleted: boolean("isDeleted").default(false).notNull(),
  readAt: timestamp("readAt"),
  deletedAt: timestamp("deletedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  broadcastUserIdx: index("broadcastReads_broadcastUser_idx").on(table.broadcastId, table.userId),
  userIdIdx: index("broadcastReads_userId_idx").on(table.userId),
}));

export type BroadcastRead = typeof broadcastReads.$inferSelect;
export type InsertBroadcastRead = typeof broadcastReads.$inferInsert;

/**
 * AI-powered support chat conversations
 */
export const chatConversations = mysqlTable("chatConversations", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  subject: varchar("subject", { length: 255 }).notNull(), // First question or auto-generated summary
  status: mysqlEnum("status", ["active", "resolved", "needs_admin"]).default("active").notNull(),
  hasAdminReplied: boolean("hasAdminReplied").default(false).notNull(), // Track if admin has joined conversation
  lastMessageAt: timestamp("lastMessageAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  userIdIdx: index("chatConversations_userId_idx").on(table.userId),
  statusIdx: index("chatConversations_status_idx").on(table.status),
  lastMessageAtIdx: index("chatConversations_lastMessageAt_idx").on(table.lastMessageAt),
}));

export type ChatConversation = typeof chatConversations.$inferSelect;
export type InsertChatConversation = typeof chatConversations.$inferInsert;

/**
 * Individual messages within chat conversations
 */
export const chatMessages = mysqlTable("chatMessages", {
  id: int("id").autoincrement().primaryKey(),
  conversationId: int("conversationId").notNull().references(() => chatConversations.id, { onDelete: "cascade" }),
  senderId: int("senderId").references(() => users.id), // Null for AI messages
  senderType: mysqlEnum("senderType", ["user", "ai", "admin"]).notNull(),
  message: text("message").notNull(),
  isRead: boolean("isRead").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  conversationIdIdx: index("chatMessages_conversationId_idx").on(table.conversationId),
  createdAtIdx: index("chatMessages_createdAt_idx").on(table.createdAt),
}));

export type ChatMessage = typeof chatMessages.$inferSelect;
export type InsertChatMessage = typeof chatMessages.$inferInsert;

/**
 * OAuth2 tokens for persistent authentication
 * Stores encrypted refresh tokens to survive server hibernation
 */
export const oauthTokens = mysqlTable("oauthTokens", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: varchar("provider", { length: 50 }).notNull(), // 'tastytrade', 'tradier', etc.
  refreshToken: text("refreshToken").notNull(), // Encrypted refresh token
  accessToken: text("accessToken"), // Encrypted access token (optional)
  expiresAt: timestamp("expiresAt"), // Access token expiration
  scopes: text("scopes"), // OAuth scopes granted (comma-separated)
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  uniqueUserProvider: unique("unique_user_provider").on(table.userId, table.provider),
  userIdIdx: index("oauthTokens_userId_idx").on(table.userId),
}));

export type OAuthToken = typeof oauthTokens.$inferSelect;
export type InsertOAuthToken = typeof oauthTokens.$inferInsert;

/**
 * Monthly premium cache to reduce API load and improve performance
 * Stores aggregated premium data for completed months
 */
export const monthlyPremiumCache = mysqlTable("monthlyPremiumCache", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  accountId: varchar("accountId", { length: 64 }).notNull(),
  month: varchar("month", { length: 7 }).notNull(), // Format: YYYY-MM (e.g., "2026-01")
  netPremium: varchar("netPremium", { length: 20 }).notNull(), // Credits - Debits
  credits: varchar("credits", { length: 20 }).notNull(), // Total credits (money received)
  debits: varchar("debits", { length: 20 }).notNull(), // Total debits (money paid)
  transactionCount: int("transactionCount").notNull(), // Number of transactions included
  isLocked: int("isLocked").default(0).notNull(), // 1 = locked (completed month), 0 = current month
  lastUpdated: timestamp("lastUpdated").defaultNow().onUpdateNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  uniqueUserAccountMonth: unique("unique_user_account_month").on(table.userId, table.accountId, table.month),
  userIdIdx: index("monthlyPremiumCache_userId_idx").on(table.userId),
  monthIdx: index("monthlyPremiumCache_month_idx").on(table.month),
}));

export type MonthlyPremiumCache = typeof monthlyPremiumCache.$inferSelect;
export type InsertMonthlyPremiumCache = typeof monthlyPremiumCache.$inferInsert;

/**
 * API usage tracking for rate limiting (Tier 1 free trial users)
 * Tracks daily scan counts to enforce 10 scans/day limit
 */
export const apiUsage = mysqlTable("apiUsage", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  date: varchar("date", { length: 10 }).notNull(), // Format: YYYY-MM-DD
  scanCount: int("scanCount").default(0).notNull(), // Number of scans performed today
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  uniqueUserDate: unique("unique_user_date").on(table.userId, table.date),
  userIdIdx: index("apiUsage_userId_idx").on(table.userId),
  dateIdx: index("apiUsage_date_idx").on(table.date),
}));

export type ApiUsage = typeof apiUsage.$inferSelect;
export type InsertApiUsage = typeof apiUsage.$inferInsert;

/**
 * User invitations for controlled access
 */
export const invites = mysqlTable("invites", {
  id: int("id").autoincrement().primaryKey(),
  /** Email address to send invite to */
  email: varchar("email", { length: 320 }).notNull(),
  /** Unique invite code for URL */
  code: varchar("code", { length: 64 }).notNull().unique(),
  /** Invite status */
  status: mysqlEnum("status", ["pending", "accepted", "revoked", "expired"]).default("pending").notNull(),
  /** When the invite expires (7 days from creation) */
  expiresAt: timestamp("expiresAt").notNull(),
  /** Admin user ID who sent the invite */
  invitedBy: int("invitedBy").notNull().references(() => users.id),
  /** User ID who accepted the invite (null if not accepted yet) */
  acceptedBy: int("acceptedBy"),
  /** When the invite was accepted */
  acceptedAt: timestamp("acceptedAt"),
  /** When the invite was revoked by admin */
  revokedAt: timestamp("revokedAt"),
  /** Optional note from admin about this invite */
  note: text("note"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  emailIdx: index("invites_email_idx").on(table.email),
  statusIdx: index("invites_status_idx").on(table.status),
  invitedByIdx: index("invites_invitedBy_idx").on(table.invitedBy),
}));

export type Invite = typeof invites.$inferSelect;
export type InsertInvite = typeof invites.$inferInsert;

/**
 * Automation settings for daily trading automation
 */
export const automationSettings = mysqlTable("automationSettings", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }).unique(),
  // Mode toggles
  dryRunMode: boolean("dryRunMode").default(true).notNull(),
  requireApproval: boolean("requireApproval").default(true).notNull(),
  autoScheduleEnabled: boolean("autoScheduleEnabled").default(false).notNull(),
  scheduleTime: varchar("scheduleTime", { length: 10 }).default("09:35").notNull(), // HH:MM format in ET
  // Close positions settings
  profitThresholdPercent: int("profitThresholdPercent").default(75).notNull(),
  // Covered call automation settings
  ccAutomationEnabled: boolean("ccAutomationEnabled").default(false).notNull(),
  ccDteMin: int("ccDteMin").default(7).notNull(),
  ccDteMax: int("ccDteMax").default(14).notNull(),
  ccDeltaMin: varchar("ccDeltaMin", { length: 10 }).default("0.25").notNull(),
  ccDeltaMax: varchar("ccDeltaMax", { length: 10 }).default("0.30").notNull(),
  // Roll automation settings (future)
  rollEnabled: boolean("rollEnabled").default(false).notNull(),
  rollDteThreshold: int("rollDteThreshold").default(7).notNull(), // Roll when DTE <= this
  rollProfitThreshold: int("rollProfitThreshold").default(50).notNull(), // Only roll if profit% < this
  // Email notifications
  emailNotificationsEnabled: boolean("emailNotificationsEnabled").default(true).notNull(),
  notificationEmail: varchar("notificationEmail", { length: 320 }),
  // Weekly Monday morning position digest
  weeklyPositionDigestEnabled: boolean("weeklyPositionDigestEnabled").default(false).notNull(),
  // AI Tier 1 scoring for CC scan results
  aiScoringEnabled: boolean("aiScoringEnabled").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AutomationSettings = typeof automationSettings.$inferSelect;
export type InsertAutomationSettings = typeof automationSettings.$inferInsert;

/**
 * Automation execution logs
 */
export const automationLogs = mysqlTable("automationLogs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  runId: varchar("runId", { length: 64 }).notNull().unique(), // UUID for this automation run
  status: mysqlEnum("status", ["running", "completed", "failed", "cancelled"]).default("running").notNull(),
  triggerType: mysqlEnum("triggerType", ["manual", "scheduled"]).notNull(),
  dryRun: boolean("dryRun").default(true).notNull(),
  // Summary statistics
  positionsClosedCount: int("positionsClosedCount").default(0).notNull(),
  coveredCallsOpenedCount: int("coveredCallsOpenedCount").default(0).notNull(),
  totalProfitRealized: varchar("totalProfitRealized", { length: 20 }).default("0").notNull(),
  totalPremiumCollected: varchar("totalPremiumCollected", { length: 20 }).default("0").notNull(),
  accountsProcessed: int("accountsProcessed").default(0).notNull(),
  errorMessage: text("errorMessage"),
  scanResultsJson: text("scanResultsJson"), // JSON array of BTC scan results for dry-run display
  ccScanResultsJson: text("ccScanResultsJson"), // JSON array of CC scan results (covered calls to open)
  ccExcludedStocksJson: text("ccExcludedStocksJson"), // JSON array of excluded stocks with reasons (maxContracts=0)
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
}, (table) => ({
  userIdIdx: index("automationLogs_userId_idx").on(table.userId),
  runIdIdx: index("automationLogs_runId_idx").on(table.runId),
}));

export type AutomationLog = typeof automationLogs.$inferSelect;
export type InsertAutomationLog = typeof automationLogs.$inferInsert;

/**
 * Pending automation orders awaiting approval
 */
export const automationPendingOrders = mysqlTable("automationPendingOrders", {
  id: int("id").autoincrement().primaryKey(),
  runId: varchar("runId", { length: 64 }).notNull().references(() => automationLogs.runId, { onDelete: "cascade" }),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  accountNumber: varchar("accountNumber", { length: 64 }).notNull(),
  orderType: mysqlEnum("orderType", ["close_position", "open_covered_call", "close_spread"]).notNull(),
  symbol: varchar("symbol", { length: 64 }).notNull(),  // Option symbols can be 21+ chars e.g. AAPL250117P00150000
  // Spread order fields (populated when orderType = 'close_spread')
  spreadLongSymbol: varchar("spreadLongSymbol", { length: 64 }),  // Long leg OCC symbol
  spreadLongStrike: varchar("spreadLongStrike", { length: 20 }),  // Long leg strike price
  spreadLongPrice: varchar("spreadLongPrice", { length: 20 }),    // Long leg close price
  strike: varchar("strike", { length: 20 }),
  expiration: varchar("expiration", { length: 64 }),  // ISO timestamps from Tastytrade can be 25+ chars
  quantity: int("quantity").notNull(),
  price: varchar("price", { length: 20 }).notNull(),
  // Additional context
  profitPercent: int("profitPercent"), // For close_position orders
  score: int("score"), // For open_covered_call orders
  estimatedProfit: varchar("estimatedProfit", { length: 20 }),
  estimatedPremium: varchar("estimatedPremium", { length: 20 }),
  // Order status
  status: mysqlEnum("status", ["pending", "approved", "rejected", "submitted", "failed"]).default("pending").notNull(),
  orderId: varchar("orderId", { length: 64 }), // Tastytrade order ID after submission
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  approvedAt: timestamp("approvedAt"),
  submittedAt: timestamp("submittedAt"),
}, (table) => ({
  runIdIdx: index("automationPendingOrders_runId_idx").on(table.runId),
  userIdIdx: index("automationPendingOrders_userId_idx").on(table.userId),
  statusIdx: index("automationPendingOrders_status_idx").on(table.status),
}));

export type AutomationPendingOrder = typeof automationPendingOrders.$inferSelect;
export type InsertAutomationPendingOrder = typeof automationPendingOrders.$inferInsert;

/**
 * Scan history log — records every Friday sweep and daily scan run
 */
export const scanHistory = mysqlTable('scan_history', {
  id: int('id').primaryKey().autoincrement(),
  userId: int('user_id').notNull(),
  scanType: varchar('scan_type', { length: 20 }).notNull(), // 'friday_sweep' | 'daily_scan'
  ranAt: bigint('ran_at', { mode: 'number' }).notNull(),
  alertCount: int('alert_count').notNull().default(0),
  accountsScanned: int('accounts_scanned').notNull().default(0),
  triggeredBy: varchar('triggered_by', { length: 20 }).notNull().default('auto'), // 'auto' | 'manual'
  summaryJson: text('summary_json'),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  userRanIdx: index('scan_history_user_ran_idx').on(table.userId, table.ranAt),
}));

export type ScanHistory = typeof scanHistory.$inferSelect;
export type InsertScanHistory = typeof scanHistory.$inferInsert;

/**
 * Snoozed violations — lets users dismiss ITM_ASSIGNMENT_RISK warnings for 24 hours.
 * Only applies to warnings (ITM_ASSIGNMENT_RISK); critical violations cannot be snoozed.
 */
export const snoozedViolations = mysqlTable('snoozed_violations', {
  id: int('id').primaryKey().autoincrement(),
  userId: int('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  symbol: varchar('symbol', { length: 10 }).notNull(),
  accountNumber: varchar('account_number', { length: 64 }).notNull(),
  violationType: varchar('violation_type', { length: 40 }).notNull(), // ITM_ASSIGNMENT_RISK only
  snoozedUntil: bigint('snoozed_until', { mode: 'number' }).notNull(), // UTC ms timestamp
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  userIdx: index('snoozed_violations_user_idx').on(table.userId),
  lookupIdx: index('snoozed_violations_lookup_idx').on(table.userId, table.symbol, table.accountNumber, table.violationType),
}));

export type SnoozedViolation = typeof snoozedViolations.$inferSelect;
export type InsertSnoozedViolation = typeof snoozedViolations.$inferInsert;

/**
 * Liquidation flags — manually set by the user to mark a stock position for exit.
 * When flagged: no new covered call STO orders will be opened on this symbol/account
 * by automation or the CC-BCS dashboard. Spreads (BPS, BCS, IC) are still allowed.
 */
export const liquidationFlags = mysqlTable('liquidation_flags', {
  id: int('id').primaryKey().autoincrement(),
  userId: int('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  symbol: varchar('symbol', { length: 10 }).notNull(),
  accountNumber: varchar('account_number', { length: 64 }).notNull(),
  flaggedAt: timestamp('flagged_at').defaultNow().notNull(),
  note: varchar('note', { length: 255 }),
}, (table) => ({
  userIdx: index('liquidation_flags_user_idx').on(table.userId),
  lookupIdx: index('liquidation_flags_lookup_idx').on(table.userId, table.symbol, table.accountNumber),
}));
export type LiquidationFlag = typeof liquidationFlags.$inferSelect;
export type InsertLiquidationFlag = typeof liquidationFlags.$inferInsert;

/**
 * App-level configuration store — key/value pairs that must survive sandbox
 * restarts and environment variable rotation.
 *
 * The most critical use-case is the JWT signing secret: generated once on first
 * boot, persisted here forever, and used in place of the JWT_SECRET env var.
 * This makes all user sessions immune to sandbox hibernation / secret rotation.
 */
export const appConfig = mysqlTable('app_config', {
  key: varchar('key', { length: 128 }).primaryKey(),
  value: text('value').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
});
export type AppConfig = typeof appConfig.$inferSelect;

/**
 * WTR History — records the Weeks-to-Recover value for each position every time
 * the Position Analyzer is run. Used to surface week-over-week WTR deltas on
 * each position card so the user can see whether a position is recovering or
 * deteriorating over time.
 *
 * One row per (userId, symbol, accountNumber, scanDate).
 * scanDate is stored as a YYYY-MM-DD string so we can group by calendar week.
 */
export const wtrHistory = mysqlTable('wtr_history', {
  id: int('id').primaryKey().autoincrement(),
  userId: int('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  symbol: varchar('symbol', { length: 10 }).notNull(),
  accountNumber: varchar('account_number', { length: 64 }).notNull(),
  /** YYYY-MM-DD date of the scan */
  scanDate: varchar('scan_date', { length: 10 }).notNull(),
  /** UTC ms timestamp of the scan (for precise ordering) */
  scannedAt: bigint('scanned_at', { mode: 'number' }).notNull(),
  /** Weeks-to-Recover value at time of scan; null means no deficit (KEEP) */
  weeksToRecover: varchar('weeks_to_recover', { length: 20 }),
  /** Recommendation tier at time of scan */
  recommendation: mysqlEnum('recommendation', ['KEEP', 'HARVEST', 'MONITOR', 'LIQUIDATE']).notNull(),
  /** Average cost basis at time of scan */
  avgCostBasis: varchar('avg_cost_basis', { length: 20 }).notNull(),
  /** Current price at time of scan */
  currentPrice: varchar('current_price', { length: 20 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  userSymbolAccountIdx: index('wtr_history_user_symbol_account_idx').on(table.userId, table.symbol, table.accountNumber),
  userScanDateIdx: index('wtr_history_user_scan_date_idx').on(table.userId, table.scanDate),
  scannedAtIdx: index('wtr_history_scanned_at_idx').on(table.scannedAt),
}));
export type WtrHistory = typeof wtrHistory.$inferSelect;
export type InsertWtrHistory = typeof wtrHistory.$inferInsert;

/**
 * GTC Close Orders
 * Tracks automatically-submitted GTC (Good Till Cancelled) close orders
 * that are placed immediately after a fill at the user's profit target.
 *
 * One row per STO fill that triggers a GTC close order.
 * Status lifecycle: pending → submitted → filled | cancelled | failed
 */
export const gtcOrders = mysqlTable('gtcOrders', {
  id: int('id').primaryKey().autoincrement(),
  userId: int('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  accountId: varchar('accountId', { length: 64 }).notNull(),

  // Source STO order that triggered this GTC
  sourceOrderId: varchar('sourceOrderId', { length: 64 }).notNull(),
  sourceStrategy: varchar('sourceStrategy', { length: 30 }).notNull(), // 'iron_condor' | 'bps' | 'bcs' | 'csp' | 'cc'

  // Underlying and legs
  symbol: varchar('symbol', { length: 10 }).notNull(),
  expiration: varchar('expiration', { length: 20 }).notNull(),

  // Premium collected at fill (per share, pre-multiplied by 100 for total)
  premiumCollected: varchar('premiumCollected', { length: 20 }).notNull(), // e.g. "3.50"
  totalPremiumCollected: varchar('totalPremiumCollected', { length: 20 }).notNull(), // e.g. "350.00"

  // Profit target
  profitTargetPct: int('profitTargetPct').notNull().default(75), // 25, 50, 75, or 90
  targetClosePrice: varchar('targetClosePrice', { length: 20 }).notNull(), // GTC limit price (per share)

  // GTC order details (populated after submission)
  gtcOrderId: varchar('gtcOrderId', { length: 64 }), // Tastytrade order ID
  submittedAt: timestamp('submittedAt'),
  filledAt: timestamp('filledAt'),
  cancelledAt: timestamp('cancelledAt'),

  // P&L (populated when status = filled)
  closeCost: varchar('closeCost', { length: 20 }),       // BTC fill price per share, e.g. "0.875"
  totalCloseCost: varchar('totalCloseCost', { length: 20 }), // closeCost * 100 * contracts, e.g. "87.50"
  realizedPnl: varchar('realizedPnl', { length: 20 }),   // totalPremiumCollected - totalCloseCost, e.g. "262.50"
  realizedPnlPct: varchar('realizedPnlPct', { length: 10 }), // realizedPnl / totalPremiumCollected * 100, e.g. "75.00"

  // Status
  status: mysqlEnum('status', ['pending', 'submitted', 'filled', 'cancelled', 'failed']).default('pending').notNull(),
  errorMessage: text('errorMessage'), // If status = failed

  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  userIdIdx: index('gtcOrders_userId_idx').on(table.userId),
  sourceOrderIdx: index('gtcOrders_sourceOrder_idx').on(table.sourceOrderId),
  statusIdx: index('gtcOrders_status_idx').on(table.status),
}));

export type GtcOrder = typeof gtcOrders.$inferSelect;
export type InsertGtcOrder = typeof gtcOrders.$inferInsert;

/**
 * Daily scan cache — stores pre-computed counts and top items for the 3 key
 * automation steps (Close for Profit, Roll Positions, Sell Calls).
 * Populated by the 8:30 AM ET scheduled cron job.
 * One row per user per scan run (upserted on each run).
 */
export const dailyScanCache = mysqlTable('daily_scan_cache', {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** UTC timestamp when this cache entry was last populated */
  scannedAt: timestamp("scannedAt").notNull(),
  /** Count of positions at >= 90% of max profit (ready to close) */
  closeProfitCount: int("closeProfitCount").default(0).notNull(),
  /** JSON array of top items for Close for Profit (symbol, profitPct, daysLeft) */
  closeProfitItems: text("closeProfitItems"),
  /** Count of short option positions with DTE <= 7 needing a roll */
  rollPositionsCount: int("rollPositionsCount").default(0).notNull(),
  /** JSON array of top items for Roll Positions (symbol, dte, strike, type) */
  rollPositionsItems: text("rollPositionsItems"),
  /** Count of HARVEST/MONITOR stock positions with no active covered call */
  sellCallsCount: int("sellCallsCount").default(0).notNull(),
  /** JSON array of top items for Sell Calls (symbol, shares, wtr, recommendation) */
  sellCallsItems: text("sellCallsItems"),
  /** Whether the last scan completed successfully */
  scanSuccess: boolean("scanSuccess").default(true).notNull(),
  /** Error message if scan failed */
  scanError: text("scanError"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DailyScanCache = typeof dailyScanCache.$inferSelect;
export type InsertDailyScanCache = typeof dailyScanCache.$inferInsert;


/**
 * Paper trading simulated orders
 * Records every dry-run / paper order submission for history and P&L tracking
 */
export const paperTradingOrders = mysqlTable('paperTradingOrders', {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  strategy: varchar("strategy", { length: 30 }).notNull(),
  action: varchar("action", { length: 10 }).notNull().default('STO'),
  optionType: varchar("optionType", { length: 10 }),
  strike: varchar("strike", { length: 20 }),
  expiration: varchar("expiration", { length: 10 }),
  dte: int("dte"),
  premiumCents: int("premiumCents"),
  contracts: int("contracts").notNull().default(1),
  totalPremiumCents: int("totalPremiumCents"),
  delta: varchar("delta", { length: 10 }),
  status: mysqlEnum("status", ["open", "closed", "expired"]).notNull().default("open"),
  pnlCents: int("pnlCents"),
  orderSnapshot: text("orderSnapshot"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  userIdIdx: index("paperTradingOrders_userId_idx").on(table.userId),
  statusIdx: index("paperTradingOrders_status_idx").on(table.status),
}));
export type PaperTradingOrder = typeof paperTradingOrders.$inferSelect;
export type InsertPaperTradingOrder = typeof paperTradingOrders.$inferInsert;

/**
 * Cached Tastytrade Positions
 * Mirrors live positions from Tastytrade. Synced on login and on-demand.
 * AI advisors and all analytics read from this table — no live API calls needed.
 *
 * Sync strategy:
 *   - Full refresh: replace all rows for userId on first sync or manual refresh
 *   - Incremental: upsert by (userId, accountNumber, symbol) on subsequent syncs
 */
export const cachedPositions = mysqlTable('cached_positions', {
  id: int('id').primaryKey().autoincrement(),
  userId: int('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  accountNumber: varchar('account_number', { length: 64 }).notNull(),

  // Core position fields (mirrors Tastytrade API field names)
  symbol: varchar('symbol', { length: 30 }).notNull(),           // OCC symbol or equity symbol
  underlyingSymbol: varchar('underlying_symbol', { length: 10 }).notNull(), // e.g. 'APLD'
  instrumentType: varchar('instrument_type', { length: 30 }).notNull(), // 'Equity' | 'Equity Option'
  quantity: varchar('quantity', { length: 20 }).notNull(),       // signed string (negative = short)
  quantityDirection: varchar('quantity_direction', { length: 10 }), // 'Long' | 'Short'
  averageOpenPrice: varchar('average_open_price', { length: 20 }).notNull(),
  closePrice: varchar('close_price', { length: 20 }),            // Current market close price
  multiplier: int('multiplier').default(1).notNull(),            // 100 for options, 1 for equity

  // Option-specific fields (null for equity positions)
  optionType: varchar('option_type', { length: 5 }),             // 'C' | 'P' | null
  strikePrice: varchar('strike_price', { length: 20 }),
  expiresAt: varchar('expires_at', { length: 30 }),              // ISO date string

  // Sync metadata
  syncedAt: timestamp('synced_at').defaultNow().onUpdateNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  userAccountSymbolIdx: unique('cached_positions_unique').on(table.userId, table.accountNumber, table.symbol),
  userUnderlyingIdx: index('cached_positions_underlying_idx').on(table.userId, table.underlyingSymbol),
  userAccountIdx: index('cached_positions_account_idx').on(table.userId, table.accountNumber),
}));

export type CachedPosition = typeof cachedPositions.$inferSelect;
export type InsertCachedPosition = typeof cachedPositions.$inferInsert;

/**
 * Cached Tastytrade Transactions
 * Stores the full transaction history from Tastytrade.
 * Synced incrementally: only fetches transactions newer than the last sync date.
 * AI advisors read from this table for cost basis, premium income, and trade history.
 *
 * Sync strategy:
 *   - Initial load: fetch last 3 years on first sync
 *   - Incremental: fetch only since lastSyncedTransactionDate on subsequent syncs
 */
export const cachedTransactions = mysqlTable('cached_transactions', {
  id: int('id').primaryKey().autoincrement(),
  userId: int('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  accountNumber: varchar('account_number', { length: 64 }).notNull(),

  // Tastytrade transaction fields
  tastytradeId: varchar('tastytrade_id', { length: 64 }).notNull(), // Tastytrade's own transaction ID
  transactionType: varchar('transaction_type', { length: 50 }).notNull(), // 'Trade' | 'Receive Deliver' | 'Money Movement'
  transactionSubType: varchar('transaction_sub_type', { length: 50 }),
  action: varchar('action', { length: 50 }),                     // 'Sell to Open' | 'Buy to Close' | etc.
  symbol: varchar('symbol', { length: 30 }),                     // OCC symbol or equity symbol
  underlyingSymbol: varchar('underlying_symbol', { length: 10 }), // e.g. 'APLD'
  instrumentType: varchar('instrument_type', { length: 30 }),    // 'Equity' | 'Equity Option'
  description: text('description'),

  // Financial fields — stored as strings to preserve precision
  value: varchar('value', { length: 20 }).notNull(),             // Signed dollar amount (negative = debit)
  netValue: varchar('net_value', { length: 20 }),                // After fees
  quantity: varchar('quantity', { length: 20 }),
  price: varchar('price', { length: 20 }),
  commissions: varchar('commissions', { length: 20 }),
  fees: varchar('fees', { length: 20 }),

  // Option fields (null for equity transactions)
  optionType: varchar('option_type', { length: 5 }),             // 'C' | 'P'
  strikePrice: varchar('strike_price', { length: 20 }),
  expiresAt: varchar('expires_at', { length: 30 }),

  // Execution timestamp
  executedAt: timestamp('executed_at').notNull(),                 // When the trade was executed

  // Sync metadata
  syncedAt: timestamp('synced_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  // Unique constraint prevents duplicate imports
  uniqueTxn: unique('cached_transactions_unique').on(table.userId, table.accountNumber, table.tastytradeId),
  userUnderlyingIdx: index('cached_transactions_underlying_idx').on(table.userId, table.underlyingSymbol),
  userAccountIdx: index('cached_transactions_account_idx').on(table.userId, table.accountNumber),
  executedAtIdx: index('cached_transactions_executed_at_idx').on(table.userId, table.executedAt),
}));

export type CachedTransaction = typeof cachedTransactions.$inferSelect;
export type InsertCachedTransaction = typeof cachedTransactions.$inferInsert;

/**
 * Portfolio Sync State
 * Tracks the last successful sync time per user per account.
 * Used by the incremental sync engine to know how far back to fetch.
 */
export const portfolioSyncState = mysqlTable('portfolio_sync_state', {
  id: int('id').primaryKey().autoincrement(),
  userId: int('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  accountNumber: varchar('account_number', { length: 64 }).notNull(),

  // Last time positions were synced (full refresh)
  lastPositionsSyncAt: timestamp('last_positions_sync_at'),
  // Last time transactions were synced
  lastTransactionsSyncAt: timestamp('last_transactions_sync_at'),
  // The most recent transaction date we have cached (for incremental sync)
  lastTransactionDate: varchar('last_transaction_date', { length: 10 }), // YYYY-MM-DD
  // Total transactions cached for this account
  totalTransactionsCached: int('total_transactions_cached').default(0).notNull(),
  // Sync status
  syncStatus: mysqlEnum('sync_status', ['idle', 'syncing', 'error']).default('idle').notNull(),
  lastSyncError: text('last_sync_error'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  uniqueUserAccount: unique('portfolio_sync_state_unique').on(table.userId, table.accountNumber),
  userIdIdx: index('portfolio_sync_state_user_idx').on(table.userId),
}));

export type PortfolioSyncState = typeof portfolioSyncState.$inferSelect;
export type InsertPortfolioSyncState = typeof portfolioSyncState.$inferInsert;

/**
 * Trading Activity Log
 * Captures every order attempt with its outcome and full error payload.
 * Used by the floating Trading Activity Log panel and AI diagnosis feature.
 */
export const tradingLog = mysqlTable('trading_log', {
  id: int('id').primaryKey().autoincrement(),
  userId: int('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),

  // Order identification
  /** The underlying symbol (e.g., SPXW, AAPL, SPY) */
  symbol: varchar('symbol', { length: 20 }).notNull(),
  /** Full OCC option symbol (e.g., SPXW  260418P05500000) */
  optionSymbol: varchar('option_symbol', { length: 64 }),
  /** Account number the order was submitted to */
  accountNumber: varchar('account_number', { length: 64 }),

  // Order details
  /** Strategy type: csp, cc, bcs, bps, pmcc, close, roll, automation */
  strategy: varchar('strategy', { length: 32 }).notNull(),
  /** Order action: STO, BTC, BTO, STC, ROLL */
  action: varchar('action', { length: 16 }).notNull(),
  /** Strike price */
  strike: varchar('strike', { length: 20 }),
  /** Expiration date string */
  expiration: varchar('expiration', { length: 20 }),
  /** Number of contracts */
  quantity: int('quantity'),
  /** Limit price submitted */
  price: varchar('price', { length: 20 }),
  /** Credit or Debit */
  priceEffect: varchar('price_effect', { length: 16 }),
  /** Instrument type used: Equity Option or Index Option */
  instrumentType: varchar('instrument_type', { length: 32 }),

  // Outcome
  /** pending | filled | success | rejected | error | dry_run | api_error */
  outcome: mysqlEnum('outcome', ['pending', 'filled', 'success', 'rejected', 'error', 'dry_run', 'api_error']).notNull(),
  /** Tastytrade order ID on success */
  orderId: varchar('order_id', { length: 64 }),
  /** Full error message from Tastytrade API on failure */
  errorMessage: text('error_message'),
  /** Full JSON payload of the error response for AI diagnosis */
  errorPayload: text('error_payload'),
  /** AI-generated diagnosis (populated on demand via diagnose button) */
  aiDiagnosis: text('ai_diagnosis'),

  // Source context
  /** Which page/procedure triggered this order */
  source: varchar('source', { length: 64 }),
  /** Whether this was a dry run */
  isDryRun: boolean('is_dry_run').default(false).notNull(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index('trading_log_user_idx').on(table.userId),
  outcomeIdx: index('trading_log_outcome_idx').on(table.outcome),
  createdAtIdx: index('trading_log_created_at_idx').on(table.createdAt),
}));

export type TradingLog = typeof tradingLog.$inferSelect;
export type InsertTradingLog = typeof tradingLog.$inferInsert;


/**
 * Position Auto-Close Targets
 * Per-position opt-in for automated profit-target monitoring.
 * When a position's P/L reaches the configured profitTargetPct, the
 * auto-close cron job (every 5 min during market hours) submits a BTC order.
 * One row per opted-in position (keyed by accountId + optionSymbol).
 */
export const positionTargets = mysqlTable('positionTargets', {
  id: int('id').autoincrement().primaryKey(),
  userId: int('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  accountId: varchar('accountId', { length: 64 }).notNull(),
  accountNumber: varchar('accountNumber', { length: 32 }).notNull(),

  // Position identification
  symbol: varchar('symbol', { length: 10 }).notNull(),           // underlying, e.g. "NVDA"
  optionSymbol: varchar('optionSymbol', { length: 32 }).notNull(), // OCC symbol, e.g. "NVDA  260117C00150000"
  optionType: varchar('optionType', { length: 4 }).notNull(),    // 'C' | 'P'
  strike: varchar('strike', { length: 20 }).notNull(),
  expiration: varchar('expiration', { length: 20 }).notNull(),   // YYYY-MM-DD
  quantity: int('quantity').notNull(),                           // number of contracts (positive = long, negative = short)

  // Premium collected at open (used to compute profit %)
  premiumCollected: varchar('premiumCollected', { length: 20 }).notNull(), // per-share, e.g. "3.50"

  // Auto-close configuration
  profitTargetPct: int('profitTargetPct').notNull().default(50), // 25 | 50 | 75 | 90
  stopLossPct: int('stopLossPct'),          // e.g. 200 = close when loss reaches 2× premium. NULL = disabled
  dteFloor: int('dteFloor'),                // close when DTE ≤ this value. NULL = disabled
  enabled: boolean('enabled').notNull().default(true),
  closeReason: varchar('closeReason', { length: 20 }), // profit_target | stop_loss | dte_floor | manual

  // Monitoring state
  status: mysqlEnum('status', ['watching', 'triggered', 'closed', 'expired', 'error']).notNull().default('watching'),
  lastCheckedAt: timestamp('lastCheckedAt'),
  lastProfitPct: varchar('lastProfitPct', { length: 10 }),       // last observed profit %, e.g. "47.3"
  closedAt: timestamp('closedAt'),
  closedOrderId: varchar('closedOrderId', { length: 64 }),       // TT order ID when closed
  errorMessage: text('errorMessage'),

  // Display label (strategy type for UI)
  strategy: varchar('strategy', { length: 30 }).default('csp'),  // 'csp' | 'cc' | 'bps' | 'ic' | 'pmcc'

  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  userIdIdx: index('positionTargets_userId_idx').on(table.userId),
  accountIdx: index('positionTargets_account_idx').on(table.accountId),
  statusIdx: index('positionTargets_status_idx').on(table.status),
  optionSymbolIdx: index('positionTargets_optionSymbol_idx').on(table.optionSymbol),
}));

export type PositionTarget = typeof positionTargets.$inferSelect;
export type InsertPositionTarget = typeof positionTargets.$inferInsert;

// ─── BCS Auto-Entry System ────────────────────────────────────────────────────
export const bcsAutoEntrySettings = mysqlTable('bcsAutoEntrySettings', {
  id: int('id').autoincrement().primaryKey(),
  userId: int('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  enabled: boolean('enabled').notNull().default(false),
  scanTimeET: varchar('scanTimeET', { length: 8 }).notNull().default('10:30'),
  contracts: int('contracts').notNull().default(2),
  spreadWidth: int('spreadWidth').notNull().default(50),
  minScore: int('minScore').notNull().default(70),
  minDTE: int('minDTE').notNull().default(30),
  maxDTE: int('maxDTE').notNull().default(45),
  maxDelta: varchar('maxDelta', { length: 10 }).notNull().default('0.20'),
  minOI: int('minOI').notNull().default(500),
  maxConcurrent: int('maxConcurrent').notNull().default(2),
  approvalTimeoutMins: int('approvalTimeoutMins').notNull().default(30),
  accountId: varchar('accountId', { length: 64 }),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
  updatedAt: timestamp('updatedAt').defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  userIdIdx: index('bcsAutoEntrySettings_userId_idx').on(table.userId),
}));

export type BcsAutoEntrySettings = typeof bcsAutoEntrySettings.$inferSelect;
export type InsertBcsAutoEntrySettings = typeof bcsAutoEntrySettings.$inferInsert;

export const bcsPendingApprovals = mysqlTable('bcsPendingApprovals', {
  id: int('id').autoincrement().primaryKey(),
  userId: int('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: varchar('token', { length: 64 }).notNull(),
  symbol: varchar('symbol', { length: 16 }).notNull().default('SPXW'),
  shortStrike: varchar('shortStrike', { length: 20 }).notNull(),
  longStrike: varchar('longStrike', { length: 20 }).notNull(),
  expiration: varchar('expiration', { length: 20 }).notNull(),
  dte: int('dte').notNull(),
  netCredit: varchar('netCredit', { length: 20 }).notNull(),
  delta: varchar('delta', { length: 20 }).notNull(),
  score: int('score').notNull().default(0),
  contracts: int('contracts').notNull().default(2),
  shortOptionSymbol: varchar('shortOptionSymbol', { length: 64 }).notNull(),
  longOptionSymbol: varchar('longOptionSymbol', { length: 64 }).notNull(),
  accountId: varchar('accountId', { length: 64 }).notNull(),
  status: mysqlEnum('status', ['pending', 'approved', 'skipped', 'expired', 'error']).notNull().default('pending'),
  orderId: varchar('orderId', { length: 64 }),
  errorMessage: text('errorMessage'),
  telegramMessageId: int('telegramMessageId'),
  expiresAt: timestamp('expiresAt').notNull(),
  approvedAt: timestamp('approvedAt'),
  resolvedAt: timestamp('resolvedAt'),
  createdAt: timestamp('createdAt').defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index('bcsPendingApprovals_userId_idx').on(table.userId),
  statusIdx: index('bcsPendingApprovals_status_idx').on(table.status),
  tokenIdx: index('bcsPendingApprovals_token_idx').on(table.token),
}));

export type BcsPendingApproval = typeof bcsPendingApprovals.$inferSelect;
export type InsertBcsPendingApproval = typeof bcsPendingApprovals.$inferInsert;

// ─── Auto-Close Execution Log ─────────────────────────────────────────────────

export const autoCloseLog = mysqlTable('auto_close_log', {
  id: int('id').autoincrement().primaryKey(),
  userId: int('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  accountId: varchar('account_id', { length: 64 }).notNull(),
  accountNumber: varchar('account_number', { length: 32 }).notNull(),
  symbol: varchar('symbol', { length: 16 }).notNull(),
  optionSymbol: varchar('option_symbol', { length: 64 }).notNull(),
  optionType: mysqlEnum('option_type', ['C', 'P']).notNull(),
  strike: varchar('strike', { length: 16 }).notNull(),
  expiration: varchar('expiration', { length: 16 }).notNull(),
  quantity: int('quantity').notNull().default(1),
  openPrice: decimal('open_price', { precision: 10, scale: 4 }).notNull(),
  closePrice: decimal('close_price', { precision: 10, scale: 4 }).notNull(),
  profitPct: decimal('profit_pct', { precision: 6, scale: 2 }).notNull(),
  targetPct: int('target_pct').notNull(),
  orderId: varchar('order_id', { length: 64 }),
  closedAt: bigint('closed_at', { mode: 'number' }).notNull(),
  archived: boolean('archived').notNull().default(false),
  archivedAt: bigint('archived_at', { mode: 'number' }),
  closeReason: varchar('close_reason', { length: 32 }),  // profit_target | stop_loss | dte_floor | manual
  notes: text('notes'),
}, (table) => ({
  userIdIdx: index('acl_user_id_idx').on(table.userId),
  closedAtIdx: index('acl_closed_at_idx').on(table.closedAt),
  archivedIdx: index('acl_archived_idx').on(table.archived),
}));

export type AutoCloseLog = typeof autoCloseLog.$inferSelect;
export type InsertAutoCloseLog = typeof autoCloseLog.$inferInsert;

// ─── Global Bracket Defaults ─────────────────────────────────────────────────
export const globalBracketDefaults = mysqlTable('global_bracket_defaults', {
  id: int('id').autoincrement().primaryKey(),
  userId: int('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  profitTargetPct: int('profit_target_pct').notNull().default(50),
  stopLossPct: int('stop_loss_pct'),
  dteFloor: int('dte_floor'),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
}, (table) => ({
  userIdIdx: unique('gbd_user_id_idx').on(table.userId),
}));

export type GlobalBracketDefaults = typeof globalBracketDefaults.$inferSelect;
export type InsertGlobalBracketDefaults = typeof globalBracketDefaults.$inferInsert;
