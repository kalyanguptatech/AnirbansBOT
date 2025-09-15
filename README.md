# 🤖 Whop AI Bot bot

**A production-ready AI support bot for Whop communities with intelligent response optimization and cost-efficient token usage.**

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-000000?logo=next.js&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?logo=postgresql&logoColor=white)

## ✨ What It Does

Transform your Whop community with an AI-powered support bot that:

- **🧠 Smart Question Detection** - Only processes actual questions, saving 80%+ on AI costs
- **⚡ Instant Preset Answers** - Common questions get immediate responses without AI calls
- **📚 Knowledge Base Integration** - AI responses tailored to your community's specific information
- **🔒 Admin-Only Configuration** - Secure dashboard accessible only to company admins
- **💰 Cost Optimized** - Advanced caching and filtering dramatically reduces API usage
- **🔄 Real-time Responses** - WebSocket-based for instant message processing
- **📊 Production Ready** - Built-in rate limiting, error handling, and monitoring

## 🚀 Key Features

- **Smart question detection**: Only responds to actual questions and support requests
- **Preset Q&A system**: Instant responses for common questions
- **AI-powered responses**: Context-aware answers using company knowledge base
- **Rate limiting**: Prevents API quota exhaustion (10 requests/minute per company)
- **Multiple response styles**: Professional, friendly, casual, technical, or custom
- **User mentions**: Always mentions the user being responded to
- **Context awareness**: Maintains conversation context for better responses
- **Admin controls**: Easy management through the Dashboard

## 💡 Cost Savings

This bot is designed for efficiency:

- **80-90% token reduction** compared to processing all messages
- **Smart caching** prevents duplicate AI calls
- **Preset answers** bypass AI entirely for common questions
- **Message filtering** skips non-questions, spam, and duplicates

**Example**: Instead of 1000 AI calls per day, you might only make 100-200, saving hundreds of dollars monthly.

## 🛠️ Tech Stack

- **Backend**: Next.js 15 with TypeScript
- **Database**: PostgreSQL with Prisma ORM
- **AI**: OpenRouter (Claude, GPT-4, Gemini, etc.)
- **Platform**: Whop SDK for community integration
- **UI**: React with Framer Motion animations
- **Styling**: Tailwind CSS with shadcn/ui components

## 📋 Requirements

- Node.js 18+ and npm/pnpm
- PostgreSQL database (Supabase recommended)
- OpenRouter API key
- Whop App API key and Bot User ID

## 🎯 Perfect For

- **Community managers** who want to reduce support workload
- **Course creators** with frequently asked questions
- **SaaS companies** running communities on Whop
- **Anyone** looking to provide 24/7 AI support while controlling costs

## 🚀 Quick Start & Development

### Prerequisites
   ```bash
# Clone the repository
git clone https://github.com/yourusername/whop-ai-bot.git
cd whop-ai-bot

# Install dependencies
   npm install
# or
pnpm install
   ```

### Environment Setup
   ```bash
# Copy environment template
   cp env.example .env

# Edit .env with your credentials:
# - DATABASE_URL (PostgreSQL)
# - OPENROUTER_API_KEY
# - WHOP_API_KEY
# - BOT_USER_ID
   ```

### Database Setup
   ```bash
# Push schema to database
   npm run db:push

# (Optional) Open Prisma Studio
npm run db:studio
   ```

### Development Mode

**Important**: For Whop integration to work properly, you must install and use the Whop dev proxy:

   ```bash
# First, install the Whop dev proxy globally
npm install @whop-apps/dev-proxy -g

# Then start the development server with proxy
whop-proxy --command 'npx next dev --turbopack'
```

**⚠️ Do NOT use `npm run dev` alone** - it won't include the Whop proxy and iframe integration won't work!

**Before installing the app**: Configure your Whop app settings:
- **Base URL**: `http://localhost:3000/`
- **App path**: `/company/[companyId]`

The bot will automatically start listening for WebSocket connections when you visit the dashboard at `http://localhost:3000/company/[companyId]`.

### Production Deployment

```bash
# Build for production
npm run build

# Start production server
npm start

# Run bot independently (if needed)
npm run bot
```

## 🏗️ Architecture

The bot uses a modular architecture:

- **Core Bot**: WebSocket connection and message orchestration
- **AI Engine**: Smart question processing and response generation
- **Data Manager**: Settings persistence and caching
- **API Services**: Whop platform integration and message sending

## 📈 Monitoring

Built-in monitoring includes:

- Message processing statistics
- AI API usage tracking
- Cache hit/miss ratios
- Error rates and types
- System health metrics

## 🔒 Security

- **Admin-only access** to configuration
- **Input sanitization** and validation
- **Rate limiting** to prevent abuse
- **Environment variable protection**

## 📝 License

MIT License - feel free to use this for your own communities!

---

**Ready to get started?** Check out the installation documentation to set up your AI bot in minutes.

**Need help?** Create an [issue](https://github.com/whop-ai-bot/issues) or join the community discussion. 
