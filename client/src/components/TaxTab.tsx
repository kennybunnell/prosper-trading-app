import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { trpc } from '@/lib/trpc';
import { DollarSign, TrendingDown, TrendingUp, AlertTriangle, Save, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useAccount } from '@/contexts/AccountContext';

export function TaxTab() {
  const { selectedAccountId } = useAccount();
  const [taxRate, setTaxRate] = useState(24);
  const [isSaving, setIsSaving] = useState(false);
  
  // Fetch user preferences
  const { data: userPrefs, refetch: refetchPrefs } = trpc.userPreferences.get.useQuery();
  const setPreferencesMutation = trpc.userPreferences.setTaxRate.useMutation();
  
  // Sync tax rate from user preferences
  useEffect(() => {
    if (userPrefs?.taxRate) {
      setTaxRate(userPrefs.taxRate);
    }
  }, [userPrefs]);
  
  const handleSaveTaxRate = async () => {
    if (taxRate < 0 || taxRate > 50) {
      toast.error('Tax rate must be between 0% and 50%');
      return;
    }
    
    setIsSaving(true);
    try {
      await setPreferencesMutation.mutateAsync({ taxRate });
      await refetchPrefs();
      toast.success('Tax rate saved');
    } catch (error) {
      toast.error('Failed to save tax rate');
    } finally {
      setIsSaving(false);
    }
  };
  
  // Fetch real tax data from Tastytrade
  const { data: taxData, isLoading, refetch } = trpc.tax.getTaxSummary.useQuery(
    { accountNumber: selectedAccountId || undefined },
    { enabled: !!selectedAccountId || selectedAccountId === 'all' }
  );
  
  const realizedGains = taxData?.realizedGains || 0;
  const realizedLosses = taxData?.realizedLosses || 0;
  const netCapitalGain = taxData?.netCapitalGain || 0;
  const ordinaryIncome = taxData?.ordinaryIncome || 0;
  const harvestablePositions = taxData?.harvestablePositions || [];
  const totalHarvestable = taxData?.totalHarvestable || 0;
  
  const estimatedTaxOwed = Math.max(0, netCapitalGain * (taxRate / 100));
  const ordinaryIncomeTax = ordinaryIncome * (taxRate / 100);
  const totalTaxLiability = estimatedTaxOwed + ordinaryIncomeTax;
  const potentialTaxSavings = Math.abs(totalHarvestable) * (taxRate / 100);
  
  return (
    <div className="space-y-6">
      {/* Tax Rate Configuration */}
      <Card>
        <CardHeader>
          <CardTitle>Tax Configuration</CardTitle>
          <CardDescription>
            Configure your marginal tax rate for accurate tax mitigation calculations
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-4">
            <div className="flex-1 max-w-xs space-y-2">
              <Label htmlFor="tax-rate">Your Marginal Tax Rate (%)</Label>
              <Input
                id="tax-rate"
                type="number"
                min="0"
                max="50"
                step="1"
                value={taxRate}
                onChange={(e) => setTaxRate(parseInt(e.target.value) || 0)}
                placeholder="e.g., 37 for highest bracket"
              />
              <p className="text-xs text-muted-foreground">
                Federal + State combined rate (e.g., 37% federal + 13% CA = 50%)
              </p>
            </div>
            <Button onClick={handleSaveTaxRate} disabled={isSaving}>
              {isSaving ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Save Tax Rate
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
      
      {/* Current Year Tax Position */}
      <Card>
        <CardHeader>
          <CardTitle>{taxData?.taxYear || new Date().getFullYear()} Tax Position</CardTitle>
          <CardDescription>
            Your realized gains/losses and ordinary income for the current tax year
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
          <div className="space-y-6">
            {/* Capital Gains Section */}
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-3">Capital Gains/Losses</h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-green-500" />
                    <p className="text-sm text-muted-foreground">Realized Gains</p>
                  </div>
                  <p className="text-2xl font-bold text-green-500">
                    +${realizedGains.toLocaleString()}
                  </p>
                </div>
                
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <TrendingDown className="h-4 w-4 text-red-500" />
                    <p className="text-sm text-muted-foreground">Realized Losses</p>
                  </div>
                  <p className="text-2xl font-bold text-red-500">
                    ${realizedLosses.toLocaleString()}
                  </p>
                </div>
                
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <DollarSign className="h-4 w-4 text-blue-500" />
                    <p className="text-sm text-muted-foreground">Net Capital Gain</p>
                  </div>
                  <p className={`text-2xl font-bold ${netCapitalGain >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                    {netCapitalGain >= 0 ? '+' : ''}${netCapitalGain.toLocaleString()}
                  </p>
                </div>
                
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                    <p className="text-sm text-muted-foreground">Capital Gains Tax</p>
                  </div>
                  <p className="text-2xl font-bold text-amber-500">
                    ${estimatedTaxOwed.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    At {taxRate}% tax rate
                  </p>
                </div>
              </div>
            </div>
            
            {/* Ordinary Income Section */}
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-3">Ordinary Income (Options Premium)</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <DollarSign className="h-4 w-4 text-purple-500" />
                    <p className="text-sm text-muted-foreground">Options Premium Collected</p>
                  </div>
                  <p className="text-2xl font-bold text-purple-500">
                    ${ordinaryIncome.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Taxed as ordinary income
                  </p>
                </div>
                
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-orange-500" />
                    <p className="text-sm text-muted-foreground">Ordinary Income Tax</p>
                  </div>
                  <p className="text-2xl font-bold text-orange-500">
                    ${ordinaryIncomeTax.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    At {taxRate}% tax rate
                  </p>
                </div>
                
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-red-500" />
                    <p className="text-sm text-muted-foreground">Total Tax Liability</p>
                  </div>
                  <p className="text-2xl font-bold text-red-500">
                    ${totalTaxLiability.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Capital gains + ordinary income
                  </p>
                </div>
              </div>
            </div>
          </div>
          )}
        </CardContent>
      </Card>
      
      {/* Harvestable Losses */}
      <Card>
        <CardHeader>
          <CardTitle>Unrealized Losses (Available to Harvest)</CardTitle>
          <CardDescription>
            Stock positions with unrealized losses that can offset capital gains
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Summary */}
            <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
              <div>
                <p className="text-sm text-muted-foreground">Total Harvestable Losses</p>
                <p className="text-2xl font-bold text-red-500">
                  ${totalHarvestable.toLocaleString()}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm text-muted-foreground">Potential Tax Savings</p>
                <p className="text-2xl font-bold text-green-500">
                  ${potentialTaxSavings.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </p>
                <p className="text-xs text-muted-foreground">
                  At {taxRate}% tax rate
                </p>
              </div>
            </div>
            
            {/* Positions Table */}
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left p-3 text-sm font-medium">Symbol</th>
                    <th className="text-right p-3 text-sm font-medium">Quantity</th>
                    <th className="text-right p-3 text-sm font-medium">Cost Basis</th>
                    <th className="text-right p-3 text-sm font-medium">Current Price</th>
                    <th className="text-right p-3 text-sm font-medium">Unrealized Loss</th>
                    <th className="text-right p-3 text-sm font-medium">Tax Savings</th>
                    <th className="text-center p-3 text-sm font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {harvestablePositions.map((position, index) => (
                    <tr key={index} className="border-t hover:bg-muted/30">
                      <td className="p-3">
                        <Badge variant="outline" className="font-mono">
                          {position.symbol}
                        </Badge>
                      </td>
                      <td className="text-right p-3">{position.quantity}</td>
                      <td className="text-right p-3">${position.costBasis.toFixed(2)}</td>
                      <td className="text-right p-3">${position.currentPrice.toFixed(2)}</td>
                      <td className="text-right p-3 text-red-500 font-medium">
                        ${position.unrealizedPL.toLocaleString()}
                      </td>
                      <td className="text-right p-3 text-green-500 font-medium">
                        ${(Math.abs(position.unrealizedPL) * (taxRate / 100)).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </td>
                      <td className="text-center p-3">
                        <Button size="sm" variant="outline">
                          Harvest
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </CardContent>
      </Card>
      
      {/* Wash Sale Warnings */}
      {taxData && taxData.washSaleViolations && taxData.washSaleViolations.length > 0 && (
        <Card className="border-red-500/50">
          <CardHeader>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              <CardTitle className="text-red-500">Wash Sale Violations Detected</CardTitle>
            </div>
            <CardDescription>
              IRS wash sale rule: Losses are disallowed if you repurchase the same security within 30 days before or after the sale
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* Summary */}
              <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Total Disallowed Losses</p>
                    <p className="text-2xl font-bold text-red-500">
                      ${taxData.totalDisallowedLoss?.toLocaleString(undefined, { maximumFractionDigits: 0 }) || 0}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Violations</p>
                    <p className="text-2xl font-bold text-red-500">
                      {taxData.washSaleViolations.length}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Lost Tax Savings</p>
                    <p className="text-2xl font-bold text-red-500">
                      ${((taxData.totalDisallowedLoss || 0) * (taxRate / 100)).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </p>
                  </div>
                </div>
              </div>
              
              {/* Violations Table */}
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left p-3 font-medium">Symbol</th>
                      <th className="text-left p-3 font-medium">Sale Date</th>
                      <th className="text-left p-3 font-medium">Repurchase Date</th>
                      <th className="text-right p-3 font-medium">Disallowed Loss</th>
                      <th className="text-right p-3 font-medium">Lost Tax Savings</th>
                      <th className="text-left p-3 font-medium">Account</th>
                    </tr>
                  </thead>
                  <tbody>
                    {taxData.washSaleViolations.map((ws, idx) => (
                      <tr key={idx} className="border-t hover:bg-muted/30">
                        <td className="p-3 font-medium">{ws.symbol}</td>
                        <td className="p-3 text-sm">{new Date(ws.saleDate).toLocaleDateString()}</td>
                        <td className="p-3 text-sm">{new Date(ws.repurchaseDate).toLocaleDateString()}</td>
                        <td className="text-right p-3 text-red-500 font-medium">
                          ${ws.disallowedLoss.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </td>
                        <td className="text-right p-3 text-red-500 font-medium">
                          ${(ws.disallowedLoss * (taxRate / 100)).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </td>
                        <td className="p-3 text-sm text-muted-foreground">{ws.accountNumber}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              
              {/* Guidance */}
              <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-amber-500">How to Avoid Wash Sales</p>
                    <ul className="text-sm text-muted-foreground mt-2 space-y-1 list-disc list-inside">
                      <li>Wait 31 days after selling before repurchasing the same security</li>
                      <li>Consider purchasing a similar (but not substantially identical) security instead</li>
                      <li>Track your trades carefully to avoid accidental violations</li>
                      <li>Disallowed losses are added to the cost basis of the repurchased shares (not permanently lost)</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
      
      {/* Strategic Recommendations */}
      <Card>
        <CardHeader>
          <CardTitle>Strategic Recommendations</CardTitle>
          <CardDescription>
            Recommendations for maximizing after-tax returns
          </CardDescription>
        </CardHeader>       <CardContent>
          <div className="space-y-3">
            <div className="flex items-start gap-3 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-green-500/20 flex items-center justify-center mt-0.5">
                <span className="text-green-500 text-sm">✓</span>
              </div>
              <div className="flex-1">
                <p className="font-medium">Harvest HOOD & HIMS losses before Dec 15</p>
                <p className="text-sm text-muted-foreground mt-1">
                  This creates ${Math.abs(totalHarvestable).toLocaleString()} tax loss buffer
                </p>
              </div>
            </div>
            
            <div className="flex items-start gap-3 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center mt-0.5">
                <span className="text-blue-500 text-sm">✓</span>
              </div>
              <div className="flex-1">
                <p className="font-medium">Deploy aggressive spreads up to ${Math.abs(totalHarvestable).toLocaleString()}</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Knowing losses will offset existing gains—trade more aggressively with tax protection
                </p>
              </div>
            </div>
            
            <div className="flex items-start gap-3 p-3 bg-purple-500/10 border border-purple-500/20 rounded-lg">
              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-purple-500/20 flex items-center justify-center mt-0.5">
                <span className="text-purple-500 text-sm">💡</span>
              </div>
              <div className="flex-1">
                <p className="font-medium">After-tax break-even analysis</p>
                <p className="text-sm text-muted-foreground mt-1">
                  If you harvest losses and deploy aggressive spreads that lose $2,000, your after-tax loss is only ${(2000 - (2000 * (taxRate / 100))).toLocaleString(undefined, { maximumFractionDigits: 0 })} (vs. $2,000 without harvesting)
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
      

    </div>
  );
}
