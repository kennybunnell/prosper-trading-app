/**
 * seed-transactions.mjs
 * One-time import of Tastytrade CSV transaction history into cached_transactions.
 * Run: node server/seed-transactions.mjs <path-to-csv> <account-number>
 *
 * Usage:
 *   node server/seed-transactions.mjs /path/to/transactions.csv 5WZ80418
 */

import fs from 'fs';
import path from 'path';
import { createConnection } from 'mysql2/promise';

const CSV_PATH = process.argv[2];
const ACCOUNT_NUMBER = process.argv[3] || '5WZ80418';

if (!CSV_PATH) {
  console.error('Usage: node server/seed-transactions.mjs <csv-path> [account-number]');
  process.exit(1);
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL env var is required');
  process.exit(1);
}

// Parse CSV (handles quoted commas)
function parseCSV(content) {
  const lines = content.trim().split('\n');
  const headers = parseCSVLine(lines[0]);
  return lines.slice(1).map(line => {
    const values = parseCSVLine(line);
    const row = {};
    headers.forEach((h, i) => { row[h.trim()] = (values[i] || '').trim(); });
    return row;
  });
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// Parse dollar string like "$1,234.56" or "-1,234.56" or "1234.56"
function parseDollar(s) {
  if (!s) return null;
  return s.replace(/[$,]/g, '').trim() || null;
}

// Parse Tastytrade date like "2026-05-12T11:22:46-0600"
function parseDate(s) {
  if (!s) return null;
  try {
    return new Date(s);
  } catch {
    return null;
  }
}

async function main() {
  const content = fs.readFileSync(CSV_PATH, 'utf8');
  const rows = parseCSV(content);
  console.log(`Parsed ${rows.length} rows from CSV`);

  const conn = await createConnection(DATABASE_URL);

  // Find owner user ID
  const [userRows] = await conn.execute('SELECT id FROM users LIMIT 1');
  if (!userRows.length) {
    console.error('No users found in database. Please log in first.');
    await conn.end();
    process.exit(1);
  }
  const userId = userRows[0].id;
  console.log(`Using userId: ${userId}, accountNumber: ${ACCOUNT_NUMBER}`);

  let inserted = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of rows) {
    // Skip rows without a date or order number (money movements without trade ID)
    const executedAt = parseDate(row['Date']);
    if (!executedAt) { skipped++; continue; }

    // Use Order # as tastytrade ID; for non-trade rows use a hash of date+description
    const tastytradeId = row['Order #'] || `${row['Date']}_${row['Description']?.substring(0, 30)}`;
    if (!tastytradeId) { skipped++; continue; }

    const value = parseDollar(row['Value']);
    const netValue = parseDollar(row['Total']);
    const quantity = row['Quantity'] || null;
    const price = parseDollar(row['Average Price']);
    const commissions = parseDollar(row['Commissions']);
    const fees = parseDollar(row['Fees']);

    try {
      await conn.execute(
        `INSERT IGNORE INTO cached_transactions
          (user_id, account_number, tastytrade_id, transaction_type, transaction_sub_type,
           action, symbol, underlying_symbol, instrument_type, description,
           value, net_value, quantity, price, commissions, fees,
           option_type, strike_price, expires_at, executed_at, synced_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [
          userId,
          ACCOUNT_NUMBER,
          tastytradeId,
          row['Type'] || null,
          row['Sub Type'] || null,
          row['Action'] || null,
          row['Symbol'] || null,
          row['Underlying Symbol'] || null,
          row['Instrument Type'] || null,
          row['Description'] || null,
          value,
          netValue,
          quantity,
          price,
          commissions,
          fees,
          row['Call or Put'] === 'PUT' ? 'P' : row['Call or Put'] === 'CALL' ? 'C' : null,
          row['Strike Price'] || null,
          row['Expiration Date'] || null,
          executedAt,
        ]
      );
      inserted++;
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') {
        skipped++;
      } else {
        console.error(`Row error: ${e.message}`, row);
        errors++;
      }
    }
  }

  await conn.end();
  console.log(`\nDone! Inserted: ${inserted}, Skipped (dup/invalid): ${skipped}, Errors: ${errors}`);
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
