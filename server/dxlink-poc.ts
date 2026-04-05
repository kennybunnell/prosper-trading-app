/**
 * DXLink Proof-of-Concept Test
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests whether Tastytrade's DXLink API returns Greeks (delta, theta, vega, IV)
 * for equity options on this account.
 *
 * Run with:  npx tsx server/dxlink-poc.ts
 * ─────────────────────────────────────────────────────────────────────────────
 */

import 'dotenv/config';
import WebSocket from 'ws';
import { getDb } from './db';
import { apiCredentials, users } from '../drizzle/schema';
import { authenticateTastytrade } from './tastytrade';
import axios from 'axios';

const TASTYTRADE_API_BASE = 'https://api.tastyworks.com';

// ── Helpers ──────────────────────────────────────────────────────────────────

function log(icon: string, msg: string, data?: unknown) {
  const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
  console.log(`[${ts}] ${icon}  ${msg}`);
  if (data !== undefined) {
    console.log('         ', JSON.stringify(data, null, 2).replace(/\n/g, '\n          '));
  }
}

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}

// ── Step 1: Load credentials from DB ─────────────────────────────────────────

async function loadCredentials() {
  log('🔍', 'Connecting to database...');
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  const { eq } = await import('drizzle-orm');

  // Get all users with credentials
  const creds = await db
    .select({
      userId: apiCredentials.userId,
      clientSecret: apiCredentials.tastytradeClientSecret,
      refreshToken: apiCredentials.tastytradeRefreshToken,
      accessToken: apiCredentials.tastytradeAccessToken,
    })
    .from(apiCredentials)
    .limit(5);

  const validCred = creds.find(c => c.clientSecret && c.refreshToken);
  if (!validCred) throw new Error('No Tastytrade OAuth2 credentials found in database. Please configure them in Settings.');

  log('✅', `Found credentials for userId: ${validCred.userId}`);
  return validCred;
}

// ── Step 2: Authenticate and get a quote token ────────────────────────────────

async function getQuoteToken(cred: Awaited<ReturnType<typeof loadCredentials>>) {
  log('🔐', 'Authenticating with Tastytrade...');

  const api = await authenticateTastytrade(
    {
      tastytradeClientSecret: cred.clientSecret,
      tastytradeRefreshToken: cred.refreshToken,
    },
    cred.userId
  );

  // Access the internal access token via the class
  const accessToken = (api as any).accessToken as string;
  if (!accessToken) throw new Error('Failed to get Tastytrade access token');

  log('✅', 'Authenticated with Tastytrade');

  // Get DXLink quote token
  log('🔑', 'Fetching FRESH DXLink quote token from /api-quote-tokens...');
  // Always fetch a fresh token — DXLink tokens may be single-use or very short-lived
  const resp = await axios.get(`${TASTYTRADE_API_BASE}/api-quote-tokens`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    // Bust any cache
    params: { _t: Date.now() },
  });

  const tokenData = resp.data?.data;
  if (!tokenData?.token || !tokenData?.['dxlink-url']) {
    throw new Error(`Unexpected /api-quote-tokens response: ${JSON.stringify(resp.data)}`);
  }

  log('✅', 'Got FRESH DXLink quote token', {
    dxlinkUrl: tokenData['dxlink-url'],
    level: tokenData.level,
    issuedAt: tokenData['issued-at'],
    expiresAt: tokenData['expires-at'],
    tokenLength: tokenData.token.length,
    tokenPreview: tokenData.token.substring(0, 40) + '...',
  });

  return { dxlinkUrl: tokenData['dxlink-url'] as string, token: tokenData.token as string, accessToken };
}

// ── Step 3: Get a real option streamer symbol from open positions ──────────────

async function getTestSymbol(accessToken: string): Promise<string> {
  log('📋', 'Fetching open positions to find a real option streamer symbol...');

  try {
    // Get accounts
    const acctResp = await axios.get(`${TASTYTRADE_API_BASE}/customers/me/accounts`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const accounts = acctResp.data?.data?.items ?? [];
    if (!accounts.length) throw new Error('No accounts found');

    const accountNumber = accounts[0]?.account?.['account-number'];
    log('📂', `Using account: ${accountNumber}`);

    // Get positions
    const posResp = await axios.get(`${TASTYTRADE_API_BASE}/accounts/${accountNumber}/positions`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const positions = posResp.data?.data?.items ?? [];
    const optionPos = positions.find((p: any) => p['instrument-type'] === 'Equity Option' && p['streamer-symbol']);

    if (optionPos) {
      log('✅', `Found open option position: ${optionPos.symbol}`, {
        streamerSymbol: optionPos['streamer-symbol'],
        quantity: optionPos.quantity,
        direction: optionPos['quantity-direction'],
      });
      return optionPos['streamer-symbol'];
    }
  } catch (err: any) {
    log('⚠️', `Could not fetch positions: ${err.message} — falling back to option chain lookup`);
  }

  // Fallback: get a symbol from SPY option chain
  log('🔄', 'Fallback: fetching SPY option chain for a test symbol...');
  const chainResp = await axios.get(`${TASTYTRADE_API_BASE}/option-chains/SPY/nested`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: { 'option-type': 'P' },
  });

  const expirations = chainResp.data?.data?.items ?? [];
  // Pick the first expiration with strikes
  for (const exp of expirations) {
    const strikes = exp?.strikes ?? [];
    if (strikes.length > 0) {
      // Pick a near-ATM strike (middle of array)
      const mid = strikes[Math.floor(strikes.length / 2)];
      const streamerSymbol = mid?.put?.['streamer-symbol'] ?? mid?.['streamer-symbol'];
      if (streamerSymbol) {
        log('✅', `Using SPY option from chain: ${streamerSymbol}`, {
          expiration: exp.expiration_date ?? exp['expiration-date'],
          strike: mid['strike-price'],
        });
        return streamerSymbol;
      }
    }
  }

  throw new Error('Could not find any option symbol to test with');
}

// ── Step 4: DXLink WebSocket test ─────────────────────────────────────────────

async function testDXLink(dxlinkUrl: string, token: string, streamerSymbol: string) {
  log('🌐', `Opening DXLink WebSocket: ${dxlinkUrl}`);

  return new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(dxlinkUrl);
    let channelId = 1;
    let state: 'connecting' | 'setup' | 'auth' | 'channel' | 'feed_setup' | 'subscribed' | 'done' = 'connecting';
    let timeout: ReturnType<typeof setTimeout>;
    const received: Record<string, unknown[]> = {};

    const done = (success: boolean, reason?: string) => {
      clearTimeout(timeout);
      ws.close();
      if (success) {
        log('🎉', '');
        log('🎉', '═══════════════════════════════════════════════');
        log('🎉', '  TEST PASSED — DXLink Greeks ARE available!');
        log('🎉', '═══════════════════════════════════════════════');
        log('🎉', '');
        resolve();
      } else {
        log('❌', '');
        log('❌', '═══════════════════════════════════════════════');
        log('❌', `  TEST RESULT: ${reason}`);
        if (received['Quote'] && (received['Quote'] as any[]).length > 0) {
          log('ℹ️', '  Quote events DID arrive (quotes work, greeks may need market hours)');
          log('ℹ️', '  Quote sample:', received['Quote'][0]);
        }
        log('❌', '═══════════════════════════════════════════════');
        log('❌', '');
        resolve(); // resolve not reject — this is informational
      }
    };

    // 10-second overall timeout
    timeout = setTimeout(() => {
      log('⏳', 'Timeout reached (10 seconds). Checking what was received...');
      const hasGreeks = (received['Greeks'] ?? []).length > 0;
      const hasQuotes = (received['Quote'] ?? []).length > 0;
      if (hasGreeks) {
        done(true);
      } else if (hasQuotes) {
        done(false, 'TIMEOUT — Quotes received but NO Greeks. Try during market hours or contact Tastytrade support.');
      } else {
        done(false, 'TIMEOUT — No events received at all. Connection may have an issue.');
      }
    }, 10000);

    ws.on('open', () => {
      log('✅', 'WebSocket connected');
      state = 'setup';
      // Step 1: SETUP
      const setup = {
        type: 'SETUP',
        channel: 0,
        keepaliveTimeout: 60,
        acceptKeepaliveTimeout: 60,
        version: '0.1-DXF-JS/0.3.0',
      };
      log('📤', 'Sending SETUP', setup);
      ws.send(JSON.stringify(setup));
    });

    ws.on('message', (raw) => {
      let msg: any;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        log('⚠️', 'Non-JSON message received:', raw.toString().substring(0, 200));
        return;
      }

      log('📥', `Received: ${msg.type}`, msg.type === 'FEED_DATA' ? { type: msg.type, channel: msg.channel, dataCount: msg.data?.length } : msg);

      switch (msg.type) {
        case 'SETUP':
          log('✅', 'SETUP acknowledged by server');
          state = 'auth';
          // Step 2: AUTH
          const auth = { type: 'AUTH', channel: 0, token };
          const authStr = JSON.stringify(auth);
          log('📤', 'Sending AUTH (raw)', { rawLength: authStr.length, tokenLength: token.length, tokenFirst20: token.substring(0, 20), tokenLast10: token.substring(token.length - 10) });
          ws.send(authStr);
          break;

        case 'AUTH_STATE':
          if (msg.state === 'AUTHORIZED') {
            log('✅', 'AUTH_STATE: AUTHORIZED');
            state = 'channel';
            // Step 3: CHANNEL_REQUEST
            const chanReq = { type: 'CHANNEL_REQUEST', channel: channelId, service: 'FEED', parameters: { contract: 'AUTO' } };
            log('📤', 'Sending CHANNEL_REQUEST', chanReq);
            ws.send(JSON.stringify(chanReq));
          } else {
            done(false, `AUTH_STATE: ${msg.state} — token may be invalid`);
          }
          break;

        case 'CHANNEL_OPENED':
          log('✅', `Channel ${msg.channel} opened`);
          state = 'feed_setup';
          // Step 4: FEED_SETUP — request Greeks AND Quote event types
          const feedSetup = {
            type: 'FEED_SETUP',
            channel: channelId,
            acceptAggregationPeriod: 0,
            acceptDataFormat: 'FULL',
            acceptEventFields: {
              Greeks: ['eventType', 'eventSymbol', 'eventTime', 'price', 'volatility', 'delta', 'gamma', 'theta', 'rho', 'vega'],
              Quote: ['eventType', 'eventSymbol', 'bidPrice', 'askPrice', 'bidSize', 'askSize'],
            },
          };
          log('📤', 'Sending FEED_SETUP (requesting Greeks + Quote fields)', feedSetup);
          ws.send(JSON.stringify(feedSetup));
          break;

        case 'FEED_CONFIG':
          log('✅', 'FEED_CONFIG received — server confirmed field schema');
          state = 'subscribed';
          // Step 5: FEED_SUBSCRIPTION
          const sub = {
            type: 'FEED_SUBSCRIPTION',
            channel: channelId,
            reset: true,
            add: [
              { type: 'Greeks', symbol: streamerSymbol },
              { type: 'Quote', symbol: streamerSymbol },
            ],
          };
          log('📤', `Sending FEED_SUBSCRIPTION for: ${streamerSymbol}`, sub);
          ws.send(JSON.stringify(sub));
          log('⏳', 'Waiting for Greeks/Quote events (up to 10 seconds)...');
          break;

        case 'FEED_DATA':
          // Data arrives as array of events
          const events: any[] = msg.data ?? [];
          for (const event of events) {
            const evType = event.eventType ?? event[0];
            if (!received[evType]) received[evType] = [];
            received[evType].push(event);

            if (evType === 'Greeks') {
              log('🎯', `GREEKS EVENT RECEIVED for ${event.eventSymbol ?? streamerSymbol}!`, {
                delta: event.delta,
                theta: event.theta,
                vega: event.vega,
                gamma: event.gamma,
                volatility: event.volatility,
                price: event.price,
              });
              done(true);
            } else if (evType === 'Quote') {
              log('📊', `Quote event received for ${event.eventSymbol ?? streamerSymbol}`, {
                bid: event.bidPrice,
                ask: event.askPrice,
              });
            }
          }
          break;

        case 'KEEPALIVE':
          ws.send(JSON.stringify({ type: 'KEEPALIVE', channel: 0 }));
          break;

        case 'ERROR':
          log('❌', 'DXLink ERROR', msg);
          done(false, `DXLink server error: ${msg.error ?? JSON.stringify(msg)}`);
          break;
      }
    });

    ws.on('error', (err) => {
      log('❌', `WebSocket error: ${err.message}`);
      done(false, `WebSocket connection error: ${err.message}`);
    });

    ws.on('close', (code, reason) => {
      if (state !== 'done') {
        log('⚠️', `WebSocket closed unexpectedly: code=${code} reason=${reason.toString()}`);
      }
    });
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║        DXLink Greeks Proof-of-Concept Test            ║');
  console.log('╚═══════════════════════════════════════════════════════╝');
  console.log('');

  try {
    const cred = await loadCredentials();
    const { dxlinkUrl, token, accessToken } = await getQuoteToken(cred);
    const streamerSymbol = await getTestSymbol(accessToken);
    await testDXLink(dxlinkUrl, token, streamerSymbol);
  } catch (err: any) {
    log('❌', `FATAL ERROR: ${err.message}`);
    if (err.response?.data) {
      log('❌', 'API Response:', err.response.data);
    }
    process.exit(1);
  }

  process.exit(0);
}

main();
