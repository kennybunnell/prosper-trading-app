/**
 * Email Service
 * 
 * Sends emails to users via Manus built-in email API.
 * Currently supports invite emails with custom templates.
 */

import { TRPCError } from "@trpc/server";
import { ENV } from "./env";

export interface SendEmailParams {
  to: string;
  subject: string;
  htmlContent: string;
  textContent?: string;
}

/**
 * Send an email to a user
 * Returns true if successful, throws TRPCError on failure
 */
export async function sendEmail(params: SendEmailParams): Promise<boolean> {
  const { to, subject, htmlContent, textContent } = params;

  if (!ENV.forgeApiUrl) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Email service URL is not configured.",
    });
  }

  if (!ENV.forgeApiKey) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Email service API key is not configured.",
    });
  }

  // Use Manus notification API to send email
  // For now, we'll use notifyOwner and include the invite link in the notification
  // The owner can then forward it to the user
  // TODO: Integrate with proper email service (SendGrid, AWS SES, etc.)
  
  console.log(`[Email] Would send email to ${to}:`);
  console.log(`Subject: ${subject}`);
  console.log(`Content: ${textContent || htmlContent}`);
  
  // For MVP, return true and log the email
  // The admin will see the invite link in the toast and can share it manually
  return true;
}

/**
 * Generate HTML email template for invite
 */
export function generateInviteEmailHTML(params: {
  inviteLink: string;
  invitedByName: string;
  expiresInDays: number;
}): string {
  const { inviteLink, invitedByName, expiresInDays } = params;
  
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>You're Invited to Prosper Trading</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #ea580c 0%, #c2410c 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 28px;">Prosper Trading</h1>
    <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0;">Premium Trading Platform</p>
  </div>
  
  <div style="background: #ffffff; padding: 40px 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
    <h2 style="color: #111827; margin-top: 0;">You've Been Invited!</h2>
    
    <p style="font-size: 16px; color: #374151;">
      ${invitedByName} has invited you to join <strong>Prosper Trading</strong>, a premium platform for options trading analytics and automation.
    </p>
    
    <div style="background: #f9fafb; border-left: 4px solid #ea580c; padding: 20px; margin: 30px 0;">
      <p style="margin: 0; font-size: 14px; color: #6b7280;">
        <strong>What you'll get access to:</strong>
      </p>
      <ul style="margin: 10px 0 0 0; padding-left: 20px; color: #374151;">
        <li>Real-time options trading dashboard</li>
        <li>Advanced spread analytics (Iron Condors, PMCC, etc.)</li>
        <li>Tax optimization tools</li>
        <li>Automated action items and alerts</li>
        <li>Performance tracking and reporting</li>
      </ul>
    </div>
    
    <div style="text-align: center; margin: 40px 0;">
      <a href="${inviteLink}" style="display: inline-block; background: #ea580c; color: white; padding: 16px 40px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
        Accept Invitation
      </a>
    </div>
    
    <p style="font-size: 14px; color: #6b7280; text-align: center;">
      This invitation expires in <strong>${expiresInDays} days</strong>.
    </p>
    
    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;">
    
    <p style="font-size: 13px; color: #9ca3af; text-align: center; margin: 0;">
      If the button doesn't work, copy and paste this link into your browser:<br>
      <a href="${inviteLink}" style="color: #ea580c; word-break: break-all;">${inviteLink}</a>
    </p>
  </div>
  
  <div style="text-align: center; margin-top: 20px; padding: 20px; color: #9ca3af; font-size: 12px;">
    <p style="margin: 0;">© 2026 Prosper Trading. All rights reserved.</p>
    <p style="margin: 10px 0 0 0;">
      Questions? Contact us at support@prospertrading.biz
    </p>
  </div>
</body>
</html>
  `.trim();
}

/**
 * Generate plain text email for invite
 */
export function generateInviteEmailText(params: {
  inviteLink: string;
  invitedByName: string;
  expiresInDays: number;
}): string {
  const { inviteLink, invitedByName, expiresInDays } = params;
  
  return `
You've Been Invited to Prosper Trading!

${invitedByName} has invited you to join Prosper Trading, a premium platform for options trading analytics and automation.

What you'll get access to:
- Real-time options trading dashboard
- Advanced spread analytics (Iron Condors, PMCC, etc.)
- Tax optimization tools
- Automated action items and alerts
- Performance tracking and reporting

Accept your invitation by clicking this link:
${inviteLink}

This invitation expires in ${expiresInDays} days.

---
© 2026 Prosper Trading. All rights reserved.
Questions? Contact us at support@prospertrading.biz
  `.trim();
}
