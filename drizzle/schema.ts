import { int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

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
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
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
  strategy: mysqlEnum("strategy", ["csp", "cc", "pmcc"]).notNull(),
  // Metadata columns for enhanced watchlist management
  company: text("company"),
  type: varchar("type", { length: 20 }), // Growth, Value, Blend
  sector: varchar("sector", { length: 100 }),
  reason: text("reason"),
  rank: int("rank"),
  portfolioSize: mysqlEnum("portfolioSize", ["small", "medium", "large"]), // Portfolio size category
  price: varchar("price", { length: 20 }), // Current stock price
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

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
  strategy: mysqlEnum("strategy", ["csp", "cc", "pmcc"]).notNull(),
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
  strategy: mysqlEnum("strategy", ["csp", "cc", "pmcc"]).notNull(),
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
  tastytradeUsername: varchar("tastytradeUsername", { length: 255 }),
  tastytradePassword: varchar("tastytradePassword", { length: 255 }),
  tradierApiKey: varchar("tradierApiKey", { length: 255 }),
  tradierAccountId: varchar("tradierAccountId", { length: 255 }),
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
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type TastytradeAccount = typeof tastytradeAccounts.$inferSelect;
export type InsertTastytradeAccount = typeof tastytradeAccounts.$inferInsert;

/**
 * CSP filter preset configurations (conservative, medium, aggressive)
 */
export const cspFilterPresets = mysqlTable("cspFilterPresets", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
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

export type CspFilterPreset = typeof cspFilterPresets.$inferSelect;
export type InsertCspFilterPreset = typeof cspFilterPresets.$inferInsert;
/**
 * User preferences for trading settings
 */
export const userPreferences = mysqlTable("userPreferences", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  
  // Default Tastytrade account for trading
  defaultTastytradeAccountId: varchar("defaultTastytradeAccountId", { length: 64 }),
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type UserPreference = typeof userPreferences.$inferSelect;
export type InsertUserPreference = typeof userPreferences.$inferInsert;
