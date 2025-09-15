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

export function createSystemPrompt(
  knowledgeBase: string, 
  settings: BotSettings, 
  shouldForceResponse: boolean = false
): string {
  let systemPrompt = '';

  switch (settings.responseStyle) {
    case 'professional':
      systemPrompt = 'You are a professional AI assistant. Be clear and respectful.';
      break;
    case 'friendly':
      systemPrompt = 'You are a friendly AI assistant. Be warm, approachable, and kind.';
      break;
    case 'casual':
      systemPrompt = 'You are a casual AI assistant. Be relaxed, witty, and natural.';
      break;
    case 'technical':
      systemPrompt = 'You are a technical AI assistant. Be precise and detailed.';
      break;
    case 'custom':
      systemPrompt = settings.botPersonality || 'You are a helpful AI assistant.';
      break;
    default:
      systemPrompt = 'You are a helpful AI assistant.';
  }

  if (knowledgeBase?.trim()) {
    systemPrompt += '\n\nCommunity Information:\n' + knowledgeBase.trim();
  }

  if (settings.customInstructions?.trim()) {
    systemPrompt += '\n\nAdditional Instructions:\n' + settings.customInstructions.trim();
  }

  // NEW RULES
  systemPrompt += `
IMPORTANT:
- If the user asks about community info, use ONLY the community information above.
- If the user is greeting, small talking, or being social, reply naturally in the chosen style.
- Never say "I don't know" — for casual talk, just keep the conversation flowing.
- Keep replies under 150 words.`;

  return systemPrompt;
}

export function createQuestionAnalysisPrompt(): string {
  return `Determine if this message is a QUESTION that needs a factual AI assistant response.

Respond "YES" if the message:
- Asks about community rules, requirements, or processes
- Asks "how to" do something
- Requests specific numbers or details
- Reports a problem needing help

Respond "NO" if the message:
- Is small talk, greetings, or casual conversation
- Is vague or off-topic

If "NO", the assistant may still respond socially — but it's not a factual Q&A.`;
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
      if (!shouldForceResponse) {
        const isActualQuestion = await this.isQuestionAnalysis(truncatedMessage);
        if (!isActualQuestion) {
          logger.debug('AI determined message is not a question', { 
            companyId, 
            messagePreview: truncatedMessage.substring(0, 50) 
          });
          return null;
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
   * Check if message matches any preset Q&A
   */
  private checkPresetQA(message: string, presetQA: Array<{question: string, answer: string, enabled: boolean}>, username?: string): string | null {
    if (!presetQA || presetQA.length === 0) {
      return null;
    }

    const messageLower = message.toLowerCase().trim();

    for (const qa of presetQA) {
      if (!qa.enabled) continue;

      const questionLower = qa.question.toLowerCase().trim();

      // Skip very short questions (less than 5 chars) to prevent over-matching
      if (questionLower.length < 5) {
        continue;
      }

      // 1. Exact match only (case insensitive) - most conservative
      if (messageLower === questionLower) {
        logger.debug('Preset Q&A exact match found', {
          question: qa.question,
          answer: qa.answer,
          messagePreview: message.substring(0, 50)
        });
        return username ? `@${username} ${qa.answer}` : qa.answer;
      }

      // 2. Very strict contains match - only if the question is short and message contains it exactly
      if (questionLower.length <= 15 && messageLower.includes(questionLower)) {
        logger.debug('Preset Q&A strict contains match found', {
          question: qa.question,
          answer: qa.answer,
          messagePreview: message.substring(0, 50)
        });
        return username ? `@${username} ${qa.answer}` : qa.answer;
      }
    }

    return null;
  }

  /**
   * Use AI to determine if a message is actually a question
   */
  private async isQuestionAnalysis(message: string): Promise<boolean> {
    try {
      const response = await retry(async () => {
        // Using new Gemini syntax
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
      return result === 'YES';
      
    } catch (error) {
      logger.error('Error in question analysis', error as Error, { messagePreview: message.substring(0, 50) });
      // Default to true if AI analysis fails
      return true;
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
        // Using new Gemini syntax
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
            temperature: 0.1
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
}

// Create and export singleton instance
export const aiEngine = new AIEngine();