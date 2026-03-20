/**
 * Open Positions — standalone page accessible from Daily Actions sidebar
 */
import { ActivePositionsTab } from './Performance';

export default function OpenPositionsPage() {
  return (
    <div className="p-6">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-foreground">Open Positions</h1>
        <p className="text-sm text-muted-foreground mt-1">View and analyze your current open positions</p>
      </div>
      <ActivePositionsTab />
    </div>
  );
}
