/**
 * Charts router — previously provided server-side Bollinger Band and RSI
 * calculations for the Lightweight Charts panel.
 *
 * As of Mar 15, 2026 the chart panel was replaced with the TradingView
 * Advanced Chart widget, which handles all indicator calculations and
 * historical data natively in the browser with no server round-trips.
 *
 * This file is kept as an empty router stub to avoid breaking the router
 * registration in routers.ts.
 */
import { router } from './_core/trpc';

export const chartsRouter = router({});
