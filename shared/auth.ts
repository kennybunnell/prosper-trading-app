/**
 * Shared authentication utilities
 */

export interface User {
  id: number;
  openId: string;
  email: string | null;
  name: string | null;
  role: 'admin' | 'user';
  subscriptionTier?: 'free_trial' | 'wheel' | 'advanced' | null;
}

/**
 * Check if a user is the owner/admin account
 * 
 * This function provides multi-layered protection to ensure demo mode
 * and trial features NEVER apply to the production owner account.
 * 
 * Returns true if ANY of these conditions are met:
 * 1. User email matches kennybunnell@gmail.com
 * 2. User role is 'admin'
 * 3. User openId matches OWNER_OPEN_ID environment variable
 */
export function isOwnerAccount(user: User | null | undefined): boolean {
  if (!user) return false;
  
  console.log('[isOwnerAccount] Checking user:', {
    email: user.email,
    role: user.role,
    openId: user.openId
  });
  
  // Check 1: Email match
  if (user.email === 'kennybunnell@gmail.com') {
    console.log('[isOwnerAccount] MATCHED: Email is kennybunnell@gmail.com');
    return true;
  }
  
  // Check 2: Admin role
  if (user.role === 'admin') {
    console.log('[isOwnerAccount] MATCHED: Role is admin');
    return true;
  }
  
  // Check 3: OpenID match (server-side only, env var may not exist on client)
  if (typeof process !== 'undefined' && process.env?.OWNER_OPEN_ID) {
    console.log('[isOwnerAccount] Checking openId against OWNER_OPEN_ID:', process.env.OWNER_OPEN_ID);
    if (user.openId === process.env.OWNER_OPEN_ID) {
      console.log('[isOwnerAccount] MATCHED: OpenID matches OWNER_OPEN_ID');
      return true;
    }
  }
  
  console.log('[isOwnerAccount] NO MATCH: User is not owner');
  return false;
}

/**
 * Check if a user should have demo mode enabled
 * 
 * Demo mode is ONLY enabled for users who:
 * 1. Have subscriptionTier === 'free_trial'
 * 2. Are NOT the owner account (checked via isOwnerAccount)
 */
export function shouldEnableDemoMode(user: User | null | undefined): boolean {
  if (!user) return false;
  
  // CRITICAL: Never enable demo mode for owner
  if (isOwnerAccount(user)) {
    return false;
  }
  
  // Only enable for free trial users
  return user.subscriptionTier === 'free_trial';
}
