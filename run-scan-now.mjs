/**
 * One-time script to trigger the daily scan for a specific user.
 * Run with: node run-scan-now.mjs
 */

import { createConnection } from 'mysql2/promise';
import { config } from 'dotenv';

config();

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

// We'll call the tRPC endpoint directly via HTTP since the server is running
const SERVER_URL = 'http://localhost:3000';

async function getSessionCookieForUser(userId) {
  // Get the user's session from DB
  const conn = await createConnection(DATABASE_URL);
  try {
    const [sessions] = await conn.query(
      'SELECT token FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
      [userId]
    );
    if (sessions.length === 0) {
      console.log('No session found for user', userId);
      return null;
    }
    return sessions[0].token;
  } catch (e) {
    console.log('No sessions table or error:', e.message);
    return null;
  } finally {
    await conn.end();
  }
}

async function runScanDirectly(userId) {
  console.log(`Running daily scan directly for user ${userId}...`);
  
  // Import the scan module directly
  const { runDailyScan } = await import('./server/daily-scan.ts');
  const result = await runDailyScan(userId);
  
  console.log('Scan result:', JSON.stringify(result, null, 2));
  return result;
}

// Since we can't easily import TypeScript directly, call the API endpoint
async function triggerViaTRPC() {
  console.log('Triggering scan via internal API call...');
  
  // Use the dev restart endpoint to trigger a scan
  const conn = await createConnection(DATABASE_URL);
  try {
    // Check if there's already a scan cache entry
    const [existing] = await conn.query('SELECT * FROM daily_scan_cache WHERE user_id = 1 OR userId = 1 LIMIT 1');
    console.log('Existing cache:', existing);
    
    // Get user IDs with Tastytrade credentials
    const [creds] = await conn.query(
      'SELECT userId FROM apiCredentials WHERE tastytradeRefreshToken IS NOT NULL OR tastytradePassword IS NOT NULL'
    );
    console.log('Users with Tastytrade credentials:', creds.map(c => c.userId));
    
    return creds.map(c => c.userId);
  } finally {
    await conn.end();
  }
}

triggerViaTRPC().then(userIds => {
  console.log('\nUser IDs to scan:', userIds);
  console.log('\nTo trigger the scan, use the "Scan Now" button on the Home dashboard,');
  console.log('or wait for the 8:30 AM ET cron job.');
  console.log('\nAlternatively, the triggerDailyScan mutation is available via the tRPC API.');
}).catch(console.error);
