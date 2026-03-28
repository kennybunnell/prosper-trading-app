/**
 * Uses the app's own Tastytrade auth flow (with token refresh) to fetch positions.
 * Run from the project root: node scripts/check-etf-positions2.mjs
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const axios = require('axios');
import mysql from 'mysql2/promise';

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
  'DVY','VYM','SCHD','HDV','VNQ','IYR','XSP',
]);

async function refreshToken(refreshToken) {
  const clientId = '64e7a9e5-962d-405c-86e2-0d0052ec22f6'; // Tastytrade OAuth client ID
  const resp = await axios.post('https://api.tastytrade.com/oauth/token', {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
  }, {
    headers: { 'Content-Type': 'application/json' },
  });
  return resp.data.access_token;
}

async function main() {
  const baseUrl = 'https://api.tastytrade.com';
  const db = await mysql.createConnection(process.env.DATABASE_URL);

  const [rows] = await db.execute(
    'SELECT tastytradeAccessToken, tastytradeRefreshToken, tastytradeClientId FROM apiCredentials WHERE userId = 1 LIMIT 1'
  );
  await db.end();

  if (!rows.length || !rows[0].tastytradeRefreshToken) {
    console.log('No Tastytrade refresh token found. Please authenticate via the app first.');
    return;
  }

  console.log('Refreshing Tastytrade access token...');
  let accessToken;
  try {
    accessToken = await refreshToken(rows[0].tastytradeRefreshToken);
    console.log('Token refreshed successfully.\n');
  } catch (e) {
    console.log('Token refresh failed:', e.response?.data || e.message);
    console.log('\nFalling back to stored access token...');
    accessToken = rows[0].tastytradeAccessToken;
  }

  const headers = { Authorization: accessToken, 'Content-Type': 'application/json' };

  // Get accounts
  const acctResp = await axios.get(`${baseUrl}/customers/me/accounts`, { headers });
  const accountItems = acctResp.data.data.items;
  const accounts = accountItems.map(a => ({
    number: a.account['account-number'],
    nickname: a.account.nickname || a.account['account-type-name'] || '',
  }));
  console.log(`Found ${accounts.length} account(s):\n`);
  accounts.forEach(a => console.log(`  ${a.number}  ${a.nickname}`));
  console.log('');

  const allEquityPositions = [];

  for (const acct of accounts) {
    const posResp = await axios.get(`${baseUrl}/accounts/${acct.number}/positions`, { headers });
    const positions = posResp.data.data.items || [];

    const equities = positions.filter(p => p['instrument-type'] === 'Equity');
    for (const p of equities) {
      allEquityPositions.push({
        account: acct.number,
        accountNick: acct.nickname,
        symbol: p.symbol,
        quantity: parseInt(p.quantity),
        direction: p['quantity-direction'],
        avgPrice: parseFloat(p['average-open-price'] || '0'),
        isETF: KNOWN_ETFS.has(p.symbol),
      });
    }
  }

  const etfs = allEquityPositions.filter(p => p.isETF);
  const stocks = allEquityPositions.filter(p => !p.isETF);

  console.log('=== ETF POSITIONS ===');
  if (etfs.length === 0) {
    console.log('  None found\n');
  } else {
    for (const p of etfs) {
      const sign = p.direction === 'Long' ? '+' : '-';
      console.log(`  ${p.symbol.padEnd(8)} ${sign}${p.quantity} shares @ $${p.avgPrice.toFixed(2)}  [${p.account} - ${p.accountNick}]`);
    }
    console.log('');
  }

  console.log('=== INDIVIDUAL STOCK POSITIONS ===');
  if (stocks.length === 0) {
    console.log('  None found\n');
  } else {
    for (const p of stocks) {
      const sign = p.direction === 'Long' ? '+' : '-';
      console.log(`  ${p.symbol.padEnd(8)} ${sign}${p.quantity} shares @ $${p.avgPrice.toFixed(2)}  [${p.account} - ${p.accountNick}]`);
    }
    console.log('');
  }

  console.log(`Summary: ${etfs.length} ETF position(s), ${stocks.length} individual stock position(s)`);
}

main().catch(e => {
  if (e.response) {
    console.error('API Error:', e.response.status, JSON.stringify(e.response.data, null, 2));
  } else {
    console.error(e.message);
  }
});
