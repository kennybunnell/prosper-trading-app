/**
 * Enhanced order status checking with order history lookup
 * 
 * Tastytrade API endpoints:
 * - GET /accounts/{account_number}/orders/live - Returns working orders
 * - GET /accounts/{account_number}/orders/{order_id} - Returns specific order details with status
 * 
 * Order statuses: Received, Live, Filled, Cancelled, Rejected, Contingent, Routed
 */

import { getTastytradeAPI } from './tastytrade';

export interface OrderStatus {
  status: 'Working' | 'Filled' | 'Cancelled' | 'Rejected' | 'MarketClosed' | 'Unknown';
  filledAt?: string;
  cancelledAt?: string;
  rejectedReason?: string;
  marketClosedMessage?: string;
}

/**
 * Check if market is currently open for options trading
 * Options market hours: 9:30 AM - 4:00 PM ET (Monday-Friday)
 */
function isMarketOpen(): boolean {
  const now = new Date();
  const etTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  
  // Check if weekend
  const dayOfWeek = etTime.getDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return false;
  }
  
  // Check if within market hours (9:30 AM - 4:00 PM ET)
  const hours = etTime.getHours();
  const minutes = etTime.getMinutes();
  const timeInMinutes = hours * 60 + minutes;
  
  const marketOpen = 9 * 60 + 30; // 9:30 AM
  const marketClose = 16 * 60; // 4:00 PM
  
  return timeInMinutes >= marketOpen && timeInMinutes < marketClose;
}

/**
 * Check order status by fetching individual order details
 * This provides accurate status for completed orders (filled/cancelled/rejected)
 */
export async function checkOrderStatus(
  accountId: string,
  orderId: string
): Promise<OrderStatus> {
  const api = getTastytradeAPI();
  
  // Check if market is closed first
  if (!isMarketOpen()) {
    return {
      status: 'MarketClosed',
      marketClosedMessage: 'Market is currently closed. Orders will be processed when market opens.',
    };
  }
  
  try {
    // Fetch specific order details using the order ID endpoint
    const orderData = await api.getOrderById(accountId, orderId);
    
    if (!orderData) {
      return { status: 'Unknown' };
    }
    
    // Map Tastytrade status to our simplified status
    const tastytradeStatus = orderData.status;
    
    switch (tastytradeStatus) {
      case 'Filled':
        return {
          status: 'Filled',
          filledAt: orderData['updated-at'] || orderData['received-at'],
        };
      
      case 'Cancelled':
      case 'Canceled': // Handle both spellings
        return {
          status: 'Cancelled',
          cancelledAt: orderData['cancelled-at'] || orderData['updated-at'],
        };
      
      case 'Rejected':
        return {
          status: 'Rejected',
          rejectedReason: orderData['reject-reason'] || 'Unknown reason',
        };
      
      case 'Received':
      case 'Live':
      case 'Routed':
      case 'Contingent':
        return { status: 'Working' };
      
      default:
        console.warn(`[OrderStatus] Unknown Tastytrade status: ${tastytradeStatus}`);
        return { status: 'Unknown' };
    }
  } catch (error: any) {
    // If order not found (404), it might have been purged from the system
    // This typically means it was filled or cancelled a while ago
    if (error.response?.status === 404) {
      console.log(`[OrderStatus] Order ${orderId} not found (404) - likely filled/cancelled and purged`);
      return { status: 'Unknown' };
    }
    
    console.error(`[OrderStatus] Error fetching order ${orderId}:`, error.message);
    throw new Error(`Failed to check order status: ${error.message}`);
  }
}

/**
 * Check status for multiple orders in batch
 * Returns a map of order ID to status
 */
export async function checkOrderStatusBatch(
  accountId: string,
  orderIds: string[]
): Promise<Record<string, OrderStatus>> {
  const statusMap: Record<string, OrderStatus> = {};
  
  // Process orders sequentially to avoid rate limiting
  for (const orderId of orderIds) {
    try {
      const status = await checkOrderStatus(accountId, orderId);
      statusMap[orderId] = status;
    } catch (error: any) {
      console.error(`[OrderStatus] Failed to check status for order ${orderId}:`, error.message);
      statusMap[orderId] = { status: 'Unknown' };
    }
  }
  
  return statusMap;
}

/**
 * Poll order status until it's no longer "Working"
 * Useful for real-time order tracking after submission
 */
export async function pollOrderStatus(
  accountId: string,
  orderId: string,
  options: {
    maxAttempts?: number;
    intervalMs?: number;
    onUpdate?: (status: OrderStatus, attempt: number) => void;
  } = {}
): Promise<OrderStatus & { orderId: string; message?: string }> {
  const {
    maxAttempts = 60, // 60 attempts = 5 minutes at 5-second intervals
    intervalMs = 5000, // 5 seconds
    onUpdate,
  } = options;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const status = await checkOrderStatus(accountId, orderId);
    
    if (onUpdate) {
      onUpdate(status, attempt);
    }
    
    // Stop polling if order is no longer working or market is closed
    if (status.status !== 'Working') {
      // Build user-friendly message based on status
      let message = '';
      if (status.status === 'Filled') {
        message = `Order filled at ${status.filledAt || 'unknown time'}`;
      } else if (status.status === 'Rejected') {
        message = `Order rejected: ${status.rejectedReason || 'Unknown reason'}`;
      } else if (status.status === 'MarketClosed') {
        message = status.marketClosedMessage || 'Market is currently closed. Orders will be processed when market opens.';
      } else if (status.status === 'Cancelled') {
        message = `Order cancelled at ${status.cancelledAt || 'unknown time'}`;
      }
      
      return {
        ...status,
        orderId,
        message,
      };
    }
    
    // Wait before next attempt (except on last attempt)
    if (attempt < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  }
  
  // Max attempts reached, order still working
  return {
    status: 'Working',
    orderId,
    message: 'Order is still working (pending execution)',
  };
}
