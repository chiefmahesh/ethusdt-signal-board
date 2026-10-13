# ETHUSDT Signal Board

A single-page, live dashboard that turns ETH/USDT market data into a plain trading read: **current price, support, resistance, nearest liquidity on both sides, and a Long % / Short % bias** scored from a 9-indicator matrix. It refreshes itself every hour and works on phone, tablet and desktop.

![ETHUSDT Signal Board on desktop, dark theme](screenshots/desktop-dark.png)

<p align="center">
  <img src="screenshots/mobile-dark.png" alt="Signal Board on a phone, dark theme" width="300">
  &nbsp;&nbsp;
  <img src="screenshots/mobile-light.png" alt="Signal Board on a phone, light theme" width="300">
</p>

> Screenshots show sample data captured on 12 Oct 2026. Live numbers will differ.

---

## Contents

- [What it shows](#what-it-shows)
- [Data sources](#data-sources)
- [The 9-indicator matrix](#the-9-indicator-matrix)
- [Support, resistance and liquidity](#support-resistance-and-liquidity)
- [Running it](#running-it)
- [Manual inputs](#manual-inputs)
- [Interface](#interface)
- [Project structure](#project-structure)
- [Changing the rules](#changing-the-rules)
- [Limitations](#limitations)
- [Disclaimer](#disclaimer)

---

## What it shows

The top card gives the answer in the same five lines every time:

```
Current value: $2,554.62 (24h +45.42, +1.81%)
Support: $2,406.84 (downside liquidity swept)
Resistance: $2,587.33 ($2,519.68 passed, now first support on a retest)
Long: 55%
Short: 45%
```

Below it:

| Section | What you get |
|---|---|
| **24h change** | Under the price: the change over the last 24 hours in dollars and percent, e.g. ▲ +45.42 (+1.81%) · 24h, green when up and red when down |
| **Long / Short bar** | The bias as a split bar, plus a one-line summary ("Long-favoured. 2 signals lean long, 1 leans short, 6 neutral.") |
| **Nearest liquidity** | The three closest liquidity pools above price (buy-side) and below price (sell-side), each with its distance in %, plus the biggest order-book wall on each side |
| **9-indicator matrix** | Every indicator's live value and whether it adds Long +5, Short +5 or stays neutral |
| **Manual inputs** | Optional boxes to override funding rate and the long/short account ratio |
| **Copy summary** | Copies the five lines plus the two nearest liquidity levels, ready to paste anywhere |

## Data sources

The page picks its source automatically, based on where it is opened:

| Opened in | Source | What it pulls |
|---|---|---|
| **claude.ai** (as a published artifact) | Crypto.com connector | ETH_USDT ticker (price and 24h change), 4H and 1D candles (50 each), BTC_USDT 1D candles, last 150 trades, order book (50 levels), ETH perpetual mark price, ETH index price, perpetual open interest |
| **A browser** (local file or any web host) | Binance public API, no key needed | ETHUSDT 24h ticker (price and 24h change), 4H candles (150), 1D candles (60), BTCUSDT 1D candles, last 500 aggregated trades, order book (1,000 levels), and from Binance Futures: funding rate, mark/index price, open interest, global long/short account ratio |

The header shows which source is active, for example `Crypto.com spot · hourly` or `Binance (data-api.binance.vision) · hourly`.

In browser mode the page tries seven Binance market-data hosts in order until one answers: `data-api.binance.vision`, `api.binance.com`, `api1` to `api4.binance.com`, and `api-gcp.binance.com`. If Binance Futures can't be reached, the funding and long/short rows fall back to the manual boxes.

## The 9-indicator matrix

The bias starts at **50 / 50**. Each indicator moves it by **5 points** toward Long or Short, or leaves it alone. The final value is clamped between 5% and 95%.

| # | Indicator | Timeframe | Long +5 when | Short +5 when |
|---|---|---|---|---|
| 1 | **BTC trend** | 1D | BTC is above its EMA 20 and EMA 10 > EMA 20 | BTC is below its EMA 20 and EMA 10 < EMA 20 |
| 2 | **Structure & liquidity** | 4H | Price has closed above a recent 4H swing high (last 15 bars) | Price has closed below a recent 4H swing low (last 15 bars) |
| 3 | **ATR (14) volatility** | 1D | Never (information only) | Never |
| 4 | **Funding rate** | 8H | Funding is negative (shorts paying) | Funding is 0.01% or higher (crowded longs) |
| 5 | **Long/short ratio** | 8H | 40% or fewer accounts are long (contrarian) | 60% or more accounts are long (contrarian) |
| 6 | **EMA stack** | 4H | 10 > 20 > 50 (> 100 when available) | 10 < 20 < 50 (< 100 when available) |
| 7 | **RSI (14) momentum** | 4H | RSI 60 to 70, or RSI 30 or below (oversold) | RSI 70 or above (overbought), or RSI 30 to 40 |
| 8 | **Taker flow** (CVD proxy) | Live | More than 55% of recent trade volume was taker buys | Less than 45% was taker buys |
| 9 | **Volume** | 4H | Last closed bar is 1.2× its 20-bar average on a green candle, or volume is low (0.8× or less) after a fall | Same high volume on a red candle, or low volume after a rise (move unconfirmed) |

**Funding source, in order of priority:**

1. A value typed into the manual box
2. Binance's live funding rate (browser mode)
3. On Crypto.com, the gap between the ETH perpetual's mark price and the spot index. A premium of +0.05% or more counts as crowded longs (Short +5), and −0.05% or less counts as Long +5.

**EMA stack:** Crypto.com returns 50 candles, so the stack uses EMA 10/20/50. Binance returns 150, so EMA 100 is added.

## Support, resistance and liquidity

All levels come from closed candles only. The candle that is still forming is ignored.

| Level | How it is found |
|---|---|
| **Support** | The lowest 4H low of the last 50 closed bars (about 8 days). Labelled "downside liquidity swept" when price has since recovered more than 3% above it. |
| **Resistance** | The nearest 4H swing high above price. If none exists in the window, the 50-bar high. |
| **Passed level** | The highest swing high below price formed in the last 15 bars, i.e. a resistance price has broken. It is shown as the first support on a retest. |
| **Swing high / low** | A bar whose high (or low) is beyond the two bars on each side of it. |
| **Liquidity pools** | Swing highs above price and swing lows below price, on both 4H and 1D, that price has **not traded through since**. Stop orders tend to cluster just beyond them. The three nearest on each side are shown, merged so levels within 0.2% of each other count once. Two swings within 0.15% are tagged **equal levels**, a stronger pool. |
| **Order-book walls** | The largest resting ask and bid in the order book snapshot. The note under each shows how far that snapshot reaches. |

The note under the liquidity cards names the **nearer pool**. Price often reaches for the closer pool first, and a quick sweep through it followed by a reversal is a common trap.

## Running it

### Option 1: inside claude.ai (Crypto.com data)

1. Connect the **Crypto.com** connector in claude.ai (no account or API key needed).
2. Open the published artifact. The first time, allow it to use Crypto.com.
3. It loads immediately and refreshes every hour while open.

### Option 2: in a browser (Binance data)

1. Download `index.html`.
2. Open it in **Chrome, Edge, Firefox or Safari**. On Android, open it **with Chrome** (long-press the file → Open with → Chrome). The built-in "HTML Viewer" and the in-app preview in the Claude app block outside connections.
3. It refreshes every hour while the tab stays open.

To check whether your network can reach Binance, open this in your browser:

```
https://data-api.binance.vision/api/v3/ticker/price?symbol=ETHUSDT
```

If it shows a price, the board will work. If not, Binance is blocked on that network. Try mobile data or use Option 1.

### Option 3: GitHub Pages

1. In this repository go to **Settings → Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**, branch `main`, folder `/ (root)`.
3. Open `https://chiefmahesh.github.io/ethusdt-signal-board/`. It runs in browser mode with Binance data.

## Manual inputs

| Box | When to use it | Effect |
|---|---|---|
| **Funding %** | To use a specific funding rate, e.g. `0.0024` | Overrides the live value. 0.01% or more → Short +5. Negative → Long +5. |
| **Long accounts %** | On Crypto.com, which has no long/short ratio, e.g. `65` | 60% or more → Short +5. 40% or less → Long +5. |

Leave a box blank to use the live value. Typed values are saved in that browser only.

## Interface

- **Responsive.** Phone: one column, and the indicator table turns into cards. Tablet: the two liquidity panels sit side by side. Desktop (1024px and wider): two columns, with the verdict and liquidity on the left (kept in view while scrolling) and the matrix and inputs on the right.
- **Light and dark themes** follow the device setting.
- **Refresh animation.** The icon spins and a progress line sweeps the button. Values dim while loading. When data arrives, the price counts to its new value with a green or red glow showing which way it moved since the last refresh, changed indicators flash, and the button shows **Updated** (or **Failed**, with a shake).
- **No layout jumping.** Placeholders reserve the space real values will take, and the refresh button has a fixed width, so nothing moves during load or refresh.
- **Reduced motion.** With the device's "reduce motion" setting on, animations are switched off.

## Project structure

```
ethusdt-signal-board/
├── index.html          Built page: open this, or host it (generated by build.py)
├── build.py            Inlines src/engine.js into src/page.src.html → index.html
├── src/
│   ├── engine.js       All calculations: EMA, RSI, ATR, swing pivots, scoring, liquidity pools
│   └── page.src.html   Layout, styles, data fetching (Crypto.com and Binance), animations
└── screenshots/
    ├── desktop-dark.png
    ├── desktop-light.png
    ├── mobile-dark.png
    └── mobile-light.png
```

The page is self-contained. It needs no build tools, packages or server, and the only external request besides market data is the IBM Plex font from Google Fonts. Without the font it falls back to the system font.

After editing anything in `src/`, rebuild:

```bash
python3 build.py
```

## Changing the rules

All scoring lives in `src/engine.js`, inside `analyze()`. Each indicator is one `add(...)` call. The last argument is its points (`5` = Long +5, `-5` = Short +5, `0` = neutral).

| To change | Look for |
|---|---|
| Points per signal | The `5` / `-5` values in each `add(...)` call |
| RSI bands | `if (r >= 70)` … `else if (r <= 40)` |
| Taker flow thresholds | `buyShare > 55` / `buyShare < 45` |
| Volume thresholds | `ratio >= 1.2` / `ratio <= 0.8` |
| Funding thresholds | `funding >= 0.01` (typed or Binance) and `premium >= 0.05` (Crypto.com proxy) |
| Long/short thresholds | `lsLong >= 60` / `lsLong <= 40` |
| Swing detection width | `pivots(win, 2)` (2 bars each side) |
| Support window | `closed4h.slice(-50)` |
| Equal-level tolerance | `0.0015` in `pools()` (0.15%) |
| Refresh interval | `const HOUR = 3600000;` in `src/page.src.html` |

`engine.js` has no dependencies and also runs in Node.js:

```js
require("./src/engine.js");
const result = globalThis.EthEngine.analyze({ price, eth4h, eth1d, btc1d, trades });
```

Candles are arrays of `{ t, o, h, l, c, v }` sorted oldest first. Trades are `{ side: "buy" | "sell", q }`.

## Limitations

- **No liquidation heatmap.** No free data source provides one. The liquidity pools are an estimate of where stop orders sit, based on untouched swing levels.
- **CVD is approximated** from the most recent trades (150 on Crypto.com, 500 on Binance), not a cumulative series.
- **Crypto.com has no long/short account ratio**, so that row stays neutral there unless you type a value.
- **Crypto.com funding is a proxy** (perpetual premium over the index), not an actual funding rate.
- **Crypto.com's order book is shallow** (50 levels, about ±$2 from price), so its walls only describe the price right next to market.
- **Prices differ slightly between exchanges.** Crypto.com and Binance usually agree within a few dollars.
- **Updates need the page open.** It refreshes hourly only while the tab or artifact is open, and doesn't send notifications.

## Disclaimer

This board applies fixed rules to public market data. It is **not financial advice** and makes no prediction about price. Crypto trading carries a high risk of loss. Do your own research and manage your risk.
