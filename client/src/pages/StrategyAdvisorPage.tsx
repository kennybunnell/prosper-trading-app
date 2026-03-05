import { StrategyAdvisor } from "@/components/StrategyAdvisor";

export default function StrategyAdvisorPage() {
  return (
    <div className="container py-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Spread Advisor</h1>
        <p className="text-muted-foreground mt-2">
          AI-powered spread recommendations based on current market conditions
        </p>
      </div>

      <StrategyAdvisor />
    </div>
  );
}
