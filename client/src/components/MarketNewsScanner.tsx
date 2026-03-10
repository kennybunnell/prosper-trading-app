import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TrendingUp, TrendingDown, AlertTriangle, Newspaper, ExternalLink, Clock } from 'lucide-react';
import { trpc } from '@/lib/trpc';

interface NewsItem {
  title: string;
  summary: string;
  tradingRecommendation: string;
  searchQuery: string;
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
          <div className="text-sm text-muted-foreground">Analyzing market conditions...</div>
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

  const handleSearchNews = (searchQuery: string) => {
    const googleNewsUrl = `https://news.google.com/search?q=${encodeURIComponent(searchQuery)}`;
    window.open(googleNewsUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <Card className="bg-card/50 backdrop-blur border-primary/20 shadow-[0_0_15px_rgba(59,130,246,0.2)]">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Newspaper className="h-5 w-5" />
          Market News & Risk Alerts
          <Badge variant="outline" className="ml-auto">
            AI Analysis
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {newsData.map((item: NewsItem, idx: number) => (
            <div
              key={idx}
              className="p-4 rounded-lg border border-border/50 hover:border-primary/50 hover:bg-accent/30 transition-all"
            >
              <div className="flex items-start gap-3">
                <div className="mt-1">{getSentimentIcon(item.sentiment)}</div>
                <div className="flex-1 min-w-0 space-y-2">
                  {/* Title */}
                  <div className="font-semibold text-sm">{item.title}</div>
                  
                  {/* Summary */}
                  <div className="text-sm text-muted-foreground leading-relaxed">
                    {item.summary}
                  </div>
                  
                  {/* Trading Recommendation */}
                  <div className="p-2 rounded bg-primary/10 border border-primary/20">
                    <div className="text-xs font-medium text-primary mb-1">Trading Recommendation:</div>
                    <div className="text-sm">{item.tradingRecommendation}</div>
                  </div>
                  
                  {/* Metadata and Actions */}
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant={getSentimentBadge(item.sentiment)} className="text-xs">
                        {item.sentiment}
                      </Badge>
                      {item.keywords.slice(0, 3).map((keyword, kidx) => (
                        <Badge key={kidx} variant="outline" className="text-xs">
                          {keyword}
                        </Badge>
                      ))}
                      {item.publishedAt && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {new Date(item.publishedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleSearchNews(item.searchQuery)}
                      className="text-xs gap-1"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Search News
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
