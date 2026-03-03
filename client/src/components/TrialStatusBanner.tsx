import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { AlertCircle, Clock, TrendingUp, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";

/**
 * Trial Status Banner
 * 
 * Displays trial information for free_trial users:
 * - Days remaining in 14-day trial
 * - Scan usage counter (X/10 scans used today)
 * - Upgrade CTA
 * 
 * Only visible for users with subscriptionTier === 'free_trial'
 * Owner/admin accounts bypass trial restrictions and don't see this banner
 */
export function TrialStatusBanner() {
  const { user } = useAuth();
  const { data: subscriptionStatus } = trpc.user.getSubscriptionStatus.useQuery(undefined, { enabled: !!user });

  // Only show for free trial users
  if (!user || !subscriptionStatus || subscriptionStatus.tier !== 'free_trial') {
    return null;
  }

  // Calculate days remaining
  const trialEndsAt = subscriptionStatus.trialEndsAt ? new Date(subscriptionStatus.trialEndsAt) : null;
  const now = new Date();
  const daysRemaining = trialEndsAt 
    ? Math.max(0, Math.ceil((trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
    : 14;

  // Get scan usage
  const scansUsed = subscriptionStatus.scansUsed || 0;
  const scansLimit = subscriptionStatus.scansLimit || 10;
  const scansRemaining = subscriptionStatus.scansRemaining || 0;

  // Determine urgency level
  const isExpiringSoon = daysRemaining <= 3;
  const isLowScans = scansRemaining <= 2;
  const isUrgent = isExpiringSoon || isLowScans;

  return (
    <div className={`border-b ${isUrgent ? 'bg-orange-500/10 border-orange-500/30' : 'bg-blue-500/10 border-blue-500/30'}`}>
      <div className="container mx-auto px-4 py-3">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          {/* Left: Trial Status */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Clock className={`h-5 w-5 ${isUrgent ? 'text-orange-500' : 'text-blue-500'}`} />
              <div>
                <p className="text-sm font-semibold">
                  14-Day Free Trial
                </p>
                <p className="text-xs text-muted-foreground">
                  {daysRemaining} {daysRemaining === 1 ? 'day' : 'days'} remaining
                </p>
              </div>
            </div>

            <div className="h-8 w-px bg-border" />

            {/* Scan Counter */}
            <div className="flex items-center gap-2">
              <Zap className={`h-5 w-5 ${isLowScans ? 'text-orange-500' : 'text-blue-500'}`} />
              <div>
                <p className="text-sm font-semibold">
                  {scansUsed}/{scansLimit} Scans Used
                </p>
                <p className="text-xs text-muted-foreground">
                  {scansRemaining} {scansRemaining === 1 ? 'scan' : 'scans'} remaining today
                </p>
              </div>
            </div>
          </div>

          {/* Right: Upgrade CTA */}
          <div className="flex items-center gap-3">
            {isUrgent && (
              <div className="flex items-center gap-2 text-orange-500">
                <AlertCircle className="h-4 w-4" />
                <span className="text-sm font-medium">
                  {isExpiringSoon ? 'Trial ending soon!' : 'Low on scans!'}
                </span>
              </div>
            )}
            
            <Link href="/subscription">
              <Button 
                size="sm" 
                className="bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800"
              >
                <TrendingUp className="h-4 w-4 mr-2" />
                Upgrade Now
              </Button>
            </Link>
          </div>
        </div>

        {/* Warning message when scans are low */}
        {isLowScans && scansRemaining > 0 && (
          <div className="mt-2 text-sm text-orange-500">
            ⚠️ You're running low on scans. Upgrade to <strong>Wheel Trading ($47/month)</strong> for unlimited scans.
          </div>
        )}

        {/* Out of scans message */}
        {scansRemaining === 0 && (
          <div className="mt-2 text-sm text-red-500 font-medium">
            🚫 You've used all your scans for today. Upgrade to continue scanning or wait until tomorrow for your daily limit to reset.
          </div>
        )}
      </div>
    </div>
  );
}
