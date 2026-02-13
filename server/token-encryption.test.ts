import { describe, it, expect } from 'vitest';
import { encryptToken, decryptToken } from './token-encryption';

describe('Token Encryption', () => {
  it('should encrypt and decrypt a token correctly', () => {
    const plaintext = 'test_refresh_token_12345';
    
    // Encrypt
    const encrypted = encryptToken(plaintext);
    expect(encrypted).toBeTruthy();
    expect(encrypted).not.toBe(plaintext);
    expect(encrypted.split(':')).toHaveLength(3); // iv:data:authTag
    
    // Decrypt
    const decrypted = decryptToken(encrypted);
    expect(decrypted).toBe(plaintext);
  });
  
  it('should generate different ciphertexts for the same plaintext', () => {
    const plaintext = 'test_refresh_token_12345';
    
    const encrypted1 = encryptToken(plaintext);
    const encrypted2 = encryptToken(plaintext);
    
    // Different IVs should produce different ciphertexts
    expect(encrypted1).not.toBe(encrypted2);
    
    // But both should decrypt to the same plaintext
    expect(decryptToken(encrypted1)).toBe(plaintext);
    expect(decryptToken(encrypted2)).toBe(plaintext);
  });
  
  it('should throw error for invalid encrypted format', () => {
    expect(() => decryptToken('invalid_format')).toThrow();
  });
  
  it('should throw error for tampered ciphertext', () => {
    const plaintext = 'test_refresh_token_12345';
    const encrypted = encryptToken(plaintext);
    
    // Tamper with the ciphertext
    const parts = encrypted.split(':');
    parts[1] = parts[1].slice(0, -1) + 'X'; // Change last character
    const tampered = parts.join(':');
    
    expect(() => decryptToken(tampered)).toThrow();
  });
});
