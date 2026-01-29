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
};
