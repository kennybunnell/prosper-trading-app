import { describe, it, expect } from 'vitest';

describe('Connection Status Logic', () => {
  it('should return disconnected when credentials are missing', () => {
    const credentials = null;
    
    const tastytradeConfigured = !!(credentials?.tastytradeUsername && credentials?.tastytradePassword);
    const tradierConfigured = !!credentials?.tradierApiKey;
    
    expect(tastytradeConfigured).toBe(false);
    expect(tradierConfigured).toBe(false);
  });

  it('should return connected for Tastytrade when both username and password are present', () => {
    const credentials = {
      tastytradeUsername: 'test-user',
      tastytradePassword: 'test-password',
    };
    
    const tastytradeConfigured = !!(credentials?.tastytradeUsername && credentials?.tastytradePassword);
    
    expect(tastytradeConfigured).toBe(true);
  });

  it('should return disconnected for Tastytrade when only username is present', () => {
    const credentials = {
      tastytradeUsername: 'test-user',
      tastytradePassword: null,
    };
    
    const tastytradeConfigured = !!(credentials?.tastytradeUsername && credentials?.tastytradePassword);
    
    expect(tastytradeConfigured).toBe(false);
  });

  it('should return disconnected for Tastytrade when only password is present', () => {
    const credentials = {
      tastytradeUsername: null,
      tastytradePassword: 'test-password',
    };
    
    const tastytradeConfigured = !!(credentials?.tastytradeUsername && credentials?.tastytradePassword);
    
    expect(tastytradeConfigured).toBe(false);
  });

  it('should return connected for Tradier when API key is present', () => {
    const credentials = {
      tradierApiKey: 'test-api-key',
    };
    
    const tradierConfigured = !!credentials?.tradierApiKey;
    
    expect(tradierConfigured).toBe(true);
  });

  it('should return disconnected for Tradier when API key is missing', () => {
    const credentials = {
      tradierApiKey: null,
    };
    
    const tradierConfigured = !!credentials?.tradierApiKey;
    
    expect(tradierConfigured).toBe(false);
  });

  it('should return connected for both APIs when all credentials are present', () => {
    const credentials = {
      tastytradeUsername: 'test-user',
      tastytradePassword: 'test-password',
      tradierApiKey: 'test-api-key',
    };
    
    const tastytradeConfigured = !!(credentials?.tastytradeUsername && credentials?.tastytradePassword);
    const tradierConfigured = !!credentials?.tradierApiKey;
    
    expect(tastytradeConfigured).toBe(true);
    expect(tradierConfigured).toBe(true);
  });

  it('should return correct status strings based on configuration', () => {
    const credentials = {
      tastytradeUsername: 'test-user',
      tastytradePassword: 'test-password',
      tradierApiKey: null,
    };
    
    const tastytradeConfigured = !!(credentials?.tastytradeUsername && credentials?.tastytradePassword);
    const tradierConfigured = !!credentials?.tradierApiKey;
    
    const result = {
      tastytrade: {
        configured: tastytradeConfigured,
        status: tastytradeConfigured ? 'connected' : 'disconnected',
      },
      tradier: {
        configured: tradierConfigured,
        status: tradierConfigured ? 'connected' : 'disconnected',
      },
    };
    
    expect(result.tastytrade.status).toBe('connected');
    expect(result.tradier.status).toBe('disconnected');
  });
});
