import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/v1/subjects': {
        target: process.env.RESOLVER_ORIGIN ?? 'http://127.0.0.1:4311',
        changeOrigin: true,
      },
      '/v1/chat': {
        target: process.env.CHAT_ORIGIN ?? 'http://127.0.0.1:4310',
        changeOrigin: true,
      },
      '/v1/run-activities': {
        target: process.env.CHAT_ORIGIN ?? 'http://127.0.0.1:4310',
        changeOrigin: true,
      },
      '/v1/analyze': {
        target: process.env.DEV_API_ORIGIN ?? 'http://127.0.0.1:4312',
        changeOrigin: true,
      },
      '/v1/agents': {
        target: process.env.DEV_API_ORIGIN ?? 'http://127.0.0.1:4312',
        changeOrigin: true,
      },
      '/v1/dev': {
        target: process.env.DEV_API_ORIGIN ?? 'http://127.0.0.1:4312',
        changeOrigin: true,
      },
      '/v1/themes': {
        target: process.env.DEV_API_ORIGIN ?? 'http://127.0.0.1:4312',
        changeOrigin: true,
      },
      '/v1/watchlists': {
        target: process.env.WATCHLISTS_ORIGIN ?? 'http://127.0.0.1:4313',
        changeOrigin: true,
      },
      '/v1/market': {
        target: process.env.MARKET_ORIGIN ?? 'http://127.0.0.1:4321',
        changeOrigin: true,
      },
      '/v1/markets': {
        target: process.env.MARKET_ORIGIN ?? 'http://127.0.0.1:4321',
        changeOrigin: true,
      },
      '/v1/balances': {
        target: process.env.DEV_API_ORIGIN ?? 'http://127.0.0.1:4312',
        changeOrigin: true,
      },
      '/v1/impact': {
        target: process.env.DEV_API_ORIGIN ?? 'http://127.0.0.1:4312',
        changeOrigin: true,
      },
      // `/v1/briefs/daily` and `/v1/briefs/{id}/outcomes` are still served by the
      // commodities decision API on dev-api; only the new daily-call CRUD routes
      // move to the briefs service. Regex keys (leading `^`) are matched first,
      // so these stay on dev-api while everything else under /v1/briefs routes to
      // the briefs service. (Remove when the decision API stub is superseded.)
      '^/v1/briefs/daily': {
        target: process.env.DEV_API_ORIGIN ?? 'http://127.0.0.1:4312',
        changeOrigin: true,
      },
      '^/v1/briefs/[^/]+/outcomes': {
        target: process.env.DEV_API_ORIGIN ?? 'http://127.0.0.1:4312',
        changeOrigin: true,
      },
      '/v1/briefs': {
        target: process.env.BRIEFS_ORIGIN ?? 'http://127.0.0.1:4337',
        changeOrigin: true,
      },
      '/v1/fundamentals': {
        target: process.env.FUNDAMENTALS_ORIGIN ?? 'http://127.0.0.1:4322',
        changeOrigin: true,
      },
      '/v1/screener': {
        target: process.env.SCREENER_ORIGIN ?? 'http://127.0.0.1:4323',
        changeOrigin: true,
      },
      '/v1/portfolios': {
        target: process.env.PORTFOLIO_ORIGIN ?? 'http://127.0.0.1:4333',
        changeOrigin: true,
      },
      '/v1/home': {
        target: process.env.HOME_ORIGIN ?? 'http://127.0.0.1:4334',
        changeOrigin: true,
      },
      '/v1/evidence': {
        target: process.env.EVIDENCE_ORIGIN ?? 'http://127.0.0.1:4335',
        changeOrigin: true,
      },
    },
  },
})
