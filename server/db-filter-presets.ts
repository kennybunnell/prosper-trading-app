/**
 * Filter preset helper functions for CSP and CC strategies
 */

import { getDb } from "./db";

/**
 * Get recommended values for a specific strategy and preset combination
 */
export function getRecommendedFilterValues(
  strategy: "csp" | "cc" | "pmcc" | "bps" | "bcs",
  presetName: "conservative" | "medium" | "aggressive"
) {
  const recommendations = {
    csp: {
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
    },
    cc: {
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
    },
    bps: {
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
    },
    bcs: {
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
    },
    pmcc: {
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
    },
  };

  return recommendations[strategy][presetName];
}

/**
 * Seed default CC filter presets for a user if they don't exist
 */
export async function seedCcFilterPresets(userId: number): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot seed CC filter presets: database not available");
    return;
  }

  const { filterPresets } = await import("../drizzle/schema");
  const { eq, and } = await import("drizzle-orm");

  try {
    // Check if CC presets already exist for this user
    const existing = await db
      .select()
      .from(filterPresets)
      .where(and(eq(filterPresets.userId, userId), eq(filterPresets.strategy, "cc")))
      .limit(1);

    if (existing.length > 0) {
      console.log(`[Database] CC filter presets already exist for user ${userId}`);
      return;
    }

    // Use recommended values for CC strategy
    const defaults = [
      {
        userId,
        strategy: "cc" as const,
        presetName: "conservative" as const,
        ...getRecommendedFilterValues("cc", "conservative"),
      },
      {
        userId,
        strategy: "cc" as const,
        presetName: "medium" as const,
        ...getRecommendedFilterValues("cc", "medium"),
      },
      {
        userId,
        strategy: "cc" as const,
        presetName: "aggressive" as const,
        ...getRecommendedFilterValues("cc", "aggressive"),
      },
    ];

    await db.insert(filterPresets).values(defaults);
    console.log(`[Database] Seeded ${defaults.length} CC filter presets for user ${userId}`);
  } catch (error) {
    console.error("[Database] Failed to seed CC filter presets:", error);
    throw error;
  }
}

/**
 * Seed default PMCC filter presets for a user if they don't exist
 */
export async function seedPmccFilterPresets(userId: number): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot seed PMCC filter presets: database not available");
    return;
  }

  const { filterPresets } = await import("../drizzle/schema");
  const { eq, and } = await import("drizzle-orm");

  try {
    // Check if PMCC presets already exist for this user
    const existing = await db
      .select()
      .from(filterPresets)
      .where(and(eq(filterPresets.userId, userId), eq(filterPresets.strategy, "pmcc")))
      .limit(1);

    if (existing.length > 0) {
      console.log(`[Database] PMCC filter presets already exist for user ${userId}`);
      return;
    }

    // Use recommended values for PMCC strategy (LEAP buying)
    const defaults = [
      {
        userId,
        strategy: "pmcc" as const,
        presetName: "conservative" as const,
        ...getRecommendedFilterValues("pmcc", "conservative"),
      },
      {
        userId,
        strategy: "pmcc" as const,
        presetName: "medium" as const,
        ...getRecommendedFilterValues("pmcc", "medium"),
      },
      {
        userId,
        strategy: "pmcc" as const,
        presetName: "aggressive" as const,
        ...getRecommendedFilterValues("pmcc", "aggressive"),
      },
    ];

    await db.insert(filterPresets).values(defaults);
    console.log(`[Database] Seeded ${defaults.length} PMCC filter presets for user ${userId}`);
  } catch (error) {
    console.error("[Database] Failed to seed PMCC filter presets:", error);
    throw error;
  }
}

/**
 * Seed default BPS filter presets for a user if they don't exist
 */
export async function seedBpsFilterPresets(userId: number): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot seed BPS filter presets: database not available");
    return;
  }

  const { filterPresets } = await import("../drizzle/schema");
  const { eq, and } = await import("drizzle-orm");

  try {
    // Check if BPS presets already exist for this user
    const existing = await db
      .select()
      .from(filterPresets)
      .where(and(eq(filterPresets.userId, userId), eq(filterPresets.strategy, "bps")))
      .limit(1);

    if (existing.length > 0) {
      console.log(`[Database] BPS filter presets already exist for user ${userId}`);
      return;
    }

    // Use recommended values for BPS strategy
    const defaults = [
      {
        userId,
        strategy: "bps" as const,
        presetName: "conservative" as const,
        ...getRecommendedFilterValues("bps", "conservative"),
      },
      {
        userId,
        strategy: "bps" as const,
        presetName: "medium" as const,
        ...getRecommendedFilterValues("bps", "medium"),
      },
      {
        userId,
        strategy: "bps" as const,
        presetName: "aggressive" as const,
        ...getRecommendedFilterValues("bps", "aggressive"),
      },
    ];

    await db.insert(filterPresets).values(defaults);
    console.log(`[Database] Seeded ${defaults.length} BPS filter presets for user ${userId}`);
  } catch (error) {
    console.error("[Database] Failed to seed BPS filter presets:", error);
    throw error;
  }
}

/**
 * Seed default BCS filter presets for a user if they don't exist
 */
export async function seedBcsFilterPresets(userId: number): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot seed BCS filter presets: database not available");
    return;
  }

  const { filterPresets } = await import("../drizzle/schema");
  const { eq, and } = await import("drizzle-orm");

  try {
    // Check if BCS presets already exist for this user
    const existing = await db
      .select()
      .from(filterPresets)
      .where(and(eq(filterPresets.userId, userId), eq(filterPresets.strategy, "bcs")))
      .limit(1);

    if (existing.length > 0) {
      console.log(`[Database] BCS filter presets already exist for user ${userId}`);
      return;
    }

    // Use recommended values for BCS strategy
    const defaults = [
      {
        userId,
        strategy: "bcs" as const,
        presetName: "conservative" as const,
        ...getRecommendedFilterValues("bcs", "conservative"),
      },
      {
        userId,
        strategy: "bcs" as const,
        presetName: "medium" as const,
        ...getRecommendedFilterValues("bcs", "medium"),
      },
      {
        userId,
        strategy: "bcs" as const,
        presetName: "aggressive" as const,
        ...getRecommendedFilterValues("bcs", "aggressive"),
      },
    ];

    await db.insert(filterPresets).values(defaults);
    console.log(`[Database] Seeded ${defaults.length} BCS filter presets for user ${userId}`);
  } catch (error) {
    console.error("[Database] Failed to seed BCS filter presets:", error);
    throw error;
  }
}

/**
 * Get all filter presets for a specific strategy
 */
export async function getFilterPresetsByStrategy(
  userId: number,
  strategy: "csp" | "cc" | "pmcc" | "bps" | "bcs"
) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const { filterPresets } = await import("../drizzle/schema");
  const { eq, and } = await import("drizzle-orm");

  const presets = await db
    .select()
    .from(filterPresets)
    .where(and(eq(filterPresets.userId, userId), eq(filterPresets.strategy, strategy)));

  return presets;
}

/**
 * Update a specific filter preset
 */
export async function updateFilterPreset(
  userId: number,
  strategy: "csp" | "cc" | "pmcc" | "bps" | "bcs",
  presetName: "conservative" | "medium" | "aggressive",
  updates: Partial<{
    minDte: number;
    maxDte: number;
    minDelta: string;
    maxDelta: string;
    minOpenInterest: number;
    minVolume: number;
    minRsi: number | null;
    maxRsi: number | null;
    minIvRank: number | null;
    maxIvRank: number | null;
    minBbPercent: string | null;
    maxBbPercent: string | null;
    minScore: number;
    maxStrikePercent: number | string;
  }>
): Promise<void> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const { filterPresets } = await import("../drizzle/schema");
  const { eq, and } = await import("drizzle-orm");

  // Filter out undefined values
  const filteredUpdates = Object.fromEntries(
    Object.entries(updates).filter(([_, v]) => v !== undefined)
  );

  if (Object.keys(filteredUpdates).length === 0) {
    console.log("[Database] No values to update for filter preset");
    return;
  }

  await db
    .update(filterPresets)
    .set(filteredUpdates)
    .where(
      and(
        eq(filterPresets.userId, userId),
        eq(filterPresets.strategy, strategy),
        eq(filterPresets.presetName, presetName)
      )
    );

  console.log(
    `[Database] Updated ${strategy} ${presetName} filter preset for user ${userId}`
  );
}
