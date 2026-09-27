# Dalal Pulse

A free, always-on website with Moneycontrol news **grouped by stock**, technicals, 52-week highs and lows, a sector heatmap, a results calendar, a private portfolio tracker, and **automated insights**. The insights are rule-based, with no AI model and no API keys.

## How it works
- `scripts/build-data.js` runs on **GitHub Actions** every 15 minutes during Indian market hours (hourly otherwise). It fetches:
  - Moneycontrol headlines (direct RSS plus Google News, filtered to moneycontrol.com)
  - Prices and 1-year history for the Nifty 200 (Yahoo Finance)
  - Indices, sectors, FII/DII flows, 52-week lists and the corporate calendar (NSE), with fallbacks if NSE is unreachable
- It scores every headline's tone, combines it with trend, moving averages, RSI, volume and the 52-week range, and writes a plain-English insight for each stock plus an overall market-mood score.
- The result is published to **GitHub Pages**. The page checks for new data every minute while it's open.

## Files
| Path | What it is |
|---|---|
| `site/` | The website (HTML/CSS/JS, no frameworks) |
| `scripts/build-data.js` | Data builder |
| `scripts/lib/insights.js` | The rules behind the insights (tone words and scoring) |
| `config.json` | Title, stock universe, extra symbols to track, news window |
| `.github/workflows/update.yml` | The 15-minute schedule (kept as `github-workflow/update.yml` on your PC) |

## Change what's tracked
Edit `config.json` on GitHub. For example, add stocks outside the Nifty 200:
```json
"extra_symbols": [{"symbol": "IRCTC", "name": "Indian Railway Catering and Tourism Corporation"}]
```

## Notes
- Portfolio, watchlist and alerts are stored only in each visitor's browser.
- GitHub may run scheduled jobs a few minutes late at busy times.
- For information only, not investment advice.
