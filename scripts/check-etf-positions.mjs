/**
 * Fetches all equity (stock/ETF) positions from Tastytrade across all accounts
 * and identifies which are ETFs vs individual stocks.
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const axios = require('axios');
import mysql from 'mysql2/promise';

// Known ETF symbols (broad list)
const KNOWN_ETFS = new Set([
  'SPY','IVV','VOO','VTI','QQQ','IWM','DIA','MDY','IJH','IJR',
  'XLK','XLF','XLE','XLV','XLI','XLY','XLP','XLU','XLB','XLRE',
  'VGT','VFH','VDE','VHT','VIS','VCR','VDC','VPU','VAW',
  'EEM','EFA','VEA','VWO','IEFA','ACWI','VT',
  'TLT','IEF','SHY','AGG','BND','LQD','HYG','JNK',
  'GLD','SLV','IAU','PDBC','DJP','GSG','USO','UNG',
  'VXX','UVXY','SQQQ','SPXU','SH','PSQ',
  'TQQQ','UPRO','SPXL','SOXL','SOXS','LABU','LABD',
  'ARKK','ARKG','ARKW','ARKF','ARKQ',
  'DVY','VYM','SCHD','HDV',
  'VNQ','IYR','XSP',
]);

async function main() {
  const baseUrl = 'https://api.tastytrade.com';

  const db = await mysql.createConnection(process.env.DATABASE_URL);

  // Get the owner's OAuth access token
  const [rows] = await db.execute(
    'SELECT tastytradeAccessToken, tastytradeRefreshToken FROM apiCredentials WHERE userId = 1 LIMIT 1'
  );
  await db.end();

  if (!rows.length) {
    console.log('No credentials found in DB for user 1');
    return;
  }

  const accessToken = rows[0].tastytradeAccessToken;
  if (!accessToken) {
    console.log('No Tastytrade access token found — user may need to re-authenticate');
    return;
  }

  const headers = { Authorization: accessToken, 'Content-Type': 'application/json' };

  // Get accounts
  const acctResp = await axios.get(`${baseUrl}/customers/me/accounts`, { headers });
  const accounts = acctResp.data.data.items.map(a => a.account['account-number']);
  console.log(`Found ${accounts.length} account(s): ${accounts.join(', ')}\n`);

  const allEquityPositions = [];

  for (const acct of accounts) {
    const posResp = await axios.get(`${baseUrl}/accounts/${acct}/positions`, { headers });
    const positions = posResp.data.data.items || [];

    const equities = positions.filter(p => p['instrument-type'] === 'Equity');
    for (const p of equities) {
      allEquityPositions.push({
        account: acct,
        symbol: p.symbol,
        quantity: parseInt(p.quantity),
        direction: p['quantity-direction'],
        avgPrice: parseFloat(p['average-open-price'] || '0'),
        marketValue: parseFloat(p['market-value'] || '0'),
        isETF: KNOWN_ETFS.has(p.symbol),
      });
    }
  }

  const etfs = allEquityPositions.filter(p => p.isETF);
  const stocks = allEquityPositions.filter(p => !p.isETF);

  console.log('=== ETF POSITIONS ===');
  if (etfs.length === 0) {
    console.log('  None found');
  } else {
    for (const p of etfs) {
      const sign = p.direction === 'Long' ? '+' : '-';
      console.log(`  ${p.symbol.padEnd(8)} ${sign}${p.quantity} shares @ $${p.avgPrice.toFixed(2)}  [${p.account}]`);
    }
  }

  console.log('\n=== INDIVIDUAL STOCK POSITIONS ===');
  if (stocks.length === 0) {
    console.log('  None found');
  } else {
    for (const p of stocks) {
      const sign = p.direction === 'Long' ? '+' : '-';
      console.log(`  ${p.symbol.padEnd(8)} ${sign}${p.quantity} shares @ $${p.avgPrice.toFixed(2)}  [${p.account}]`);
    }
  }

  console.log(`\nSummary: ${etfs.length} ETF position(s), ${stocks.length} individual stock position(s)`);
}

main().catch(console.error);
