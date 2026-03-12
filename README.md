# ◈ PRISM — Knowledge Lineage Engine

Give it an idea. It gives you back 2,500 years of intellectual DNA.

Prism traces the intellectual lineage of any claim, belief, or idea — mapping predecessors, challengers, and descendants as a force-directed graph. A second-pass "Blind Spot" analysis finds the unstated assumption that all sides of the debate share.

## Deploy to Vercel (5 minutes)

### Prerequisites
- GitHub account
- [Anthropic API key](https://console.anthropic.com/) (you get $5 free credit)

### Steps

1. **Push to GitHub**
```bash
cd prism-app
git init
git add .
git commit -m "prism v0.3"
gh repo create prism --public --source=. --push
# or push manually to a new GitHub repo
```

2. **Deploy on Vercel**
- Go to [vercel.com](https://vercel.com) → Sign in with GitHub
- Click "New Project" → Import your `prism` repo
- Framework Preset: **Vite**
- Click "Deploy"

3. **Add your API key**
- In Vercel dashboard → Your project → Settings → Environment Variables
- Add: `ANTHROPIC_API_KEY` = your key starting with `sk-ant-`
- Redeploy (Deployments tab → 3 dots → Redeploy)

4. **Share the URL**
- Vercel gives you `prism-xxxxx.vercel.app`
- Send it to whoever you want

### Local development
```bash
npm install
cp .env.example .env   # add your API key
npx vercel dev          # runs both Vite + serverless functions locally
```

## Architecture

- **Frontend**: React + D3 force-directed graph
- **Backend**: Single Vercel serverless function (`/api/chat.js`) that proxies Anthropic API calls
- **Two-pass synthesis**: First call traces lineage → renders graph immediately. Second call takes full graph and finds the blind spot.
- **Client-side cache**: History loads instantly from memory, no re-queries

## Cost

With Sonnet, each trace costs ~$0.01-0.02 (two API calls). The $5 free credit gets you ~250-500 traces. After that it's pay-as-you-go. For a few friends testing it, you'll spend maybe $2/month.
