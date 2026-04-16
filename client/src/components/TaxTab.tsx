import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { trpc } from '@/lib/trpc';
import { DollarSign, TrendingDown, TrendingUp, AlertTriangle, Save, RefreshCw, FileDown } from 'lucide-react';
import { toast } from 'sonner';
import { useAccount } from '@/contexts/AccountContext';

export function TaxTab() {
  const { selectedAccountId } = useAccount();
  const [taxRate, setTaxRate] = useState(24);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [isExporting, setIsExporting] = useState(false);
  
  // PDF export mutation
  const exportPDFMutation = trpc.tax.generateTaxPDF.useMutation();
  
  const handleExportPDF = async () => {
    setIsExporting(true);
    try {
      const result = await exportPDFMutation.mutateAsync({
        accountNumber: selectedAccountId || undefined,
        year: selectedYear,
      });
      
      // Convert base64 to blob and trigger download
      const byteCharacters = atob(result.pdf);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'application/pdf' });
      
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = result.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      
      toast.success('PDF exported successfully');
    } catch (error) {
      console.error('PDF export error:', error);
      toast.error('Failed to export PDF');
    } finally {
      setIsExporting(false);
    }
  };
  
  // Generate year options (current year + 2 previous years)
  const currentYear = new Date().getFullYear();
  const yearOptions = [currentYear, currentYear - 1, currentYear - 2];
  
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
  const { data: taxData, isLoading, error: taxError, refetch } = trpc.tax.getTaxSummary.useQuery(
    { 
      accountNumber: selectedAccountId || undefined,
      year: selectedYear 
    },
    { 
      enabled: !!selectedAccountId || selectedAccountId === 'all',
      retry: false, // Don't retry on auth errors
    }
  );
  
  // Fetch tax verification data (cross-check with Tastytrade official data)
  const { data: verificationData, isLoading: isVerifying, error: verificationError, refetch: refetchVerification } = trpc.tax.getTaxVerification.useQuery(
    { 
      accountNumber: selectedAccountId || undefined,
      year: selectedYear 
    },
    { 
      enabled: !!selectedAccountId || selectedAccountId === 'all',
      retry: false, // Don't retry on auth errors
    }
  );
  
  // Portfolio sync state — for last-refreshed timestamp
  const { data: syncStateData, refetch: refetchSyncState } = trpc.portfolioSync.getSyncState.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const lastSyncAt: Date | null = (syncStateData?.states ?? []).reduce((latest: Date | null, s: any) => {
    const t = s.lastTransactionsSyncAt ? new Date(s.lastTransactionsSyncAt) : null;
    if (!t) return latest;
    return !latest || t > latest ? t : latest;
  }, null);

  // Portfolio sync mutation — wired to the "Refresh data" button
  const [isSyncing, setIsSyncing] = useState(false);
  const triggerSyncMutation = trpc.portfolioSync.triggerSync.useMutation();
  const handleRefreshData = async () => {
    setIsSyncing(true);
    try {
      await triggerSyncMutation.mutateAsync({ forceFullRefresh: false });
      // Wait a moment then re-fetch tax data and sync state
      setTimeout(async () => {
        await Promise.all([refetch(), refetchSyncState()]);
        setIsSyncing(false);
        toast.success('Tax data refreshed from latest portfolio sync');
      }, 2000);
    } catch (err: any) {
      setIsSyncing(false);
      toast.error(`Sync failed: ${err.message || 'Unknown error'}`);
    }
  };

  // Check if authentication error occurred
  const isAuthError = taxError?.message?.includes('token is invalid') || 
                      taxError?.message?.includes('expired') ||
                      taxError?.message?.includes('credentials not found');
  
  const hasError = !!taxError || !!verificationError;
  
  const realizedGains = taxData?.realizedGains || 0; // Stock sales gains
  const realizedLosses = taxData?.realizedLosses || 0; // Stock sales losses
  const netCapitalGain = taxData?.netCapitalGain || 0; // Net stock capital gain
  const ordinaryIncome = taxData?.ordinaryIncome || 0; // Total ordinary income (CSP/CC + spreads)
  const nakedOptionsIncome = taxData?.nakedOptionsIncome || 0; // Single-leg options (CSP/CC) premium
  const spreadIncome = taxData?.spreadIncome || 0; // Spread P/L (IC/BCS/BPS)
  const harvestablePositions = taxData?.harvestablePositions || [];
  const totalHarvestable = taxData?.totalHarvestable || 0;
  
  const estimatedTaxOwed = Math.max(0, netCapitalGain * (taxRate / 100));
  const ordinaryIncomeTax = ordinaryIncome * (taxRate / 100);
  const totalTaxLiability = estimatedTaxOwed + ordinaryIncomeTax;
  const potentialTaxSavings = Math.abs(totalHarvestable) * (taxRate / 100);
  
  return (
    <div className="space-y-6">
      {/* Tax Year & Rate Configuration */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>Tax Configuration</CardTitle>
              <CardDescription>
                Select tax year and configure your marginal tax rate for accurate calculations
              </CardDescription>
            </div>
            {lastSyncAt && (
              <div className="text-right shrink-0">
                <p className="text-xs text-muted-foreground">Data cached from portfolio sync</p>
                <p className="text-xs font-medium text-foreground mt-0.5">
                  Last synced: {lastSyncAt.toLocaleString()}
                </p>
                <button
                  onClick={handleRefreshData}
                  disabled={isSyncing}
                  className="text-xs text-blue-400 hover:text-blue-300 mt-0.5 flex items-center gap-1 ml-auto disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <RefreshCw className={`h-3 w-3 ${isSyncing ? 'animate-spin' : ''}`} />
                  {isSyncing ? 'Syncing…' : 'Refresh data'}
                </button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-4 flex-wrap">
            <div className="flex-1 max-w-xs space-y-2">
              <Label htmlFor="tax-year">Tax Year</Label>
              <select
                id="tax-year"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                value={selectedYear}
                onChange={(e) => setSelectedYear(parseInt(e.target.value))}
              >
                {yearOptions.map((year) => (
                  <option key={year} value={year}>
                    {year} {year === currentYear && '(Current)'}
                  </option>
                ))}
              </select>
            </div>
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
            <Button onClick={handleExportPDF} disabled={isExporting} variant="outline">
              {isExporting ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Generating PDF...
                </>
              ) : (
                <>
                  <FileDown className="h-4 w-4 mr-2" />
                  Export PDF Report
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
      
      {/* Authentication Error Alert */}
      {isAuthError && (
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <div className="flex items-start gap-4">
              <AlertTriangle className="h-5 w-5 text-destructive mt-0.5" />
              <div className="flex-1">
                <h3 className="font-semibold text-destructive mb-2">Authentication Required</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Your Tastytrade API token has expired. Please re-authenticate your account to view tax data.
                </p>
                <Button 
                  variant="default" 
                  size="sm"
                  onClick={() => window.location.href = '/settings'}
                >
                  Go to Settings to Re-authenticate
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
      
      {/* Current Year Tax Position */}
      <Card>
        <CardHeader>
          <CardTitle>{selectedYear} Tax Position</CardTitle>
          <CardDescription>
            Your realized gains/losses and ordinary income for tax year {selectedYear}
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
              <h3 className="text-sm font-medium text-muted-foreground mb-3">Capital Gains/Losses (Stock Sales Only)</h3>
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
              <h3 className="text-sm font-medium text-muted-foreground mb-3">Ordinary Income (Options + Spreads)</h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <DollarSign className="h-4 w-4 text-purple-500" />
                    <p className="text-sm text-muted-foreground">Single-Leg Options</p>
                  </div>
                  <p className="text-2xl font-bold text-purple-500">
                    ${nakedOptionsIncome.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    CSP & CC premium
                  </p>
                </div>
                
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <DollarSign className="h-4 w-4 text-blue-500" />
                    <p className="text-sm text-muted-foreground">Spreads (IC/BCS/BPS)</p>
                  </div>
                  <p className={`text-2xl font-bold ${spreadIncome >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                    {spreadIncome >= 0 ? '+' : ''}${spreadIncome.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Net spread P/L
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
      
      {/* Data Verification */}
      <Card>
        <CardHeader>
          <CardTitle>Data Verification</CardTitle>
          <CardDescription>
            Cross-check our calculations against Tastytrade official tax data
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isVerifying ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : verificationData?.dataAvailable ? (
            <div className="space-y-4">
              {/* Verification Status */}
              <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-green-500/20 flex items-center justify-center mt-0.5">
                    <span className="text-green-500 text-sm">✓</span>
                  </div>
                  <div>
                    <p className="font-medium text-green-500">Verification Complete</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Successfully cross-checked with Tastytrade official tax data
                    </p>
                  </div>
                </div>
              </div>
              
              {/* Comparison Table */}
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left p-3 font-medium">Metric</th>
                      <th className="text-right p-3 font-medium">Our Calculation</th>
                      <th className="text-right p-3 font-medium">Tastytrade Official</th>
                      <th className="text-right p-3 font-medium">Difference</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-t">
                      <td className="p-3">Realized P&L</td>
                      <td className="text-right p-3 font-medium">
                        {netCapitalGain >= 0 ? '+' : ''}${netCapitalGain.toLocaleString()}
                      </td>
                      <td className="text-right p-3 font-medium">
                        {verificationData.tastytradeRealizedPnL >= 0 ? '+' : ''}${verificationData.tastytradeRealizedPnL.toLocaleString()}
                      </td>
                      <td className="text-right p-3">
                        {Math.abs(netCapitalGain - verificationData.tastytradeRealizedPnL) < 1 ? (
                          <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/20">Match</Badge>
                        ) : (
                          <span className="text-amber-500">
                            ${Math.abs(netCapitalGain - verificationData.tastytradeRealizedPnL).toLocaleString()}
                          </span>
                        )}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              
              {/* Tax Lot Info */}
              {verificationData.taxLotData && verificationData.taxLotData.length > 0 && (
                <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                  <div className="flex items-start gap-3">
                    <DollarSign className="h-5 w-5 text-blue-500 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-blue-500">Tax Lot Data Available</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        Found {verificationData.taxLotData.length} positions with tax lot data for accurate cost basis verification
                      </p>
                    </div>
                  </div>
                </div>
              )}
              
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => refetchVerification()}
                className="w-full"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh Verification
              </Button>
            </div>
          ) : (
            <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-amber-500">Verification Data Unavailable</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Tastytrade official tax data not available for this account/year. Our calculations are based on transaction history.
                  </p>
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
      
      {/* Year-over-Year Comparison */}
      {selectedYear < currentYear && (
        <Card>
          <CardHeader>
            <CardTitle>Year-over-Year Comparison</CardTitle>
            <CardDescription>
              Compare tax efficiency across multiple years to track carryforward losses
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* Comparison Note */}
              <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                <div className="flex items-start gap-3">
                  <DollarSign className="h-5 w-5 text-blue-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-blue-500">Historical Tax Year Selected</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      You're viewing {selectedYear} tax data. Switch to {currentYear} to see current year position.
                    </p>
                  </div>
                </div>
              </div>
              
              {/* Carryforward Losses */}
              <div className="border rounded-lg p-4">
                <h3 className="font-medium mb-3">Capital Loss Carryforward Rules</h3>
                <div className="space-y-2 text-sm text-muted-foreground">
                  <p>• <strong>$3,000 annual limit:</strong> You can deduct up to $3,000 of net capital losses against ordinary income each year</p>
                  <p>• <strong>Unlimited carryforward:</strong> Losses exceeding $3,000 can be carried forward indefinitely to offset future capital gains</p>
                  <p>• <strong>Example:</strong> If you had $10,000 net loss in {selectedYear}, you could deduct $3,000 that year and carry forward $7,000 to future years</p>
                </div>
              </div>
              
              {/* Quick Comparison Table */}
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left p-3 font-medium">Metric</th>
                      <th className="text-right p-3 font-medium">{selectedYear}</th>
                      <th className="text-right p-3 font-medium">Change from Previous Year</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-t">
                      <td className="p-3">Net Capital Gain/Loss</td>
                      <td className="text-right p-3 font-medium">
                        {netCapitalGain >= 0 ? '+' : ''}${netCapitalGain.toLocaleString()}
                      </td>
                      <td className="text-right p-3 text-muted-foreground">—</td>
                    </tr>
                    <tr className="border-t">
                      <td className="p-3">Ordinary Income (Options)</td>
                      <td className="text-right p-3 font-medium">
                        +${ordinaryIncome.toLocaleString()}
                      </td>
                      <td className="text-right p-3 text-muted-foreground">—</td>
                    </tr>
                    <tr className="border-t">
                      <td className="p-3">Total Tax Liability</td>
                      <td className="text-right p-3 font-medium">
                        ${totalTaxLiability.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </td>
                      <td className="text-right p-3 text-muted-foreground">—</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              
              <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-amber-500">Multi-Year Comparison Coming Soon</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Full year-over-year trend analysis with carryforward loss tracking will be available in a future update.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

    </div>
  );
}
