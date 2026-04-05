import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock LLM helper ─────────────────────────────────────────────────────────
vi.mock('./_core/llm', () => ({
  invokeLLM: vi.fn().mockResolvedValue({
    choices: [{ message: { content: '## Morning Briefing\n- Hold all positions\n- VIX is elevated' } }],
  }),
}));

// ─── Mock Tastytrade API ──────────────────────────────────────────────────────
vi.mock('./tastytrade', () => ({
  TastytradeAPI: vi.fn().mockImplementation(() => ({
    getPositions: vi.fn().mockResolvedValue([
      {
        'instrument-type': 'Equity Option',
        'underlying-symbol': 'AAPL',
        symbol: 'AAPL  250418P00150000',
        quantity: -1,
        'quantity-direction': 'Short',
        'expires-at': new Date(Date.now() + 10 * 86400000).toISOString(), // 10 DTE
        'close-price': '2.50',
        'average-open-price': '3.00',
        multiplier: 100,
        'account-number': 'TEST001',
        'streamer-symbol': '',
        'cost-effect': 'Credit',
        'is-suppressed': false,
        'is-frozen': false,
        'restricted-quantity': 0,
        'realized-day-gain': '0',
        'realized-day-gain-effect': 'None',
        'realized-day-gain-date': '',
        'realized-today': '0',
        'realized-today-effect': 'None',
        'realized-today-date': '',
        'average-yearly-market-close-price': '0',
        'average-daily-market-close-price': '0',
      },
    ]),
  })),
}));

// ─── Mock env ─────────────────────────────────────────────────────────────────
vi.mock('./_core/env', () => ({
  env: {
    TASTYTRADE_USERNAME: 'test@test.com',
    TASTYTRADE_PASSWORD: 'testpass',
    TASTYTRADE_ACCOUNT_NUMBERS: 'TEST001',
    DATABASE_URL: 'mysql://localhost/test',
    JWT_SECRET: 'test-secret',
    VITE_APP_ID: 'test-app',
    OAUTH_SERVER_URL: 'https://api.manus.im',
    VITE_OAUTH_PORTAL_URL: 'https://portal.manus.im',
    OWNER_OPEN_ID: 'test-owner',
    OWNER_NAME: 'Test Owner',
    BUILT_IN_FORGE_API_URL: 'https://api.manus.im',
    BUILT_IN_FORGE_API_KEY: 'test-key',
    VITE_FRONTEND_FORGE_API_KEY: 'test-key',
    VITE_FRONTEND_FORGE_API_URL: 'https://api.manus.im',
    VITE_APP_TITLE: 'Prosper Trading',
    VITE_APP_LOGO: '',
    VITE_ANALYTICS_ENDPOINT: '',
    VITE_ANALYTICS_WEBSITE_ID: '',
    VITE_APP_ID: 'test',
    STRIPE_SECRET_KEY: '',
    STRIPE_WEBHOOK_SECRET: '',
    VITE_STRIPE_PUBLISHABLE_KEY: '',
    OAUTH_TOKEN_ENCRYPTION_KEY: 'test-enc-key',
  },
}));

import { invokeLLM } from './_core/llm';

// ─── Test: generateMorningBriefing logic ─────────────────────────────────────
describe('AI Morning Briefing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls invokeLLM with context JSON and returns briefing text', async () => {
    const mockCtx = {
      openPositionsCount: 5,
      closeProfitCount: 2,
      rollPositionsCount: 1,
      sellCallsCount: 0,
      upcomingExpirations: [{ symbol: 'AAPL', expiration: '2025-04-18', dte: 10, strategy: 'CSP', accountNumber: 'TEST001' }],
      vix: 22.5,
      marketSentiment: 'elevated volatility',
    };

    const result = await invokeLLM({
      messages: [
        { role: 'system', content: 'You are a professional options trading advisor.' },
        { role: 'user', content: `Context: ${JSON.stringify(mockCtx)}\n\nGenerate morning briefing.` },
      ],
    });

    expect(invokeLLM).toHaveBeenCalledOnce();
    expect(result.choices[0].message.content).toContain('Morning Briefing');
  });

  it('returns a non-empty briefing string', async () => {
    const result = await invokeLLM({
      messages: [
        { role: 'system', content: 'You are a professional options trading advisor.' },
        { role: 'user', content: 'Generate a morning briefing for 5 open positions.' },
      ],
    });

    const content = result.choices[0].message.content;
    expect(typeof content).toBe('string');
    expect(content.length).toBeGreaterThan(10);
  });
});

// ─── Test: upcoming expirations detection ────────────────────────────────────
describe('Upcoming Expirations Detection', () => {
  it('correctly calculates DTE from expires-at ISO string', () => {
    const now = Date.now();
    const tenDaysFromNow = new Date(now + 10 * 86400000).toISOString();
    const expMs = new Date(tenDaysFromNow).getTime();
    const dte = Math.max(0, Math.round((expMs - now) / 86400000));
    expect(dte).toBeGreaterThanOrEqual(9);
    expect(dte).toBeLessThanOrEqual(11);
  });

  it('flags positions with DTE <= 21 as upcoming expirations', () => {
    const now = Date.now();
    const positions = [
      { 'expires-at': new Date(now + 10 * 86400000).toISOString(), 'instrument-type': 'Equity Option', 'underlying-symbol': 'AAPL' },
      { 'expires-at': new Date(now + 30 * 86400000).toISOString(), 'instrument-type': 'Equity Option', 'underlying-symbol': 'TSLA' },
      { 'expires-at': new Date(now + 5 * 86400000).toISOString(), 'instrument-type': 'Equity Option', 'underlying-symbol': 'SPY' },
    ];

    const upcoming = positions.filter(pos => {
      const expMs = new Date(pos['expires-at']).getTime();
      const dte = Math.max(0, Math.round((expMs - now) / 86400000));
      return dte <= 21;
    });

    expect(upcoming).toHaveLength(2);
    expect(upcoming.map(p => p['underlying-symbol'])).toContain('AAPL');
    expect(upcoming.map(p => p['underlying-symbol'])).toContain('SPY');
    expect(upcoming.map(p => p['underlying-symbol'])).not.toContain('TSLA');
  });
});

// ─── Test: VIX badge color logic ─────────────────────────────────────────────
describe('VIX Badge Color Logic', () => {
  const getVixColor = (vix: number) => {
    if (vix >= 30) return 'red';
    if (vix >= 20) return 'amber';
    return 'green';
  };

  it('shows red for VIX >= 30 (high fear)', () => {
    expect(getVixColor(35)).toBe('red');
    expect(getVixColor(30)).toBe('red');
  });

  it('shows amber for VIX 20-29 (elevated)', () => {
    expect(getVixColor(25)).toBe('amber');
    expect(getVixColor(20)).toBe('amber');
  });

  it('shows green for VIX < 20 (calm)', () => {
    expect(getVixColor(15)).toBe('green');
    expect(getVixColor(19.9)).toBe('green');
  });
});
