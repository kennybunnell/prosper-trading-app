# Phase 5 Implementation Guide: Stripe → Invite System Integration

**Goal:** Automatically send invite emails when users complete payment via Stripe

**Estimated Time:** 15-20 minutes  
**Complexity:** Low (simple webhook modification)

---

## 🎯 What This Accomplishes

**Current Flow (Manual):**
1. User pays via Stripe
2. User tier upgraded automatically
3. ❌ User still needs manual approval from admin
4. Admin manually sends invite or approves user

**After Phase 5 (Automated):**
1. User pays via Stripe
2. User tier upgraded automatically
3. ✅ Invite email sent automatically with unique link
4. User clicks link → logs in → auto-approved
5. User gains immediate access to paid features

---

## 📝 Implementation Steps

### **Step 1: Modify Stripe Webhook Handler**

**File:** `/server/webhooks/stripe.ts`

**Location:** Inside `handleCheckoutSessionCompleted()` function (after line 132)

**Add this code:**

```typescript
async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
  console.log('[Stripe Webhook] Checkout session completed:', session.id);

  const userId = session.metadata?.user_id;
  const targetTier = session.metadata?.target_tier as SubscriptionTier;
  const customerEmail = session.customer_email || session.metadata?.customer_email;

  if (!userId) {
    console.error('[Stripe Webhook] Missing user_id in session metadata');
    return;
  }

  const db = await getDb();
  if (!db) {
    console.error('[Stripe Webhook] Database unavailable');
    return;
  }

  // Update user with Stripe customer ID and subscription ID
  const updateData: any = {
    stripeCustomerId: session.customer as string,
  };

  if (session.subscription) {
    updateData.stripeSubscriptionId = session.subscription as string;
  }

  // Update tier if specified in metadata
  if (targetTier) {
    updateData.subscriptionTier = targetTier;
    console.log('[Stripe Webhook] Upgrading user', userId, 'to tier:', targetTier);
  }

  await db.update(users)
    .set(updateData)
    .where(eq(users.id, parseInt(userId)));

  console.log('[Stripe Webhook] User updated successfully:', userId);

  // ========== NEW CODE: Auto-send invite after payment ==========
  
  if (customerEmail) {
    try {
      // Check if user is already approved
      const userResult = await db.select()
        .from(users)
        .where(eq(users.id, parseInt(userId)))
        .limit(1);

      if (userResult[0] && !userResult[0].isApproved) {
        // User not approved yet - send invite
        const { invites } = await import('../../drizzle/schema.js');
        const { generateInviteEmailHTML, generateInviteEmailText, sendEmail } = await import('../_core/email.js');
        const { notifyOwner } = await import('../_core/notification.js');
        
        // Generate unique invite code
        const code = `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

        // Create invite record
        await db.insert(invites).values({
          email: customerEmail,
          code,
          status: 'pending',
          expiresAt,
          invitedBy: parseInt(userId), // Self-invited via payment
          note: `Auto-invited after payment for ${targetTier} tier`,
        });

        // Generate invite link
        const origin = process.env.VITE_APP_URL || 'https://prospertrading.biz';
        const inviteLink = `${origin}/invite/${code}`;

        // Send email
        const emailHTML = generateInviteEmailHTML({
          inviteLink,
          invitedByName: 'Prosper Trading',
          expiresInDays: 7,
        });
        const emailText = generateInviteEmailText({
          inviteLink,
          invitedByName: 'Prosper Trading',
          expiresInDays: 7,
        });

        await sendEmail({
          to: customerEmail,
          subject: 'Welcome to Prosper Trading - Activate Your Account',
          htmlContent: emailHTML,
          textContent: emailText,
        });

        // Notify owner
        await notifyOwner({
          title: `Payment received from ${customerEmail}`,
          content: `User paid for ${targetTier} tier. Invite sent automatically.\\n\\nInvite link: ${inviteLink}`,
        });

        console.log('[Stripe Webhook] Invite sent to:', customerEmail);
      } else if (userResult[0]?.isApproved) {
        console.log('[Stripe Webhook] User already approved, no invite needed');
      }
    } catch (error: any) {
      console.error('[Stripe Webhook] Failed to send invite:', error.message);
      // Don't fail the webhook - payment still processed successfully
    }
  }
  
  // ========== END NEW CODE ==========
}
```

---

### **Step 2: Add Environment Variable (Optional)**

**File:** `.env` (or set in Manus Settings → Secrets)

**Variable:**
```
VITE_APP_URL=https://prospertrading.biz
```

**Purpose:** Used to generate invite links with the correct domain

---

### **Step 3: Test the Integration**

1. **Create a test user account** (or use existing test user)
2. **Navigate to upgrade page** → Select a paid tier
3. **Complete checkout** with test card (`4242 4242 4242 4242`)
4. **Check logs** for:
   ```
   [Stripe Webhook] Checkout session completed: cs_test_xxx
   [Stripe Webhook] User updated successfully: 123
   [Stripe Webhook] Invite sent to: test@example.com
   ```
5. **Check your email/notifications** for the invite link
6. **Click invite link** → Should redirect to `/invite/{code}`
7. **Log in** → Should auto-approve and grant access

---

## 🔍 Edge Cases Handled

| Scenario | Behavior |
|----------|----------|
| User already approved | Skip invite, log message |
| User pays but email missing | Skip invite, log error (payment still processed) |
| Invite email fails to send | Log error, notify owner (payment still processed) |
| User pays twice | Second payment updates tier, no duplicate invite |
| Invite expires | Admin can resend from Admin Panel |

---

## 🧪 Testing Checklist

- [ ] Test Tier 2 upgrade ($47/month) → Invite sent
- [ ] Test Tier 4 upgrade ($197/month) → Invite sent
- [ ] Test VIP lifetime ($2,997) → Invite sent
- [ ] Test with already-approved user → No duplicate invite
- [ ] Test invite link acceptance → Auto-approval works
- [ ] Check owner notifications → Includes invite link
- [ ] Verify webhook logs → No errors

---

## 🚨 Rollback Plan

If Phase 5 causes issues, simply **remove the new code block** from `handleCheckoutSessionCompleted()` and restart the server. Payment processing will continue to work normally without auto-invites.

---

## 📊 Success Metrics

After implementing Phase 5, you should see:
- ✅ 100% of paid users receive invite emails automatically
- ✅ 0% manual approval needed for paid users
- ✅ Faster onboarding (users get access immediately after payment)
- ✅ Owner notifications include invite links for tracking

---

## 💡 Future Enhancements (Optional)

1. **Welcome email series** - Send onboarding emails after approval
2. **Payment receipts** - Custom branded receipts (or use Stripe's built-in)
3. **Upgrade prompts** - Suggest higher tiers based on usage
4. **Referral system** - Give credits for referring new paid users

---

**Ready to implement?** Just follow Step 1 above and test with a Stripe test payment!
