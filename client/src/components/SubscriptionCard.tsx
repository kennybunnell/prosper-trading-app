import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { Loader2, Crown, Zap, Rocket, CheckCircle2, Clock } from "lucide-react";
import { toast } from "sonner";

export function SubscriptionCard() {
  const { data: subscription, isLoading } = trpc.subscription.getSubscription.useQuery();
  const createCheckout = trpc.subscription.createCheckoutSession.useMutation({
    onSuccess: (data) => {
      if (data.url) {
        toast.info("Redirecting to Stripe Checkout...");
        window.open(data.url, "_blank");
      }
    },
    onError: (error) => {
      toast.error(`Failed to create checkout: ${error.message}`);
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Subscription & Billing</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const getTierIcon = (tier: string) => {
    switch (tier) {
      case "free_trial":
        return <Clock className="h-5 w-5" />;
      case "wheel":
        return <Zap className="h-5 w-5" />;
      case "advanced":
        return <Rocket className="h-5 w-5" />;
      default:
        return <Crown className="h-5 w-5" />;
    }
  };

  const getTierBadgeColor = (tier: string) => {
    switch (tier) {
      case "free_trial":
        return "bg-blue-500/10 text-blue-500 border-blue-500/50";
      case "wheel":
        return "bg-green-500/10 text-green-500 border-green-500/50";
      case "advanced":
        return "bg-purple-500/10 text-purple-500 border-purple-500/50";
      default:
        return "bg-gray-500/10 text-gray-500 border-gray-500/50";
    }
  };

  const handleUpgrade = (tier: "free_trial" | "wheel" | "advanced") => {
    createCheckout.mutate({ tier });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Subscription & Billing</CardTitle>
        <CardDescription>
          Manage your subscription plan and billing information
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Current Plan */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                {getTierIcon(subscription?.tier || "free_trial")}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold">{subscription?.product?.name}</h3>
                  <Badge className={getTierBadgeColor(subscription?.tier || "free_trial")}>
                    {subscription?.tier === "free_trial" ? "Free Trial" : "Active"}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {subscription?.product?.description}
                </p>
              </div>
            </div>
            {subscription?.tier !== "advanced" && (
              <div className="text-right">
                <p className="text-2xl font-bold">${subscription?.product?.price}</p>
                <p className="text-xs text-muted-foreground">per month</p>
              </div>
            )}
          </div>

          {/* Trial Status */}
          {subscription?.isTrialActive && (
            <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/50">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="h-4 w-4 text-blue-500" />
                <p className="text-sm font-medium text-blue-500">Trial Active</p>
              </div>
              <p className="text-sm text-muted-foreground">
                Your free trial ends in <span className="font-semibold text-foreground">{subscription?.trialDaysRemaining} days</span>
                {subscription?.trialEndsAt && (
                  <span> ({new Date(subscription.trialEndsAt).toLocaleDateString()})</span>
                )}
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                Upgrade now to continue using the platform after your trial expires
              </p>
            </div>
          )}

          {/* Current Features */}
          <div className="space-y-2">
            <p className="text-sm font-medium">Included Features:</p>
            <ul className="space-y-1">
              {subscription?.product?.features.map((feature: string, index: number) => (
                <li key={index} className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                  {feature}
                </li>
              ))}
            </ul>
          </div>

          {/* Limitations */}
          {subscription?.product?.limitations && subscription.product.limitations.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Limitations:</p>
              <ul className="space-y-1">
                {subscription.product.limitations.map((limitation: string, index: number) => (
                  <li key={index} className="flex items-center gap-2 text-sm text-muted-foreground">
                    <div className="h-4 w-4 flex items-center justify-center flex-shrink-0">
                      <div className="h-1 w-1 rounded-full bg-muted-foreground" />
                    </div>
                    {limitation}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Upgrade Options */}
        {subscription?.tier !== "advanced" && (
          <div className="space-y-4 pt-4 border-t">
            <h3 className="font-semibold">Upgrade Your Plan</h3>
            
            {/* Demo Mode (if on free trial) */}
            {subscription?.tier === "free_trial" && (
              <div className="p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Clock className="h-5 w-5 text-blue-500" />
                    <div>
                      <h4 className="font-semibold">Continue Demo Mode</h4>
                      <p className="text-sm text-muted-foreground">After trial expires</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xl font-bold">$47</p>
                    <p className="text-xs text-muted-foreground">per month</p>
                  </div>
                </div>
                <ul className="space-y-1 mb-4">
                  <li className="text-sm text-muted-foreground flex items-center gap-2">
                    <CheckCircle2 className="h-3 w-3 text-green-500" />
                    Unlimited demo trading
                  </li>
                  <li className="text-sm text-muted-foreground flex items-center gap-2">
                    <CheckCircle2 className="h-3 w-3 text-green-500" />
                    All dashboards & features
                  </li>
                  <li className="text-sm text-muted-foreground flex items-center gap-2">
                    <CheckCircle2 className="h-3 w-3 text-green-500" />
                    Gamification & progress tracking
                  </li>
                </ul>
                <Button 
                  className="w-full" 
                  variant="outline"
                  onClick={() => handleUpgrade("free_trial")}
                  disabled={createCheckout.isPending}
                >
                  {createCheckout.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Continue with Demo Mode
                </Button>
              </div>
            )}

            {/* Wheel Strategies */}
            {(subscription?.tier === "free_trial" || subscription?.tier === "wheel") && subscription?.tier !== "wheel" && (
              <div className="p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Zap className="h-5 w-5 text-green-500" />
                    <div>
                      <h4 className="font-semibold">Wheel Strategies</h4>
                      <p className="text-sm text-muted-foreground">Live trading with CSP & CC</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xl font-bold">$97</p>
                    <p className="text-xs text-muted-foreground">per month</p>
                  </div>
                </div>
                <ul className="space-y-1 mb-4">
                  <li className="text-sm text-muted-foreground flex items-center gap-2">
                    <CheckCircle2 className="h-3 w-3 text-green-500" />
                    Everything in Demo Mode
                  </li>
                  <li className="text-sm text-muted-foreground flex items-center gap-2">
                    <CheckCircle2 className="h-3 w-3 text-green-500" />
                    Connect Tastytrade account
                  </li>
                  <li className="text-sm text-muted-foreground flex items-center gap-2">
                    <CheckCircle2 className="h-3 w-3 text-green-500" />
                    Live trading (CSP + CC)
                  </li>
                  <li className="text-sm text-muted-foreground flex items-center gap-2">
                    <CheckCircle2 className="h-3 w-3 text-green-500" />
                    Paper trading mode
                  </li>
                </ul>
                <Button 
                  className="w-full bg-green-500 hover:bg-green-600" 
                  onClick={() => handleUpgrade("wheel")}
                  disabled={createCheckout.isPending}
                >
                  {createCheckout.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Upgrade to Wheel Strategies
                </Button>
              </div>
            )}

            {/* Advanced Strategies */}
            {subscription?.tier !== "advanced" && (
              <div className="p-4 rounded-lg border-2 border-purple-500/50 bg-purple-500/5 hover:bg-purple-500/10 transition-colors">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Rocket className="h-5 w-5 text-purple-500" />
                    <div>
                      <h4 className="font-semibold">Advanced Strategies</h4>
                      <p className="text-sm text-muted-foreground">Full platform access</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xl font-bold">$197</p>
                    <p className="text-xs text-muted-foreground">per month</p>
                  </div>
                </div>
                <ul className="space-y-1 mb-4">
                  <li className="text-sm text-muted-foreground flex items-center gap-2">
                    <CheckCircle2 className="h-3 w-3 text-green-500" />
                    Everything in Wheel Strategies
                  </li>
                  <li className="text-sm text-muted-foreground flex items-center gap-2">
                    <CheckCircle2 className="h-3 w-3 text-green-500" />
                    PMCC Dashboard (unlocked)
                  </li>
                  <li className="text-sm text-muted-foreground flex items-center gap-2">
                    <CheckCircle2 className="h-3 w-3 text-green-500" />
                    Bull/Bear Put Spreads (unlocked)
                  </li>
                  <li className="text-sm text-muted-foreground flex items-center gap-2">
                    <CheckCircle2 className="h-3 w-3 text-green-500" />
                    Priority support
                  </li>
                </ul>
                <Button 
                  className="w-full bg-purple-500 hover:bg-purple-600" 
                  onClick={() => handleUpgrade("advanced")}
                  disabled={createCheckout.isPending}
                >
                  {createCheckout.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Upgrade to Advanced Strategies
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Already on highest tier */}
        {subscription?.tier === "advanced" && (
          <div className="p-4 rounded-lg bg-purple-500/10 border border-purple-500/50">
            <div className="flex items-center gap-2">
              <Crown className="h-5 w-5 text-purple-500" />
              <p className="text-sm font-medium text-purple-500">
                You're on the highest tier with full platform access!
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
