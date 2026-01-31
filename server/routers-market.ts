import { publicProcedure, router } from "./_core/trpc";
import { invokeLLM } from "./_core/llm";

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

function analyzeSentiment(title: string, snippet?: string): 'bullish' | 'bearish' | 'volatile' | 'neutral' {
  const text = `${title} ${snippet || ''}`.toLowerCase();
  
  const bullishTerms = ['rally', 'surge', 'gain', 'rise', 'up', 'positive', 'growth', 'recovery', 'strong'];
  const bearishTerms = ['fall', 'drop', 'decline', 'down', 'negative', 'loss', 'crash', 'plunge', 'weak'];
  const volatileTerms = ['volatile', 'volatility', 'uncertainty', 'risk', 'concern', 'worry', 'tariff', 'threat'];
  
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

function extractKeywords(title: string, snippet?: string): string[] {
  const text = `${title} ${snippet || ''}`.toLowerCase();
  const found: string[] = [];
  
  MARKET_KEYWORDS.forEach(keyword => {
    if (text.includes(keyword.toLowerCase())) {
      found.push(keyword);
    }
  });
  
  return found.slice(0, 3); // Return top 3 keywords
}

function extractSource(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    // Remove www. and extract domain name
    const domain = hostname.replace('www.', '').split('.')[0];
    // Capitalize first letter
    return domain.charAt(0).toUpperCase() + domain.slice(1);
  } catch {
    return 'Unknown';
  }
}

export const marketRouter = router({
  getMarketNews: publicProcedure.query(async () => {
    try {
      // Use LLM to search for financial news
      const searchPrompt = `Search for recent financial news (past 48 hours) about:
- Stock market volatility and tariffs
- Federal Reserve interest rate decisions
- Trump trade policy
- Market-moving economic events

Return the results as a JSON array with this structure:
[
  {
    "title": "headline text",
    "url": "article URL",
    "snippet": "brief description",
    "date": "relative date like '3 days ago' or ISO date"
  }
]

Only include major market-moving news. Limit to 5 most important articles.`;

      const response = await invokeLLM({
        messages: [
          { role: "system", content: "You are a financial news analyst. Search for and return recent market-moving news." },
          { role: "user", content: searchPrompt }
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "market_news",
            strict: true,
            schema: {
              type: "object",
              properties: {
                articles: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      title: { type: "string" },
                      url: { type: "string" },
                      snippet: { type: "string" },
                      date: { type: "string" }
                    },
                    required: ["title", "url", "snippet", "date"],
                    additionalProperties: false
                  }
                }
              },
              required: ["articles"],
              additionalProperties: false
            }
          }
        }
      });

      const content = response.choices[0].message.content;
      if (!content) return [];
      
      // Handle content type (string or array)
      const contentText = typeof content === 'string' ? content : JSON.stringify(content);

      const parsed = JSON.parse(contentText);
      const articles = parsed.articles || [];

      // Transform to NewsItem format
      const newsItems: NewsItem[] = articles.map((article: any) => {
        const sentiment = analyzeSentiment(article.title, article.snippet);
        const keywords = extractKeywords(article.title, article.snippet);
        const source = extractSource(article.url);
        
        // Convert relative dates to ISO format (approximate)
        let publishedAt = new Date().toISOString();
        if (article.date.includes('day')) {
          const daysAgo = parseInt(article.date) || 1;
          publishedAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
        } else if (article.date.includes('hour')) {
          const hoursAgo = parseInt(article.date) || 1;
          publishedAt = new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString();
        }

        return {
          title: article.title,
          url: article.url,
          source,
          publishedAt,
          sentiment,
          keywords
        };
      });

      return newsItems;
      
    } catch (error) {
      console.error('[Market News] Error fetching news:', error);
      // Return empty array on error instead of failing
      return [];
    }
  }),
});
