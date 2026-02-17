import { publicProcedure, router } from "./_core/trpc";
import { invokeLLM } from "./_core/llm";

interface NewsItem {
  title: string;
  summary: string; // AI-generated 2-3 sentence summary
  tradingRecommendation: string; // Trading advice based on the news
  searchQuery: string; // Google News search query
  source: string;
  publishedAt: string;
  sentiment: 'bullish' | 'bearish' | 'volatile' | 'neutral';
  keywords: string[];
}

export const marketRouter = router({
  /**
   * Get current market status (open/closed) from Tradier API
   */
  getMarketStatus: publicProcedure.query(async () => {
    try {
      const { createTradierAPI } = await import('./tradier');
      
      const tradierApiKey = process.env.TRADIER_API_KEY;
      if (!tradierApiKey) {
        console.warn('[Market Status] Tradier API key not configured, using time-based fallback');
        throw new Error('API key not configured');
      }
      
      console.log('[Market Status] Fetching market status from Tradier API...');
      const tradier = createTradierAPI(tradierApiKey, false);
      const status = await tradier.getMarketStatus();
      
      console.log('[Market Status] Tradier API response:', status);
      
      return {
        isOpen: status.open,
        description: status.description || (status.open ? 'Market is open' : 'Market is closed'),
      };
    } catch (error: any) {
      console.error('[Market Status] Error fetching from Tradier API:', error.message || error);
      
      // Fallback to time-based check if Tradier API fails
      const now = new Date();
      const etTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const dayOfWeek = etTime.getDay();
      const hours = etTime.getHours();
      const minutes = etTime.getMinutes();
      const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
      const isDuringMarketHours = (hours > 9 || (hours === 9 && minutes >= 30)) && hours < 16;
      const isOpen = isWeekday && isDuringMarketHours;
      
      let description = 'Market is closed';
      if (isWeekday) {
        if (hours < 9 || (hours === 9 && minutes < 30)) {
          description = 'Market is closed (Pre-market)';
        } else if (hours >= 16) {
          description = 'Market is closed (After hours)';
        } else {
          description = 'Market is open';
        }
      } else {
        description = 'Market is closed (Weekend)';
      }
      
      console.log('[Market Status] Using time-based fallback:', { isOpen, description, etTime: etTime.toLocaleString() });
      
      return {
        isOpen,
        description,
      };
    }
  }),

  getMarketNews: publicProcedure.query(async () => {
    try {
      // Use LLM to analyze recent financial news and generate summaries
      const analysisPrompt = `Analyze recent financial news (past 48 hours) about stock market volatility, tariffs, Federal Reserve decisions, Trump trade policy, and other market-moving events.

For each major news item, provide:
1. A clear headline
2. A 2-3 sentence summary explaining what happened
3. Specific trading recommendation for options traders (e.g., "Consider defensive positions", "Good environment for premium selling", "Watch for increased volatility")
4. Sentiment (bullish/bearish/volatile/neutral)
5. A search query to find more articles about this topic

Focus on the 5 most important market-moving stories.`;

      const response = await invokeLLM({
        messages: [
          { role: "system", content: "You are a financial news analyst specializing in options trading. Provide actionable insights for premium sellers." },
          { role: "user", content: analysisPrompt }
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "market_news_analysis",
            strict: true,
            schema: {
              type: "object",
              properties: {
                articles: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      title: { type: "string", description: "Clear headline" },
                      summary: { type: "string", description: "2-3 sentence explanation" },
                      tradingRecommendation: { type: "string", description: "Specific advice for options traders" },
                      sentiment: { 
                        type: "string", 
                        enum: ["bullish", "bearish", "volatile", "neutral"],
                        description: "Market sentiment" 
                      },
                      searchQuery: { type: "string", description: "Google News search query" },
                      keywords: {
                        type: "array",
                        items: { type: "string" },
                        description: "Key topics (max 3)"
                      }
                    },
                    required: ["title", "summary", "tradingRecommendation", "sentiment", "searchQuery", "keywords"],
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
        return {
          title: article.title,
          summary: article.summary,
          tradingRecommendation: article.tradingRecommendation,
          searchQuery: article.searchQuery,
          source: "AI Analysis", // Since we're generating summaries, not linking to sources
          publishedAt: new Date().toISOString(), // Current time since it's fresh analysis
          sentiment: article.sentiment as 'bullish' | 'bearish' | 'volatile' | 'neutral',
          keywords: article.keywords.slice(0, 3) // Ensure max 3 keywords
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
