/**
 * Strategy-Specific Validation Rules
 * 
 * Implements validation logic specific to each options trading strategy:
 * - Covered Calls (CC)
 * - Cash-Secured Puts (CSP)
 * - Bear Call Spreads (BCS)
 * - Bull Put Spreads (BPS)
 * - Poor Man's Covered Calls (PMCC)
 */

import type {
  OrderToValidate,
  ValidationCheck,
  OptionMarketData,
} from '../shared/validation-types';

/**
 * Validate Covered Call strategy-specific rules
 */
export function validateCoveredCall(
  order: OrderToValidate,
  marketData: OptionMarketData | null
): ValidationCheck[] {
  const checks: ValidationCheck[] = [];
  
  if (!marketData) {
    return checks;
  }
  
  // Check 1: Strike should be above current price (OTM call)
  if (order.strike > marketData.underlyingPrice) {
    const percentOTM = ((order.strike - marketData.underlyingPrice) / marketData.underlyingPrice * 100).toFixed(1);
    checks.push({
      id: 'cc_strike_above_price',
      name: 'Strike above current price',
      status: 'valid',
      severity: 'success',
      message: `Strike $${order.strike} is ${percentOTM}% above current price $${marketData.underlyingPrice.toFixed(2)} (OTM call).`,
      details: { percentOTM: parseFloat(percentOTM) },
    });
  } else if (order.strike === marketData.underlyingPrice) {
    checks.push({
      id: 'cc_strike_above_price',
      name: 'Strike above current price',
      status: 'warning',
      severity: 'warning',
      message: `Strike $${order.strike} is ATM (at current price). Higher assignment risk.`,
    });
  } else {
    const percentITM = ((marketData.underlyingPrice - order.strike) / marketData.underlyingPrice * 100).toFixed(1);
    checks.push({
      id: 'cc_strike_above_price',
      name: 'Strike above current price',
      status: 'warning',
      severity: 'warning',
      message: `Strike $${order.strike} is ${percentITM}% below current price (ITM call). Very high assignment risk.`,
      details: { percentITM: parseFloat(percentITM) },
    });
  }
  
  // Check 2: Reasonable strike relative to stock value
  const strikeRatio = order.strike / marketData.underlyingPrice;
  if (strikeRatio < 0.8 || strikeRatio > 1.5) {
    checks.push({
      id: 'cc_reasonable_strike',
      name: 'Reasonable strike selection',
      status: 'warning',
      severity: 'warning',
      message: `Strike $${order.strike} is ${strikeRatio < 1 ? 'very far below' : 'very far above'} current price. Verify this is intentional.`,
      details: { strikeRatio },
    });
  }
  
  return checks;
}

/**
 * Validate Cash-Secured Put strategy-specific rules
 */
export function validateCashSecuredPut(
  order: OrderToValidate,
  marketData: OptionMarketData | null,
  availableBuyingPower: number
): ValidationCheck[] {
  const checks: ValidationCheck[] = [];
  
  if (!marketData) {
    return checks;
  }
  
  // Check 1: Strike should be below current price (OTM put)
  if (order.strike < marketData.underlyingPrice) {
    const percentOTM = ((marketData.underlyingPrice - order.strike) / marketData.underlyingPrice * 100).toFixed(1);
    checks.push({
      id: 'csp_strike_below_price',
      name: 'Strike below current price',
      status: 'valid',
      severity: 'success',
      message: `Strike $${order.strike} is ${percentOTM}% below current price $${marketData.underlyingPrice.toFixed(2)} (OTM put).`,
      details: { percentOTM: parseFloat(percentOTM) },
    });
  } else if (order.strike === marketData.underlyingPrice) {
    checks.push({
      id: 'csp_strike_below_price',
      name: 'Strike below current price',
      status: 'warning',
      severity: 'warning',
      message: `Strike $${order.strike} is ATM (at current price). Higher assignment risk.`,
    });
  } else {
    const percentITM = ((order.strike - marketData.underlyingPrice) / marketData.underlyingPrice * 100).toFixed(1);
    checks.push({
      id: 'csp_strike_below_price',
      name: 'Strike below current price',
      status: 'warning',
      severity: 'warning',
      message: `Strike $${order.strike} is ${percentITM}% above current price (ITM put). Very high assignment risk.`,
      details: { percentITM: parseFloat(percentITM) },
    });
  }
  
  // Check 2: Sufficient buying power for collateral
  const collateralRequired = order.strike * 100 * order.quantity;
  if (availableBuyingPower >= collateralRequired) {
    checks.push({
      id: 'csp_sufficient_buying_power',
      name: 'Sufficient buying power',
      status: 'valid',
      severity: 'success',
      message: `Buying power $${availableBuyingPower.toFixed(2)} covers collateral $${collateralRequired.toFixed(2)}.`,
      details: { collateralRequired, availableBuyingPower },
    });
  } else {
    checks.push({
      id: 'csp_sufficient_buying_power',
      name: 'Sufficient buying power',
      status: 'error',
      severity: 'error',
      message: `Insufficient buying power! Need $${collateralRequired.toFixed(2)}, have $${availableBuyingPower.toFixed(2)}.`,
      details: { collateralRequired, availableBuyingPower },
    });
  }
  
  return checks;
}

/**
 * Validate Bear Call Spread strategy-specific rules
 */
export function validateBearCallSpread(
  order: OrderToValidate,
  shortMarketData: OptionMarketData | null,
  longMarketData: OptionMarketData | null,
  availableBuyingPower: number
): ValidationCheck[] {
  const checks: ValidationCheck[] = [];
  
  if (!shortMarketData || !longMarketData) {
    return checks;
  }
  
  // Check 1: Short strike should be above current price
  if (order.strike > shortMarketData.underlyingPrice) {
    const percentOTM = ((order.strike - shortMarketData.underlyingPrice) / shortMarketData.underlyingPrice * 100).toFixed(1);
    checks.push({
      id: 'bcs_short_strike_above_price',
      name: 'Short strike above current price',
      status: 'valid',
      severity: 'success',
      message: `Short strike $${order.strike} is ${percentOTM}% above current price $${shortMarketData.underlyingPrice.toFixed(2)}.`,
      details: { percentOTM: parseFloat(percentOTM) },
    });
  } else {
    checks.push({
      id: 'bcs_short_strike_above_price',
      name: 'Short strike above current price',
      status: 'warning',
      severity: 'warning',
      message: `Short strike $${order.strike} is at or below current price. Higher risk of assignment.`,
    });
  }
  
  // Check 2: Long strike should be above short strike
  if (order.longStrike && order.longStrike > order.strike) {
    const spreadWidth = order.longStrike - order.strike;
    checks.push({
      id: 'bcs_valid_spread_width',
      name: 'Valid spread structure',
      status: 'valid',
      severity: 'success',
      message: `Spread width $${spreadWidth.toFixed(2)} (long $${order.longStrike} > short $${order.strike}).`,
      details: { spreadWidth },
    });
  } else {
    checks.push({
      id: 'bcs_valid_spread_width',
      name: 'Valid spread structure',
      status: 'error',
      severity: 'error',
      message: `Invalid spread! Long strike must be above short strike.`,
    });
  }
  
  // Check 3: Max loss calculation and buying power
  if (order.longStrike) {
    const spreadWidth = order.longStrike - order.strike;
    const netCredit = order.limitPrice;
    const maxLoss = (spreadWidth - netCredit) * 100 * order.quantity;
    
    if (availableBuyingPower >= maxLoss) {
      checks.push({
        id: 'bcs_sufficient_buying_power',
        name: 'Sufficient buying power for max loss',
        status: 'valid',
        severity: 'success',
        message: `Buying power $${availableBuyingPower.toFixed(2)} covers max loss $${maxLoss.toFixed(2)}.`,
        details: { maxLoss, availableBuyingPower },
      });
    } else {
      checks.push({
        id: 'bcs_sufficient_buying_power',
        name: 'Sufficient buying power for max loss',
        status: 'error',
        severity: 'error',
        message: `Insufficient buying power! Max loss $${maxLoss.toFixed(2)}, have $${availableBuyingPower.toFixed(2)}.`,
        details: { maxLoss, availableBuyingPower },
      });
    }
  }
  
  return checks;
}

/**
 * Validate Bull Put Spread strategy-specific rules
 */
export function validateBullPutSpread(
  order: OrderToValidate,
  shortMarketData: OptionMarketData | null,
  longMarketData: OptionMarketData | null,
  availableBuyingPower: number
): ValidationCheck[] {
  const checks: ValidationCheck[] = [];
  
  if (!shortMarketData || !longMarketData) {
    return checks;
  }
  
  // Check 1: Short strike should be below current price
  if (order.strike < shortMarketData.underlyingPrice) {
    const percentOTM = ((shortMarketData.underlyingPrice - order.strike) / shortMarketData.underlyingPrice * 100).toFixed(1);
    checks.push({
      id: 'bps_short_strike_below_price',
      name: 'Short strike below current price',
      status: 'valid',
      severity: 'success',
      message: `Short strike $${order.strike} is ${percentOTM}% below current price $${shortMarketData.underlyingPrice.toFixed(2)}.`,
      details: { percentOTM: parseFloat(percentOTM) },
    });
  } else {
    checks.push({
      id: 'bps_short_strike_below_price',
      name: 'Short strike below current price',
      status: 'warning',
      severity: 'warning',
      message: `Short strike $${order.strike} is at or above current price. Higher risk of assignment.`,
    });
  }
  
  // Check 2: Long strike should be below short strike
  if (order.longStrike && order.longStrike < order.strike) {
    const spreadWidth = order.strike - order.longStrike;
    checks.push({
      id: 'bps_valid_spread_width',
      name: 'Valid spread structure',
      status: 'valid',
      severity: 'success',
      message: `Spread width $${spreadWidth.toFixed(2)} (short $${order.strike} > long $${order.longStrike}).`,
      details: { spreadWidth },
    });
  } else {
    checks.push({
      id: 'bps_valid_spread_width',
      name: 'Valid spread structure',
      status: 'error',
      severity: 'error',
      message: `Invalid spread! Long strike must be below short strike.`,
    });
  }
  
  // Check 3: Max loss calculation and buying power
  if (order.longStrike) {
    const spreadWidth = order.strike - order.longStrike;
    const netCredit = order.limitPrice;
    const maxLoss = (spreadWidth - netCredit) * 100 * order.quantity;
    
    if (availableBuyingPower >= maxLoss) {
      checks.push({
        id: 'bps_sufficient_buying_power',
        name: 'Sufficient buying power for max loss',
        status: 'valid',
        severity: 'success',
        message: `Buying power $${availableBuyingPower.toFixed(2)} covers max loss $${maxLoss.toFixed(2)}.`,
        details: { maxLoss, availableBuyingPower },
      });
    } else {
      checks.push({
        id: 'bps_sufficient_buying_power',
        name: 'Sufficient buying power for max loss',
        status: 'error',
        severity: 'error',
        message: `Insufficient buying power! Max loss $${maxLoss.toFixed(2)}, have $${availableBuyingPower.toFixed(2)}.`,
        details: { maxLoss, availableBuyingPower },
      });
    }
  }
  
  return checks;
}

/**
 * Validate Poor Man's Covered Call strategy-specific rules
 */
export function validatePMCC(
  order: OrderToValidate,
  shortCallMarketData: OptionMarketData | null,
  leapStrike: number,
  leapExpiration: string
): ValidationCheck[] {
  const checks: ValidationCheck[] = [];
  
  if (!shortCallMarketData) {
    return checks;
  }
  
  // Check 1: Short call strike should be above LEAP strike
  if (order.strike > leapStrike) {
    const strikeSpread = order.strike - leapStrike;
    checks.push({
      id: 'pmcc_short_above_leap',
      name: 'Short call above LEAP strike',
      status: 'valid',
      severity: 'success',
      message: `Short call strike $${order.strike} is $${strikeSpread.toFixed(2)} above LEAP strike $${leapStrike}.`,
      details: { strikeSpread },
    });
  } else {
    checks.push({
      id: 'pmcc_short_above_leap',
      name: 'Short call above LEAP strike',
      status: 'error',
      severity: 'error',
      message: `Invalid PMCC! Short call strike $${order.strike} must be above LEAP strike $${leapStrike}.`,
    });
  }
  
  // Check 2: LEAP should have sufficient time remaining (>= 6 months)
  const leapExpirationDate = new Date(leapExpiration);
  const now = new Date();
  const daysRemaining = Math.floor((leapExpirationDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  
  if (daysRemaining >= 180) {
    checks.push({
      id: 'pmcc_leap_time_remaining',
      name: 'LEAP has sufficient time',
      status: 'valid',
      severity: 'success',
      message: `LEAP has ${daysRemaining} days remaining (>= 180 days recommended).`,
      details: { daysRemaining },
    });
  } else if (daysRemaining >= 90) {
    checks.push({
      id: 'pmcc_leap_time_remaining',
      name: 'LEAP has sufficient time',
      status: 'warning',
      severity: 'warning',
      message: `LEAP has only ${daysRemaining} days remaining. Consider rolling to longer-dated LEAP.`,
      details: { daysRemaining },
    });
  } else {
    checks.push({
      id: 'pmcc_leap_time_remaining',
      name: 'LEAP has sufficient time',
      status: 'error',
      severity: 'error',
      message: `LEAP has only ${daysRemaining} days remaining. Too short for PMCC strategy.`,
      details: { daysRemaining },
    });
  }
  
  return checks;
}
