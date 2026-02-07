import dotenv from 'dotenv';
dotenv.config();

import { TastytradeAPI } from './server/tastytrade.js';

const accountNumber = '5WZ77313';

console.log('Fetching transaction history...\n');

const api = new TastytradeAPI(process.env.TRADIER_API_KEY);

try {
  // Get transactions for the past year
  const endDate = new Date();
  const startDate = new Date();
  startDate.setFullYear(startDate.getFullYear() - 1);
  
  const transactions = await api.getTransactionHistory(
    accountNumber,
    startDate.toISOString().split('T')[0],
    endDate.toISOString().split('T')[0]
  );
  
  // Group by month
  const monthlyData = {};
  
  for (const txn of transactions) {
    // Only STO transactions (premium received)
    if (txn.action === 'Sell to Open' || txn.action?.includes('STO')) {
      const date = new Date(txn['executed-at'] || txn.executedAt || txn.date);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      
      if (!monthlyData[monthKey]) {
        monthlyData[monthKey] = 0;
      }
      
      // Premium is the credit received
      const premium = Math.abs(txn.value || 0);
      monthlyData[monthKey] += premium;
    }
  }
  
  // Sort and display
  const months = Object.keys(monthlyData).sort();
  
  console.log('=== Monthly Premium Earnings ===\n');
  console.log('Month          Premium Earned');
  console.log('-----------------------------------');
  
  let cumulative = 0;
  for (const month of months) {
    const premium = monthlyData[month];
    cumulative += premium;
    const date = new Date(month + '-01');
    const monthName = date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    console.log(`${monthName.padEnd(15)}$${premium.toFixed(2).padStart(15)}`);
  }
  
  console.log('-----------------------------------');
  console.log(`${'Total'.padEnd(15)}$${cumulative.toFixed(2).padStart(15)}`);
  
} catch (error) {
  console.error('Error:', error.message);
  console.error(error.stack);
}
