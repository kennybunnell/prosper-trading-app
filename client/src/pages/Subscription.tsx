import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Check, AlertCircle, ExternalLink } from "lucide-react";
import { STRIPE_PRODUCTS, TIER_TO_PRODUCT, type SubscriptionTier } from "../../../shared/products";
import { useToast } from "@/hooks/use-toast";

const TIER_NAMES: Record<SubscriptionTier, string> = {
  free_trial: "Free Trial (14 Days)",
  wheel_trading: "Tier 2: Wheel Access",
  live_trading_csp_cc: "Tier 3: Live Trading CSP+CC",
  advanced: "Tier 4: Advanced Trading",
  vip: "VIP/Partner Lifetime Access"
};

export default function Subscription() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [selectedTier, setSelectedTier] = useState<SubscriptionTier | null>(null);
  const [includeTradierSetup, setIncludeTradierSetup] = useState(false);
  const [includeTastytradeSetup, setIncludeTastytradeSetup] = useState(false);

  const subscriptionStatus = trpc.stripe.getSubscriptionStatus.useQuery(undefined, { enabled: !!user });
  const createCheckout = trpc.stripe.createCheckoutSession.useMutation({
    onSuccess: (data) => {
      // Open Stripe checkout in new tab
      if (data.checkoutUrl) {
        window.open(data.checkoutUrl, '_blank');
      }
      toast({
        title: "Redirecting to checkout",
        description: "Opening Stripe checkout in a new tab...",
      });
    },
    onError: (error) => {
      toast({
        title: "Checkout failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const cancelSubscription = trpc.stripe.cancelSubscription.useMutation({
    onSuccess: () => {
      toast({
        title: "Subscription canceled",
        description: "Your subscription will end at the end of the current billing period.",
      });
      subscriptionStatus.refetch();
    },
    onError: (error) => {
      toast({
        title: "Cancellation failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const reactivateSubscription = trpc.stripe.reactivateSubscription.useMutation({
    onSuccess: () => {
      toast({
        title: "Subscription reactivated",
        description: "Your subscription will continue at the end of the current billing period.",
      });
      subscriptionStatus.refetch();
    },
    onError: (error) => {
      toast({
        title: "Reactivation failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  if (subscriptionStatus.isLoading) {
    return (
      <div className="container mx-auto py-8">
        <p>Loading subscription status...</p>
      </div>
    );
  }

  const currentTier = subscriptionStatus.data?.tier || 'free_trial';
  const trialEndsAt = subscriptionStatus.data?.trialEndsAt;
  const createdAt = subscriptionStatus.data?.createdAt;

  // Calculate days remaining in trial
  let daysRemaining = 0;
  if (currentTier === 'free_trial' && trialEndsAt) {
    const now = new Date();
    const trialEnd = new Date(trialEndsAt);
    daysRemaining = Math.max(0, Math.ceil((trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
  }

  const handleUpgrade = (tier: SubscriptionTier) => {
    if (tier === 'free_trial') return;
    createCheckout.mutate({
      targetTier: tier,
      includeSetupFees: {
        tradier: includeTradierSetup,
        tastytrade: includeTastytradeSetup,
      },
    });
  };

  return (
    <div className="container mx-auto py-8 max-w-7xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Subscription Management</h1>
        <p className="text-muted-foreground">
          Manage your subscription tier and billing settings
        </p>
      </div>

      {/* Current Subscription Status */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Current Plan</CardTitle>
          <CardDescription>Your active subscription tier</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-2xl font-bold">{TIER_NAMES[currentTier]}</p>
              {currentTier === 'free_trial' && trialEndsAt && (
                <p className="text-sm text-muted-foreground mt-1">
                  {daysRemaining > 0 ? `${daysRemaining} days remaining` : 'Trial expired'}
                </p>
              )}
            </div>
            <Badge variant={currentTier === 'free_trial' ? 'secondary' : 'default'}>
              {currentTier === 'free_trial' ? 'Trial' : 'Active'}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Trial Expiration Warning */}
      {currentTier === 'free_trial' && daysRemaining <= 3 && (
        <Alert className="mb-8">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Your free trial {daysRemaining === 0 ? 'has expired' : `expires in ${daysRemaining} days`}. 
            Upgrade to continue accessing premium features.
          </AlertDescription>
        </Alert>
      )}

      {/* Available Tiers */}
      <div className="mb-8">
        <h2 className="text-2xl font-bold mb-4">Available Plans</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {(['wheel_trading', 'live_trading_csp_cc', 'advanced', 'vip'] as SubscriptionTier[]).map((tier) => {
            const product = TIER_TO_PRODUCT[tier];
            if (!product) return null;

            const isCurrent = currentTier === tier;
            const tierOrder: SubscriptionTier[] = ['free_trial', 'wheel_trading', 'live_trading_csp_cc', 'advanced', 'vip'];
            const isUpgrade = tierOrder.indexOf(currentTier) < tierOrder.indexOf(tier);

            return (
              <Card key={tier} className={isCurrent ? 'border-primary' : ''}>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    {product.name}
                    {isCurrent && <Badge>Current</Badge>}
                  </CardTitle>
                  <CardDescription>
                    <span className="text-2xl font-bold">${product.amount}</span>
                    {product.interval === 'month' && <span className="text-sm">/month</span>}
                    {product.interval === 'one_time' && <span className="text-sm"> one-time</span>}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-4">{product.description}</p>
                  <ul className="space-y-2">
                    {product.features.map((feature, index) => (
                      <li key={index} className="flex items-start gap-2 text-sm">
                        <Check className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
                <CardFooter>
                  {isCurrent ? (
                    <Button disabled className="w-full">Current Plan</Button>
                  ) : isUpgrade ? (
                    <Button 
                      onClick={() => setSelectedTier(tier as Exclude<SubscriptionTier, 'free_trial'>)}
                      className="w-full"
                    >
                      Upgrade
                    </Button>
                  ) : (
                    <Button variant="outline" disabled className="w-full">
                      Downgrade Not Available
                    </Button>
                  )}
                </CardFooter>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Setup Fee Options */}
      {selectedTier && selectedTier !== 'vip' && (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Setup Options</CardTitle>
            <CardDescription>
              Choose whether you want assisted setup for your API credentials
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start space-x-3">
              <Checkbox
                id="tradier-setup"
                checked={includeTradierSetup}
                onCheckedChange={(checked) => setIncludeTradierSetup(checked as boolean)}
              />
              <div className="grid gap-1.5 leading-none">
                <label
                  htmlFor="tradier-setup"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  Tradier API Setup (+$99)
                </label>
                <p className="text-sm text-muted-foreground">
                  We'll help you set up your Tradier API key via a guided setup call. 
                  Or you can <a href="https://developer.tradier.com" target="_blank" rel="noopener noreferrer" className="text-primary underline inline-flex items-center gap-1">
                    set it up yourself for free <ExternalLink className="h-3 w-3" />
                  </a>
                </p>
              </div>
            </div>

            {(selectedTier === 'live_trading_csp_cc' || selectedTier === 'advanced') && (
              <div className="flex items-start space-x-3">
                <Checkbox
                  id="tastytrade-setup"
                  checked={includeTastytradeSetup}
                  onCheckedChange={(checked) => setIncludeTastytradeSetup(checked as boolean)}
                />
                <div className="grid gap-1.5 leading-none">
                  <label
                    htmlFor="tastytrade-setup"
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    Tastytrade OAuth2 Setup (+$99)
                  </label>
                  <p className="text-sm text-muted-foreground">
                    We'll help you set up your Tastytrade OAuth2 credentials via a guided setup call.
                    Or you can <a href="https://developer.tastytrade.com" target="_blank" rel="noopener noreferrer" className="text-primary underline inline-flex items-center gap-1">
                      set it up yourself for free <ExternalLink className="h-3 w-3" />
                    </a>
                  </p>
                </div>
              </div>
            )}

            <div className="pt-4 border-t">
              <div className="flex items-center justify-between mb-4">
                <span className="font-medium">Total:</span>
                <span className="text-2xl font-bold">
                  ${(TIER_TO_PRODUCT[selectedTier]?.amount || 0) + 
                    (includeTradierSetup ? 99 : 0) + 
                    (includeTastytradeSetup ? 99 : 0)}
                </span>
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={() => handleUpgrade(selectedTier)}
                  disabled={createCheckout.isPending}
                  className="flex-1"
                >
                  {createCheckout.isPending ? 'Processing...' : 'Continue to Checkout'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setSelectedTier(null)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Subscription Actions */}
      {currentTier !== 'free_trial' && currentTier !== 'vip' && (
        <Card>
          <CardHeader>
            <CardTitle>Subscription Actions</CardTitle>
            <CardDescription>Manage your active subscription</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="destructive"
              onClick={() => cancelSubscription.mutate()}
              disabled={cancelSubscription.isPending}
            >
              {cancelSubscription.isPending ? 'Canceling...' : 'Cancel Subscription'}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
