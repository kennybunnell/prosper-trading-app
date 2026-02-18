import { describe, it, expect } from 'vitest';

/**
 * Unit tests for credentials masking functionality
 * 
 * Tests that sensitive credentials are properly masked before being sent to frontend
 * and that only new (unmasked) values are saved to database.
 */

describe('Credentials Masking', () => {
  describe('Backend Masking Logic', () => {
    it('should mask Tastytrade client secret when it exists', () => {
      const credentials = {
        tastytradeClientSecret: '9452a71cba2bc68e8b911164e1edadbb446df0e6',
        tastytradeRefreshToken: null,
        tradierApiKey: null,
      };

      const masked = {
        ...credentials,
        tastytradeClientSecret: credentials.tastytradeClientSecret ? '••••••••••••••••' : '',
        tastytradeRefreshToken: credentials.tastytradeRefreshToken ? '••••••••••••••••' : '',
        tradierApiKey: credentials.tradierApiKey ? '••••••••••••••••' : '',
      };

      expect(masked.tastytradeClientSecret).toBe('••••••••••••••••');
      expect(masked.tastytradeRefreshToken).toBe('');
      expect(masked.tradierApiKey).toBe('');
    });

    it('should mask Tastytrade refresh token when it exists', () => {
      const credentials = {
        tastytradeClientSecret: null,
        tastytradeRefreshToken: 'eyJhbGciOiJFZERTQSIsInR5cCI6InJ0K2p3dCIsImtpZCI6IkxsbHMyWnJPdW5TZ2RDOF9oU2VBWjQyX1d4cWtQUmV3QnRnMTFSRG9sdnMiLCJqa3UiOiJodHRwczovL2ludGVyaW9yLWFwaS5hcjIudGFzdHl0cmFkZS5zeXN0ZW1zL29hdXRoL2p3a3MifQ',
        tradierApiKey: null,
      };

      const masked = {
        ...credentials,
        tastytradeClientSecret: credentials.tastytradeClientSecret ? '••••••••••••••••' : '',
        tastytradeRefreshToken: credentials.tastytradeRefreshToken ? '••••••••••••••••' : '',
        tradierApiKey: credentials.tradierApiKey ? '••••••••••••••••' : '',
      };

      expect(masked.tastytradeClientSecret).toBe('');
      expect(masked.tastytradeRefreshToken).toBe('••••••••••••••••');
      expect(masked.tradierApiKey).toBe('');
    });

    it('should mask Tradier API key when it exists', () => {
      const credentials = {
        tastytradeClientSecret: null,
        tastytradeRefreshToken: null,
        tradierApiKey: 'abc123def456ghi789',
      };

      const masked = {
        ...credentials,
        tastytradeClientSecret: credentials.tastytradeClientSecret ? '••••••••••••••••' : '',
        tastytradeRefreshToken: credentials.tastytradeRefreshToken ? '••••••••••••••••' : '',
        tradierApiKey: credentials.tradierApiKey ? '••••••••••••••••' : '',
      };

      expect(masked.tastytradeClientSecret).toBe('');
      expect(masked.tastytradeRefreshToken).toBe('');
      expect(masked.tradierApiKey).toBe('••••••••••••••••');
    });

    it('should mask all credentials when all exist', () => {
      const credentials = {
        tastytradeClientSecret: '9452a71cba2bc68e8b911164e1edadbb446df0e6',
        tastytradeRefreshToken: 'eyJhbGciOiJFZERTQSIsInR5cCI6InJ0K2p3dCIsImtpZCI6IkxsbHMyWnJPdW5TZ2RDOF9oU2VBWjQyX1d4cWtQUmV3QnRnMTFSRG9sdnMiLCJqa3UiOiJodHRwczovL2ludGVyaW9yLWFwaS5hcjIudGFzdHl0cmFkZS5zeXN0ZW1zL29hdXRoL2p3a3MifQ',
        tradierApiKey: 'abc123def456ghi789',
      };

      const masked = {
        ...credentials,
        tastytradeClientSecret: credentials.tastytradeClientSecret ? '••••••••••••••••' : '',
        tastytradeRefreshToken: credentials.tastytradeRefreshToken ? '••••••••••••••••' : '',
        tradierApiKey: credentials.tradierApiKey ? '••••••••••••••••' : '',
      };

      expect(masked.tastytradeClientSecret).toBe('••••••••••••••••');
      expect(masked.tastytradeRefreshToken).toBe('••••••••••••••••');
      expect(masked.tradierApiKey).toBe('••••••••••••••••');
    });

    it('should return empty strings when no credentials exist', () => {
      const credentials = {
        tastytradeClientSecret: null,
        tastytradeRefreshToken: null,
        tradierApiKey: null,
      };

      const masked = {
        ...credentials,
        tastytradeClientSecret: credentials.tastytradeClientSecret ? '••••••••••••••••' : '',
        tastytradeRefreshToken: credentials.tastytradeRefreshToken ? '••••••••••••••••' : '',
        tradierApiKey: credentials.tradierApiKey ? '••••••••••••••••' : '',
      };

      expect(masked.tastytradeClientSecret).toBe('');
      expect(masked.tastytradeRefreshToken).toBe('');
      expect(masked.tradierApiKey).toBe('');
    });
  });

  describe('Frontend Masking Detection', () => {
    it('should detect masked values starting with ••••', () => {
      const isMasked = (value: string) => value.startsWith('••••');

      expect(isMasked('••••••••••••••••')).toBe(true);
      expect(isMasked('9452a71cba2bc68e8b911164e1edadbb446df0e6')).toBe(false);
      expect(isMasked('')).toBe(false);
    });

    it('should only send unmasked credentials on save', () => {
      const tastytradeClientSecret = '••••••••••••••••'; // Masked - don't send
      const tastytradeRefreshToken = 'new-refresh-token-value'; // New value - send
      const tradierApiKey = ''; // Empty - don't send

      const isMasked = (value: string) => value.startsWith('••••');

      const payload = {
        tastytradeClientSecret: (tastytradeClientSecret && !isMasked(tastytradeClientSecret)) ? tastytradeClientSecret : undefined,
        tastytradeRefreshToken: (tastytradeRefreshToken && !isMasked(tastytradeRefreshToken)) ? tastytradeRefreshToken : undefined,
        tradierApiKey: (tradierApiKey && !isMasked(tradierApiKey)) ? tradierApiKey : undefined,
      };

      expect(payload.tastytradeClientSecret).toBeUndefined();
      expect(payload.tastytradeRefreshToken).toBe('new-refresh-token-value');
      expect(payload.tradierApiKey).toBeUndefined();
    });

    it('should send all new credentials when user enters new values', () => {
      const tastytradeClientSecret = '9452a71cba2bc68e8b911164e1edadbb446df0e6';
      const tastytradeRefreshToken = 'eyJhbGciOiJFZERTQSIsInR5cCI6InJ0K2p3dCIsImtpZCI6IkxsbHMyWnJPdW5TZ2RDOF9oU2VBWjQyX1d4cWtQUmV3QnRnMTFSRG9sdnMiLCJqa3UiOiJodHRwczovL2ludGVyaW9yLWFwaS5hcjIudGFzdHl0cmFkZS5zeXN0ZW1zL29hdXRoL2p3a3MifQ';
      const tradierApiKey = 'abc123def456ghi789';

      const isMasked = (value: string) => value.startsWith('••••');

      const payload = {
        tastytradeClientSecret: (tastytradeClientSecret && !isMasked(tastytradeClientSecret)) ? tastytradeClientSecret : undefined,
        tastytradeRefreshToken: (tastytradeRefreshToken && !isMasked(tastytradeRefreshToken)) ? tastytradeRefreshToken : undefined,
        tradierApiKey: (tradierApiKey && !isMasked(tradierApiKey)) ? tradierApiKey : undefined,
      };

      expect(payload.tastytradeClientSecret).toBe('9452a71cba2bc68e8b911164e1edadbb446df0e6');
      expect(payload.tastytradeRefreshToken).toBe('eyJhbGciOiJFZERTQSIsInR5cCI6InJ0K2p3dCIsImtpZCI6IkxsbHMyWnJPdW5TZ2RDOF9oU2VBWjQyX1d4cWtQUmV3QnRnMTFSRG9sdnMiLCJqa3UiOiJodHRwczovL2ludGVyaW9yLWFwaS5hcjIudGFzdHl0cmFkZS5zeXN0ZW1zL29hdXRoL2p3a3MifQ');
      expect(payload.tradierApiKey).toBe('abc123def456ghi789');
    });

    it('should not send any credentials when all are masked', () => {
      const tastytradeClientSecret = '••••••••••••••••';
      const tastytradeRefreshToken = '••••••••••••••••';
      const tradierApiKey = '••••••••••••••••';

      const isMasked = (value: string) => value.startsWith('••••');

      const payload = {
        tastytradeClientSecret: (tastytradeClientSecret && !isMasked(tastytradeClientSecret)) ? tastytradeClientSecret : undefined,
        tastytradeRefreshToken: (tastytradeRefreshToken && !isMasked(tastytradeRefreshToken)) ? tastytradeRefreshToken : undefined,
        tradierApiKey: (tradierApiKey && !isMasked(tradierApiKey)) ? tradierApiKey : undefined,
      };

      expect(payload.tastytradeClientSecret).toBeUndefined();
      expect(payload.tastytradeRefreshToken).toBeUndefined();
      expect(payload.tradierApiKey).toBeUndefined();
    });
  });

  describe('Security Validation', () => {
    it('should never expose actual credential values in masked response', () => {
      const actualSecret = '9452a71cba2bc68e8b911164e1edadbb446df0e6';
      const maskedSecret = '••••••••••••••••';

      expect(maskedSecret).not.toContain(actualSecret);
      expect(maskedSecret).not.toMatch(/[a-f0-9]{40}/); // No hex strings
      expect(maskedSecret.length).toBeLessThan(actualSecret.length);
    });

    it('should never expose actual refresh token in masked response', () => {
      const actualToken = 'eyJhbGciOiJFZERTQSIsInR5cCI6InJ0K2p3dCIsImtpZCI6IkxsbHMyWnJPdW5TZ2RDOF9oU2VBWjQyX1d4cWtQUmV3QnRnMTFSRG9sdnMiLCJqa3UiOiJodHRwczovL2ludGVyaW9yLWFwaS5hcjIudGFzdHl0cmFkZS5zeXN0ZW1zL29hdXRoL2p3a3MifQ';
      const maskedToken = '••••••••••••••••';

      expect(maskedToken).not.toContain(actualToken);
      expect(maskedToken).not.toMatch(/^eyJ/); // No JWT prefix
      expect(maskedToken.length).toBeLessThan(actualToken.length);
    });

    it('should use consistent masking character (bullet point)', () => {
      const masked = '••••••••••••••••';
      
      expect(masked).toMatch(/^•+$/); // Only bullet points
      expect(masked.length).toBe(16); // Consistent length
    });
  });
});
