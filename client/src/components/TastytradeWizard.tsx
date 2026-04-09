import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  CheckCircle2,
  ExternalLink,
  AlertTriangle,
  Copy,
  ChevronRight,
  Loader2,
  XCircle,
  Info,
} from "lucide-react";

interface TastytradeWizardProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const STEPS = [
  { id: 1, title: "Create OAuth App", short: "Create App" },
  { id: 2, title: "Copy Client ID & Secret", short: "Credentials" },
  { id: 3, title: "Generate Personal Grant", short: "Refresh Token" },
  { id: 4, title: "Paste & Connect", short: "Connect" },
];

export default function TastytradeWizard({ open, onClose, onSuccess }: TastytradeWizardProps) {
  const [step, setStep] = useState(1);
  const [scopesConfirmed, setScopesConfirmed] = useState(false);
  const [secretSaved, setSecretSaved] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [testError, setTestError] = useState("");

  const saveCredentials = trpc.settings.saveCredentials.useMutation();
  const testConnection = trpc.settings.testTastytradeConnection.useMutation();
  const syncAccounts = trpc.accounts.sync.useMutation();
  const utils = trpc.useUtils();

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => toast.success(`${label} copied to clipboard`));
  };

  const handleTestAndConnect = async () => {
    if (!clientId.trim() || !clientSecret.trim() || !refreshToken.trim()) {
      toast.error("Please fill in all three fields before connecting.");
      return;
    }
    if (!refreshToken.trim().startsWith("eyJ")) {
      toast.error("Refresh Token looks incorrect — it should start with 'eyJ'. Make sure you copied the full token from the Create Grant page.");
      return;
    }
    if (clientSecret.trim().length < 20) {
      toast.error("Client Secret looks too short. Make sure you copied the full secret.");
      return;
    }

    setTestStatus("testing");
    setTestError("");

    try {
      // Save credentials first
      await saveCredentials.mutateAsync({
        tastytradeClientId: clientId.trim(),
        tastytradeClientSecret: clientSecret.trim(),
        tastytradeRefreshToken: refreshToken.trim(),
      });

      // Then test the connection
      await testConnection.mutateAsync();

      setTestStatus("success");

      // Auto-sync accounts
      try {
        await syncAccounts.mutateAsync();
      } catch {
        // sync failure is non-fatal
      }

      await utils.accounts.list.invalidate();
      toast.success("Connected to Tastytrade successfully! Accounts synced.");

      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1500);
    } catch (err: unknown) {
      setTestStatus("error");
      const message = err instanceof Error ? err.message : String(err);
      // Parse out the tRPC wrapper to get the real error
      const match = message.match(/TRPCClientError: (.+)/);
      setTestError(match ? match[1] : message);
    }
  };

  const reset = () => {
    setStep(1);
    setScopesConfirmed(false);
    setSecretSaved(false);
    setClientId("");
    setClientSecret("");
    setRefreshToken("");
    setTestStatus("idle");
    setTestError("");
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl">Tastytrade Connection Setup</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Follow these steps exactly to connect your Tastytrade account. Takes about 3 minutes.
          </p>
        </DialogHeader>

        {/* Step Progress */}
        <div className="flex items-center gap-1 my-2">
          {STEPS.map((s, i) => (
            <div key={s.id} className="flex items-center gap-1 flex-1">
              <div
                className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors ${
                  step === s.id
                    ? "bg-primary text-primary-foreground"
                    : step > s.id
                    ? "bg-green-600/20 text-green-400"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {step > s.id ? (
                  <CheckCircle2 className="h-3 w-3" />
                ) : (
                  <span className="w-3 text-center">{s.id}</span>
                )}
                <span className="hidden sm:inline">{s.short}</span>
              </div>
              {i < STEPS.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />}
            </div>
          ))}
        </div>

        {/* ─── STEP 1: Create OAuth App ─── */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
              <h3 className="font-semibold text-blue-400 mb-1">Step 1: Create Your OAuth Application</h3>
              <p className="text-sm text-muted-foreground">
                You need to create a personal OAuth app on Tastytrade's website. This is a one-time setup.
              </p>
            </div>

            <div className="space-y-3">
              <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/40">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">1</span>
                <div>
                  <p className="text-sm font-medium">Go to your Tastytrade OAuth Applications page</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Navigate to: <span className="font-mono text-xs bg-muted px-1 rounded">Manage tab → My Profile → API → OAuth Applications</span>
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2 gap-1.5"
                    onClick={() => window.open("https://my.tastytrade.com", "_blank")}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open my.tastytrade.com
                  </Button>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/40">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">2</span>
                <div>
                  <p className="text-sm font-medium">Click <span className="font-mono bg-muted px-1 rounded">+ New OAuth client</span></p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Fill in any name (e.g., "Prosper Trading"). For Redirect URI, enter: <span className="font-mono text-xs bg-muted px-1 rounded">https://prospertrading.biz</span>
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2 gap-1.5"
                    onClick={() => handleCopy("https://prospertrading.biz", "Redirect URI")}
                  >
                    <Copy className="h-3.5 w-3.5" />
                    Copy Redirect URI
                  </Button>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/40">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">3</span>
                <div>
                  <p className="text-sm font-medium">Select ALL three scopes — this is critical</p>
                  <div className="flex gap-2 mt-2">
                    <Badge variant="outline" className="text-green-400 border-green-400/50">✓ read</Badge>
                    <Badge variant="outline" className="text-green-400 border-green-400/50">✓ trade</Badge>
                    <Badge variant="outline" className="text-green-400 border-green-400/50">✓ openid</Badge>
                  </div>
                  <p className="text-xs text-destructive mt-2 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    Missing any scope = 400 error. All three must be checked.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/40">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">4</span>
                <div>
                  <p className="text-sm font-medium">Click <span className="font-mono bg-muted px-1 rounded">Create</span></p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Tastytrade will show you your Client ID and Client Secret. <strong>Do not close this page yet</strong> — you'll need these in the next step.
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
              <p className="text-xs text-amber-400 flex items-start gap-2">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>
                  <strong>If you already have an OAuth app:</strong> You can use it — but if you regenerated the Client Secret, you MUST also delete the old grant and create a new one (Step 3). The secret and refresh token must be from the same generation.
                </span>
              </p>
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={scopesConfirmed}
                  onChange={(e) => setScopesConfirmed(e.target.checked)}
                  className="rounded"
                />
                <span className="text-sm">I have created the OAuth app with all three scopes selected (read, trade, openid)</span>
              </label>
            </div>

            <Button
              className="w-full"
              disabled={!scopesConfirmed}
              onClick={() => setStep(2)}
            >
              Next: Copy Client ID & Secret
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        )}

        {/* ─── STEP 2: Copy Client ID & Secret ─── */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
              <h3 className="font-semibold text-blue-400 mb-1">Step 2: Save Your Client ID & Client Secret</h3>
              <p className="text-sm text-muted-foreground">
                After creating the app, Tastytrade shows you both values. You need to copy them now.
              </p>
            </div>

            <div className="bg-red-500/10 border border-red-500/40 rounded-lg p-4">
              <p className="text-sm text-red-400 font-semibold flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                CRITICAL: Client Secret is shown ONLY ONCE
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Tastytrade will never show you the Client Secret again after you click "Finish Setup." If you miss it, you must click "Regenerate" — but regenerating the secret immediately invalidates your existing refresh token (grant), so you'll need to create a new grant in Step 3 as well.
              </p>
            </div>

            <div className="space-y-3">
              <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/40">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">1</span>
                <div>
                  <p className="text-sm font-medium">Copy your Client ID</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    It looks like a UUID: <span className="font-mono text-xs bg-muted px-1 rounded">a4fbab96-3d65-4f69-a28a-b2f8ac90c364</span>
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/40">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">2</span>
                <div>
                  <p className="text-sm font-medium">Copy your Client Secret</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    It's a long alphanumeric string, typically 40-80 characters. Copy it exactly — no extra spaces.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/40">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">3</span>
                <div>
                  <p className="text-sm font-medium">Click "Finish Setup" on Tastytrade</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Only click Finish Setup after you've copied both values. The secret disappears after this.
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
              <p className="text-xs text-blue-400 flex items-start gap-2">
                <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>
                  <strong>Lost your Client Secret?</strong> Go to your OAuth app → Manage → Settings → click "Regenerate." This gives you a new secret but invalidates your existing grant. You'll need to create a new grant in Step 3.
                </span>
              </p>
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={secretSaved}
                onChange={(e) => setSecretSaved(e.target.checked)}
                className="rounded"
              />
              <span className="text-sm">I have copied both my Client ID and Client Secret</span>
            </label>

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(1)} className="flex-1">Back</Button>
              <Button className="flex-1" disabled={!secretSaved} onClick={() => setStep(3)}>
                Next: Generate Refresh Token
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* ─── STEP 3: Generate Personal Grant ─── */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
              <h3 className="font-semibold text-blue-400 mb-1">Step 3: Generate Your Refresh Token (Personal Grant)</h3>
              <p className="text-sm text-muted-foreground">
                The Refresh Token is what allows Prosper Trading to stay connected to your account without needing your password.
              </p>
            </div>

            <div className="space-y-3">
              <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/40">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">1</span>
                <div>
                  <p className="text-sm font-medium">Go back to your OAuth Applications page</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    <span className="font-mono text-xs bg-muted px-1 rounded">Manage tab → My Profile → API → OAuth Applications</span>
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2 gap-1.5"
                    onClick={() => window.open("https://my.tastytrade.com", "_blank")}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open my.tastytrade.com
                  </Button>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/40">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">2</span>
                <div>
                  <p className="text-sm font-medium">Find your app and click <span className="font-mono bg-muted px-1 rounded">Manage</span></p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Your app will appear in the list. Click the "Manage" button on the right side.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/40">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">3</span>
                <div>
                  <p className="text-sm font-medium">Click <span className="font-mono bg-muted px-1 rounded">Create Grant</span></p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    This generates your personal Refresh Token. It will start with <span className="font-mono text-xs bg-muted px-1 rounded">eyJ</span> and is very long (200+ characters).
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/40">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">4</span>
                <div>
                  <p className="text-sm font-medium">Copy the entire Refresh Token</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Select all the text and copy it. Make sure you get the full token — it's long and easy to accidentally truncate.
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
              <p className="text-xs text-amber-400 flex items-start gap-2">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>
                  <strong>Important sequence rule:</strong> The Refresh Token is tied to the Client Secret that existed when you created the grant. If you regenerated your Client Secret after creating the grant, you MUST delete the old grant and create a new one — otherwise you'll always get a 400 error.
                </span>
              </p>
            </div>

            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
              <p className="text-xs text-blue-400 flex items-start gap-2">
                <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>
                  <strong>Refresh tokens never expire</strong> — once created, this token works indefinitely unless you delete the grant or regenerate your Client Secret.
                </span>
              </p>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(2)} className="flex-1">Back</Button>
              <Button className="flex-1" onClick={() => setStep(4)}>
                Next: Paste & Connect
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* ─── STEP 4: Paste & Connect ─── */}
        {step === 4 && (
          <div className="space-y-4">
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
              <h3 className="font-semibold text-blue-400 mb-1">Step 4: Paste Your Credentials & Connect</h3>
              <p className="text-sm text-muted-foreground">
                Paste all three values below. They will be saved and tested immediately.
              </p>
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="wiz-client-id">
                  Client ID
                  <span className="text-xs text-muted-foreground ml-2">UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx</span>
                </Label>
                <Input
                  id="wiz-client-id"
                  type="text"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="Paste your Client ID here"
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono text-sm"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="wiz-client-secret">
                  Client Secret
                  <span className="text-xs text-muted-foreground ml-2">Long alphanumeric string (40+ chars)</span>
                </Label>
                <Input
                  id="wiz-client-secret"
                  type="text"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  placeholder="Paste your Client Secret here"
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono text-sm"
                />
                {clientSecret && clientSecret.length < 20 && (
                  <p className="text-xs text-destructive flex items-center gap-1">
                    <XCircle className="h-3 w-3" />
                    Too short — make sure you copied the full secret
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="wiz-refresh-token">
                  Refresh Token
                  <span className="text-xs text-muted-foreground ml-2">Starts with "eyJ", very long (200+ chars)</span>
                </Label>
                <Input
                  id="wiz-refresh-token"
                  type="text"
                  value={refreshToken}
                  onChange={(e) => setRefreshToken(e.target.value)}
                  placeholder="Paste your Refresh Token here"
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono text-sm"
                />
                {refreshToken && !refreshToken.startsWith("eyJ") && (
                  <p className="text-xs text-destructive flex items-center gap-1">
                    <XCircle className="h-3 w-3" />
                    Should start with "eyJ" — check you copied the Refresh Token, not the Client Secret
                  </p>
                )}
              </div>
            </div>

            {/* Test Result */}
            {testStatus === "success" && (
              <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-400 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-green-400">Connected successfully!</p>
                  <p className="text-xs text-muted-foreground">Your accounts are being synced. Closing in a moment...</p>
                </div>
              </div>
            )}

            {testStatus === "error" && (
              <div className="bg-red-500/10 border border-red-500/40 rounded-lg p-3 space-y-2">
                <p className="text-sm font-semibold text-red-400 flex items-center gap-2">
                  <XCircle className="h-4 w-4" />
                  Connection failed
                </p>
                <p className="text-xs text-muted-foreground">{testError}</p>
                <div className="text-xs text-muted-foreground space-y-1 mt-2 border-t border-red-500/20 pt-2">
                  <p className="font-medium text-red-300">Common fixes for 400 errors:</p>
                  <ul className="space-y-1 ml-3 list-disc">
                    <li>Did you regenerate the Client Secret after creating the grant? → Delete the grant, create a new one, paste the new refresh token</li>
                    <li>Did you select all three scopes (read, trade, openid) when creating the app?</li>
                    <li>Is the Refresh Token complete? It should be 200+ characters starting with "eyJ"</li>
                    <li>Are there any extra spaces before/after any of the values?</li>
                  </ul>
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => { setStep(3); setTestStatus("idle"); }} className="flex-1" disabled={testStatus === "testing"}>
                Back
              </Button>
              <Button
                className="flex-1"
                onClick={handleTestAndConnect}
                disabled={testStatus === "testing" || testStatus === "success" || !clientId || !clientSecret || !refreshToken}
              >
                {testStatus === "testing" ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Testing connection...
                  </>
                ) : testStatus === "success" ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    Connected!
                  </>
                ) : (
                  "Save & Connect to Tastytrade"
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
