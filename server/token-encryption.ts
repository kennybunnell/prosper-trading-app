import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits

/**
 * Get encryption key from environment variable
 * Key must be 32 bytes (256 bits) encoded as hex string
 */
function getEncryptionKey(): Buffer {
  const keyHex = process.env.OAUTH_TOKEN_ENCRYPTION_KEY;
  
  if (!keyHex) {
    throw new Error('OAUTH_TOKEN_ENCRYPTION_KEY environment variable is not set');
  }
  
  const key = Buffer.from(keyHex, 'hex');
  
  if (key.length !== 32) {
    throw new Error(`OAUTH_TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex characters), got ${key.length} bytes`);
  }
  
  return key;
}

/**
 * Encrypt a token using AES-256-GCM
 * Returns format: {iv}:{encrypted_data}:{auth_tag} (Base64 encoded)
 */
export function encryptToken(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  
  const authTag = cipher.getAuthTag().toString('base64');
  
  return `${iv.toString('base64')}:${encrypted}:${authTag}`;
}

/**
 * Decrypt a token using AES-256-GCM
 * Expects format: {iv}:{encrypted_data}:{auth_tag} (Base64 encoded)
 */
export function decryptToken(encrypted: string): string {
  const key = getEncryptionKey();
  const parts = encrypted.split(':');
  
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted token format');
  }
  
  const [ivB64, dataB64, authTagB64] = parts;
  
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(dataB64, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

/**
 * Generate a new encryption key (for initial setup)
 * Returns 32-byte key as hex string
 */
export function generateEncryptionKey(): string {
  return crypto.randomBytes(32).toString('hex');
}
