/**
 * Uses the app's own authenticateTastytrade function (with full token refresh logic)
 * to fetch all equity positions and identify ETFs.
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Load dotenv if available
try {
  const { config } = await import('dotenv');
  config();
} catch {}

// Import the app's own modules
const { authenticateTastytrade } = await import('../server/tastytrade.ts').catch(async () => {
  // Try compiled JS
  return import('../server/tastytrade.js');
});

const { getApiCredentials } = await import('../server/db.ts').catch(async () => {
  return import('../server/db.js');
});

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

async function main() {
  const credentials = await getApiCredentials(1); // user ID 1 = owner
  if (!credentials) {
    console.log('No credentials found for user 1');
    return;
  }

  console.log('Authenticating with Tastytrade...');
  const tt = await authenticateTastytrade(credentials, 1);
  if (!tt) {
    console.log('Authentication failed');
    return;
  }
  console.log('Authenticated.\n');

  const accounts = await tt.getAccounts();
  const accountList = accounts.map(a => ({
    number: a.account?.['account-number'] || a['account-number'] || a.accountNumber,
    nickname: a.account?.nickname || a.account?.['account-type-name'] || '',
  })).filter(a => a.number);

  console.log(`Found ${accountList.length} account(s):`);
  accountList.forEach(a => console.log(`  ${a.number}  ${a.nickname}`));
  console.log('');

  const allEquityPositions = [];

  for (const acct of accountList) {
    let positions = [];
    try {
      positions = await tt.getPositions(acct.number);
    } catch (e) {
      console.log(`  Error fetching positions for ${acct.number}: ${e.message}`);
      continue;
    }

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
  console.error('Error:', e.message || e);
});
