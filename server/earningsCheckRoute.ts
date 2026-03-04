import { Router, json } from 'express';
import { TradierAPI } from './tradier';
import { checkEarningsBlock } from './earningsBlock';

const earningsCheckRouter = Router();

earningsCheckRouter.post('/api/earnings-check', json(), async (req, res) => {
  try {
    const { symbols } = req.body;
    if (!Array.isArray(symbols) || symbols.length === 0) {
      return res.status(400).json({ error: 'symbols array required' });
    }

    const tradierKey = process.env.TRADIER_API_KEY || '';
    if (!tradierKey) {
      return res.json({ blocked: [], warned: [], clear: symbols });
    }

    const tradierAPI = new TradierAPI(tradierKey);
    const result = await checkEarningsBlock(symbols, tradierAPI);
    return res.json(result);
  } catch (err: any) {
    console.error('[EarningsCheck Route] Error:', err.message);
    return res.status(500).json({ error: 'Earnings check failed' });
  }
});

export { earningsCheckRouter };
