import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { Loader2, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { useState, useEffect } from "react";
import { toast } from "sonner";

export default function Settings() {
  const { user, loading: authLoading } = useAuth();
  const [tastytradeUsername, setTastytradeUsername] = useState("");
  const [tastytradePassword, setTastytradePassword] = useState("");
  const [tradierApiKey, setTradierApiKey] = useState("");
  const [tradierAccountId, setTradierAccountId] = useState("");
  const [defaultTastytradeAccountId, setDefaultTastytradeAccountId] = useState("");
  const [hasChanges, setHasChanges] = useState(false);
  
  // Debug: Log hasChanges whenever it changes
  useEffect(() => {
    console.log('[Settings] hasChanges state updated to:', hasChanges);
  }, [hasChanges]);

  const { data: credentials, isLoading: loadingCredentials } = trpc.settings.getCredentials.useQuery(
    undefined,
    { enabled: !!user }
  );

  const saveCredentials = trpc.settings.saveCredentials.useMutation({
    onSuccess: () => {
      toast.success("Credentials saved successfully");
      setHasChanges(false);
      // Refresh credentials from database
      utils.settings.getCredentials.invalidate();
    },
    onError: (error) => {
      toast.error(`Failed to save credentials: ${error.message}`);
    },
  });

  const testTastytrade = trpc.settings.testTastytradeConnection.useMutation({
    onSuccess: () => {
      toast.success("Tastytrade connection successful!");
    },
    onError: (error) => {
      toast.error(`Tastytrade connection failed: ${error.message}`);
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

  const syncAccounts = trpc.accounts.sync.useMutation({
    onSuccess: (data) => {
      toast.success(`Synced ${data.count} account(s) from Tastytrade`);
      utils.accounts.list.invalidate();
    },
    onError: (error) => {
      toast.error(`Failed to sync accounts: ${error.message}`);
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

  useEffect(() => {
    if (credentials) {
      console.log('[Settings] Loading credentials from database:', credentials);
      setTastytradeUsername(credentials.tastytradeUsername || "");
      setTastytradePassword(credentials.tastytradePassword || "");
      setTradierApiKey(credentials.tradierApiKey || "");
      setTradierAccountId(credentials.tradierAccountId || "");
    }
  }, [credentials]);

  useEffect(() => {
    if (userPreferences) {
      setDefaultTastytradeAccountId(userPreferences.defaultTastytradeAccountId || "");
      // Reset hasChanges when credentials are loaded
      console.log('[Settings] Resetting hasChanges to false');
      setHasChanges(false);
    }
  }, [credentials]);

  const handleSave = () => {
    saveCredentials.mutate({
      tastytradeUsername: tastytradeUsername || undefined,
      tastytradePassword: tastytradePassword || undefined,
      tradierApiKey: tradierApiKey || undefined,
      tradierAccountId: tradierAccountId || undefined,
      defaultTastytradeAccountId: defaultTastytradeAccountId || undefined,
    });
  };

  const handleInputChange = () => {
    console.log('[Settings] Input changed, setting hasChanges to true');
    setHasChanges(true);
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
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
          <p className="text-muted-foreground mt-2">
            Configure your API credentials for Tastytrade and Tradier
          </p>
        </div>

        {/* Tastytrade Credentials */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Tastytrade API
              {credentials?.tastytradeUsername && credentials?.tastytradePassword && (
                <CheckCircle2 className="h-5 w-5 text-green-500" />
              )}
            </CardTitle>
            <CardDescription>
              Used for order execution and account management. Your credentials are stored securely.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="tastytrade-username">Username</Label>
              <Input
                id="tastytrade-username"
                type="text"
                value={tastytradeUsername}
                onChange={(e) => {
                  setTastytradeUsername(e.target.value);
                  handleInputChange();
                }}
                placeholder="your-username"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tastytrade-password">Password</Label>
              <Input
                id="tastytrade-password"
                type="password"
                value={tastytradePassword}
                onChange={(e) => {
                  setTastytradePassword(e.target.value);
                  handleInputChange();
                }}
                placeholder="••••••••"
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => testTastytrade.mutate()}
                disabled={!credentials?.tastytradeUsername || !credentials?.tastytradePassword || testTastytrade.isPending || hasChanges}
              >
                {testTastytrade.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Test Connection
              </Button>
              <Button
                variant="outline"
                onClick={() => syncAccounts.mutate()}
                disabled={!credentials?.tastytradeUsername || !credentials?.tastytradePassword || syncAccounts.isPending || hasChanges}
              >
                {syncAccounts.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Sync Accounts
              </Button>
            </div>
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
            {hasChanges && (
              <p className="text-xs text-muted-foreground mt-2">
                Save your credentials first before testing the connection
              </p>
            )}
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
                placeholder="your-api-key"
              />
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
            <Button
              variant="outline"
              onClick={() => testTradier.mutate()}
              disabled={!credentials?.tradierApiKey || testTradier.isPending || hasChanges}
            >
              {testTradier.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Test Connection
            </Button>
            {hasChanges && (
              <p className="text-xs text-muted-foreground mt-2">
                Save your credentials first before testing the connection
              </p>
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

        {/* CSP Filter Presets */}
        <FilterPresetsSection />
      </div>
    </div>
  );
}

function FilterPresetsSection() {
  const { data: presets, isLoading } = trpc.cspFilters.getPresets.useQuery();
  const updatePreset = trpc.cspFilters.updatePreset.useMutation({
    onSuccess: () => {
      toast.success("Filter preset updated successfully");
      utils.cspFilters.getPresets.invalidate();
    },
    onError: (error) => {
      toast.error(`Failed to update preset: ${error.message}`);
    },
  });
  const utils = trpc.useUtils();

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>CSP Filter Presets</CardTitle>
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
        <CardTitle>CSP Filter Presets</CardTitle>
        <CardDescription>
          Configure the filter criteria for Conservative, Medium, and Aggressive presets used in the CSP Dashboard
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {conservative && (
          <PresetEditor
            preset={conservative}
            label="🟢 Conservative"
            onSave={(updates) => updatePreset.mutate({ presetName: 'conservative', ...updates })}
            isPending={updatePreset.isPending}
          />
        )}
        {medium && (
          <PresetEditor
            preset={medium}
            label="🟡 Medium"
            onSave={(updates) => updatePreset.mutate({ presetName: 'medium', ...updates })}
            isPending={updatePreset.isPending}
          />
        )}
        {aggressive && (
          <PresetEditor
            preset={aggressive}
            label="🔴 Aggressive"
            onSave={(updates) => updatePreset.mutate({ presetName: 'aggressive', ...updates })}
            isPending={updatePreset.isPending}
          />
        )}
      </CardContent>
    </Card>
  );
}

function PresetEditor({
  preset,
  label,
  onSave,
  isPending,
}: {
  preset: any;
  label: string;
  onSave: (updates: any) => void;
  isPending: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [values, setValues] = useState({
    minDte: preset.minDte,
    maxDte: preset.maxDte,
    minDelta: preset.minDelta,
    maxDelta: preset.maxDelta,
    minOpenInterest: preset.minOpenInterest,
    minVolume: preset.minVolume,
    minRsi: preset.minRsi ?? 0,
    maxRsi: preset.maxRsi ?? 100,
    minIvRank: preset.minIvRank ?? 0,
    maxIvRank: preset.maxIvRank ?? 100,
    minBbPercent: preset.minBbPercent ?? "0",
    maxBbPercent: preset.maxBbPercent ?? "1.0",
    minScore: preset.minScore,
    maxStrikePercent: preset.maxStrikePercent,
  });

  const handleReset = () => {
    setValues({
      minDte: preset.minDte,
      maxDte: preset.maxDte,
      minDelta: preset.minDelta,
      maxDelta: preset.maxDelta,
      minOpenInterest: preset.minOpenInterest,
      minVolume: preset.minVolume,
      minRsi: preset.minRsi ?? 0,
      maxRsi: preset.maxRsi ?? 100,
      minIvRank: preset.minIvRank ?? 0,
      maxIvRank: preset.maxIvRank ?? 100,
      minBbPercent: preset.minBbPercent ?? "0",
      maxBbPercent: preset.maxBbPercent ?? "1.0",
      minScore: preset.minScore,
      maxStrikePercent: preset.maxStrikePercent,
    });
  };

  const handleSave = () => {
    onSave(values);
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
                onChange={(e) => setValues({ ...values, minDte: parseInt(e.target.value) })}
              />
            </div>
            <div>
              <Label htmlFor={`${preset.presetName}-maxDte`}>Max DTE</Label>
              <Input
                id={`${preset.presetName}-maxDte`}
                type="number"
                value={values.maxDte}
                onChange={(e) => setValues({ ...values, maxDte: parseInt(e.target.value) })}
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
                onChange={(e) => setValues({ ...values, minOpenInterest: parseInt(e.target.value) })}
              />
            </div>
            <div>
              <Label htmlFor={`${preset.presetName}-minVol`}>Min Volume</Label>
              <Input
                id={`${preset.presetName}-minVol`}
                type="number"
                value={values.minVolume}
                onChange={(e) => setValues({ ...values, minVolume: parseInt(e.target.value) })}
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
                onChange={(e) => setValues({ ...values, minRsi: parseInt(e.target.value) })}
              />
            </div>
            <div>
              <Label htmlFor={`${preset.presetName}-maxRsi`}>Max RSI</Label>
              <Input
                id={`${preset.presetName}-maxRsi`}
                type="number"
                value={values.maxRsi}
                onChange={(e) => setValues({ ...values, maxRsi: parseInt(e.target.value) })}
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
                onChange={(e) => setValues({ ...values, minIvRank: parseInt(e.target.value) })}
              />
            </div>
            <div>
              <Label htmlFor={`${preset.presetName}-maxIvRank`}>Max IV Rank</Label>
              <Input
                id={`${preset.presetName}-maxIvRank`}
                type="number"
                value={values.maxIvRank}
                onChange={(e) => setValues({ ...values, maxIvRank: parseInt(e.target.value) })}
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
                onChange={(e) => setValues({ ...values, minScore: parseInt(e.target.value) })}
              />
            </div>
            <div>
              <Label htmlFor={`${preset.presetName}-maxStrike`}>Max Strike % of Stock Price</Label>
              <Input
                id={`${preset.presetName}-maxStrike`}
                type="number"
                value={values.maxStrikePercent}
                onChange={(e) => setValues({ ...values, maxStrikePercent: parseInt(e.target.value) })}
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
          </div>
        </div>
      )}
    </div>
  );
}
