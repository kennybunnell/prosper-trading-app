import { AdminLayout } from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, UserCheck, UserX, AlertCircle, TrendingUp, TrendingDown } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export function AdminDashboard() {
  const { data: analytics, isLoading } = trpc.admin.getAnalyticsOverview.useQuery();

  if (isLoading) {
    return (
      <AdminLayout>
        <div className="p-8">
          <h1 className="text-3xl font-bold mb-8">Dashboard</h1>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[...Array(4)].map((_, i) => (
              <Card key={i}>
                <CardHeader>
                  <Skeleton className="h-4 w-24" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-8 w-16" />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </AdminLayout>
    );
  }

  const totalUsers = analytics?.usersByTier.reduce((sum, tier) => sum + tier.count, 0) || 0;
  const freeTrialUsers = analytics?.usersByTier.find(t => t.tier === 'free_trial')?.count || 0;
  const paidUsers = totalUsers - freeTrialUsers;

  const stats = [
    {
      title: "Total Users",
      value: totalUsers,
      icon: Users,
      description: "All registered users",
      trend: analytics?.newUsersThisWeek ? `+${analytics.newUsersThisWeek} this week` : undefined,
    },
    {
      title: "Active Users (7d)",
      value: analytics?.activeUsers7d || 0,
      icon: UserCheck,
      description: "Users active in last 7 days",
      percentage: totalUsers > 0 ? Math.round((analytics?.activeUsers7d || 0) / totalUsers * 100) : 0,
    },
    {
      title: "Active Users (30d)",
      value: analytics?.activeUsers30d || 0,
      icon: UserCheck,
      description: "Users active in last 30 days",
      percentage: totalUsers > 0 ? Math.round((analytics?.activeUsers30d || 0) / totalUsers * 100) : 0,
    },
    {
      title: "Expiring Trials",
      value: analytics?.expiringTrials || 0,
      icon: AlertCircle,
      description: "Trials ending in next 7 days",
      alert: (analytics?.expiringTrials || 0) > 0,
    },
  ];

  return (
    <AdminLayout>
      <div className="p-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground mt-2">
            Overview of your platform's key metrics and user activity
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {stats.map((stat) => {
            const Icon = stat.icon;
            return (
              <Card key={stat.title} className={stat.alert ? "border-yellow-500" : ""}>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {stat.title}
                  </CardTitle>
                  <Icon className={`h-4 w-4 ${stat.alert ? "text-yellow-500" : "text-muted-foreground"}`} />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stat.value}</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {stat.description}
                  </p>
                  {stat.trend && (
                    <p className="text-xs text-green-600 dark:text-green-400 mt-2 flex items-center gap-1">
                      <TrendingUp className="h-3 w-3" />
                      {stat.trend}
                    </p>
                  )}
                  {stat.percentage !== undefined && (
                    <p className="text-xs text-muted-foreground mt-2">
                      {stat.percentage}% of total users
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* User Distribution */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Users by Subscription Tier</CardTitle>
              <CardDescription>Distribution of users across subscription plans</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {analytics?.usersByTier.map((tier) => {
                  const percentage = totalUsers > 0 ? Math.round((tier.count / totalUsers) * 100) : 0;
                      const tierLabels: Record<string, string> = {
                    free_trial: "Free Trial",
                    wheel: "Wheel Strategy ($97)",
                    advanced: "Advanced ($197)",
                  };
                  
                  return (
                    <div key={tier.tier} className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">{tier.tier ? (tierLabels[tier.tier] || tier.tier) : 'Unknown'}</span>
                        <span className="text-muted-foreground">
                          {tier.count} ({percentage}%)
                        </span>
                      </div>
                      <div className="h-2 bg-secondary rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary transition-all"
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Quick Stats</CardTitle>
              <CardDescription>Key platform metrics at a glance</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Free Trial Users</span>
                  <span className="text-lg font-semibold">{freeTrialUsers}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Paid Users</span>
                  <span className="text-lg font-semibold">{paidUsers}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Conversion Rate</span>
                  <span className="text-lg font-semibold">
                    {totalUsers > 0 ? Math.round((paidUsers / totalUsers) * 100) : 0}%
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">7-Day Engagement</span>
                  <span className="text-lg font-semibold">
                    {totalUsers > 0 ? Math.round(((analytics?.activeUsers7d || 0) / totalUsers) * 100) : 0}%
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </AdminLayout>
  );
}
