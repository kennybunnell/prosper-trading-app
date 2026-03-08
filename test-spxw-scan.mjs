/**
 * Standalone SPXW scan diagnostic script
 * Tests the correct way to query SPXW options via Tradier API
 */
import mysql from 'mysql2/promise';
import axios from 'axios';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('DATABASE_URL not set'); process.exit(1); }

const TRADIER_API_BASE = 'https://api.tradier.com/v1';

async function main() {
  // 1. Get API key from database
  const conn = await mysql.createConnection(DATABASE_URL);
  const [rows] = await conn.execute('SELECT tradierApiKey FROM apiCredentials WHERE tradierApiKey IS NOT NULL LIMIT 1');
  await conn.end();
  const apiKey = rows[0]?.tradierApiKey;
  if (!apiKey) { console.error('No API key'); process.exit(1); }
  console.log(`API Key: ${apiKey.substring(0, 10)}...`);

  const client = axios.create({
    baseURL: TRADIER_API_BASE,
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' },
    timeout: 30000,
  });

  // 2. Test different ways to get SPXW expirations
  console.log('\n=== Test A: SPXW expirations directly ===');
  try {
    const r = await client.get('/markets/options/expirations', { params: { symbol: 'SPXW', includeAllRoots: true, strikes: false } });
    const d = r.data?.expirations?.date;
    const exps = Array.isArray(d) ? d : (d ? [d] : []);
    console.log(`SPXW direct: ${exps.length} expirations`, exps.slice(0, 5));
  } catch (e) { console.error('SPXW direct failed:', e.message); }

  console.log('\n=== Test B: SPX expirations with includeAllRoots ===');
  let spxExpirations = [];
  try {
    const r = await client.get('/markets/options/expirations', { params: { symbol: 'SPX', includeAllRoots: true, strikes: false } });
    const d = r.data?.expirations?.date;
    spxExpirations = Array.isArray(d) ? d : (d ? [d] : []);
    console.log(`SPX with includeAllRoots: ${spxExpirations.length} expirations`);
    console.log('First 10:', spxExpirations.slice(0, 10));
  } catch (e) { console.error('SPX includeAllRoots failed:', e.message); }

  console.log('\n=== Test C: SPX expirations without includeAllRoots ===');
  try {
    const r = await client.get('/markets/options/expirations', { params: { symbol: 'SPX', strikes: false } });
    const d = r.data?.expirations?.date;
    const exps = Array.isArray(d) ? d : (d ? [d] : []);
    console.log(`SPX without includeAllRoots: ${exps.length} expirations`);
    console.log('First 10:', exps.slice(0, 10));
  } catch (e) { console.error('SPX without includeAllRoots failed:', e.message); }

  // 3. Get underlying price
  console.log('\n=== Test D: Get SPX/SPXW underlying price ===');
  let underlyingPrice = 0;
  for (const sym of ['$SPX', 'SPX', 'SPXW', '^SPX']) {
    try {
      const r = await client.get('/markets/quotes', { params: { symbols: sym, greeks: false } });
      const q = r.data?.quotes?.quote;
      const price = q?.last || q?.close || q?.prevclose || 0;
      console.log(`${sym}: $${price} (type: ${q?.type})`);
      if (price > 0 && underlyingPrice === 0) underlyingPrice = price;
    } catch (e) { console.log(`${sym}: failed - ${e.message}`); }
  }

  // 4. Fetch SPXW chain using SPX expirations
  const today = new Date();
  const targetExp = spxExpirations.find(exp => {
    const dte = Math.round((new Date(exp) - today) / (1000 * 60 * 60 * 24));
    return dte >= 7 && dte <= 30;
  });

  if (!targetExp) { console.error('No expiration in 7-30 DTE range'); return; }
  console.log(`\n=== Test E: Fetch SPXW chain for ${targetExp} ===`);
  
  for (const sym of ['SPXW', 'SPX']) {
    try {
      const r = await client.get('/markets/options/chains', { params: { symbol: sym, expiration: targetExp, greeks: true } });
      const opts = r.data?.options?.option;
      const all = Array.isArray(opts) ? opts : (opts ? [opts] : []);
      const puts = all.filter(o => o.option_type === 'put');
      const strikes = puts.map(p => p.strike).sort((a, b) => a - b);
      console.log(`\n${sym} chain for ${targetExp}:`);
      console.log(`  Total: ${all.length}, Puts: ${puts.length}`);
      if (strikes.length > 0) {
        console.log(`  Strike range: ${strikes[0]} to ${strikes[strikes.length - 1]}`);
        // Show puts near the money
        const nearMoney = puts
          .filter(p => p.strike >= (underlyingPrice || 6700) * 0.93 && p.strike <= (underlyingPrice || 6700) * 0.995)
          .sort((a, b) => b.strike - a.strike)
          .slice(0, 8);
        console.log(`  Near-money puts (93-99.5% of $${underlyingPrice}):`);
        nearMoney.forEach(p => {
          const delta = p.greeks?.delta;
          console.log(`    Strike: ${p.strike}, Delta: ${delta?.toFixed(4) ?? 'N/A'}, Bid: ${p.bid}, Ask: ${p.ask}, OI: ${p.open_interest}`);
        });
      }
    } catch (e) {
      console.error(`${sym} chain failed:`, e.message);
      if (e.response) console.error('  Status:', e.response.status, JSON.stringify(e.response.data).substring(0, 200));
    }
  }

  // 5. Test NDXP
  console.log('\n=== Test F: NDXP expirations ===');
  try {
    const r = await client.get('/markets/options/expirations', { params: { symbol: 'NDX', includeAllRoots: true, strikes: false } });
    const d = r.data?.expirations?.date;
    const exps = Array.isArray(d) ? d : (d ? [d] : []);
    console.log(`NDX with includeAllRoots: ${exps.length} expirations, first 5:`, exps.slice(0, 5));
  } catch (e) { console.error('NDX expirations failed:', e.message); }

  console.log('\n=== Diagnostic complete ===');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
