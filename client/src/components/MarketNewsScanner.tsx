import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown, AlertTriangle, Newspaper } from 'lucide-react';
import { trpc } from '@/lib/trpc';

interface NewsItem {
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  sentiment: 'bullish' | 'bearish' | 'volatile' | 'neutral';
  keywords: string[];
}

export function MarketNewsScanner() {
  const { data: newsData, isLoading } = trpc.market.getMarketNews.useQuery();

  if (isLoading) {
    return (
      <Card className="bg-card/50 backdrop-blur">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Newspaper className="h-5 w-5" />
            Market News & Risk Alerts
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">Loading market news...</div>
        </CardContent>
      </Card>
    );
  }

  if (!newsData || newsData.length === 0) {
    return (
      <Card className="bg-card/50 backdrop-blur">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Newspaper className="h-5 w-5" />
            Market News & Risk Alerts
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">No major market-moving news detected in the past 48 hours.</div>
        </CardContent>
      </Card>
    );
  }

  const getSentimentIcon = (sentiment: string) => {
    switch (sentiment) {
      case 'bullish':
        return <TrendingUp className="h-4 w-4 text-green-500" />;
      case 'bearish':
        return <TrendingDown className="h-4 w-4 text-red-500" />;
      case 'volatile':
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
      default:
        return <Newspaper className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getSentimentBadge = (sentiment: string) => {
    const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      bullish: 'default',
      bearish: 'destructive',
      volatile: 'secondary',
      neutral: 'outline',
    };
    return variants[sentiment] || 'outline';
  };

  return (
    <Card className="bg-card/50 backdrop-blur border-primary/20 shadow-[0_0_15px_rgba(59,130,246,0.2)]">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Newspaper className="h-5 w-5" />
          Market News & Risk Alerts
          <Badge variant="outline" className="ml-auto">
            Past 48 Hours
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {newsData.map((item: NewsItem, idx: number) => (
            <a
              key={idx}
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block p-3 rounded-lg border border-border/50 hover:border-primary/50 hover:bg-accent/50 transition-all"
            >
              <div className="flex items-start gap-3">
                <div className="mt-1">{getSentimentIcon(item.sentiment)}</div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm line-clamp-2">{item.title}</div>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className="text-xs text-muted-foreground">{item.source}</span>
                    <span className="text-xs text-muted-foreground">•</span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(item.publishedAt).toLocaleDateString()}
                    </span>
                    <Badge variant={getSentimentBadge(item.sentiment)} className="text-xs">
                      {item.sentiment}
                    </Badge>
                    {item.keywords.slice(0, 2).map((keyword, kidx) => (
                      <Badge key={kidx} variant="outline" className="text-xs">
                        {keyword}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            </a>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
