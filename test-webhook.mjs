/**
 * Test script to verify Stripe webhook endpoint
 * This simulates a checkout.session.completed event
 */

const WEBHOOK_URL = 'https://3000-i9zcnjlcuz3p3d53rge3s-7c6e9ff2.us2.manus.computer/api/webhooks/stripe';
const WEBHOOK_SECRET = 'whsec_3mo7dpDugaLs1ocMuytujBq0ovVJrVPZ';

// Mock Stripe event payload
const mockEvent = {
  id: 'evt_test_webhook_' + Date.now(),
  object: 'event',
  api_version: '2026-01-28',
  created: Math.floor(Date.now() / 1000),
  type: 'checkout.session.completed',
  data: {
    object: {
      id: 'cs_test_' + Date.now(),
      object: 'checkout.session',
      customer: 'cus_test_123',
      subscription: 'sub_test_123',
      metadata: {
        user_id: '1',
        target_tier: 'wheel_trading',
        customer_email: 'test@example.com',
        customer_name: 'Test User'
      }
    }
  }
};

async function testWebhook() {
  console.log('🧪 Testing Stripe Webhook Endpoint...\n');
  console.log('Webhook URL:', WEBHOOK_URL);
  console.log('Event Type:', mockEvent.type);
  console.log('Event ID:', mockEvent.id);
  console.log('\n---\n');

  try {
    // Import Stripe to generate proper signature
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    // Generate webhook signature
    const payload = JSON.stringify(mockEvent);
    const signature = stripe.webhooks.generateTestHeaderString({
      payload,
      secret: WEBHOOK_SECRET,
    });

    console.log('Sending webhook request with signature...\n');

    // Send request to webhook endpoint
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': signature,
      },
      body: payload,
    });

    const responseText = await response.text();
    let responseJson;
    try {
      responseJson = JSON.parse(responseText);
    } catch {
      responseJson = null;
    }

    console.log('✅ Response Status:', response.status, response.statusText);
    console.log('📦 Response Body:', responseJson || responseText);
    console.log('\n---\n');

    if (response.ok && responseJson?.received) {
      console.log('✅ SUCCESS: Webhook endpoint is working correctly!');
      console.log('The webhook handler received and processed the event.');
    } else {
      console.log('❌ FAILED: Webhook endpoint returned an error');
      console.log('Check the server logs for more details');
    }

  } catch (error) {
    console.error('❌ ERROR:', error.message);
    console.error('\nFull error:', error);
  }
}

// Run the test
testWebhook();
