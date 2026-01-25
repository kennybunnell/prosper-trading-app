import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, TrendingUp } from "lucide-react";
import EnhancedWatchlist from "@/components/EnhancedWatchlist";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

export default function PMCCDashboard() {
  const [selectedPreset, setSelectedPreset] = useState<"conservative" | "medium" | "aggressive">("medium");
  const [isScanning, setIsScanning] = useState(false);

  const scanLeapsMutation = trpc.pmcc.scanLeaps.useMutation({
    onSuccess: (data) => {
      toast.success(data.message || `Found ${data.opportunities.length} LEAP opportunities`);
      setIsScanning(false);
    },
    onError: (error) => {
      toast.error(error.message || "Failed to scan for LEAPs");
      setIsScanning(false);
    },
  });

  const handleScanLeaps = () => {
    setIsScanning(true);
    scanLeapsMutation.mutate({ presetName: selectedPreset });
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <TrendingUp className="h-8 w-8 text-purple-500" />
            <h1 className="text-3xl font-bold">PMCC Dashboard</h1>
          </div>
          <p className="text-muted-foreground">
            Poor Man's Covered Call - Buy LEAPs and sell short calls for income
          </p>
        </div>

        {/* Watchlist Management */}
        <div className="mb-8">
          <EnhancedWatchlist />
        </div>

        {/* LEAP Scanner Section */}
        <Card>
          <CardHeader>
            <CardTitle>LEAP Scanner</CardTitle>
            <CardDescription>
              Scan for LEAP call options (9-15 months out, deep ITM for PMCC strategy)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* Preset Selection */}
              <div>
                <label className="text-sm font-medium mb-2 block">Filter Preset</label>
                <div className="flex gap-2">
                  <Button
                    variant={selectedPreset === "conservative" ? "default" : "outline"}
                    onClick={() => setSelectedPreset("conservative")}
                  >
                    Conservative
                  </Button>
                  <Button
                    variant={selectedPreset === "medium" ? "default" : "outline"}
                    onClick={() => setSelectedPreset("medium")}
                  >
                    Medium
                  </Button>
                  <Button
                    variant={selectedPreset === "aggressive" ? "default" : "outline"}
                    onClick={() => setSelectedPreset("aggressive")}
                  >
                    Aggressive
                  </Button>
                </div>
              </div>

              {/* Scan Button */}
              <Button
                onClick={handleScanLeaps}
                disabled={isScanning}
                className="w-full"
                size="lg"
              >
                {isScanning ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Scanning for LEAPs...
                  </>
                ) : (
                  "Scan for LEAPs"
                )}
              </Button>

              {/* Placeholder for LEAP opportunities table */}
              {scanLeapsMutation.data && scanLeapsMutation.data.opportunities.length > 0 && (
                <div className="mt-6">
                  <h3 className="text-lg font-semibold mb-4">
                    LEAP Opportunities ({scanLeapsMutation.data.opportunities.length})
                  </h3>
                  <div className="text-sm text-muted-foreground">
                    <p>LEAP opportunity table coming soon...</p>
                    <p className="mt-2">
                      Found {scanLeapsMutation.data.opportunities.length} opportunities across watchlist
                    </p>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Active PMCC Positions (Placeholder) */}
        <Card className="mt-8">
          <CardHeader>
            <CardTitle>Active PMCC Positions</CardTitle>
            <CardDescription>
              Your owned LEAPs available for selling covered calls
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-sm text-muted-foreground text-center py-8">
              <p>No LEAP positions found. Start by scanning for LEAP opportunities above!</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
