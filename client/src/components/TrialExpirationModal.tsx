import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Check, ExternalLink } from "lucide-react";
import { Link } from "wouter";

interface TrialExpirationModalProps {
  open: boolean;
  daysRemaining: number;
  onClose: () => void;
}

export function TrialExpirationModal({ open, daysRemaining, onClose }: TrialExpirationModalProps) {
  const isExpired = daysRemaining <= 0;
  const CALENDLY_LINK = "https://calendly.com/your-calendly-link"; // TODO: Replace with actual Calendly link

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl">
            {isExpired ? "Your Free Trial Has Ended" : `Your Trial Expires in ${daysRemaining} Days`}
          </DialogTitle>
          <DialogDescription>
            {isExpired 
              ? "Upgrade to continue accessing premium features and unlimited scans."
              : "Upgrade now to continue enjoying unlimited scans and advanced features."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Tier 2 Upgrade Options */}
          <div>
            <h3 className="text-lg font-semibold mb-4">Continue with Tier 2 - Wheel Access ($47/month)</h3>
            <div className="grid gap-4 mb-4">
              <div className="flex items-start gap-2">
                <Check className="h-5 w-5 text-green-600 mt-0.5 flex-shrink-0" />
                <span>Unlimited scans per day</span>
              </div>
              <div className="flex items-start gap-2">
                <Check className="h-5 w-5 text-green-600 mt-0.5 flex-shrink-0" />
                <span>Full paper trading access</span>
              </div>
              <div className="flex items-start gap-2">
                <Check className="h-5 w-5 text-green-600 mt-0.5 flex-shrink-0" />
                <span>View all strategies (CSP, CC, PMCC, Iron Condor)</span>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              {/* DIY Setup Option */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Option 1: Set Up Yourself (Free)</CardTitle>
                  <CardDescription>Configure your own Tradier API key</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="text-sm space-y-2">
                    <p className="font-medium">Steps to set up Tradier:</p>
                    <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                      <li>Create a free Tradier sandbox account</li>
                      <li>Generate your API key</li>
                      <li>Enter your API key in Settings</li>
                    </ol>
                  </div>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => window.open("https://developer.tradier.com", "_blank")}
                  >
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Get Tradier API Key
                  </Button>
                  <Link href="/subscription">
                    <Button className="w-full" onClick={onClose}>
                      Continue to Subscription ($47/mo)
                    </Button>
                  </Link>
                </CardContent>
              </Card>

              {/* Assisted Setup Option */}
              <Card className="border-primary">
                <CardHeader>
                  <CardTitle className="text-base">Option 2: Assisted Setup (+$99)</CardTitle>
                  <CardDescription>We'll help you set up everything</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="text-sm space-y-2">
                    <p className="font-medium">What's included:</p>
                    <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                      <li>Guided setup call with our team</li>
                      <li>Help creating Tradier account</li>
                      <li>API key configuration</li>
                      <li>Verification and testing</li>
                    </ul>
                  </div>
                  <div className="pt-2 border-t">
                    <p className="text-sm font-medium mb-1">First month total:</p>
                    <p className="text-2xl font-bold">$146</p>
                    <p className="text-xs text-muted-foreground">($47/mo + $99 setup fee)</p>
                  </div>
                  <Button
                    className="w-full"
                    onClick={() => window.open(CALENDLY_LINK, "_blank")}
                  >
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Schedule Setup Call
                  </Button>
                  <Link href="/subscription">
                    <Button variant="outline" className="w-full" onClick={onClose}>
                      View Subscription Options
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Other Tiers */}
          <div className="pt-4 border-t">
            <h3 className="text-lg font-semibold mb-2">Or Upgrade to a Higher Tier</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Get live trading capabilities with CSP, CC, PMCC, and Iron Condor strategies
            </p>
            <div className="grid md:grid-cols-3 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Tier 3: Live Trading CSP+CC</CardTitle>
                  <CardDescription>$97/month</CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="text-sm space-y-1 text-muted-foreground">
                    <li>• Live trading CSP + CC only</li>
                    <li>• Requires Tradier + Tastytrade</li>
                    <li>• Setup: $198 (both APIs)</li>
                  </ul>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Tier 4: Advanced Trading</CardTitle>
                  <CardDescription>$197/month</CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="text-sm space-y-1 text-muted-foreground">
                    <li>• All strategies live trading</li>
                    <li>• Requires Tradier + Tastytrade</li>
                    <li>• Setup: $198 (both APIs)</li>
                  </ul>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">VIP/Partner</CardTitle>
                  <CardDescription>$5,000 one-time</CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="text-sm space-y-1 text-muted-foreground">
                    <li>• Lifetime access</li>
                    <li>• All features included</li>
                    <li>• Setup included</li>
                  </ul>
                </CardContent>
              </Card>
            </div>
            <Link href="/subscription">
              <Button variant="outline" className="w-full mt-4" onClick={onClose}>
                View All Subscription Options
              </Button>
            </Link>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
