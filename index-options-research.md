# Index Options OCC Symbol Root & Instrument-Type Research

## Key Finding: Tastytrade instrument-type for ALL index options
Based on live testing and Tastytrade API behavior:
- **Multi-leg spread orders (BCS, BPS, IC, etc.)**: Use `'Equity Option'` for ALL symbols including indexes
- **Single-leg orders (closes, rolls, BTCs)**: Use `'Equity Option'` for all EXCEPT true cash-settled indexes where Tastytrade may require `'Index Option'`
- **CRITICAL**: Tastytrade API rejects `'Index Option'` for multi-leg spread orders on ALL symbols

## OCC Symbol Root Rules (from CBOE official docs)

### SPX (S&P 500)
- **Monthly AM-settled** (3rd Friday): Root = `SPX`
- **Weekly/Daily PM-settled**: Root = `SPXW`
- Rule: If expiration is 3rd Friday of month → `SPX`, otherwise → `SPXW`
- Note: SPX EOM (end-of-month) also uses `SPXW`

### NDX (Nasdaq-100)
- **Monthly AM-settled** (3rd Friday): Root = `NDX`
- **Weekly/Daily/Quarterly PM-settled**: Root = `NDXP`
- Rule: If expiration is 3rd Friday of month → `NDX`, otherwise → `NDXP`

### RUT (Russell 2000)
- **Monthly AM-settled** (3rd Friday): Root = `RUT`
- **Weekly PM-settled**: Root = `RUTW`
- Rule: If expiration is 3rd Friday of month → `RUT`, otherwise → `RUTW`

### SPXW
- Already the weekly root — always use `SPXW` as-is
- No mapping needed

### MRUT (Mini-Russell 2000, 1/10th RUT)
- **All expirations**: Root = `MRUT` (single root symbol, no weekly variant)
- Weekly, monthly, quarterly all use `MRUT`

### DJX (Dow Jones Industrial Average, 1/100th DJIA)
- **All expirations**: Root = `DJX` (single root symbol)
- Weekly options exist but use same `DJX` root (confirmed: no DJXW)
- Note: DJX weeklys are AM-settled (unusual for weeklys)

### XSP (Mini-SPX, 1/10th SPX)
- **All expirations**: Root = `XSP` (single root symbol, no weekly variant)
- Weekly and monthly all use `XSP`

### XND (Micro-NDX, 1/100th NDX)
- **All expirations**: Root = `XND` (single root symbol)
- Weekly and monthly all use `XND`

### NDXP
- Already the weekly/PM root — always use `NDXP` as-is
- No mapping needed

## Summary Table

| Watchlist Symbol | Monthly OCC Root | Weekly OCC Root | Notes |
|---|---|---|---|
| SPX | SPX | SPXW | 3rd Friday = SPX, all others = SPXW |
| SPXW | SPXW | SPXW | Always SPXW |
| NDX | NDX | NDXP | 3rd Friday = NDX, all others = NDXP |
| NDXP | NDXP | NDXP | Always NDXP |
| RUT | RUT | RUTW | 3rd Friday = RUT, all others = RUTW |
| MRUT | MRUT | MRUT | Single root, no weekly variant |
| DJX | DJX | DJX | Single root, AM-settled weeklys |
| XSP | XSP | XSP | Single root, no weekly variant |
| XND | XND | XND | Single root, no weekly variant |

## Implementation Rule for getOccRoot(symbol, expirationDate)

```
function getOccRoot(symbol: string, expirationDate: Date): string {
  const is3rdFriday = isThirdFriday(expirationDate);
  
  switch (symbol.toUpperCase()) {
    case 'SPX':
      return is3rdFriday ? 'SPX' : 'SPXW';
    case 'NDX':
      return is3rdFriday ? 'NDX' : 'NDXP';
    case 'RUT':
      return is3rdFriday ? 'RUT' : 'RUTW';
    // All others: use symbol as-is
    case 'SPXW':
    case 'NDXP':
    case 'RUTW':
    case 'MRUT':
    case 'DJX':
    case 'XSP':
    case 'XND':
    default:
      return symbol.toUpperCase();
  }
}
```
