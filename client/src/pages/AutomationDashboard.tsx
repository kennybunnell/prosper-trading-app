/**
 * Daily Trading Automation Dashboard
 * Control panel for managing automated trading workflows
 */

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2, Play, Clock, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

export default function AutomationDashboard() {
  const [isRunning, setIsRunning] = useState(false);

  // Fetch automation settings
  const { data: settings, isLoading: settingsLoading } = trpc.automation.getSettings.useQuery();
  
  // Fetch automation logs
  const { data: logs, isLoading: logsLoading } = trpc.automation.getLogs.useQuery({ limit: 10 });

  // Update settings mutation
  const updateSettings = trpc.automation.updateSettings.useMutation({
    onSuccess: () => {
      toast.success('Settings updated successfully');
    },
    onError: (error) => {
      toast.error(`Failed to update settings: ${error.message}`);
    },
  });

  // Run automation mutation
  const runAutomation = trpc.automation.runAutomation.useMutation({
    onSuccess: (data) => {
      setIsRunning(false);
      toast.success(`Automation completed! ${data.summary.pendingOrdersCount} orders pending approval`);
    },
    onError: (error) => {
      setIsRunning(false);
      toast.error(`Automation failed: ${error.message}`);
    },
  });

  const handleRunAutomation = () => {
    setIsRunning(true);
    runAutomation.mutate({ triggerType: 'manual' });
  };

  const handleToggle = (key: string, value: boolean) => {
    updateSettings.mutate({ [key]: value });
  };

  const handleNumberChange = (key: string, value: number) => {
    updateSettings.mutate({ [key]: value });
  };

  if (settingsLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="container py-8 space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Daily Trading Automation</h1>
        <p className="text-muted-foreground mt-2">
          Automate your daily trading workflow: close profitable positions and submit covered calls
        </p>
      </div>

      {/* Control Panel */}
      <Card>
        <CardHeader>
          <CardTitle>Control Panel</CardTitle>
          <CardDescription>Configure automation settings and run workflows</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Run Button */}
          <div className="flex items-center justify-between p-4 border rounded-lg bg-muted/50">
            <div>
              <h3 className="font-semibold">Run Automation Now</h3>
              <p className="text-sm text-muted-foreground">
                Manually trigger the daily automation workflow
              </p>
            </div>
            <Button
              onClick={handleRunAutomation}
              disabled={isRunning}
              size="lg"
            >
              {isRunning ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Running...
                </>
              ) : (
                <>
                  <Play className="mr-2 h-4 w-4" />
                  Run Now
                </>
              )}
            </Button>
          </div>

          {/* Mode Toggles */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="dry-run">Dry Run Mode</Label>
                <p className="text-sm text-muted-foreground">
                  Generate reports without submitting orders
                </p>
              </div>
              <Switch
                id="dry-run"
                checked={settings?.dryRunMode}
                onCheckedChange={(checked) => handleToggle('dryRunMode', checked)}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="require-approval">Require Approval</Label>
                <p className="text-sm text-muted-foreground">
                  Review and approve orders before submission
                </p>
              </div>
              <Switch
                id="require-approval"
                checked={settings?.requireApproval}
                onCheckedChange={(checked) => handleToggle('requireApproval', checked)}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="auto-schedule">Auto-Schedule (9:35 AM ET)</Label>
                <p className="text-sm text-muted-foreground">
                  Automatically run daily at 9:35 AM Eastern Time
                </p>
              </div>
              <Switch
                id="auto-schedule"
                checked={settings?.autoScheduleEnabled}
                onCheckedChange={(checked) => handleToggle('autoScheduleEnabled', checked)}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="email-notifications">Email Notifications</Label>
                <p className="text-sm text-muted-foreground">
                  Receive email summaries after each run
                </p>
              </div>
              <Switch
                id="email-notifications"
                checked={settings?.emailNotificationsEnabled}
                onCheckedChange={(checked) => handleToggle('emailNotificationsEnabled', checked)}
              />
            </div>
          </div>

          {/* Settings */}
          <div className="space-y-4 pt-4 border-t">
            <h3 className="font-semibold">Position Management Settings</h3>
            
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="profit-threshold">Profit Threshold (%)</Label>
                <Input
                  id="profit-threshold"
                  type="number"
                  min="1"
                  max="100"
                  value={settings?.profitThresholdPercent}
                  onChange={(e) => handleNumberChange('profitThresholdPercent', parseInt(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">
                  Close positions when profit reaches this percentage
                </p>
              </div>
            </div>

            <h3 className="font-semibold pt-4">Covered Call Settings</h3>
            
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="dte-min">Min DTE</Label>
                <Input
                  id="dte-min"
                  type="number"
                  min="1"
                  max="365"
                  value={settings?.ccDteMin}
                  onChange={(e) => handleNumberChange('ccDteMin', parseInt(e.target.value))}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="dte-max">Max DTE</Label>
                <Input
                  id="dte-max"
                  type="number"
                  min="1"
                  max="365"
                  value={settings?.ccDteMax}
                  onChange={(e) => handleNumberChange('ccDteMax', parseInt(e.target.value))}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="delta-min">Min Delta</Label>
                <Input
                  id="delta-min"
                  type="text"
                  value={settings?.ccDeltaMin}
                  onChange={(e) => updateSettings.mutate({ ccDeltaMin: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="delta-max">Max Delta</Label>
                <Input
                  id="delta-max"
                  type="text"
                  value={settings?.ccDeltaMax}
                  onChange={(e) => updateSettings.mutate({ ccDeltaMax: e.target.value })}
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Execution History */}
      <Card>
        <CardHeader>
          <CardTitle>Execution History</CardTitle>
          <CardDescription>Recent automation runs and their results</CardDescription>
        </CardHeader>
        <CardContent>
          {logsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : logs && logs.length > 0 ? (
            <div className="space-y-4">
              {logs.map((log) => (
                <div
                  key={log.id}
                  className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    {log.status === 'completed' && (
                      <CheckCircle2 className="h-5 w-5 text-green-500" />
                    )}
                    {log.status === 'failed' && (
                      <XCircle className="h-5 w-5 text-red-500" />
                    )}
                    {log.status === 'running' && (
                      <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
                    )}
                    
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">
                          {new Date(log.startedAt).toLocaleString()}
                        </span>
                        <Badge variant={log.triggerType === 'manual' ? 'default' : 'secondary'}>
                          {log.triggerType}
                        </Badge>
                        {log.dryRun && (
                          <Badge variant="outline">Dry Run</Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">
                        {log.positionsClosedCount} positions closed • {log.coveredCallsOpenedCount} covered calls opened
                      </p>
                      {log.errorMessage && (
                        <p className="text-sm text-red-500 mt-1">
                          Error: {log.errorMessage}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="text-right">
                    <p className="font-semibold text-green-600">
                      +${log.totalProfitRealized}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      ${log.totalPremiumCollected} premium
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <AlertCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No automation runs yet</p>
              <p className="text-sm mt-1">Click "Run Now" to start your first automation</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
