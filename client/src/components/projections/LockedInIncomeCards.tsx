import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { trpc } from '@/lib/trpc';
import { DollarSign, TrendingUp, Calendar, Wallet, RefreshCw } from 'lucide-react';

export function LockedInIncomeCards() {
  const { data, isLoading, isFetching, refetch } = trpc.projections.getLockedInIncome.useQuery();

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} className="p-6 bg-card/50 backdrop-blur animate-pulse">
            <div className="h-20 bg-muted rounded" />
          </Card>
        ))}
      </div>
    );
  }

  const cards = [
    {
      title: 'This Week',
      value: data?.thisWeek?.premium || 0,
      count: data?.thisWeek?.positions || 0,
      icon: Calendar,
      gradient: 'from-blue-500/20 to-cyan-500/20',
      iconColor: 'text-cyan-400',
    },
    {
      title: 'This Month',
      value: data?.thisMonth?.premium || 0,
      count: data?.thisMonth?.positions || 0,
      icon: TrendingUp,
      gradient: 'from-green-500/20 to-emerald-500/20',
      iconColor: 'text-emerald-400',
    },
    {
      title: 'Next Month',
      value: data?.nextMonth?.premium || 0,
      count: data?.nextMonth?.positions || 0,
      icon: DollarSign,
      gradient: 'from-amber-500/20 to-orange-500/20',
      iconColor: 'text-orange-400',
    },
    {
      title: 'Total Open Premium',
      value: data?.totalOpen?.premium || 0,
      count: data?.totalOpen?.positions || 0,
      icon: Wallet,
      gradient: 'from-purple-500/20 to-pink-500/20',
      iconColor: 'text-pink-400',
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`w-4 h-4 mr-1 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <Card
              key={card.title}
              className={`p-6 bg-gradient-to-br ${card.gradient} border-border/50 backdrop-blur`}
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <p className="text-sm text-muted-foreground mb-1">{card.title}</p>
                  <p className="text-2xl font-bold text-foreground">
                    ${card.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </div>
                <div className={`p-3 rounded-lg bg-background/50 ${card.iconColor}`}>
                  <Icon className="w-5 h-5" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {card.count} position{card.count !== 1 ? 's' : ''}
              </p>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
