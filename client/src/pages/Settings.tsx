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

  const { data: credentials, isLoading: loadingCredentials } = trpc.settings.getCredentials.useQuery(
    undefined,
    { enabled: !!user }
  );

  const saveCredentials = trpc.settings.saveCredentials.useMutation({
    onSuccess: () => {
      toast.success("Credentials saved successfully");
      setHasChanges(false);
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

  const utils = trpc.useUtils();

  useEffect(() => {
    if (credentials) {
      setTastytradeUsername(credentials.tastytradeUsername || "");
      setTastytradePassword(credentials.tastytradePassword || "");
      setTradierApiKey(credentials.tradierApiKey || "");
      setTradierAccountId(credentials.tradierAccountId || "");
      setDefaultTastytradeAccountId(credentials.defaultTastytradeAccountId || "");
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
      </div>
    </div>
  );
}
