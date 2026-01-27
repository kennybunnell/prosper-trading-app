import { Card } from '@/components/ui/card';
import { trpc } from '@/lib/trpc';
import { Clock, CalendarDays, CalendarRange } from 'lucide-react';

export function ThetaDecayCards() {
  const { data, isLoading } = trpc.projections.getThetaDecay.useQuery();

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <Card key={i} className="p-6 bg-card/50 backdrop-blur animate-pulse">
            <div className="h-20 bg-muted rounded" />
          </Card>
        ))}
      </div>
    );
  }

  const cards = [
    {
      title: 'Daily Theta',
      value: data?.dailyTheta || 0,
      subtitle: 'Time decay per day',
      icon: Clock,
      gradient: 'from-violet-500/20 to-purple-500/20',
      iconColor: 'text-violet-400',
    },
    {
      title: 'Weekly Projection',
      value: data?.weeklyTheta || 0,
      subtitle: '7-day theta estimate',
      icon: CalendarDays,
      gradient: 'from-blue-500/20 to-indigo-500/20',
      iconColor: 'text-blue-400',
    },
    {
      title: 'Monthly Projection',
      value: data?.monthlyTheta || 0,
      subtitle: '30-day theta estimate',
      icon: CalendarRange,
      gradient: 'from-cyan-500/20 to-teal-500/20',
      iconColor: 'text-cyan-400',
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
            <p className="text-xs text-muted-foreground">{card.subtitle}</p>
          </Card>
        );
      })}
    </div>
  );
}
