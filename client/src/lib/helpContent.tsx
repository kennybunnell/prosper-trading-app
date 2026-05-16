/**
 * Help content definitions for trading concepts
 * Used by HelpBadge components throughout the application
 */

export const HELP_CONTENT = {
  DELTA_CSP: (
    <div className="space-y-3">
      <p className="font-semibold">Delta measures how much an option's price changes per $1 move in the stock.</p>
      
      <div className="space-y-2">
        <p className="font-medium">For Puts (CSP/Bull Put Spreads):</p>
        <ul className="list-disc list-inside space-y-1 text-xs">
          <li>-0.30 Delta = 30% probability of being ITM at expiration</li>
          <li>Lower delta (closer to 0) = Safer, less premium</li>
          <li>Higher delta (closer to -1) = Riskier, more premium</li>
        </ul>
      </div>

      <div className="space-y-2">
        <p className="font-medium">Target Ranges:</p>
        <ul className="list-disc list-inside space-y-1 text-xs">
          <li>🟢 Conservative: 0.15-0.25 (15-25% probability)</li>
          <li>🟡 Medium: 0.25-0.35 (25-35% probability)</li>
          <li>🔴 Aggressive: 0.35-0.45 (35-45% probability)</li>
        </ul>
      </div>
    </div>
  ),

  DELTA_CC: (
    <div className="space-y-3">
      <p className="font-semibold">Delta measures how much an option's price changes per $1 move in the stock.</p>
      
      <div className="space-y-2">
        <p className="font-medium">For Calls (CC/Bear Call Spreads):</p>
        <ul className="list-disc list-inside space-y-1 text-xs">
          <li>0.30 Delta = 30% probability of being ITM at expiration</li>
          <li>Lower delta (closer to 0) = Safer, less premium</li>
          <li>Higher delta (closer to 1) = Riskier, more premium</li>
        </ul>
      </div>

      <div className="space-y-2">
        <p className="font-medium">Target Ranges:</p>
        <ul className="list-disc list-inside space-y-1 text-xs">
          <li>🟢 Conservative: 0.15-0.25 (15-25% probability)</li>
          <li>🟡 Medium: 0.25-0.35 (25-35% probability)</li>
          <li>🔴 Aggressive: 0.35-0.45 (35-45% probability)</li>
        </ul>
      </div>
    </div>
  ),

  DTE: (
    <div className="space-y-3">
      <p className="font-semibold">Days to Expiration - Time until the option contract expires.</p>
      
      <div className="space-y-2">
        <p className="font-medium">Sweet Spot: 21-45 DTE</p>
        <ul className="list-disc list-inside space-y-1 text-xs">
          <li>Optimal balance of premium and theta decay</li>
          <li>Enough time for stock to move in your favor</li>
          <li>Not too far out (lower premium per day)</li>
        </ul>
      </div>

      <div className="space-y-2">
        <p className="font-medium">Why This Range?</p>
        <ul className="list-disc list-inside space-y-1 text-xs">
          <li>&lt;21 DTE: Gamma risk increases (rapid delta changes)</li>
          <li>21-45 DTE: Maximum theta decay efficiency</li>
          <li>&gt;45 DTE: Lower weekly returns, capital tied up longer</li>
        </ul>
      </div>

      <div className="space-y-2">
        <p className="font-medium">Weekly Options (7 DTE):</p>
        <ul className="list-disc list-inside space-y-1 text-xs">
          <li>Higher weekly returns but riskier</li>
          <li>Less room for stock to recover</li>
          <li>Best for experienced traders only</li>
        </ul>
      </div>
    </div>
  ),

  RSI_CSP: (
    <div className="space-y-3">
      <p className="font-semibold">RSI measures whether a stock is overbought or oversold (0-100 scale).</p>
      
      <div className="space-y-2">
        <p className="font-medium">For Cash-Secured Puts:</p>
        <ul className="list-disc list-inside space-y-1 text-xs">
          <li>🟢 20-35: Oversold - Good entry for bullish trades</li>
          <li>🟡 15-20 or 35-45: Caution zone</li>
          <li>🔴 &lt;15 or &gt;45: Avoid - stock may continue falling</li>
        </ul>
      </div>

      <div className="space-y-2">
        <p className="font-medium">How to Use:</p>
        <ul className="list-disc list-inside space-y-1 text-xs">
          <li>RSI &lt;30: Stock is oversold (potential bounce)</li>
          <li>RSI &gt;70: Stock is overbought (potential pullback)</li>
          <li>Combine with other indicators for confirmation</li>
        </ul>
      </div>
    </div>
  ),

  RSI_CC: (
    <div className="space-y-3">
      <p className="font-semibold">RSI measures whether a stock is overbought or oversold (0-100 scale).</p>
      
      <div className="space-y-2">
        <p className="font-medium">For Covered Calls:</p>
        <ul className="list-disc list-inside space-y-1 text-xs">
          <li>🟢 65-80: Overbought - Good entry for bearish trades</li>
          <li>🟡 55-65 or 80-85: Caution zone</li>
          <li>🔴 &lt;55 or &gt;85: Avoid - stock may continue rising</li>
        </ul>
      </div>

      <div className="space-y-2">
        <p className="font-medium">How to Use:</p>
        <ul className="list-disc list-inside space-y-1 text-xs">
          <li>RSI &lt;30: Stock is oversold (potential bounce)</li>
          <li>RSI &gt;70: Stock is overbought (potential pullback)</li>
          <li>Combine with other indicators for confirmation</li>
        </ul>
      </div>
    </div>
  ),

  BB_PCTB_CSP: (
    <div className="space-y-3">
      <p className="font-semibold">BB %B shows where price is relative to Bollinger Bands (0-1 scale).</p>
      
      <div className="space-y-2">
        <p className="font-medium">For Cash-Secured Puts:</p>
        <ul className="list-disc list-inside space-y-1 text-xs">
          <li>🟢 0.00-0.20: Near lower band - oversold, good entry</li>
          <li>🟡 0.20-0.40: Below middle - moderate</li>
          <li>🔴 0.40-1.00: Above middle - avoid</li>
        </ul>
      </div>

      <div className="space-y-2">
        <p className="font-medium">What It Means:</p>
        <ul className="list-disc list-inside space-y-1 text-xs">
          <li>0.00: Price at lower band (oversold)</li>
          <li>0.50: Price at middle band (neutral)</li>
          <li>1.00: Price at upper band (overbought)</li>
        </ul>
      </div>
    </div>
  ),

  BB_PCTB_CC: (
    <div className="space-y-3">
      <p className="font-semibold">BB %B shows where price is relative to Bollinger Bands (0-1 scale).</p>
      
      <div className="space-y-2">
        <p className="font-medium">For Covered Calls:</p>
        <ul className="list-disc list-inside space-y-1 text-xs">
          <li>🟢 0.80-1.00: Near upper band - overbought, good entry</li>
          <li>🟡 0.60-0.80: Above middle - moderate</li>
          <li>🔴 0.00-0.60: Below middle - avoid</li>
        </ul>
      </div>

      <div className="space-y-2">
        <p className="font-medium">What It Means:</p>
        <ul className="list-disc list-inside space-y-1 text-xs">
          <li>0.00: Price at lower band (oversold)</li>
          <li>0.50: Price at middle band (neutral)</li>
          <li>1.00: Price at upper band (overbought)</li>
        </ul>
      </div>
    </div>
  ),

  IV_RANK: (
    <div className="space-y-3">
      <p className="font-semibold">IV Rank shows where current implied volatility sits relative to its 52-week range (0-100%).</p>
      
      <div className="space-y-2">
        <p className="font-medium">Target Ranges:</p>
        <ul className="list-disc list-inside space-y-1 text-xs">
          <li>🟢 50-100%: High IV - Great for selling options (higher premiums)</li>
          <li>🟡 30-50%: Moderate IV - Acceptable premiums</li>
          <li>🔴 0-30%: Low IV - Poor premiums, consider waiting</li>
        </ul>
      </div>

      <div className="space-y-2">
        <p className="font-medium">Why It Matters:</p>
        <ul className="list-disc list-inside space-y-1 text-xs">
          <li>High IV = Higher option premiums (better for sellers)</li>
          <li>Low IV = Lower option premiums (better for buyers)</li>
          <li>Sell when IV is high, buy when IV is low</li>
        </ul>
      </div>

      <div className="space-y-2">
        <p className="font-medium">Example:</p>
        <p className="text-xs">IV Rank 80% = Current IV is higher than 80% of past year. Expect premiums to be above average.</p>
      </div>
    </div>
  ),

  NET_CREDIT: (
    <div className="space-y-3">
      <p className="font-semibold">Net Credit = Premium received from short leg - Premium paid for long leg</p>
      
      <div className="space-y-2">
        <p className="font-medium">Example Bull Put Spread:</p>
        <ul className="list-disc list-inside space-y-1 text-xs">
          <li>Sell $400 put for $2.50 (receive $250)</li>
          <li>Buy $395 put for $0.50 (pay $50)</li>
          <li>Net Credit: $2.00 ($200 per contract)</li>
        </ul>
      </div>

      <div className="space-y-2">
        <p className="font-medium">This is the maximum profit you can make on the spread.</p>
        <ul className="list-disc list-inside space-y-1 text-xs">
          <li>Higher Net Credit = More profit potential</li>
          <li>Lower Net Credit = Less profit, but safer strikes</li>
        </ul>
      </div>
    </div>
  ),

  CAPITAL_AT_RISK: (
    <div className="space-y-3">
      <p className="font-semibold">Capital at Risk = Spread Width - Net Credit</p>
      
      <div className="space-y-2">
        <p className="font-medium">Example Bull Put Spread:</p>
        <ul className="list-disc list-inside space-y-1 text-xs">
          <li>Spread Width: $5.00 ($400 - $395)</li>
          <li>Net Credit: $2.00</li>
          <li>Capital at Risk: $3.00 ($300 per contract)</li>
        </ul>
      </div>

      <div className="space-y-2">
        <p className="font-medium">This is the maximum loss if both strikes expire ITM.</p>
        <ul className="list-disc list-inside space-y-1 text-xs">
          <li>Determines buying power required</li>
          <li>Lower capital risk = More contracts possible</li>
          <li>Spread ROC = Net Credit / Capital at Risk</li>
        </ul>
      </div>
    </div>
  ),

  SPREAD_ROC: (
    <div className="space-y-3">
      <p className="font-semibold">Spread ROC = (Net Credit / Capital at Risk) × 100</p>
      
      <div className="space-y-2">
        <p className="font-medium">Example Bull Put Spread:</p>
        <ul className="list-disc list-inside space-y-1 text-xs">
          <li>Net Credit: $2.00</li>
          <li>Capital at Risk: $3.00</li>
          <li>Spread ROC: 66.7%</li>
        </ul>
      </div>

      <div className="space-y-2">
        <p className="font-medium">Target Ranges:</p>
        <ul className="list-disc list-inside space-y-1 text-xs">
          <li>🟢 &gt;50%: Excellent return on capital</li>
          <li>🟡 30-50%: Good return</li>
          <li>🔴 &lt;30%: Consider wider spread or different strike</li>
        </ul>
      </div>

      <div className="space-y-2">
        <p className="font-medium">Compare to CSP:</p>
        <ul className="list-disc list-inside space-y-1 text-xs">
          <li>CSP ROC: ~2-5% (premium / full collateral)</li>
          <li>Spread ROC: ~40-80% (premium / capital at risk)</li>
          <li>Spreads are more capital efficient!</li>
        </ul>
      </div>
    </div>
  ),

  BREAKEVEN_BULL_PUT: (
    <div className="space-y-3">
      <p className="font-semibold">Breakeven = Short Strike - Net Credit</p>
      
      <div className="space-y-2">
        <p className="font-medium">For Bull Put Spreads:</p>
        <ul className="list-disc list-inside space-y-1 text-xs">
          <li>Example: $400 short - $2.00 credit = $398 breakeven</li>
          <li>Stock can drop to $398 before you lose money</li>
          <li>Below $398: Start losing money</li>
          <li>Below $395 (long strike): Max loss reached</li>
        </ul>
      </div>

      <div className="space-y-2">
        <p className="font-medium">Profit Zone:</p>
        <p className="text-xs">Stock stays above $398 at expiration = Keep full net credit as profit</p>
      </div>
    </div>
  ),

  BREAKEVEN_BEAR_CALL: (
    <div className="space-y-3">
      <p className="font-semibold">Breakeven = Short Strike + Net Credit</p>
      
      <div className="space-y-2">
        <p className="font-medium">For Bear Call Spreads:</p>
        <ul className="list-disc list-inside space-y-1 text-xs">
          <li>Example: $400 short + $2.00 credit = $402 breakeven</li>
          <li>Stock can rise to $402 before you lose money</li>
          <li>Above $402: Start losing money</li>
          <li>Above $405 (long strike): Max loss reached</li>
        </ul>
      </div>

      <div className="space-y-2">
        <p className="font-medium">Profit Zone:</p>
        <p className="text-xs">Stock stays below $402 at expiration = Keep full net credit as profit</p>
      </div>
    </div>
  ),

  BUYING_POWER_USAGE: (
    <div className="space-y-3">
      <p className="font-semibold">Buying Power Usage = (Total Collateral Required / Available Buying Power) × 100</p>
      
      <div className="space-y-2">
        <p className="font-medium">Risk Thresholds:</p>
        <ul className="list-disc list-inside space-y-1 text-xs">
          <li>🟢 &lt;50%: Conservative - Plenty of cushion for adjustments</li>
          <li>🟡 50-80%: Moderate - Normal usage, monitor closely</li>
          <li>🔴 &gt;80%: Aggressive - High risk, limited adjustment capacity</li>
        </ul>
      </div>

      <div className="space-y-2">
        <p className="font-medium">Why It Matters:</p>
        <ul className="list-disc list-inside space-y-1 text-xs">
          <li>Leaving 20-30% buying power free allows you to adjust losing positions</li>
          <li>Over-leveraging (&gt;80%) can force you to take max loss on bad trades</li>
          <li>Market volatility can trigger margin calls if you're maxed out</li>
        </ul>
      </div>

      <div className="space-y-2">
        <p className="font-medium">Best Practice:</p>
        <p className="text-xs">Target 50-70% usage to balance capital efficiency with risk management flexibility.</p>
      </div>
    </div>
  ),

  CONCENTRATION_RISK: (
    <div className="space-y-3">
      <p className="font-semibold">Concentration Risk = Exposure to a single ticker or correlated group</p>
      
      <div className="space-y-2">
        <p className="font-medium">Diversification Guidelines:</p>
        <ul className="list-disc list-inside space-y-1 text-xs">
          <li>🟢 &lt;10% per ticker: Well diversified</li>
          <li>🟡 10-20% per ticker: Moderate concentration</li>
          <li>🔴 &gt;20% per ticker: High concentration risk</li>
        </ul>
      </div>

      <div className="space-y-2">
        <p className="font-medium">Why It Matters:</p>
        <ul className="list-disc list-inside space-y-1 text-xs">
          <li>A single bad earnings report can wipe out a large portion of your portfolio</li>
          <li>Sector correlation (e.g., all tech stocks) amplifies risk during market rotations</li>
          <li>Diversification reduces portfolio volatility and drawdown risk</li>
        </ul>
      </div>

      <div className="space-y-2">
        <p className="font-medium">Example:</p>
        <p className="text-xs">With $10,000 buying power, limit each ticker to $1,000-1,500 collateral (10-15%). Spread across 7-10 different tickers in different sectors.</p>
      </div>
    </div>
  ),

  MARKET_HOURS: (
    <div className="space-y-3">
      <p className="font-semibold">Market Hours: 9:30 AM - 4:00 PM ET (Regular Trading)</p>
      
      <div className="space-y-2">
        <p className="font-medium">Best Times to Trade Options:</p>
        <ul className="list-disc list-inside space-y-1 text-xs">
          <li>🟢 9:30-10:30 AM ET: High volume, best liquidity, tighter spreads</li>
          <li>🟢 3:00-4:00 PM ET: Closing rush, good liquidity</li>
          <li>🟡 10:30 AM-3:00 PM ET: Moderate activity, acceptable spreads</li>
          <li>🔴 Pre-market/After-hours: Wide spreads, low liquidity, avoid</li>
        </ul>
      </div>

      <div className="space-y-2">
        <p className="font-medium">Why It Matters:</p>
        <ul className="list-disc list-inside space-y-1 text-xs">
          <li>Low liquidity = wider bid/ask spreads = worse fill prices</li>
          <li>Opening hour volatility can provide better entry prices</li>
          <li>Avoid submitting orders outside regular hours unless using limit orders</li>
        </ul>
      </div>

      <div className="space-y-2">
        <p className="font-medium">Dry Run Mode:</p>
        <p className="text-xs">Always enabled outside market hours to prevent accidental submissions with poor pricing.</p>
      </div>
    </div>
  ),

  // Dialog-style help content for complex topics
  SCORE_CALCULATION_DIALOG: (
    <div className="space-y-4">
      <div className="p-4 bg-primary/10 rounded-lg">
        <p className="font-semibold text-base mb-2">Composite Score Formula (D1–D6 v2)</p>
        <p className="text-sm">The Score is a weighted combination of six dimensions that identifies the best risk/reward opportunities. Each dimension scores 0–100% of its maximum points:</p>
      </div>

      <div className="space-y-3">
        <div className="border-l-4 border-blue-500 pl-4">
          <p className="font-semibold">D1 — 15% · Liquidity (Bid/Ask Spread + OI + Volume)</p>
          <p className="text-xs text-muted-foreground">Measures how easy it is to get a good fill. Tight bid/ask spread (&lt;5%), high open interest (&gt;500), and solid volume (&gt;200) each contribute. Poor liquidity = wide slippage on entry/exit.</p>
        </div>

        <div className="border-l-4 border-green-500 pl-4">
          <p className="font-semibold">D2 — 20% · Probability Fit (Delta + DTE)</p>
          <p className="text-xs text-muted-foreground">Delta 0.15–0.20 is the sweet spot for CSP (high probability OTM). DTE 7–14 days maximises theta decay. Scores drop sharply outside these ranges.</p>
        </div>

        <div className="border-l-4 border-purple-500 pl-4">
          <p className="font-semibold">D3 — 20% · Premium Efficiency (Weekly Return %)</p>
          <p className="text-xs text-muted-foreground">Premium received relative to capital at risk, normalised to a weekly basis. ≥1.0%/week = full score. Rewards trades that generate meaningful income for the risk taken.</p>
        </div>

        <div className="border-l-4 border-yellow-500 pl-4">
          <p className="font-semibold">D4 — 15% · IV Richness (IV Rank)</p>
          <p className="text-xs text-muted-foreground">IV Rank ≥50 = full score (options are expensive vs history — ideal for selling). IV Rank &lt;20 = near zero (cheap options = poor premium). Higher IV Rank = better edge for option sellers.</p>
        </div>

        <div className="border-l-4 border-orange-500 pl-4">
          <p className="font-semibold">D5 — 15% · Strike Safety (OTM Distance vs Expected Move)</p>
          <p className="text-xs text-muted-foreground">Compares the strike’s distance from current price to the 1-sigma expected move. Strike ≥2× beyond expected move = full score. Strike inside expected move = near-zero score. Shows as Safety × in the table.</p>
        </div>

        <div className="border-l-4 border-red-500 pl-4">
          <p className="font-semibold">D6 — 15% · Technical Context (RSI + BB %B)</p>
          <p className="text-xs text-muted-foreground">RSI &lt;30 (oversold) + BB %B &lt;0.20 (near lower band) = maximum score for puts — mean reversion setup. Neutral RSI/BB scores ~50%. Overbought conditions score low for CSP.</p>
        </div>
      </div>

      <div className="p-4 bg-muted rounded-lg">
        <p className="font-semibold mb-2">Example Calculation</p>
        <div className="space-y-1 text-xs font-mono">
          <p>D1 Liquidity: Spread 4%, OI 800, Vol 300 → 14/15 pts</p>
          <p>D2 Probability: Delta 0.17, DTE 10 → 18/20 pts</p>
          <p>D3 Premium: Weekly 1.2% → 20/20 pts</p>
          <p>D4 IV Richness: IV Rank 55 → 15/15 pts</p>
          <p>D5 Strike Safety: Strike 2.1× beyond EM → 15/15 pts</p>
          <p>D6 Technical: RSI 28, BB 0.15 → 13/15 pts</p>
          <p className="font-bold mt-2 pt-2 border-t border-border">Total Score: 95 / 100</p>
        </div>
      </div>

      <div className="space-y-2">
        <p className="font-semibold">Score Interpretation:</p>
        <ul className="list-disc list-inside space-y-1 text-xs">
          <li>🟢 80-100: Excellent — strong setup across all six dimensions</li>
          <li>🟡 60-79: Good — solid opportunity, minor weaknesses</li>
          <li>🟠 40-59: Fair — acceptable but at least one dimension is weak</li>
          <li>🔴 &lt;40: Poor — avoid unless you have specific conviction</li>
        </ul>
      </div>
    </div>
  ),

  PRESET_FILTERS_DIALOG: (
    <div className="space-y-4">
      <div className="p-4 bg-primary/10 rounded-lg">
        <p className="font-semibold text-base mb-2">Preset Filter Profiles</p>
        <p className="text-sm">Quick-apply filter combinations optimized for different risk tolerances and trading styles.</p>
      </div>

      <div className="space-y-4">
        <div className="border border-green-500/30 rounded-lg p-4 bg-green-500/5">
          <p className="font-bold text-green-400 mb-2">🟢 Conservative</p>
          <p className="text-xs mb-3">Focus on safety and high probability of profit. Lower returns but much lower risk.</p>
          <div className="space-y-1 text-xs">
            <p><span className="font-semibold">Delta:</span> 0.05 - 0.15 (5-15% chance ITM)</p>
            <p><span className="font-semibold">DTE:</span> 30-45 days (more time decay cushion)</p>
            <p><span className="font-semibold">RSI:</span> &lt;25 for puts, &gt;75 for calls (extreme oversold/overbought)</p>
            <p><span className="font-semibold">Weekly %:</span> &gt;0.5% (lower premium but safer)</p>
            <p><span className="font-semibold">Min Score:</span> 70 (only high-quality setups)</p>
          </div>
          <p className="text-xs mt-2 italic text-muted-foreground">Best for: Beginners, small accounts, risk-averse traders</p>
        </div>

        <div className="border border-yellow-500/30 rounded-lg p-4 bg-yellow-500/5">
          <p className="font-bold text-yellow-400 mb-2">🟡 Moderate (Default)</p>
          <p className="text-xs mb-3">Balanced approach between income and safety. Most popular for consistent returns.</p>
          <div className="space-y-1 text-xs">
            <p><span className="font-semibold">Delta:</span> 0.10 - 0.25 (10-25% chance ITM)</p>
            <p><span className="font-semibold">DTE:</span> 21-45 days (standard theta decay window)</p>
            <p><span className="font-semibold">RSI:</span> &lt;35 for puts, &gt;65 for calls (moderately oversold/overbought)</p>
            <p><span className="font-semibold">Weekly %:</span> &gt;1.0% (decent premium)</p>
            <p><span className="font-semibold">Min Score:</span> 60 (good quality setups)</p>
          </div>
          <p className="text-xs mt-2 italic text-muted-foreground">Best for: Experienced traders, medium accounts, balanced portfolios</p>
        </div>

        <div className="border border-red-500/30 rounded-lg p-4 bg-red-500/5">
          <p className="font-bold text-red-400 mb-2">🔴 Aggressive</p>
          <p className="text-xs mb-3">Maximize premium income with higher risk. Requires active monitoring and adjustment skills.</p>
          <div className="space-y-1 text-xs">
            <p><span className="font-semibold">Delta:</span> 0.20 - 0.40 (20-40% chance ITM)</p>
            <p><span className="font-semibold">DTE:</span> 7-30 days (faster theta decay)</p>
            <p><span className="font-semibold">RSI:</span> &lt;45 for puts, &gt;55 for calls (any pullback)</p>
            <p><span className="font-semibold">Weekly %:</span> &gt;2.0% (high premium)</p>
            <p><span className="font-semibold">Min Score:</span> 50 (accept more opportunities)</p>
          </div>
          <p className="text-xs mt-2 italic text-muted-foreground">Best for: Advanced traders, large accounts, high-conviction plays</p>
        </div>
      </div>

      <div className="p-4 bg-muted rounded-lg">
        <p className="font-semibold mb-2">Customization Tip</p>
        <p className="text-xs">Start with a preset, then fine-tune individual filters based on market conditions and your specific goals. Save your custom settings for future use.</p>
      </div>
    </div>
  ),

  OPEN_INTEREST_VOLUME_DIALOG: (
    <div className="space-y-4">
      <div className="p-4 bg-primary/10 rounded-lg">
        <p className="font-semibold text-base mb-2">Open Interest & Volume</p>
        <p className="text-sm">Liquidity indicators that determine how easy it is to enter and exit positions at fair prices.</p>
      </div>

      <div className="space-y-3">
        <div className="border-l-4 border-blue-500 pl-4">
          <p className="font-semibold">Open Interest (OI)</p>
          <p className="text-xs text-muted-foreground mb-2">Total number of outstanding option contracts that have not been closed or exercised.</p>
          <ul className="list-disc list-inside space-y-1 text-xs">
            <li>Higher OI = more traders holding positions = more liquidity</li>
            <li>OI increases when new positions are opened</li>
            <li>OI decreases when positions are closed or exercised</li>
          </ul>
        </div>

        <div className="border-l-4 border-green-500 pl-4">
          <p className="font-semibold">Volume (Vol)</p>
          <p className="text-xs text-muted-foreground mb-2">Number of contracts traded today. Resets to zero at market open each day.</p>
          <ul className="list-disc list-inside space-y-1 text-xs">
            <li>Higher volume = more active trading = tighter spreads</li>
            <li>Volume shows current market interest</li>
            <li>Volume &gt; OI means many traders are opening new positions</li>
          </ul>
        </div>
      </div>

      <div className="space-y-2">
        <p className="font-semibold">Liquidity Thresholds:</p>
        <div className="space-y-2">
          <div className="p-3 bg-green-500/10 border border-green-500/30 rounded">
            <p className="font-semibold text-green-400 text-xs">🟢 Excellent Liquidity</p>
            <ul className="list-disc list-inside space-y-1 text-xs mt-1">
              <li>OI &gt; 1,000 contracts</li>
              <li>Volume &gt; 500 contracts</li>
              <li>Bid/Ask spread &lt; $0.10</li>
              <li>Result: Easy fills at mid-price or better</li>
            </ul>
          </div>

          <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded">
            <p className="font-semibold text-yellow-400 text-xs">🟡 Acceptable Liquidity</p>
            <ul className="list-disc list-inside space-y-1 text-xs mt-1">
              <li>OI: 100-1,000 contracts</li>
              <li>Volume: 50-500 contracts</li>
              <li>Bid/Ask spread: $0.10-$0.25</li>
              <li>Result: Use limit orders, may need to wait for fills</li>
            </ul>
          </div>

          <div className="p-3 bg-red-500/10 border border-red-500/30 rounded">
            <p className="font-semibold text-red-400 text-xs">🔴 Poor Liquidity</p>
            <ul className="list-disc list-inside space-y-1 text-xs mt-1">
              <li>OI &lt; 100 contracts</li>
              <li>Volume &lt; 50 contracts</li>
              <li>Bid/Ask spread &gt; $0.25</li>
              <li>Result: Avoid - wide spreads eat into profits</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="p-4 bg-muted rounded-lg">
        <p className="font-semibold mb-2">Pro Tip: Bid/Ask Spread</p>
        <p className="text-xs mb-2">The difference between bid and ask prices is the "hidden cost" of trading illiquid options.</p>
        <p className="text-xs font-mono">Example: Bid $1.80, Ask $2.20 → Spread: $0.40 (20% of mid-price!)</p>
        <p className="text-xs mt-2">Always check the spread before trading. High OI/Volume = tighter spreads = more profit in your pocket.</p>
      </div>
    </div>
  ),

  DRY_RUN_MODE_DIALOG: (
    <div className="space-y-4">
      <div className="p-4 bg-primary/10 rounded-lg">
        <p className="font-semibold text-base mb-2">Dry Run Mode</p>
        <p className="text-sm">Test your order submission workflow without sending real orders to your broker.</p>
      </div>

      <div className="space-y-3">
        <div className="border-l-4 border-green-500 pl-4">
          <p className="font-semibold text-green-400">What Happens in Dry Run Mode?</p>
          <ul className="list-disc list-inside space-y-1 text-xs mt-2">
            <li>Orders are validated and previewed exactly as if they were real</li>
            <li>Buying power calculations are performed</li>
            <li>Concentration risk warnings are shown</li>
            <li>Market hours are checked</li>
            <li><span className="font-bold">BUT: No orders are sent to your broker</span></li>
          </ul>
        </div>

        <div className="border-l-4 border-blue-500 pl-4">
          <p className="font-semibold text-blue-400">When to Use Dry Run Mode</p>
          <ul className="list-disc list-inside space-y-1 text-xs mt-2">
            <li><span className="font-semibold">Learning:</span> Practice the order flow without risk</li>
            <li><span className="font-semibold">Testing:</span> Verify filter settings and opportunity selection</li>
            <li><span className="font-semibold">After Hours:</span> Review opportunities when market is closed</li>
            <li><span className="font-semibold">Sanity Check:</span> Double-check orders before going live</li>
          </ul>
        </div>

        <div className="border-l-4 border-orange-500 pl-4">
          <p className="font-semibold text-orange-400">Automatic Dry Run Triggers</p>
          <ul className="list-disc list-inside space-y-1 text-xs mt-2">
            <li><span className="font-semibold">Outside Market Hours:</span> Automatically enabled 4:00 PM - 9:30 AM ET</li>
            <li><span className="font-semibold">Weekends:</span> Always enabled Saturday-Sunday</li>
            <li><span className="font-semibold">Market Holidays:</span> Enabled on exchange holidays</li>
          </ul>
          <p className="text-xs mt-2 italic">This prevents accidental submissions with stale pricing or wide spreads.</p>
        </div>
      </div>

      <div className="p-4 bg-muted rounded-lg">
        <p className="font-semibold mb-2">Transitioning to Live Trading</p>
        <div className="space-y-2 text-xs">
          <p><span className="font-bold">Step 1:</span> Practice with Dry Run until you're comfortable with the workflow</p>
          <p><span className="font-bold">Step 2:</span> Start with 1-2 contracts in live mode to verify execution</p>
          <p><span className="font-bold">Step 3:</span> Gradually increase position sizes as you gain confidence</p>
          <p className="mt-2 p-2 bg-yellow-500/20 border border-yellow-500/50 rounded"><span className="font-bold">⚠️ Important:</span> Always review the dry run preview carefully before toggling to live mode. Check buying power, concentration risk, and individual order details.</p>
        </div>
      </div>
    </div>
  ),

  PORTFOLIO_SIZE_DIALOG: (
    <div className="space-y-4">
      <div className="p-4 bg-primary/10 rounded-lg">
        <p className="font-semibold text-base mb-2">Portfolio Size Filter</p>
        <p className="text-sm">Filter opportunities by company market capitalization to match your risk tolerance and liquidity needs.</p>
      </div>

      <div className="space-y-3">
        <div className="border-l-4 border-green-500 pl-4">
          <p className="font-semibold text-green-400">🏢 Large Cap (&gt;$50B)</p>
          <ul className="list-disc list-inside space-y-1 text-xs mt-2">
            <li><span className="font-bold">Examples:</span> AAPL, MSFT, GOOGL, AMZN, TSLA</li>
            <li><span className="font-bold">Liquidity:</span> Excellent - tight bid/ask spreads, high volume</li>
            <li><span className="font-bold">Volatility:</span> Lower - more stable price movements</li>
            <li><span className="font-bold">Best For:</span> Conservative traders, larger positions</li>
          </ul>
        </div>

        <div className="border-l-4 border-blue-500 pl-4">
          <p className="font-semibold text-blue-400">🏭 Mid Cap ($10B - $50B)</p>
          <ul className="list-disc list-inside space-y-1 text-xs mt-2">
            <li><span className="font-bold">Examples:</span> SNAP, PINS, RBLX, COIN, DKNG</li>
            <li><span className="font-bold">Liquidity:</span> Good - acceptable spreads on popular strikes</li>
            <li><span className="font-bold">Volatility:</span> Moderate - balanced risk/reward</li>
            <li><span className="font-bold">Best For:</span> Moderate traders seeking higher premiums</li>
          </ul>
        </div>

        <div className="border-l-4 border-orange-500 pl-4">
          <p className="font-semibold text-orange-400">🏪 Small Cap (&lt;$10B)</p>
          <ul className="list-disc list-inside space-y-1 text-xs mt-2">
            <li><span className="font-bold">Examples:</span> Smaller tech, biotech, regional companies</li>
            <li><span className="font-bold">Liquidity:</span> Variable - check OI/Volume carefully</li>
            <li><span className="font-bold">Volatility:</span> Higher - larger price swings</li>
            <li><span className="font-bold">Best For:</span> Aggressive traders, smaller positions</li>
          </ul>
        </div>
      </div>

      <div className="p-4 bg-muted rounded-lg">
        <p className="font-semibold mb-2">How Market Cap Affects Options Trading</p>
        <div className="space-y-2 text-xs">
          <p><span className="font-bold">Liquidity Impact:</span> Larger companies = more option traders = tighter spreads = easier to enter/exit positions</p>
          <p><span className="font-bold">Premium Quality:</span> Small caps often have higher IV Rank (more premium), but with higher risk</p>
          <p><span className="font-bold">Diversification:</span> Mix large/mid/small caps to balance stability and premium income</p>
          <p className="mt-2 p-2 bg-blue-500/20 border border-blue-500/50 rounded"><span className="font-bold">💡 Pro Tip:</span> Start with large caps to learn, then gradually add mid/small caps as you gain experience. Always verify Open Interest &gt; 100 and Volume &gt; 50 regardless of market cap.</p>
        </div>
      </div>
    </div>
  ),

  PRESET_FILTER_DIALOG: (
    <div className="space-y-4">
      <div className="p-4 bg-primary/10 rounded-lg">
        <p className="font-semibold text-base mb-2">Preset Filter Profiles</p>
        <p className="text-sm">Pre-configured filter combinations designed for different risk tolerance levels.</p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b-2 border-primary">
              <th className="text-left p-2 font-semibold">Metric</th>
              <th className="text-center p-2 font-semibold text-green-400">🟢 Conservative</th>
              <th className="text-center p-2 font-semibold text-yellow-400">🟡 Moderate</th>
              <th className="text-center p-2 font-semibold text-red-400">🔴 Aggressive</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            <tr>
              <td className="p-2 font-medium">Delta</td>
              <td className="text-center p-2">0.15 - 0.25</td>
              <td className="text-center p-2">0.25 - 0.35</td>
              <td className="text-center p-2">0.35 - 0.45</td>
            </tr>
            <tr>
              <td className="p-2 font-medium">DTE</td>
              <td className="text-center p-2">30 - 45</td>
              <td className="text-center p-2">21 - 35</td>
              <td className="text-center p-2">14 - 28</td>
            </tr>
            <tr>
              <td className="p-2 font-medium">Min Score</td>
              <td className="text-center p-2">80</td>
              <td className="text-center p-2">70</td>
              <td className="text-center p-2">60</td>
            </tr>
            <tr>
              <td className="p-2 font-medium">Open Interest</td>
              <td className="text-center p-2">&gt; 500</td>
              <td className="text-center p-2">&gt; 200</td>
              <td className="text-center p-2">&gt; 100</td>
            </tr>
            <tr>
              <td className="p-2 font-medium">Volume</td>
              <td className="text-center p-2">&gt; 100</td>
              <td className="text-center p-2">&gt; 50</td>
              <td className="text-center p-2">&gt; 25</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="space-y-3 mt-4">
        <div className="border-l-4 border-green-500 pl-4">
          <p className="font-semibold text-green-400">🟢 Conservative Profile</p>
          <ul className="list-disc list-inside space-y-1 text-xs mt-2">
            <li><span className="font-bold">Goal:</span> Maximize safety, minimize assignment risk</li>
            <li><span className="font-bold">Best For:</span> New traders, large accounts, retirement funds</li>
            <li><span className="font-bold">Expected Win Rate:</span> 85-95%</li>
            <li><span className="font-bold">Trade-off:</span> Lower premiums, longer holding periods</li>
          </ul>
        </div>

        <div className="border-l-4 border-yellow-500 pl-4">
          <p className="font-semibold text-yellow-400">🟡 Moderate Profile</p>
          <ul className="list-disc list-inside space-y-1 text-xs mt-2">
            <li><span className="font-bold">Goal:</span> Balance safety and premium income</li>
            <li><span className="font-bold">Best For:</span> Experienced traders, most account sizes</li>
            <li><span className="font-bold">Expected Win Rate:</span> 75-85%</li>
            <li><span className="font-bold">Trade-off:</span> Moderate premiums, acceptable risk</li>
          </ul>
        </div>

        <div className="border-l-4 border-red-500 pl-4">
          <p className="font-semibold text-red-400">🔴 Aggressive Profile</p>
          <ul className="list-disc list-inside space-y-1 text-xs mt-2">
            <li><span className="font-bold">Goal:</span> Maximize premium income, accept higher risk</li>
            <li><span className="font-bold">Best For:</span> Expert traders, smaller positions, active management</li>
            <li><span className="font-bold">Expected Win Rate:</span> 65-75%</li>
            <li><span className="font-bold">Trade-off:</span> Higher premiums, more assignments</li>
          </ul>
        </div>
      </div>

      <div className="p-4 bg-muted rounded-lg">
        <p className="font-semibold mb-2">Choosing Your Profile</p>
        <div className="space-y-2 text-xs">
          <p><span className="font-bold">Start Conservative:</span> Build confidence and understand the workflow before increasing risk</p>
          <p><span className="font-bold">Mix Profiles:</span> Use conservative for 70% of capital, aggressive for 30% to balance risk/reward</p>
          <p><span className="font-bold">Adjust by Market:</span> Switch to conservative during high volatility or uncertain markets</p>
          <p className="mt-2 p-2 bg-yellow-500/20 border border-yellow-500/50 rounded"><span className="font-bold">⚠️ Remember:</span> Presets are starting points. You can further refine with live range filters (Delta, DTE, Score sliders) to fine-tune your selections.</p>
        </div>
      </div>
    </div>
  ),

  WEEKLY_RETURN: (
    <div className="space-y-3">
      <p className="font-semibold">Weekly Return % = Annualized return based on premium and time.</p>
      
      <div className="space-y-2">
        <p className="font-medium">Formula:</p>
        <p className="text-xs font-mono bg-muted p-2 rounded">
          (Premium / Collateral) × (52 weeks / DTE × 7) × 100
        </p>
      </div>

      <div className="space-y-2">
        <p className="font-medium">Example:</p>
        <ul className="list-disc list-inside space-y-1 text-xs">
          <li>Premium: $200, Collateral: $10,000, DTE: 30</li>
          <li>($200 / $10,000) × (52 / 4.29) × 100 = 24.3% annual</li>
          <li>Weekly: 24.3% / 52 = 0.47% per week</li>
        </ul>
      </div>

      <div className="space-y-2">
        <p className="font-medium">Why It Matters:</p>
        <ul className="list-disc list-inside space-y-1 text-xs">
          <li>Normalizes returns across different DTEs for comparison</li>
          <li>Higher Weekly % = Better capital efficiency</li>
          <li>Target: 0.5-1.0% weekly (26-52% annualized)</li>
        </ul>
      </div>

      <div className="space-y-2">
        <p className="font-medium">Trade-offs:</p>
        <ul className="list-disc list-inside space-y-1 text-xs">
          <li>🟢 Higher Weekly %: More income, but often higher risk (closer delta, shorter DTE)</li>
          <li>🟡 Moderate Weekly %: Balanced risk/reward</li>
          <li>🔴 Lower Weekly %: Safer strikes, but lower returns</li>
        </ul>
      </div>
    </div>
  ),

  EXP_MOVE: (
    <div className="space-y-3">
      <p className="font-semibold">Expected Move is the 1-standard-deviation price range the market expects for the stock over the option's lifetime.</p>
      
      <div className="space-y-2">
        <p className="font-medium">Formula:</p>
        <p className="text-xs font-mono bg-muted px-2 py-1 rounded">Price × (IV / 100) × √(DTE / 365)</p>
      </div>

      <div className="space-y-2">
        <p className="font-medium">What It Means:</p>
        <ul className="list-disc list-inside space-y-1 text-xs">
          <li>Statistically, ~68% of the time the stock stays within ±1 Expected Move</li>
          <li>Higher IV = Larger expected move = More uncertainty</li>
          <li>Shorter DTE = Smaller expected move = Less time for big moves</li>
        </ul>
      </div>

      <div className="space-y-2">
        <p className="font-medium">How to Use It:</p>
        <ul className="list-disc list-inside space-y-1 text-xs">
          <li>Compare your strike to the expected move to gauge safety</li>
          <li>Strike beyond 1× EM = strike outside the expected range (safer)</li>
          <li>Strike inside 1× EM = strike inside the expected range (riskier)</li>
        </ul>
      </div>
    </div>
  ),

  SAFETY_RATIO: (
    <div className="space-y-3">
      <p className="font-semibold">Safety Ratio measures how far your strike is beyond the 1-sigma Expected Move — a higher ratio means a safer, more OTM strike.</p>
      
      <div className="space-y-2">
        <p className="font-medium">Formula:</p>
        <p className="text-xs font-mono bg-muted px-2 py-1 rounded">Strike Distance from Current Price ÷ Expected Move</p>
      </div>

      <div className="space-y-2">
        <p className="font-medium">Color Guide:</p>
        <ul className="list-disc list-inside space-y-1 text-xs">
          <li>🟢 ≥ 1.5× — Strike is well beyond the expected move (very safe)</li>
          <li>🟡 1.0–1.5× — Strike is at or just beyond the expected move (moderate)</li>
          <li>🔴 &lt; 1.0× — Strike is inside the expected move (elevated risk)</li>
        </ul>
      </div>

      <div className="space-y-2">
        <p className="font-medium">Example:</p>
        <ul className="list-disc list-inside space-y-1 text-xs">
          <li>Stock at $100, Expected Move = $8, Strike at $88</li>
          <li>Distance = $12, Safety Ratio = 12 ÷ 8 = 1.5×</li>
          <li>Strike is 1.5 standard deviations below current price</li>
        </ul>
      </div>
    </div>
  ),
};

