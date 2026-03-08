/**
 * Check what root_symbol field looks like on SPX chain contracts
 */
import mysql from 'mysql2/promise';
import axios from 'axios';

const DATABASE_URL = process.env.DATABASE_URL;
const conn = await mysql.createConnection(DATABASE_URL);
const [rows] = await conn.execute('SELECT tradierApiKey FROM apiCredentials WHERE tradierApiKey IS NOT NULL LIMIT 1');
await conn.end();
const apiKey = rows[0]?.tradierApiKey;

const client = axios.create({
  baseURL: 'https://api.tradier.com/v1',
  headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' },
  timeout: 30000,
});

// Fetch SPX chain for 2026-03-16 (a weekly expiration)
const r = await client.get('/markets/options/chains', {
  params: { symbol: 'SPX', expiration: '2026-03-16', greeks: true }
});
const opts = r.data?.options?.option;
const all = Array.isArray(opts) ? opts : (opts ? [opts] : []);
const puts = all.filter(o => o.option_type === 'put');

console.log(`Total puts: ${puts.length}`);
console.log('\nSample of root_symbol values:');
const rootSymbols = [...new Set(puts.map(p => p.root_symbol))];
console.log('Unique root_symbol values:', rootSymbols);

// Show a few near-money puts with their root_symbol
const nearMoney = puts.filter(p => p.strike >= 6600 && p.strike <= 6750).slice(0, 5);
console.log('\nNear-money puts with root_symbol:');
nearMoney.forEach(p => {
  console.log(`  ${p.symbol}: strike=${p.strike}, root_symbol=${p.root_symbol}, delta=${p.greeks?.delta?.toFixed(4)}`);
});

// Count by root_symbol
const countByRoot = {};
puts.forEach(p => {
  const root = p.root_symbol || 'null/undefined';
  countByRoot[root] = (countByRoot[root] || 0) + 1;
});
console.log('\nPuts count by root_symbol:', countByRoot);
