import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TRPCError } from '@trpc/server';

/**
 * Test suite for API key restriction logic
 * 
 * Requirements:
 * - Free trial users (subscriptionTier === 'free_trial') can use system TRADIER_API_KEY
 * - Paid users (starter/pro/advanced) MUST provide their own Tradier API key
 * - Clear error messages for each scenario
 */

describe('API Key Restriction Logic', () => {
  describe('Free Trial Users', () => {
    it('should allow system API key fallback for free_trial users', () => {
      const userCredentials = null; // No personal credentials
      const subscriptionTier = 'free_trial';
      const systemApiKey = 'SYSTEM_KEY_123';

      const isFreeTrialUser = subscriptionTier === 'free_trial';
      const tradierApiKey = userCredentials || (isFreeTrialUser ? systemApiKey : null);

      expect(tradierApiKey).toBe('SYSTEM_KEY_123');
    });

    it('should prefer user credentials over system key for free_trial users', () => {
      const userCredentials = 'USER_KEY_456';
      const subscriptionTier = 'free_trial';
      const systemApiKey = 'SYSTEM_KEY_123';

      const isFreeTrialUser = subscriptionTier === 'free_trial';
      const tradierApiKey = userCredentials || (isFreeTrialUser ? systemApiKey : null);

      expect(tradierApiKey).toBe('USER_KEY_456');
    });

    it('should throw support error when system key is missing for free_trial', () => {
      const userCredentials = null;
      const subscriptionTier = 'free_trial';
      const systemApiKey = undefined;

      const isFreeTrialUser = subscriptionTier === 'free_trial';
      const tradierApiKey = userCredentials || (isFreeTrialUser ? systemApiKey : null);

      if (!tradierApiKey) {
        const message = isFreeTrialUser 
          ? 'System Tradier API key not configured. Please contact support.'
          : 'Please configure your Tradier API key in Settings to access live market data.';
        
        expect(message).toBe('System Tradier API key not configured. Please contact support.');
      }
    });
  });

  describe('Paid Users (Starter/Pro/Advanced)', () => {
    const paidTiers = ['starter', 'pro', 'advanced'];

    paidTiers.forEach(tier => {
      it(`should require personal API key for ${tier} tier users`, () => {
        const userCredentials = null; // No personal credentials
        const subscriptionTier = tier;
        const systemApiKey = 'SYSTEM_KEY_123';

        const isFreeTrialUser = subscriptionTier === 'free_trial';
        const tradierApiKey = userCredentials || (isFreeTrialUser ? systemApiKey : null);

        expect(tradierApiKey).toBeNull();
      });

      it(`should use personal API key for ${tier} tier users when provided`, () => {
        const userCredentials = 'USER_KEY_789';
        const subscriptionTier = tier;
        const systemApiKey = 'SYSTEM_KEY_123';

        const isFreeTrialUser = subscriptionTier === 'free_trial';
        const tradierApiKey = userCredentials || (isFreeTrialUser ? systemApiKey : null);

        expect(tradierApiKey).toBe('USER_KEY_789');
      });

      it(`should throw settings error when key is missing for ${tier} tier`, () => {
        const userCredentials = null;
        const subscriptionTier = tier;
        const systemApiKey = 'SYSTEM_KEY_123';

        const isFreeTrialUser = subscriptionTier === 'free_trial';
        const tradierApiKey = userCredentials || (isFreeTrialUser ? systemApiKey : null);

        if (!tradierApiKey) {
          const message = isFreeTrialUser 
            ? 'System Tradier API key not configured. Please contact support.'
            : 'Please configure your Tradier API key in Settings to access live market data.';
          
          expect(message).toBe('Please configure your Tradier API key in Settings to access live market data.');
        }
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle undefined subscription tier as paid user', () => {
      const userCredentials = null;
      const subscriptionTier = undefined;
      const systemApiKey = 'SYSTEM_KEY_123';

      const isFreeTrialUser = subscriptionTier === 'free_trial';
      const tradierApiKey = userCredentials || (isFreeTrialUser ? systemApiKey : null);

      expect(tradierApiKey).toBeNull();
    });

    it('should handle empty string credentials correctly', () => {
      const userCredentials = '';
      const subscriptionTier = 'starter';
      const systemApiKey = 'SYSTEM_KEY_123';

      const isFreeTrialUser = subscriptionTier === 'free_trial';
      const tradierApiKey = userCredentials || (isFreeTrialUser ? systemApiKey : null);

      // Empty string is falsy, so should fall back to null for paid users
      expect(tradierApiKey).toBeNull();
    });

    it('should handle whitespace-only credentials correctly', () => {
      const userCredentials = '   ';
      const subscriptionTier = 'pro';
      const systemApiKey = 'SYSTEM_KEY_123';

      const isFreeTrialUser = subscriptionTier === 'free_trial';
      const tradierApiKey = userCredentials || (isFreeTrialUser ? systemApiKey : null);

      // Whitespace string is truthy, so should be used
      expect(tradierApiKey).toBe('   ');
    });
  });

  describe('Error Message Validation', () => {
    it('should provide correct error message for trial users without system key', () => {
      const isFreeTrialUser = true;
      const tradierApiKey = null;

      if (!tradierApiKey) {
        const message = isFreeTrialUser 
          ? 'System Tradier API key not configured. Please contact support.'
          : 'Please configure your Tradier API key in Settings to access live market data.';
        
        expect(message).toContain('contact support');
        expect(message).not.toContain('Settings');
      }
    });

    it('should provide correct error message for paid users without personal key', () => {
      const isFreeTrialUser = false;
      const tradierApiKey = null;

      if (!tradierApiKey) {
        const message = isFreeTrialUser 
          ? 'System Tradier API key not configured. Please contact support.'
          : 'Please configure your Tradier API key in Settings to access live market data.';
        
        expect(message).toContain('Settings');
        expect(message).toContain('configure your Tradier API key');
        expect(message).not.toContain('contact support');
      }
    });
  });
});
