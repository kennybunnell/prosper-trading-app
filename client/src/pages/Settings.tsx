import { useAuth } from "@/_core/hooks/useAuth";
import { ConnectionStatusIndicator } from "@/components/ConnectionStatusIndicator";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { Loader2, CheckCircle2, XCircle, AlertCircle, Trash2, Wand2, RefreshCw, Database, Send, BellRing } from "lucide-react";
import { useState, useEffect } from "react";
import TastytradeWizard from "@/components/TastytradeWizard";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export default function Settings() {
  const { user, loading: authLoading } = useAuth();
  const [tastytradeClientId, setTastytradeClientId] = useState("");
  const [tastytradeClientSecret, setTastytradeClientSecret] = useState("");
  const [tastytradeRefreshToken, setTastytradeRefreshToken] = useState("");
  const [tradierApiKey, setTradierApiKey] = useState("");
  const [tradierAccountId, setTradierAccountId] = useState("");
  const [defaultTastytradeAccountId, setDefaultTastytradeAccountId] = useState("");
  const [hasChanges, setHasChanges] = useState(false);
  const [credentialsSaved, setCredentialsSaved] = useState(false);
  const [lastConnectedAt, setLastConnectedAt] = useState<Date | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  
  // Background pattern state for real-time preview
  const [opacity, setOpacity] = useState(8);
  const [pattern, setPattern] = useState<'diagonal' | 'crosshatch' | 'dots' | 'woven' | 'none'>('diagonal');
  
  const { data: credentials, isLoading: loadingCredentials } = trpc.settings.getCredentials.useQuery(
    undefined,
    { enabled: !!user }
  );
  
  // Fetch background preferences
  const { data: backgroundPrefs } = trpc.settings.getBackgroundPreferences.useQuery();
  
  // Update local state when preferences load
  useEffect(() => {
    if (backgroundPrefs) {
      setOpacity(backgroundPrefs.opacity);
      setPattern(backgroundPrefs.pattern as any);
    }
  }, [backgroundPrefs]);

  const saveCredentials = trpc.settings.saveCredentials.useMutation({
    onSuccess: () => {
      toast.success("Credentials saved successfully");
      setHasChanges(false);
      setCredentialsSaved(true);
      // Do NOT invalidate getCredentials — that would re-fetch masked values
      // and overwrite what the user just typed.
    },
    onError: (error) => {
      toast.error(`Failed to save credentials: ${error.message}`);
    },
  });

  const testTastytrade = trpc.settings.testTastytradeConnection.useMutation({
    onSuccess: () => {
      const now = new Date();
      setLastConnectedAt(now);
      toast.success("Tastytrade connection successful! Syncing accounts...");
      // Auto-sync accounts after successful connection
      syncAccounts.mutate();
    },
    onError: (error) => {
      toast.error(`Tastytrade connection failed: ${error.message}`);
    },
  });

  const forceTokenRefresh = trpc.settings.forceTokenRefresh.useMutation({
    onSuccess: (data) => {
      const expiresAt = data.expiresAt ? new Date(data.expiresAt).toLocaleString() : 'Unknown';
      toast.success(`Token refreshed successfully! Expires at: ${expiresAt}`);
    },
    onError: (error) => {
      toast.error(`Token refresh failed: ${error.message}`);
    },
  });

  const testTradier = trpc.settings.testTradierConnection.useMutation({
    onSuccess: () => {
      toast.success("Tradier connection successful!");
    },
    onError: (error) => {
      toast.error(`Tradier connection failed: ${error.message}`);
    },
  });

  const connectionStatus = trpc.settings.getConnectionStatus.useQuery(
    undefined,
    { enabled: !!user, refetchInterval: 60000 } // Refetch every minute
  );

  const refreshTradierHealth = trpc.settings.refreshTradierHealth.useMutation({
    onSuccess: (data) => {
      if (data.warning) {
        toast.warning(`Balance: $${data.balance} (Below $100 threshold)`);
      } else {
        toast.success(`Balance: $${data.balance}`);
      }
      // Refresh connection status to update UI
      utils.settings.getConnectionStatus.invalidate();
    },
    onError: (error) => {
      toast.error(`Failed to fetch account health: ${error.message}`);
    },
  });

  const clearTastytradeCredentials = trpc.settings.clearTastytradeCredentials.useMutation({
    onSuccess: () => {
      // Clear local state so fields are blank and ready for new input
      setTastytradeClientId("");
      setTastytradeClientSecret("");
      setTastytradeRefreshToken("");
      setCredentialsSaved(false);
      setHasChanges(false);
      toast.success("Tastytrade credentials cleared. Enter your new credentials below.");
    },
    onError: (error) => {
      toast.error(`Failed to clear credentials: ${error.message}`);
    },
  });

  const syncAccounts = trpc.accounts.sync.useMutation({
    onSuccess: (data) => {
      const removedMsg = (data as any).removed > 0 ? ` (${(data as any).removed} removed)` : '';
      const skippedMsg = (data as any).skippedDemo > 0 ? ` — ${(data as any).skippedDemo} demo account(s) excluded` : '';
      toast.success(`Synced ${data.count} real account(s) from Tastytrade${removedMsg}${skippedMsg}`);
      utils.accounts.list.invalidate();
    },
    onError: (error) => {
      toast.error(`Failed to sync accounts: ${error.message}`);
    },
  });

  const removeAccount = trpc.accounts.remove.useMutation({
    onSuccess: () => {
      toast.success('Account removed successfully');
      utils.accounts.list.invalidate();
    },
    onError: (error) => {
      toast.error(`Failed to remove account: ${error.message}`);
    },
  });

  const { data: accounts = [] } = trpc.accounts.list.useQuery(
    undefined,
    { enabled: !!user }
  );

  const { data: userPreferences } = trpc.userPreferences.get.useQuery(
    undefined,
    { enabled: !!user }
  );

  const saveDefaultAccount = trpc.userPreferences.setDefaultAccount.useMutation({
    onSuccess: () => {
      toast.success("Default account saved successfully");
      utils.userPreferences.get.invalidate();
    },
    onError: (error) => {
      toast.error(`Failed to save default account: ${error.message}`);
    },
  });

  const utils = trpc.useUtils();

  // Tradier credentials are safe to pre-fill (they don't interfere with Tastytrade auth)
  useEffect(() => {
    if (credentials && !tradierApiKey && !tradierAccountId) {
      setTradierApiKey(credentials.tradierApiKey || "");
      setTradierAccountId(credentials.tradierAccountId || "");
    }
  }, [credentials]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (userPreferences) {
      setDefaultTastytradeAccountId(userPreferences.defaultTastytradeAccountId || "");
      // NOTE: Do NOT reset hasChanges here — userPreferences loading fires after
      // the user may have already typed new credentials, which would incorrectly
      // disable the Save button.
    }
  }, [userPreferences]);

  const validateCredentials = (): boolean => {
    // Simple validation — fields are always plain text, no masking logic needed
    if (tastytradeClientSecret && tastytradeClientSecret.length < 20) {
      toast.error('Client Secret must be at least 20 characters.');
      return false;
    }
    if (tastytradeRefreshToken && !tastytradeRefreshToken.startsWith('eyJ')) {
      toast.error("Refresh Token must start with 'eyJ' (JWT format). Check that you copied the full token.");
      return false;
    }
    return true;
  };

  const handleSave = () => {
    if (!validateCredentials()) return;
    // Fields are always plain text — send whatever is in them
    saveCredentials.mutate({
      tastytradeClientId: tastytradeClientId || undefined,
      tastytradeClientSecret: tastytradeClientSecret || undefined,
      tastytradeRefreshToken: tastytradeRefreshToken || undefined,
      tradierApiKey: tradierApiKey || undefined,
      tradierAccountId: tradierAccountId || undefined,
      defaultTastytradeAccountId: defaultTastytradeAccountId || undefined,
    });
  };

  const handleInputChange = () => {
    console.log('[Settings] Input changed, setting hasChanges to true');
    setHasChanges(true);
  };
  
  // Generate CSS pattern based on user's selection
  const getPatternCSS = (p: string) => {
    switch (p) {
      case 'diagonal':
        return `repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(255, 255, 255, 0.03) 10px, rgba(255, 255, 255, 0.03) 20px)`;
      case 'crosshatch':
        return `repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(255, 255, 255, 0.03) 10px, rgba(255, 255, 255, 0.03) 20px), repeating-linear-gradient(-45deg, transparent, transparent 10px, rgba(255, 255, 255, 0.03) 10px, rgba(255, 255, 255, 0.03) 20px)`;
      case 'dots':
        return `radial-gradient(circle, rgba(255, 255, 255, 0.05) 1px, transparent 1px)`;
      case 'woven':
        return `repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255, 255, 255, 0.02) 2px, rgba(255, 255, 255, 0.02) 4px), repeating-linear-gradient(90deg, transparent, transparent 2px, rgba(255, 255, 255, 0.02) 2px, rgba(255, 255, 255, 0.02) 4px)`;
      default:
        return 'none';
    }
  };

  if (authLoading || loadingCredentials) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Authentication Required</CardTitle>
            <CardDescription>Please log in to access settings</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-8 relative">
      {/* Background texture pattern - uses local state for instant feedback */}
      {pattern !== 'none' && (
        <div 
          className="absolute inset-0 pointer-events-none" 
          style={{
            backgroundImage: getPatternCSS(pattern),
            backgroundSize: pattern === 'dots' ? '20px 20px' : 'auto',
            opacity: opacity / 100
          }}
        />
      )}
      <div className="max-w-4xl mx-auto space-y-8 relative z-10">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
            <p className="text-muted-foreground mt-2">
              Configure your API credentials for Tastytrade and Tradier
            </p>
          </div>
          <ConnectionStatusIndicator />
        </div>

        {/* Tastytrade Credentials */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Tastytrade API (OAuth2)
              {(credentialsSaved || (tastytradeClientSecret && tastytradeRefreshToken)) && (
                <CheckCircle2 className="h-5 w-5 text-green-500" />
              )}
            </CardTitle>
            <CardDescription>
              Used for order execution and account management. Create an OAuth2 app at{" "}
              <a
                href="https://my.tastytrade.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                my.tastytrade.com
              </a>
              {" "}→ My Profile → API → OAuth Applications
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Setup Wizard Banner */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-blue-500/10 border border-blue-500/30">
              <div>
                <p className="text-sm font-medium text-blue-400">First time or having trouble? Use the Setup Wizard</p>
                <p className="text-xs text-muted-foreground">Step-by-step guide with exact Tastytrade instructions — takes 3 minutes</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 border-blue-500/50 text-blue-400 hover:bg-blue-500/10 shrink-0 ml-4"
                onClick={() => setWizardOpen(true)}
              >
                <Wand2 className="h-3.5 w-3.5" />
                Setup Wizard
              </Button>
            </div>
            <div className="space-y-2">
              <Label htmlFor="tastytrade-client-id">Client ID</Label>
              <Input
                id="tastytrade-client-id"
                type="text"
                value={tastytradeClientId}
                onChange={(e) => {
                  setTastytradeClientId(e.target.value);
                  handleInputChange();
                }}
                placeholder="Paste your Tastytrade Client ID"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tastytrade-client-secret">Client Secret</Label>
              <Input
                id="tastytrade-client-secret"
                type="text"
                value={tastytradeClientSecret}
                onChange={(e) => {
                  setTastytradeClientSecret(e.target.value);
                  handleInputChange();
                }}
                placeholder="Paste your Tastytrade Client Secret"
                autoComplete="off"
                spellCheck={false}
              />
              {tastytradeClientSecret && tastytradeClientSecret.length < 20 && (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <XCircle className="h-3.5 w-3.5 shrink-0" />
                  Client Secret must be at least 20 characters.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="tastytrade-refresh-token">Refresh Token</Label>
              <Input
                id="tastytrade-refresh-token"
                type="text"
                value={tastytradeRefreshToken}
                onChange={(e) => {
                  setTastytradeRefreshToken(e.target.value);
                  handleInputChange();
                }}
                placeholder="Paste your Tastytrade Refresh Token (starts with eyJ...)"
                autoComplete="off"
                spellCheck={false}
              />
              {tastytradeRefreshToken && !tastytradeRefreshToken.startsWith('eyJ') ? (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <XCircle className="h-3.5 w-3.5 shrink-0" />
                  Refresh Token must start with 'eyJ' (JWT format). Check that you copied the full token.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Generate a personal grant in your OAuth app with <strong>all scopes selected</strong> (read, trade, openid) to get the refresh token
                </p>
              )}
            </div>
            <div className="flex gap-2 flex-wrap items-center">
              <div className="flex flex-col gap-1">
                <Button
                  variant="outline"
                  onClick={() => testTastytrade.mutate()}
                  disabled={!tastytradeClientSecret || !tastytradeRefreshToken || testTastytrade.isPending || syncAccounts.isPending || hasChanges}
                >
                  {(testTastytrade.isPending || syncAccounts.isPending) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {testTastytrade.isPending ? 'Testing...' : syncAccounts.isPending ? 'Syncing...' : 'Test Connection'}
                </Button>
                {lastConnectedAt && (
                  <span className="text-xs text-green-500 flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" />
                    Last connected {lastConnectedAt.toLocaleString()}
                  </span>
                )}
              </div>
              <Button
                onClick={() => forceTokenRefresh.mutate()}
                disabled={!tastytradeClientSecret || !tastytradeRefreshToken || forceTokenRefresh.isPending || hasChanges}
                className="bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white border-0"
              >
                {forceTokenRefresh.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Reconnect Tastytrade
              </Button>
              <Button
                variant="outline"
                onClick={() => syncAccounts.mutate()}
                disabled={!tastytradeClientSecret || !tastytradeRefreshToken || syncAccounts.isPending || hasChanges}
              >
                {syncAccounts.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Sync Accounts
              </Button>
              <Button
                variant="outline"
                className="text-destructive hover:text-destructive border-destructive/40 hover:bg-destructive/10"
                onClick={() => {
                  if (confirm('This will permanently clear all saved Tastytrade credentials for your account. You will need to re-enter them. Continue?')) {
                    clearTastytradeCredentials.mutate();
                  }
                }}
                disabled={clearTastytradeCredentials.isPending}
              >
                {clearTastytradeCredentials.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Clear All Credentials
              </Button>
            </div>
            {accounts.length > 0 && (
              <div className="space-y-2">
                <Label>Connected Accounts</Label>
                <div className="space-y-1">
                  {accounts.map((account: any) => (
                    <div key={account.accountId} className="flex items-center justify-between px-3 py-2 rounded-md bg-muted/40 text-sm">
                      <span className="font-medium">{account.nickname || account.accountNumber}</span>
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <span>{account.accountType}</span>
                        <span className="text-xs opacity-60">{account.accountNumber}</span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => removeAccount.mutate({ accountId: account.accountId })}
                          disabled={removeAccount.isPending}
                          title="Remove account"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {accounts.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="default-account">Default Account</Label>
                <Select
                  value={defaultTastytradeAccountId}
                  onValueChange={(value) => {
                    setDefaultTastytradeAccountId(value);
                    handleInputChange();
                  }}
                >
                  <SelectTrigger id="default-account">
                    <SelectValue placeholder="Select default account" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((account: any) => (
                      <SelectItem key={account.accountId} value={account.accountId}>
                        {account.nickname || account.accountNumber} ({account.accountType})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  This account will be pre-selected when submitting orders
                </p>
              </div>
            )}
            {/* Save button — always visible */}
            <div className="flex items-center gap-3 pt-1">
              <Button
                onClick={handleSave}
                disabled={saveCredentials.isPending || (!tastytradeClientId && !tastytradeClientSecret && !tastytradeRefreshToken)}
                className="bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white border-0"
              >
                {saveCredentials.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Tastytrade Credentials
              </Button>
              {hasChanges && (
                <span className="text-xs text-amber-500 flex items-center gap-1">
                  <AlertCircle className="h-3.5 w-3.5" />
                  Unsaved changes — save before testing
                </span>
              )}
              {!hasChanges && credentialsSaved && (
                <span className="text-xs text-green-500 flex items-center gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Credentials saved
                </span>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Tradier Credentials */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Tradier API
              {credentials?.tradierApiKey && (
                <CheckCircle2 className="h-5 w-5 text-green-500" />
              )}
            </CardTitle>
            <CardDescription>
              Used for market data, option chains, and Greeks. Get your API key from{" "}
              <a
                href="https://developer.tradier.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                developer.tradier.com
              </a>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="tradier-api-key">API Key</Label>
              <Input
                id="tradier-api-key"
                type="password"
                value={tradierApiKey}
                onChange={(e) => {
                  setTradierApiKey(e.target.value);
                  handleInputChange();
                }}
                placeholder="Enter your Tradier API Key"
              />
              {tradierApiKey.startsWith('••••') && (
                <p className="text-xs text-muted-foreground">
                  🔒 Existing credential is masked for security. Enter a new value to update.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="tradier-account-id">Account ID</Label>
              <Input
                id="tradier-account-id"
                type="text"
                value={tradierAccountId}
                onChange={(e) => {
                  setTradierAccountId(e.target.value);
                  handleInputChange();
                }}
                placeholder="6YB60394"
              />
              <p className="text-xs text-muted-foreground">
                Used to check account balance and avoid rate limits
              </p>
            </div>
            {/* Account Health Display */}
            {connectionStatus.data?.tradier?.health && (
              <div className="border rounded-lg p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-medium">Account Health</h4>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => refreshTradierHealth.mutate()}
                    disabled={refreshTradierHealth.isPending}
                  >
                    {refreshTradierHealth.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      "Refresh"
                    )}
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Balance</p>
                    <p className={`font-medium ${connectionStatus.data.tradier.health.warning ? 'text-amber-500' : 'text-green-500'}`}>
                      ${parseFloat(connectionStatus.data.tradier.health.balance).toFixed(2)}
                      {connectionStatus.data.tradier.health.warning && (
                        <span className="ml-2 text-xs">⚠️ Low</span>
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Buying Power</p>
                    <p className="font-medium">
                      ${connectionStatus.data.tradier.health.buyingPower ? parseFloat(connectionStatus.data.tradier.health.buyingPower).toFixed(2) : '0.00'}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Status</p>
                    <p className="font-medium capitalize">{connectionStatus.data.tradier.health.status}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Last Checked</p>
                    <p className="text-xs">
                      {connectionStatus.data.tradier.health.lastChecked
                        ? new Date(connectionStatus.data.tradier.health.lastChecked).toLocaleString()
                        : 'Never'}
                    </p>
                  </div>
                </div>
                {connectionStatus.data.tradier.health.warning && (
                  <p className="text-xs text-amber-600 dark:text-amber-500 mt-2">
                    ⚠️ Balance below $100. Tradier API access may be affected.
                  </p>
                )}
              </div>
            )}
            
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => testTradier.mutate()}
                disabled={!credentials?.tradierApiKey || testTradier.isPending || hasChanges}
              >
                {testTradier.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Test Connection
              </Button>
              {credentials?.tradierApiKey && credentials?.tradierAccountId && (
                <Button
                  variant="outline"
                  onClick={() => refreshTradierHealth.mutate()}
                  disabled={refreshTradierHealth.isPending}
                >
                  {refreshTradierHealth.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Check Balance
                </Button>
              )}
            </div>
            {/* Inline Save button for Tradier */}
            {(tradierApiKey || tradierAccountId) && (
              <div className="flex items-center gap-3 pt-1">
                <Button
                  onClick={handleSave}
                  disabled={!hasChanges || saveCredentials.isPending}
                  className="bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white border-0"
                >
                  {saveCredentials.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save Tradier Credentials
                </Button>
                {hasChanges && (
                  <span className="text-xs text-amber-500 flex items-center gap-1">
                    <AlertCircle className="h-3.5 w-3.5" />
                    Unsaved changes — save before testing
                  </span>
                )}
                {!hasChanges && credentials?.tradierApiKey && (
                  <span className="text-xs text-green-500 flex items-center gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Credentials saved
                  </span>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Save Button */}
        <div className="flex justify-end gap-2">
          {hasChanges && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground mr-4">
              <AlertCircle className="h-4 w-4" />
              Unsaved changes
            </div>
          )}
          <Button
            onClick={handleSave}
            disabled={!hasChanges || saveCredentials.isPending}
            size="lg"
          >
            {saveCredentials.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Credentials
          </Button>
        </div>

        {/* Default Trading Account */}
        <Card>
          <CardHeader>
            <CardTitle>Default Trading Account</CardTitle>
            <CardDescription>
              Select your default Tastytrade account for trading operations
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="defaultAccount">Default Account</Label>
                <Select
                  value={defaultTastytradeAccountId}
                  onValueChange={(value) => {
                    setDefaultTastytradeAccountId(value);
                    saveDefaultAccount.mutate({ accountId: value });
                  }}
                >
                  <SelectTrigger id="defaultAccount">
                    <SelectValue placeholder="Select default account" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((account: any) => (
                      <SelectItem key={account.accountId} value={account.accountId}>
                        {account.nickname || account.accountNumber} ({account.accountType})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  This account will be automatically selected when you open the CSP Dashboard
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Info Card */}
        <Card className="border-blue-500/50 bg-blue-500/5">
          <CardHeader>
            <CardTitle className="text-base">Security Note</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Your API credentials are encrypted and stored securely in the database. They are never
            exposed to the frontend and are only used by the backend for API calls. You can update
            or remove them at any time.
          </CardContent>
        </Card>

        {/* Telegram Notifications */}
        <TelegramTestCard />

        {/* Portfolio Data Cache */}
        <PortfolioSyncCard />

        {/* Background Texture */}
        <BackgroundTextureSection 
          opacity={opacity}
          pattern={pattern}
          setOpacity={setOpacity}
          setPattern={setPattern}
          getPatternCSS={getPatternCSS}
        />

        {/* CSP Filter Presets */}
        <FilterPresetsSection />
      </div>

      {/* Tastytrade Setup Wizard */}
      <TastytradeWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onSuccess={() => {
          setCredentialsSaved(true);
          setLastConnectedAt(new Date());
          utils.accounts.list.invalidate();
        }}
      />
    </div>
  );
}

interface BackgroundTextureSectionProps {
  opacity: number;
  pattern: 'diagonal' | 'crosshatch' | 'dots' | 'woven' | 'none';
  setOpacity: (value: number) => void;
  setPattern: (value: 'diagonal' | 'crosshatch' | 'dots' | 'woven' | 'none') => void;
  getPatternCSS: (p: string) => string;
}

function BackgroundTextureSection({ opacity, pattern, setOpacity, setPattern, getPatternCSS }: BackgroundTextureSectionProps) {
  const utils = trpc.useUtils();
  
  const setBackgroundOpacity = trpc.settings.setBackgroundOpacity.useMutation({
    onSuccess: () => {
      toast.success("Background opacity updated");
      utils.settings.getBackgroundPreferences.invalidate();
    },
    onError: (error: any) => {
      toast.error(`Failed to update opacity: ${error.message}`);
    },
  });
  
  const setBackgroundPattern = trpc.settings.setBackgroundPattern.useMutation({
    onSuccess: () => {
      toast.success("Background pattern updated");
      utils.settings.getBackgroundPreferences.invalidate();
    },
    onError: (error: any) => {
      toast.error(`Failed to update pattern: ${error.message}`);
    },
  });

  const handleOpacityChange = (value: number) => {
    setOpacity(value);
    setBackgroundOpacity.mutate({ opacity: value });
  };
  
  const handlePatternChange = (newPattern: 'diagonal' | 'crosshatch' | 'dots' | 'woven' | 'none') => {
    setPattern(newPattern);
    setBackgroundPattern.mutate({ pattern: newPattern });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
        <CardDescription>
          Customize the visual appearance of your dashboard
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Pattern Selector */}
        <div className="space-y-3">
          <Label>Background Pattern</Label>
          <div className="grid grid-cols-5 gap-2">
            {(['diagonal', 'crosshatch', 'dots', 'woven', 'none'] as const).map((p) => (
              <button
                key={p}
                onClick={() => handlePatternChange(p)}
                className={cn(
                  "relative h-20 rounded-lg border-2 transition-all overflow-hidden",
                  pattern === p
                    ? "border-amber-500 ring-2 ring-amber-500/50"
                    : "border-border hover:border-amber-500/50"
                )}
              >
                <div 
                  className="absolute inset-0 bg-slate-900"
                  style={{
                    backgroundImage: p !== 'none' ? getPatternCSS(p) : 'none',
                    backgroundSize: p === 'dots' ? '20px 20px' : 'auto',
                    opacity: 0.5
                  }}
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-xs font-medium capitalize bg-black/50 px-2 py-1 rounded">
                    {p}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
        
        {/* Opacity Slider */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label htmlFor="background-opacity">Pattern Opacity</Label>
            <span className="text-sm font-medium text-muted-foreground">{opacity}%</span>
          </div>
          <input
            id="background-opacity"
            type="range"
            min="0"
            max="100"
            step="1"
            value={opacity}
            onChange={(e) => handleOpacityChange(parseInt(e.target.value))}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700 accent-amber-500"
          />
          <p className="text-xs text-muted-foreground">
            Adjust the visibility of the background texture. Higher values make the pattern more visible.
          </p>
          
          {/* Preview area */}
          <div className="relative h-24 rounded-lg overflow-hidden border border-border bg-slate-900">
            {pattern !== 'none' && (
              <div 
                className="absolute inset-0"
                style={{
                  backgroundImage: getPatternCSS(pattern),
                  backgroundSize: pattern === 'dots' ? '20px 20px' : 'auto',
                  opacity: opacity / 100,
                }}
              />
            )}
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-sm font-medium text-white drop-shadow-lg bg-black/30 px-3 py-1 rounded">
                Preview at {opacity}%
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function FilterPresetsSection() {
  return (
    <>
      <StrategyFilterPresetsSection strategy="csp" title="Cash-Secured Puts (CSP) Filter Presets" />
      <StrategyFilterPresetsSection strategy="bps" title="Bull Put Spreads (BPS) Filter Presets" />
      <StrategyFilterPresetsSection strategy="cc" title="Covered Calls (CC) Filter Presets" />
      <StrategyFilterPresetsSection strategy="bcs" title="Bear Call Spreads (BCS) Filter Presets" />
      <StrategyFilterPresetsSection strategy="pmcc" title="Poor Man's Covered Calls (PMCC) Filter Presets" />
    </>
  );
}

function StrategyFilterPresetsSection({ strategy, title }: { strategy: 'csp' | 'cc' | 'pmcc' | 'bps' | 'bcs', title: string }) {
  const { data: presets, isLoading } = trpc.filterPresets.getByStrategy.useQuery({ strategy });
  const [isLoadingAll, setIsLoadingAll] = useState(false);
  const updatePreset = trpc.filterPresets.update.useMutation({
    onSuccess: () => {
      toast.success("Filter preset updated successfully");
      utils.filterPresets.getByStrategy.invalidate({ strategy });
    },
    onError: (error) => {
      toast.error(`Failed to update preset: ${error.message}`);
    },
  });
  const utils = trpc.useUtils();

  const handleLoadAllRecommended = async () => {
    setIsLoadingAll(true);
    try {
      const presetNames: Array<'conservative' | 'medium' | 'aggressive'> = ['conservative', 'medium', 'aggressive'];
      
      // Load recommended values for all three presets
      for (const presetName of presetNames) {
        const recommended = await utils.client.filterPresets.getRecommendedValues.query({
          strategy,
          presetName,
        });
        
        // Update each preset with recommended values
        await updatePreset.mutateAsync({
          strategy,
          presetName,
          ...recommended,
        });
      }
      
      toast.success(`Loaded recommended values for all ${strategy.toUpperCase()} presets`);
    } catch (error: any) {
      toast.error(`Failed to load recommended values: ${error.message}`);
    } finally {
      setIsLoadingAll(false);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>Loading presets...</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const conservative = presets?.find(p => p.presetName === 'conservative');
  const medium = presets?.find(p => p.presetName === 'medium');
  const aggressive = presets?.find(p => p.presetName === 'aggressive');

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="space-y-1.5">
            <CardTitle>{title}</CardTitle>
            <CardDescription>
              Configure the filter criteria for Conservative, Medium, and Aggressive presets. Each strategy has different recommended values based on optimal technical indicators.
            </CardDescription>
          </div>
          <Button
            onClick={handleLoadAllRecommended}
            disabled={isLoadingAll || updatePreset.isPending}
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold shrink-0 shadow-md"
          >
            {isLoadingAll && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Load All Recommended Values
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {conservative && (
          <PresetEditor
            preset={conservative}
            strategy={strategy}
            label="🟢 Conservative"
            onSave={(updates) => updatePreset.mutate({ strategy, presetName: 'conservative', ...updates })}
            isPending={updatePreset.isPending}
          />
        )}
        {medium && (
          <PresetEditor
            preset={medium}
            strategy={strategy}
            label="🟡 Medium"
            onSave={(updates) => updatePreset.mutate({ strategy, presetName: 'medium', ...updates })}
            isPending={updatePreset.isPending}
          />
        )}
        {aggressive && (
          <PresetEditor
            preset={aggressive}
            strategy={strategy}
            label="🔴 Aggressive"
            onSave={(updates) => updatePreset.mutate({ strategy, presetName: 'aggressive', ...updates })}
            isPending={updatePreset.isPending}
          />
        )}
      </CardContent>
    </Card>
  );
}

function PresetEditor({
  preset,
  strategy,
  label,
  onSave,
  isPending,
}: {
  preset: any;
  strategy: 'csp' | 'cc' | 'pmcc' | 'bps' | 'bcs';
  label: string;
  onSave: (updates: any) => void;
  isPending: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [values, setValues] = useState({
    minDte: preset.minDte ?? 7,
    maxDte: preset.maxDte ?? 45,
    minDelta: preset.minDelta ?? "0.10",
    maxDelta: preset.maxDelta ?? "0.30",
    minOpenInterest: preset.minOpenInterest ?? 50,
    minVolume: preset.minVolume ?? 10,
    minRsi: preset.minRsi ?? 0,
    maxRsi: preset.maxRsi ?? 100,
    minIvRank: preset.minIvRank ?? 0,
    maxIvRank: preset.maxIvRank ?? 100,
    minBbPercent: preset.minBbPercent ?? "0",
    maxBbPercent: preset.maxBbPercent ?? "1.0",
    minScore: preset.minScore ?? 40,
    maxStrikePercent: preset.maxStrikePercent ?? "0.10",
  });

  const handleReset = () => {
    setValues({
      minDte: preset.minDte ?? 7,
      maxDte: preset.maxDte ?? 45,
      minDelta: preset.minDelta ?? "0.10",
      maxDelta: preset.maxDelta ?? "0.30",
      minOpenInterest: preset.minOpenInterest ?? 50,
      minVolume: preset.minVolume ?? 10,
      minRsi: preset.minRsi ?? 0,
      maxRsi: preset.maxRsi ?? 100,
      minIvRank: preset.minIvRank ?? 0,
      maxIvRank: preset.maxIvRank ?? 100,
      minBbPercent: preset.minBbPercent ?? "0",
      maxBbPercent: preset.maxBbPercent ?? "1.0",
      minScore: preset.minScore ?? 40,
      maxStrikePercent: preset.maxStrikePercent ?? "0.10",
    });
  };

  const handleSave = () => {
    onSave(values);
  };

  const loadRecommendedValues = trpc.filterPresets.getRecommendedValues.useQuery(
    { strategy, presetName: preset.presetName },
    { enabled: false }
  );

  const handleLoadRecommended = async () => {
    const recommended = await loadRecommendedValues.refetch();
    if (recommended.data) {
      setValues(recommended.data);
      toast.success("Loaded recommended values for " + label);
    }
  };

  return (
    <div className="space-y-4 border-l-4 border-l-border pl-4">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center justify-between text-left font-semibold hover:text-primary"
      >
        <span>{label}</span>
        <span className="text-muted-foreground">{isExpanded ? '▼' : '▶'}</span>
      </button>

      {isExpanded && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor={`${preset.presetName}-minDte`}>Min DTE</Label>
              <Input
                id={`${preset.presetName}-minDte`}
                type="number"
                value={values.minDte}
                onChange={(e) => setValues({ ...values, minDte: parseInt(e.target.value) || 0 })}
              />
            </div>
            <div>
              <Label htmlFor={`${preset.presetName}-maxDte`}>Max DTE</Label>
              <Input
                id={`${preset.presetName}-maxDte`}
                type="number"
                value={values.maxDte}
                onChange={(e) => setValues({ ...values, maxDte: parseInt(e.target.value) || 0 })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor={`${preset.presetName}-minDelta`}>Min Delta</Label>
              <Input
                id={`${preset.presetName}-minDelta`}
                type="text"
                value={values.minDelta}
                onChange={(e) => setValues({ ...values, minDelta: e.target.value })}
                placeholder="0.10"
              />
            </div>
            <div>
              <Label htmlFor={`${preset.presetName}-maxDelta`}>Max Delta</Label>
              <Input
                id={`${preset.presetName}-maxDelta`}
                type="text"
                value={values.maxDelta}
                onChange={(e) => setValues({ ...values, maxDelta: e.target.value })}
                placeholder="0.20"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor={`${preset.presetName}-minOI`}>Min Open Interest</Label>
              <Input
                id={`${preset.presetName}-minOI`}
                type="number"
                value={values.minOpenInterest}
                onChange={(e) => setValues({ ...values, minOpenInterest: parseInt(e.target.value) || 0 })}
              />
            </div>
            <div>
              <Label htmlFor={`${preset.presetName}-minVol`}>Min Volume</Label>
              <Input
                id={`${preset.presetName}-minVol`}
                type="number"
                value={values.minVolume}
                onChange={(e) => setValues({ ...values, minVolume: parseInt(e.target.value) || 0 })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor={`${preset.presetName}-minRsi`}>Min RSI</Label>
              <Input
                id={`${preset.presetName}-minRsi`}
                type="number"
                value={values.minRsi}
                onChange={(e) => setValues({ ...values, minRsi: parseInt(e.target.value) || 0 })}
              />
            </div>
            <div>
              <Label htmlFor={`${preset.presetName}-maxRsi`}>Max RSI</Label>
              <Input
                id={`${preset.presetName}-maxRsi`}
                type="number"
                value={values.maxRsi}
                onChange={(e) => setValues({ ...values, maxRsi: parseInt(e.target.value) || 0 })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor={`${preset.presetName}-minIvRank`}>Min IV Rank</Label>
              <Input
                id={`${preset.presetName}-minIvRank`}
                type="number"
                value={values.minIvRank}
                onChange={(e) => setValues({ ...values, minIvRank: parseInt(e.target.value) || 0 })}
              />
            </div>
            <div>
              <Label htmlFor={`${preset.presetName}-maxIvRank`}>Max IV Rank</Label>
              <Input
                id={`${preset.presetName}-maxIvRank`}
                type="number"
                value={values.maxIvRank}
                onChange={(e) => setValues({ ...values, maxIvRank: parseInt(e.target.value) || 0 })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor={`${preset.presetName}-minBb`}>Min BB %B</Label>
              <Input
                id={`${preset.presetName}-minBb`}
                type="text"
                value={values.minBbPercent}
                onChange={(e) => setValues({ ...values, minBbPercent: e.target.value })}
                placeholder="0"
              />
            </div>
            <div>
              <Label htmlFor={`${preset.presetName}-maxBb`}>Max BB %B</Label>
              <Input
                id={`${preset.presetName}-maxBb`}
                type="text"
                value={values.maxBbPercent}
                onChange={(e) => setValues({ ...values, maxBbPercent: e.target.value })}
                placeholder="1.0"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor={`${preset.presetName}-minScore`}>Min Score</Label>
              <Input
                id={`${preset.presetName}-minScore`}
                type="number"
                value={values.minScore}
                onChange={(e) => setValues({ ...values, minScore: parseInt(e.target.value) || 0 })}
              />
            </div>
            <div>
              <Label htmlFor={`${preset.presetName}-maxStrike`}>Max Strike % of Stock Price</Label>
              <Input
                id={`${preset.presetName}-maxStrike`}
                type="number"
                value={values.maxStrikePercent}
                onChange={(e) => setValues({ ...values, maxStrikePercent: e.target.value })}
                placeholder="150"
              />
            </div>
          </div>

          <div className="flex gap-2">
            <Button onClick={handleSave} disabled={isPending}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
            <Button onClick={handleReset} variant="outline" disabled={isPending}>
              Reset
            </Button>
            <Button 
              onClick={handleLoadRecommended} 
              variant="outline" 
              disabled={isPending || loadRecommendedValues.isFetching}
              className="bg-blue-500/10 hover:bg-blue-500/20 border-blue-500/50"
            >
              {loadRecommendedValues.isFetching && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Load Recommended Values
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Telegram Test Card ─────────────────────────────────────────────────────
function TelegramTestCard() {
  const testTelegram = trpc.system.testTelegram.useMutation({
    onSuccess: () => {
      toast.success('Test message sent! Check your Telegram bot.');
    },
    onError: (err: any) => {
      toast.error(`Telegram test failed: ${err.message}`);
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BellRing className="h-5 w-5 text-blue-400" />
          Telegram Notifications
        </CardTitle>
        <CardDescription>
          Receive order confirmations and a daily morning briefing (8:30 AM MT, weekdays)
          directly in your Telegram bot. Use the button below to verify connectivity.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md border border-muted bg-muted/20 p-3 space-y-1 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">What you'll receive:</p>
          <ul className="list-disc list-inside space-y-0.5">
            <li>✅ Order filled / ❌ Order rejected — for every CC, Roll, and CSP/BPS submission</li>
            <li>🌅 Daily briefing at 8:30 AM MT — open positions, expiring ≤7 DTE, P&L snapshot</li>
          </ul>
        </div>
        <Button
          onClick={() => testTelegram.mutate()}
          disabled={testTelegram.isPending}
          size="sm"
          className="gap-2 bg-blue-600 hover:bg-blue-700 text-white"
        >
          {testTelegram.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          {testTelegram.isPending ? 'Sending...' : 'Send Test Message'}
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Portfolio Sync Card ──────────────────────────────────────────────────────
function PortfolioSyncCard() {
  const utils = trpc.useUtils();

  const { data: syncData, isLoading: syncStateLoading } = trpc.portfolioSync.getSyncState.useQuery(undefined, {
    refetchInterval: 5000, // Poll every 5 seconds to show live sync progress
  });

  const triggerSync = trpc.portfolioSync.triggerSync.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      utils.portfolioSync.getSyncState.invalidate();
    },
    onError: (err: any) => {
      toast.error(`Sync failed: ${err.message}`);
    },
  });

  const fullRefresh = trpc.portfolioSync.triggerSync.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      utils.portfolioSync.getSyncState.invalidate();
    },
    onError: (err: any) => {
      toast.error(`Full refresh failed: ${err.message}`);
    },
  });

  const states = syncData?.states ?? [];
  const isSyncing = states.some((s) => s.syncStatus === 'syncing') || triggerSync.isPending || fullRefresh.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="h-5 w-5 text-emerald-500" />
          Portfolio Data Cache
        </CardTitle>
        <CardDescription>
          Positions and transaction history are cached locally for fast AI analysis.
          The cache syncs automatically on login and can be refreshed manually here.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {syncStateLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading sync status...
          </div>
        ) : states.length === 0 ? (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-600 dark:text-amber-400">
            No sync data found. Click "Sync Now" to populate the portfolio cache for the first time.
            This will fetch 3 years of transaction history.
          </div>
        ) : (
          <div className="space-y-3">
            {states.map((state) => (
              <div key={state.accountNumber} className="rounded-md border bg-muted/30 p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Account: {state.accountNumber}</span>
                  <span className={cn(
                    "text-xs px-2 py-0.5 rounded-full font-medium",
                    state.syncStatus === 'idle' && "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400",
                    state.syncStatus === 'syncing' && "bg-blue-500/20 text-blue-600 dark:text-blue-400",
                    state.syncStatus === 'error' && "bg-red-500/20 text-red-600 dark:text-red-400",
                  )}>
                    {state.syncStatus === 'syncing' ? (
                      <span className="flex items-center gap-1">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Syncing...
                      </span>
                    ) : state.syncStatus === 'idle' ? '✓ Up to date' : '⚠ Error'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <div>
                    <span className="font-medium">Transactions cached:</span>{' '}
                    {state.totalTransactionsCached?.toLocaleString() ?? 0}
                  </div>
                  <div>
                    <span className="font-medium">Last synced:</span>{' '}
                    {state.lastTransactionsSyncAt
                      ? new Date(state.lastTransactionsSyncAt).toLocaleString()
                      : 'Never'}
                  </div>
                  {state.lastTransactionDate && (
                    <div>
                      <span className="font-medium">Latest transaction:</span>{' '}
                      {state.lastTransactionDate}
                    </div>
                  )}
                  {state.lastSyncError && (
                    <div className="col-span-2 text-red-500">
                      Error: {state.lastSyncError}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <Button
            onClick={() => triggerSync.mutate({ forceFullRefresh: false })}
            disabled={isSyncing}
            size="sm"
            className="gap-2"
          >
            {isSyncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {isSyncing ? 'Syncing...' : 'Sync Now'}
          </Button>
          <Button
            onClick={() => fullRefresh.mutate({ forceFullRefresh: true })}
            disabled={isSyncing}
            size="sm"
            variant="outline"
            className="gap-2"
          >
            <Database className="h-4 w-4" />
            Full Refresh (3 years)
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          <strong>Sync Now</strong> fetches only new transactions since the last sync (fast).{' '}
          <strong>Full Refresh</strong> re-fetches all 3 years of history (takes 30–60 seconds on first run).
        </p>
      </CardContent>
    </Card>
  );
}
