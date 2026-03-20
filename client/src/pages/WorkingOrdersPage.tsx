/**
 * Working Orders — standalone page accessible from Daily Actions sidebar
 */
import { WorkingOrdersTab } from './Performance';

export default function WorkingOrdersPage() {
  return (
    <div className="p-6">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-foreground">Working Orders</h1>
        <p className="text-sm text-muted-foreground mt-1">Monitor and manage your active orders</p>
      </div>
      <WorkingOrdersTab />
    </div>
  );
}
