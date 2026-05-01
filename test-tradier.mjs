import axios from 'axios';
import { config } from 'dotenv';
config();

const key = process.env.TRADIER_API_KEY;
console.log('Key available:', !!key, 'Length:', key?.length);
const end = new Date().toISOString().split('T')[0];
const start = new Date(Date.now() - 250 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
console.log('Date range:', start, 'to', end);

try {
  const r = await axios.get('https://api.tradier.com/v1/markets/history', {
    params: { symbol: 'AAPL', interval: 'daily', start, end },
    headers: { Authorization: 'Bearer ' + key, Accept: 'application/json' },
    timeout: 30000
  });
  const days = r.data.history?.day;
  console.log('Days returned:', Array.isArray(days) ? days.length : (days ? 1 : 0));
  if (Array.isArray(days) && days.length > 0) {
    console.log('Last day:', days[days.length - 1]);
    
    // Calculate RSI
    const prices = days.map(d => d.close);
    const period = 14;
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
      const change = prices[i] - prices[i - 1];
      if (change > 0) gains += change;
      else losses += Math.abs(change);
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;
    for (let i = period + 1; i < prices.length; i++) {
      const change = prices[i] - prices[i - 1];
      if (change > 0) {
        avgGain = (avgGain * (period - 1) + change) / period;
        avgLoss = (avgLoss * (period - 1)) / period;
      } else {
        avgGain = (avgGain * (period - 1)) / period;
        avgLoss = (avgLoss * (period - 1) + Math.abs(change)) / period;
      }
    }
    const rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
    console.log('RSI:', rsi.toFixed(2));
  }
} catch (e) {
  console.error('Error:', e.response?.status, e.message);
}
