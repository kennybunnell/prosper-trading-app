import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { Save, Trash2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

type Strategy = 'csp' | 'cc' | 'bps' | 'bcs';

interface SavedScanConfigsProps {
  strategy: Strategy;
  currentTickers: string; // Comma-separated
  currentFilters: any; // Filter state object
  onLoad: (tickers: string, filters: any) => void;
}

export function SavedScanConfigs({ strategy, currentTickers, currentFilters, onLoad }: SavedScanConfigsProps) {
  const [selectedConfigId, setSelectedConfigId] = useState<number | null>(null);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [configName, setConfigName] = useState("");
  
  const utils = trpc.useUtils();
  
  // Fetch saved configurations based on strategy
  const cspConfigs = (trpc as any).csp.getScanConfigs.useQuery(undefined, { enabled: strategy === 'csp' });
  const ccConfigs = (trpc as any).cc.getScanConfigs.useQuery(undefined, { enabled: strategy === 'cc' });
  const bpsConfigs = (trpc as any).spread.getScanConfigs.useQuery(undefined, { enabled: strategy === 'bps' });
  const bcsConfigs = (trpc as any).bcs.getScanConfigs.useQuery(undefined, { enabled: strategy === 'bcs' });
  
  const configs = strategy === 'csp' ? cspConfigs.data || [] 
    : strategy === 'cc' ? ccConfigs.data || []
    : strategy === 'bps' ? bpsConfigs.data || []
    : bcsConfigs.data || [];
  
  // Save configuration mutations
  const cspSave = (trpc as any).csp.saveScanConfig.useMutation({
    onSuccess: () => {
      utils.invalidate();
      toast.success('Configuration saved', { description: `"${configName}" has been saved successfully.` });
      setShowSaveDialog(false);
      setConfigName("");
    },
    onError: (error: any) => {
      toast.error('Failed to save configuration', { description: error.message });
    }
  });
  
  const ccSave = (trpc as any).cc.saveScanConfig.useMutation({
    onSuccess: () => {
      utils.invalidate();
      toast.success('Configuration saved', { description: `"${configName}" has been saved successfully.` });
      setShowSaveDialog(false);
      setConfigName("");
    },
    onError: (error: any) => {
      toast.error('Failed to save configuration', { description: error.message });
    }
  });
  
  const bpsSave = (trpc as any).spread.saveScanConfig.useMutation({
    onSuccess: () => {
      utils.invalidate();
      toast.success('Configuration saved', { description: `"${configName}" has been saved successfully.` });
      setShowSaveDialog(false);
      setConfigName("");
    },
    onError: (error: any) => {
      toast.error('Failed to save configuration', { description: error.message });
    }
  });
  
  const bcsSave = (trpc as any).bcs.saveScanConfig.useMutation({
    onSuccess: () => {
      utils.invalidate();
      toast.success('Configuration saved', { description: `"${configName}" has been saved successfully.` });
      setShowSaveDialog(false);
      setConfigName("");
    },
    onError: (error: any) => {
      toast.error('Failed to save configuration', { description: error.message });
    }
  });
  
  // Delete configuration mutations
  const cspDelete = (trpc as any).csp.deleteScanConfig.useMutation({
    onSuccess: () => {
      utils.invalidate();
      toast.success('Configuration deleted');
      setSelectedConfigId(null);
    },
    onError: (error: any) => {
      toast.error('Failed to delete configuration', { description: error.message });
    }
  });
  
  const ccDelete = (trpc as any).cc.deleteScanConfig.useMutation({
    onSuccess: () => {
      utils.invalidate();
      toast.success('Configuration deleted');
      setSelectedConfigId(null);
    },
    onError: (error: any) => {
      toast.error('Failed to delete configuration', { description: error.message });
    }
  });
  
  const bpsDelete = (trpc as any).spread.deleteScanConfig.useMutation({
    onSuccess: () => {
      utils.invalidate();
      toast.success('Configuration deleted');
      setSelectedConfigId(null);
    },
    onError: (error: any) => {
      toast.error('Failed to delete configuration', { description: error.message });
    }
  });
  
  const bcsDelete = (trpc as any).bcs.deleteScanConfig.useMutation({
    onSuccess: () => {
      utils.invalidate();
      toast.success('Configuration deleted');
      setSelectedConfigId(null);
    },
    onError: (error: any) => {
      toast.error('Failed to delete configuration', { description: error.message });
    }
  });
  
  const handleSave = () => {
    if (!configName.trim()) {
      toast.error('Please enter a configuration name');
      return;
    }
    
    const payload = {
      configName: configName.trim(),
      tickers: currentTickers,
      filters: JSON.stringify(currentFilters),
    };
    
    if (strategy === 'csp') cspSave.mutate(payload);
    else if (strategy === 'cc') ccSave.mutate(payload);
    else if (strategy === 'bps') bpsSave.mutate(payload);
    else if (strategy === 'bcs') bcsSave.mutate(payload);
  };
  
  const handleLoad = () => {
    if (!selectedConfigId) {
      toast.error('Please select a configuration to load');
      return;
    }
    
    const config = configs.find((c: any) => c.id === selectedConfigId);
    if (!config) {
      toast.error('Configuration not found');
      return;
    }
    
    try {
      const filters = JSON.parse(config.filters);
      onLoad(config.tickers, filters);
      toast.success('Configuration loaded', {
        description: `"${config.configName}" has been loaded.`
      });
    } catch (error) {
      toast.error('Failed to load configuration', {
        description: 'Invalid configuration data'
      });
    }
  };
  
  const handleDelete = () => {
    if (!selectedConfigId) {
      toast.error('Please select a configuration to delete');
      return;
    }
    
    if (strategy === 'csp') cspDelete.mutate({ configId: selectedConfigId });
    else if (strategy === 'cc') ccDelete.mutate({ configId: selectedConfigId });
    else if (strategy === 'bps') bpsDelete.mutate({ configId: selectedConfigId });
    else if (strategy === 'bcs') bcsDelete.mutate({ configId: selectedConfigId });
  };
  
  const isDeleting = cspDelete.isPending || ccDelete.isPending || bpsDelete.isPending || bcsDelete.isPending;
  const isSaving = cspSave.isPending || ccSave.isPending || bpsSave.isPending || bcsSave.isPending;
  
  return (
    <div className="space-y-3">
      <Label className="text-sm font-medium">Saved Configurations</Label>
      <div className="flex gap-2">
        <Select
          value={selectedConfigId?.toString() || ""}
          onValueChange={(value) => setSelectedConfigId(value ? parseInt(value) : null)}
        >
          <SelectTrigger className="flex-1">
            <SelectValue placeholder="Select a saved configuration..." />
          </SelectTrigger>
          <SelectContent>
            {configs.length === 0 ? (
              <div className="p-2 text-sm text-muted-foreground text-center">
                No saved configurations
              </div>
            ) : (
              configs.map((config: any) => (
                <SelectItem key={config.id} value={config.id.toString()}>
                  {config.configName}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
        
        <Button
          variant="outline"
          size="icon"
          onClick={handleLoad}
          disabled={!selectedConfigId}
          title="Load selected configuration"
        >
          <RefreshCw className="w-4 h-4" />
        </Button>
        
        <Button
          variant="outline"
          size="icon"
          onClick={() => setShowSaveDialog(true)}
          title="Save current configuration"
        >
          <Save className="w-4 h-4" />
        </Button>
        
        <Button
          variant="outline"
          size="icon"
          onClick={handleDelete}
          disabled={!selectedConfigId || isDeleting}
          title="Delete selected configuration"
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>
      
      {/* Save Dialog */}
      <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save Configuration</DialogTitle>
            <DialogDescription>
              Save your current ticker list and filter settings for quick access later.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div>
              <Label htmlFor="config-name">Configuration Name</Label>
              <Input
                id="config-name"
                placeholder="e.g., High IV Tech Stocks"
                value={configName}
                onChange={(e) => setConfigName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSave();
                  }
                }}
              />
            </div>
            
            <div className="text-sm text-muted-foreground">
              <p><strong>Tickers:</strong> {currentTickers || '(none)'}</p>
              <p className="mt-1"><strong>Filters:</strong> Score, Delta, DTE, Preset settings</p>
            </div>
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSaveDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
