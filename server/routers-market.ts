import { publicProcedure, router } from "./_core/trpc";
import axios from "axios";

interface NewsArticle {
  title: string;
  url: string;
  source: { name: string };
  publishedAt: string;
  description?: string;
}

interface NewsItem {
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  sentiment: 'bullish' | 'bearish' | 'volatile' | 'neutral';
  keywords: string[];
}

const MARKET_KEYWORDS = [
  'tariff', 'tariffs', 'trade war',
  'Federal Reserve', 'Fed', 'Jerome Powell', 'interest rate',
  'inflation', 'CPI', 'PPI',
  'Trump', 'trade policy',
  'market crash', 'market volatility', 'VIX',
  'recession', 'economic data',
  'S&P 500', 'Dow Jones', 'Nasdaq'
];

function analyzeSentiment(title: string, description?: string): 'bullish' | 'bearish' | 'volatile' | 'neutral' {
  const text = `${title} ${description || ''}`.toLowerCase();
  
  const bullishTerms = ['rally', 'surge', 'gain', 'rise', 'up', 'positive', 'growth', 'recovery'];
  const bearishTerms = ['fall', 'drop', 'decline', 'down', 'negative', 'loss', 'crash', 'plunge'];
  const volatileTerms = ['volatile', 'volatility', 'uncertainty', 'risk', 'concern', 'worry', 'tariff'];
  
  let bullishScore = 0;
  let bearishScore = 0;
  let volatileScore = 0;
  
  bullishTerms.forEach(term => {
    if (text.includes(term)) bullishScore++;
  });
  
  bearishTerms.forEach(term => {
    if (text.includes(term)) bearishScore++;
  });
  
  volatileTerms.forEach(term => {
    if (text.includes(term)) volatileScore++;
  });
  
  if (volatileScore >= 2) return 'volatile';
  if (bullishScore > bearishScore) return 'bullish';
  if (bearishScore > bullishScore) return 'bearish';
  return 'neutral';
}

function extractKeywords(title: string, description?: string): string[] {
  const text = `${title} ${description || ''}`.toLowerCase();
  const found: string[] = [];
  
  MARKET_KEYWORDS.forEach(keyword => {
    if (text.includes(keyword.toLowerCase())) {
      found.push(keyword);
    }
  });
  
  return found.slice(0, 3); // Return top 3 keywords
}

export const marketRouter = router({
  getMarketNews: publicProcedure.query(async () => {
    try {
      // Use NewsAPI or similar service
      // For now, using a mock implementation that searches for financial news
      const searchQueries = [
        'stock market tariff',
        'Federal Reserve interest rate',
        'market volatility Trump',
        'S&P 500 inflation'
      ];
      
      const allNews: NewsItem[] = [];
      
      // In production, you would call a real news API here
      // For now, returning a structured response
      // You can integrate with NewsAPI, Alpha Vantage, or similar services
      
      // Example: Using a free news API (you'll need to add API key to env)
      // const API_KEY = process.env.NEWS_API_KEY;
      // const response = await axios.get(`https://newsapi.org/v2/everything`, {
      //   params: {
      //     q: 'stock market OR tariff OR "Federal Reserve" OR inflation',
      //     language: 'en',
      //     sortBy: 'publishedAt',
      //     from: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
      //     apiKey: API_KEY
      //   }
      // });
      
      // For demonstration, returning mock data structure
      // Replace this with actual API calls
      const mockNews: NewsItem[] = [
        {
          title: "Markets React to Latest Fed Comments on Interest Rates",
          url: "https://example.com/news1",
          source: "Financial Times",
          publishedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
          sentiment: 'volatile',
          keywords: ['Federal Reserve', 'interest rate', 'market volatility']
        },
        {
          title: "Trump Announces New Tariff Policy, Markets Show Uncertainty",
          url: "https://example.com/news2",
          source: "Bloomberg",
          publishedAt: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
          sentiment: 'volatile',
          keywords: ['Trump', 'tariff', 'trade policy']
        },
        {
          title: "Inflation Data Beats Expectations, S&P 500 Rallies",
          url: "https://example.com/news3",
          source: "CNBC",
          publishedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
          sentiment: 'bullish',
          keywords: ['inflation', 'S&P 500', 'CPI']
        }
      ];
      
      return mockNews;
      
    } catch (error) {
      console.error('[Market News] Error fetching news:', error);
      return [];
    }
  }),
});
