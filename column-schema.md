# Unified Column Schema — Spread Strategy Pages

## Design Principles
- **Always visible** (pinned): Checkbox, Score, Symbol, Strikes, DTE, Net Credit/Premium, Width
- **Default visible**: Trend 14d, Current Price, ROC %, Weekly %, Breakeven/Profit Zone, Risk badges
- **Default hidden** (toggle on): Exchange (index mode), Capital at Risk, Delta, OI, Volume, RSI, BB %B, IV Rank, Bid, Ask, Mid, Spread %, Distance OTM, Expiration

## Column Map (consistent across all three pages)

| # | Key | Label | BPS | BCS | IC | Default | Group |
|---|-----|-------|-----|-----|----|---------|-------|
| 1 | _select | ☐ | ✓ | ✓ | ✓ | pinned | — |
| 2 | score | Score | ✓ | ✓ | ✓ | pinned | Core |
| 2b | trend14d | Trend 14d | ✓ (spread) | ✓ (spread) | ✗ | visible | Core |
| 3 | symbol | Symbol | ✓ | ✓ | ✓ | pinned | Core |
| 3b | exchange | Exchange | index only | index only | index only | visible | Core |
| 4 | currentPrice | Current | ✓ | ✓ | ✓ | visible | Position |
| 5 | strikes | Strikes | Short/Long | Short/Long | Put / Call | pinned | Position |
| 5b | width | Width | ✓ | ✓ | ✓ | visible | Position |
| 6 | dte | DTE | ✓ | ✓ | ✓ | pinned | Position |
| 7 | netCredit | Net Credit | ✓ | ✓ | ✓ | pinned | Returns |
| 8 | capitalAtRisk | Capital Risk | ✓ | ✓ | ✓ | hidden | Returns |
| 9 | roc | ROC % | ✓ | ✓ | ✓ | visible | Returns |
| 10 | weeklyPct | Weekly % | ✓ | ✓ | ✗ | visible | Returns |
| 11 | breakeven | Breakeven | BPS only | ✗ | Profit Zone | visible | Returns |
| 12 | delta | Delta (Δ) | ✓ | ✓ | Put Δ / Call Δ / Net Δ | hidden | Greeks |
| 13 | ivRank | IV Rank | ✓ | ✓ | ✓ | hidden | Greeks |
| 14 | rsi | RSI | ✓ | ✓ | ✓ | hidden | Technical |
| 15 | bbPctB | BB %B | ✓ | ✓ | ✓ | hidden | Technical |
| 16 | openInterest | OI | ✓ | ✓ | ✗ | hidden | Liquidity |
| 17 | volume | Vol | ✓ | ✓ | ✗ | hidden | Liquidity |
| 18 | bid | Bid | ✓ | ✓ | ✗ | hidden | Quote |
| 19 | ask | Ask | ✓ | ✓ | ✗ | hidden | Quote |
| 20 | mid | Mid | ✗ | ✓ | ✗ | hidden | Quote |
| 21 | spreadPct | Spread % | ✓ | ✓ | ✗ | hidden | Quote |
| 22 | distanceOtm | Dist OTM | ✗ | ✓ | ✗ | hidden | Position |
| 23 | expiration | Expiration | ✗ | ✓ | ✗ | hidden | Position |
| 24 | riskBadges | Risk | ✓ | ✓ | ✗ | visible | Core |
| 24b | profitZone | Profit Zone | ✗ | ✗ | ✓ | visible | Returns |
| 24c | breakevens | Breakevens | ✗ | ✗ | ✓ | hidden | Returns |
| 25 | spxwScore | SPXW Score | ✗ | ✗ | SPXW only | visible | Core |

## Default visible set (applies to all three pages)
score, trend14d (BPS/BCS spread mode), symbol, exchange (index mode), currentPrice, strikes, width, dte, netCredit, roc, weeklyPct (BPS/BCS), breakeven/profitZone, riskBadges/spxwScore

## Hidden by default (toggle on)
capitalAtRisk, delta, ivRank, rsi, bbPctB, openInterest, volume, bid, ask, mid, spreadPct, distanceOtm, expiration, breakevens (IC)

## localStorage keys
- `prosper_col_vis_bps` — BPS column visibility
- `prosper_col_vis_bcs` — BCS column visibility  
- `prosper_col_vis_ic` — Iron Condor column visibility
- `prosper_widths_bps` — BPS symbolWidths
- `prosper_widths_bcs` — BCS symbolWidths
- `prosper_widths_ic` — Iron Condor symbolWidths
