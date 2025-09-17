/**
 * AI Engine - Intelligent Question Processing and Response Generation
 * 
 * This module provides the core AI functionality for the Whop support bot
 * using Google's Gemini API directly.
 */

import { GoogleGenAI } from "@google/genai";
import { BotSettings, config, logger, retry, isQuestion, sanitizeText, truncateText } from './shared-utils';

// =============================================================================
// AI PROMPTS
// =============================================================================

export function createSystemPrompt(knowledgeBase: string, settings: BotSettings, shouldForceResponse: boolean = false): string {
  let systemPrompt = '';

  // Base personality - keep it simple
  switch (settings.responseStyle) {
    case 'professional':
      systemPrompt = 'You are a helpful AI assistant for this community. Be professional and clear.';
      break;
    case 'friendly':
      systemPrompt = 'You are a friendly AI assistant for this community. Be warm and helpful.';
      break;
    case 'casual':
      systemPrompt = 'You are a casual AI assistant for this community. Be relaxed and friendly.';
      break;
    case 'technical':
      systemPrompt = 'You are a technical AI assistant for this community. Be precise and detailed.';
      break;
    case 'custom':
      systemPrompt = settings.botPersonality || 'You are a helpful AI assistant for this community.';
      break;
    default:
      systemPrompt = 'You are a helpful AI assistant for this community.';
  }

  // Add knowledge base if available
  if (knowledgeBase && knowledgeBase.trim()) {
    systemPrompt += '\n\nCommunity Information:\n' + knowledgeBase.trim();
  }

  // Add custom instructions if available
  if (settings.customInstructions && settings.customInstructions.trim()) {
    systemPrompt += '\n\nAdditional Instructions:\n' + settings.customInstructions.trim();
  }

  // Much stricter rules
if (shouldForceResponse) {
  systemPrompt += '\n\nIMPORTANT: You have been mentioned or someone replied to your message.';
  systemPrompt += '\n- If you can answer their question using ONLY the community information above, provide a helpful answer';
  systemPrompt += '\n- If the community information does not contain the answer, politely ask the user to clarify their question';
  systemPrompt += '\n- Do NOT make up information or guess';
} else {
  systemPrompt += '\n\nCRITICAL: Only respond if you can answer the question using ONLY the community information provided above.';
  systemPrompt += '\n- If the community information does not contain the answer, politely ask the user to clarify their question';
  systemPrompt += '\n- Do not make up information or guess';
  systemPrompt += '\n- The information must be explicitly stated in the community information';
}


  systemPrompt += '\n- Keep responses under 150 words';
  systemPrompt += '\n- Be direct and helpful';

  return systemPrompt;
}

export function createQuestionAnalysisPrompt(): string {
  return `Determine if this message is a question that needs an AI assistant response.

Respond "YES" if the message:
- Asks a specific question about community rules, requirements, or processes
- Asks "how to" do something specific
- Requests specific information or numbers
- Reports a problem that needs help

Respond "GREET" if the message:
- Is only a greeting like "hi", "hello", "hey", "good morning", etc.
- Does not ask a question or mention/tag someone

Respond "NO" if the message:
- Is casual conversation or small talk beyond greetings
- Is just a statement or comment
- Is off-topic or spam
- Is too vague or general
- Is users talking to each other

Only respond "YES" if you're confident the question can be answered with specific community information.

Message to analyze:`;
}


// =============================================================================
// RATE LIMITING
// =============================================================================

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

class RateLimiter {
  private requests = new Map<string, RateLimitEntry>();
  private readonly windowMs = 60 * 1000; // 1 minute window

  isAllowed(key: string, limit: number): boolean {
    const now = Date.now();
    const entry = this.requests.get(key);

    if (!entry || now > entry.resetTime) {
      // First request or window expired
      this.requests.set(key, {
        count: 1,
        resetTime: now + this.windowMs
      });
      return true;
    }

    if (entry.count >= limit) {
      return false;
    }

    entry.count++;
    return true;
  }

  cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.requests.entries()) {
      if (now > entry.resetTime) {
        this.requests.delete(key);
      }
    }
  }

  clear() {
    this.requests.clear();
  }

  getStats() {
    return {
      activeKeys: this.requests.size,
      windowMs: this.windowMs
    };
  }
}

// =============================================================================
// AI ENGINE
// =============================================================================

export class AIEngine {
  private ai: GoogleGenAI;
  private rateLimiter = new RateLimiter();
  private responseCache = new Map<string, { response: string; timestamp: number }>();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor() {
    // Initialize Gemini client with API key
    this.ai = new GoogleGenAI({
      apiKey: config.GEMINI_API_KEY || process.env.GEMINI_API_KEY
    });

    // Set up periodic cleanup for rate limiter and cache
    setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000); // Every 5 minutes
  }

  /**
   * Analyze if a message requires an AI response and generate one if needed
   */
  async analyzeQuestion(
    message: string,
    knowledgeBase: string,
    settings: BotSettings,
    companyId: string,
    shouldForceResponse: boolean = false,
    username?: string
  ): Promise<string | null> {
    try {
      // Input validation
      if (!message || message.trim().length === 0) {
        return null;
      }

      // Sanitize and truncate message
      const cleanMessage = sanitizeText(message);
      const truncatedMessage = truncateText(cleanMessage, config.MAX_MESSAGE_LENGTH);

      // Rate limiting
      if (!this.rateLimiter.isAllowed(`ai_${companyId}`, config.AI_RATE_LIMIT_PER_MINUTE)) {
        logger.warn('AI rate limit exceeded', { companyId, message: truncatedMessage.substring(0, 50) });
        return null;
      }

      // Check cache for recent identical questions
      const cacheKey = `${companyId}:${truncatedMessage.toLowerCase().trim()}`;
      const cachedEntry = this.responseCache.get(cacheKey);
      if (cachedEntry && Date.now() < cachedEntry.timestamp + this.CACHE_TTL_MS) {
        logger.debug('Returning cached response', { 
          companyId, 
          messagePreview: truncatedMessage.substring(0, 50) 
        });
        return username && !cachedEntry.response.includes(`@${username}`) 
          ? `@${username} ${cachedEntry.response}` 
          : cachedEntry.response;
      }

      // If bot should force response (mentioned or replying to bot), skip question detection
      const shouldRespond = shouldForceResponse || isQuestion(truncatedMessage);
      
      if (!shouldRespond) {
        logger.debug('Message does not appear to be a question and no forced response needed', { 
          companyId, 
          messagePreview: truncatedMessage.substring(0, 50),
          shouldForceResponse
        });
        return null;
      }

      // Check preset Q&A first
      const presetResponse = this.checkPresetQA(truncatedMessage, settings.presetQA || [], username);
      if (presetResponse) {
        logger.info('Found preset Q&A match', { 
          companyId, 
          messagePreview: truncatedMessage.substring(0, 50),
          responseLength: presetResponse.length,
          shouldForceResponse
        });
        return presetResponse;
      }

      // AI analysis - skip question detection if forced response
// AI analysis - skip question detection if forced response
if (!shouldForceResponse) {
  const analysisResult = await this.isQuestionAnalysis(truncatedMessage);

  if (analysisResult === "NO") {
    logger.debug('AI determined message is not a question', { 
      companyId, 
      messagePreview: truncatedMessage.substring(0, 50) 
    });
    return null;
  }

  if (analysisResult === "GREET") {
    logger.debug('AI detected greeting', { 
      companyId, 
      messagePreview: truncatedMessage.substring(0, 50) 
    });

    // Simple friendly reply
    const greetingResponse = username 
      ? `@${username} Hello! 👋 How can I help you today?` 
      : `Hello! 👋 How can I help you today?`;

    return greetingResponse;
  }
}


      // Generate AI response
      const aiResponse = await this.generateAIResponse(truncatedMessage, knowledgeBase, settings, companyId, shouldForceResponse, username);
      if (aiResponse) {
        // Store in cache (without username mention for reuse)
        const responseToCache = aiResponse.startsWith(`@${username}`) 
          ? aiResponse.substring(`@${username} `.length) 
          : aiResponse;
        this.responseCache.set(cacheKey, {
          response: responseToCache,
          timestamp: Date.now()
        });

        logger.info('Generated new AI response', { 
          companyId, 
          messagePreview: truncatedMessage.substring(0, 50),
          responseLength: aiResponse.length,
          shouldForceResponse
        });
      }

      return aiResponse;

    } catch (error) {
      logger.error('Error in AI analysis', error as Error, { 
        companyId, 
        messagePreview: message.substring(0, 50),
        shouldForceResponse
      });
      return null;
    }
  }

  /**
   * Check if message matches any preset Q&A with improved semantic matching
   */
  private checkPresetQA(message: string, presetQA: Array<{question: string, answer: string, enabled: boolean}>, username?: string): string | null {
    if (!presetQA || presetQA.length === 0) {
      return null;
    }

    const messageLower = message.toLowerCase().trim();

    // First pass: Try direct matching for efficiency
    for (const qa of presetQA) {
      if (!qa.enabled) continue;

      const questionLower = qa.question.toLowerCase().trim();

      // Skip very short questions (less than 3 chars)
      if (questionLower.length < 3) {
        continue;
      }

      // 1. Exact match (case insensitive)
      if (messageLower === questionLower) {
        logger.debug('Preset Q&A exact match found', {
          question: qa.question,
          messagePreview: message.substring(0, 50)
        });
        return username ? `@${username} ${qa.answer}` : qa.answer;
      }

      // 2. Contains match for short questions
      if (questionLower.length <= 15 && messageLower.includes(questionLower)) {
        logger.debug('Preset Q&A contains match found', {
          question: qa.question,
          messagePreview: message.substring(0, 50)
        });
        return username ? `@${username} ${qa.answer}` : qa.answer;
      }
    }

    // Second pass: Try semantic/fuzzy matching
    // This is where we implement more flexible matching

    // Extract key entities and concepts from the message
    const normalizedMessage = this.normalizeQuestion(messageLower);
    
    // Track best match
    let bestMatch = {
      qa: null as any,
      score: 0
    };

    for (const qa of presetQA) {
      if (!qa.enabled) continue;

      const questionLower = qa.question.toLowerCase().trim();
      const normalizedQuestion = this.normalizeQuestion(questionLower);
      
      // Skip very short questions to prevent false matches
      if (questionLower.length < 5) {
        continue;
      }

      // 3. Name/entity recognition
      // "Who is John?" should match "Who's John?" or "Tell me about John"
      const nameMatch = this.matchNames(normalizedMessage, normalizedQuestion);
      if (nameMatch && nameMatch.score > 0.8) {
        logger.debug('Preset Q&A name match found', {
          question: qa.question,
          messagePreview: message.substring(0, 50),
          score: nameMatch.score
        });
        return username ? `@${username} ${qa.answer}` : qa.answer;
      }
      
      // 4. Semantic similarity scoring
      const similarityScore = this.calculateSimilarity(normalizedMessage, normalizedQuestion);
      
      // Update best match if this score is higher
      if (similarityScore > bestMatch.score && similarityScore > 0.7) {
        bestMatch = {
          qa,
          score: similarityScore
        };
      }
    }

    // If we found a good semantic match
    if (bestMatch.qa && bestMatch.score > 0.7) {
      logger.debug('Preset Q&A semantic match found', {
        question: bestMatch.qa.question,
        messagePreview: message.substring(0, 50),
        score: bestMatch.score
      });
      return username ? `@${username} ${bestMatch.qa.answer}` : bestMatch.qa.answer;
    }

    // No match found
    return null;
  }

  /**
   * Normalize a question for better matching by removing filler words and standardizing format
   */
  private normalizeQuestion(text: string): string {
    // Remove filler words and standardize punctuation
    const fillerWords = ['a', 'an', 'the', 'is', 'are', 'was', 'were', 'will', 'would', 'should', 'could', 'do', 'does', 'did', 'has', 'have', 'had', 'can', 'may', 'might', 'must', 'shall', 'please', 'about'];
    
    let normalized = text.toLowerCase()
      .replace(/[^\w\s?]/g, ' ')        // Replace punctuation with spaces
      .replace(/\s+/g, ' ')             // Replace multiple spaces with a single space
      .trim();

    // Remove common filler words when they're standalone
    normalized = ' ' + normalized + ' ';
    for (const word of fillerWords) {
      normalized = normalized.replace(new RegExp(` ${word} `, 'g'), ' ');
    }
    
    // Handle common question variants
    normalized = normalized
      .replace(/^who is /i, 'who ')
      .replace(/^what is /i, 'what ')
      .replace(/^where is /i, 'where ')
      .replace(/^when is /i, 'when ')
      .replace(/^why is /i, 'why ')
      .replace(/^how is /i, 'how ')
      .replace(/^tell me about /i, 'who ')
      .replace(/^tell me /i, '');
    
    return normalized.trim();
  }

  /**
   * Check if names/entities in two questions match
   */
  private matchNames(message: string, question: string): { matched: boolean, score: number } | null {
    // Extract potential names (capitalized words or words after "who is", "about", etc.)
    const namePatterns = [
      /who(?:'s| is| are)? ([a-zA-Z0-9\s]+)/i,
      /about ([a-zA-Z0-9\s]+)/i,
      /([A-Z][a-z]+)/g
    ];

    // Try to extract names from both message and question
    let messageNames: string[] = [];
    let questionNames: string[] = [];
    
    for (const pattern of namePatterns) {
      const msgMatches = message.match(pattern);
      const qMatches = question.match(pattern);
      
      if (msgMatches) messageNames = [...messageNames, ...msgMatches.slice(1)];
      if (qMatches) questionNames = [...questionNames, ...qMatches.slice(1)];
    }
    
    // Clean up extracted names
    messageNames = messageNames
      .filter(name => name && name.length > 2)
      .map(name => name.toLowerCase().trim());
    
    questionNames = questionNames
      .filter(name => name && name.length > 2)
      .map(name => name.toLowerCase().trim());
    
    // If both have extracted names, check for matches
    if (messageNames.length > 0 && questionNames.length > 0) {
      for (const msgName of messageNames) {
        for (const qName of questionNames) {
          // Check for direct match or contained match for longer names
          if (msgName === qName || 
              (qName.length > 5 && msgName.includes(qName)) || 
              (msgName.length > 5 && qName.includes(msgName))) {
            
            return { 
              matched: true, 
              score: msgName === qName ? 1.0 : 0.85  // Exact match gets perfect score
            };
          }
        }
      }
    }
    
    return null;
  }

  
  /**
   * Calculate word-based similarity score between two texts
   */
  private calculateSimilarity(text1: string, text2: string): number {
    // Simple word overlap algorithm
    const words1 = new Set(text1.split(' '));
    const words2 = new Set(text2.split(' '));
    
    // Calculate Jaccard similarity
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);
    
    if (union.size === 0) return 0;
    
    // Calculate weighted score based on matching keywords
    let score = intersection.size / union.size;
    
    // Boost score if the texts share multiple meaningful words (not just common words)
    const significantMatches = [...intersection].filter(word => 
      word.length > 3 && 
      !['what', 'when', 'where', 'which', 'who', 'why', 'how'].includes(word)
    );
    
    if (significantMatches.length >= 2) {
      score += 0.2; // Boost if multiple significant words match
    }
    
    return Math.min(1.0, score); // Cap at 1.0
  }

  /**
   * Cleanup expired cache entries and rate limits
   */
  private cleanup() {
    const now = Date.now();
    let cleanedCount = 0;

    // Clean rate limiter
    this.rateLimiter.cleanup();

    // Clean response cache
    for (const [key, entry] of this.responseCache.entries()) {
      if (now > entry.timestamp + this.CACHE_TTL_MS) {
        this.responseCache.delete(key);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.debug('AI engine cleanup completed', { 
        cleanedCacheEntries: cleanedCount,
        remainingCacheSize: this.responseCache.size
      });
    }
  }

  /**
   * Clear rate limits (for admin commands)
   */
  clearRateLimits() {
    this.rateLimiter.clear();
    this.responseCache.clear();
    logger.debug('Cleared AI rate limits and response cache');
  }

  /**
   * Get stats for monitoring
   */
  getStats() {
    return {
      responseCache: {
        size: this.responseCache.size,
        maxSize: 0,
        ttlMs: this.CACHE_TTL_MS
      },
      rateLimiter: this.rateLimiter.getStats(),
      model: config.GEMINI_MODEL || "gemini-2.5-flash",
      rateLimitPerMinute: config.AI_RATE_LIMIT_PER_MINUTE
    };
  }

  /**
   * Use AI to determine if a message is actually a question
   */
  private async isQuestionAnalysis(message: string): Promise<"YES" | "NO" | "GREET"> {
  try {
    const response = await retry(async () => {
      const result = await this.ai.models.generateContent({
        model: config.GEMINI_MODEL || "gemini-2.5-flash",
        contents: [
          createQuestionAnalysisPrompt(),
          message
        ],
        config: {
          maxOutputTokens: 10,
          temperature: 0.1
        }
      });

      return result.text;
    });

    const result = response?.trim().toUpperCase();
    if (result === "YES" || result === "GREET") return result;
    return "NO";
    
  } catch (error) {
    logger.error('Error in question analysis', error as Error, { messagePreview: message.substring(0, 50) });
    // Default to "YES" if analysis fails
    return "YES";
  }
}


  /**
   * Generate AI response using Gemini
   */
  private async generateAIResponse(
    message: string, 
    knowledgeBase: string, 
    settings: BotSettings,
    companyId: string,
    shouldForceResponse: boolean,
    username?: string
  ): Promise<string | null> {
    try {
      const systemPrompt = createSystemPrompt(knowledgeBase, settings, shouldForceResponse);
      
      const response = await retry(async () => {
        // Using Gemini syntax
        const result = await this.ai.models.generateContent({
          model: config.GEMINI_MODEL || "gemini-2.5-flash",
          contents: [
            {
              role: "system",
              parts: [{ text: systemPrompt }]
            },
            {
              role: "user",
              parts: [{ text: message }]
            }
          ],
          config: {
            maxOutputTokens: config.MAX_AI_RESPONSE_TOKENS || 800,
            temperature: 0.7
          }
        });
        
        return result.text;
      });

      let aiResponse = response?.trim();
      
      // Filter out ANY response that indicates uncertainty or inability to help
      if (aiResponse) {
        const responseLower = aiResponse.toLowerCase();
        
        // Comprehensive list of phrases that indicate the AI can't/shouldn't respond
        const cantHelpPhrases = [
          'i don\'t have',
          'i cannot',
          'i can\'t',
          'don\'t have information',
          'cannot provide',
          'can\'t provide',
          'unable to',
          'not able to',
          'no information',
          'don\'t know',
          'cannot answer',
          'can\'t answer',
          'not sure',
          'unclear',
          'contact the',
          'ask the admin',
          'ask an admin',
          'check with',
          'not specified',
          'not mentioned',
          'doesn\'t say',
          'does not say',
          'no details',
          'not clear',
          'not available'
        ];
        
        // If response contains any "can't help" phrases, don't respond
        if (cantHelpPhrases.some(phrase => responseLower.includes(phrase))) {
          logger.debug('Filtered out uncertain/unhelpful response', {
            companyId,
            messagePreview: message.substring(0, 50),
            filteredResponse: aiResponse.substring(0, 100)
          });
          return null;
        }
      }
      
      // Add username mention if provided and not already included
      if (aiResponse && username && !aiResponse.includes(`@${username}`)) {
        aiResponse = `@${username} ${aiResponse}`;
      }
      
      return aiResponse || null;

    } catch (error) {
      logger.error('Error generating AI response', error as Error, { messagePreview: message.substring(0, 50) });
      return null;
    }
  }
}

// Create and export singleton instance
export const aiEngine = new AIEngine();
