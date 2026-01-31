import { getDb } from './server/_core/db.ts';

const db = await getDb();
const results = await db.execute('SELECT presetName, minDelta, maxDelta, minDte, maxDte, minScore, minOpenInterest, minVolume, minRsi, maxRsi, minIvRank, maxIvRank, minBbPercent, maxBbPercent FROM filterPresets WHERE userId = 1 AND strategy = "csp" ORDER BY presetName');
console.log(JSON.stringify(results[0], null, 2));
process.exit(0);
