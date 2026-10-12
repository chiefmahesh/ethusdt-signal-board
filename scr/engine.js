// ETHUSDT signal engine. Pure functions; shared by the dashboard page and the node test.
// Candles are arrays of {t,o,h,l,c,v} sorted oldest -> newest.
(function (root) {
  function ema(vals, n) {
    if (vals.length < n) return null;
    let e = vals.slice(0, n).reduce((a, b) => a + b, 0) / n;
    const k = 2 / (n + 1);
    for (let i = n; i < vals.length; i++) e = vals[i] * k + e * (1 - k);
    return e;
  }
  function rsi(vals, n = 14) {
    if (vals.length < n + 1) return null;
    let g = 0, l = 0;
    for (let i = 1; i <= n; i++) { const d = vals[i] - vals[i - 1]; if (d > 0) g += d; else l -= d; }
    g /= n; l /= n;
    for (let i = n + 1; i < vals.length; i++) {
      const d = vals[i] - vals[i - 1];
      g = (g * (n - 1) + Math.max(d, 0)) / n;
      l = (l * (n - 1) + Math.max(-d, 0)) / n;
    }
    return l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  function atr(c, n = 14) {
    if (c.length < n + 1) return null;
    const tr = [];
    for (let i = 1; i < c.length; i++) tr.push(Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i - 1].c), Math.abs(c[i].l - c[i - 1].c)));
    let a = tr.slice(0, n).reduce((x, y) => x + y, 0) / n;
    for (let i = n; i < tr.length; i++) a = (a * (n - 1) + tr[i]) / n;
    return a;
  }
  // Pivot highs/lows with `w` bars each side, closed bars only.
  function pivots(c, w = 2) {
    const hi = [], lo = [];
    for (let i = w; i < c.length - w; i++) {
      let isH = true, isL = true;
      for (let j = i - w; j <= i + w; j++) {
        if (j === i) continue;
        if (c[j].h >= c[i].h) isH = false;
        if (c[j].l <= c[i].l) isL = false;
      }
      if (isH) hi.push({ i, p: c[i].h, t: c[i].t });
      if (isL) lo.push({ i, p: c[i].l, t: c[i].t });
    }
    return { hi, lo };
  }

  function analyze({ price, eth4h, eth1d, btc1d, trades, funding = null, lsLong = null, premium = null, oi = null, fundingSrc = "manual", lsSrc = "manual" }) {
    const rows = [];
    let long = 50;
    const add = (n, name, frame, value, longPts) => { long += longPts; rows.push({ n, name, frame, value, impact: longPts }); };

    // Closed 4H bars (last bar is still forming)
    const closed4h = eth4h.slice(0, -1);
    const closes4h = eth4h.map(x => x.c);
    const atr4h = atr(closed4h, 14);

    // 1. BTC trend (1D)
    const bc = btc1d.map(x => x.c);
    const b10 = ema(bc, 10), b20 = ema(bc, 20), bLast = bc[bc.length - 1];
    const b7 = (bLast / bc[bc.length - 8] - 1) * 100;
    let btcPts = 0, btcTxt;
    if (bLast > b20 && b10 > b20) { btcPts = 5; btcTxt = "Bullish: above EMA20, EMA10 > EMA20"; }
    else if (bLast < b20 && b10 < b20) { btcPts = -5; btcTxt = "Bearish: below EMA20, EMA10 < EMA20"; }
    else btcTxt = "Mixed: price and EMAs disagree";
    add(1, "BTC trend", "1D", `${btcTxt} · 7d ${b7 >= 0 ? "+" : ""}${b7.toFixed(1)}%`, btcPts);

    // 2. Structure / liquidity (4H)
    const win = closed4h.slice(-50);
    const pv = pivots(win, 2);
    const rangeLow = Math.min(...win.map(x => x.l));
    const rangeLowBar = win.find(x => x.l === rangeLow);
    const rangeHigh = Math.max(...win.map(x => x.h));
    const above = pv.hi.filter(p => p.p > price).sort((a, b) => a.p - b.p);
    const passed = pv.hi.filter(p => p.p < price && p.i >= win.length - 15).sort((a, b) => b.p - a.p);
    const lowsBelow = pv.lo.filter(p => p.p < price).sort((a, b) => b.p - a.p);
    const resistance = above.length ? above[0].p : rangeHigh;
    const resistanceNote = above.length ? "nearest 4H swing high above" : "50-bar range high";
    const passedLvl = passed.length ? passed[0].p : null;
    const broken = pv.lo.filter(p => p.p > price && p.i >= win.length - 15).sort((a, b) => a.p - b.p);
    const brokenLo = broken.length ? broken[0].p : null;
    const nearSupport = passedLvl || (lowsBelow.length ? lowsBelow[0].p : null);
    const sweptRecovered = (price - rangeLow) / rangeLow > 0.03;
    let stPts = 0, stTxt;
    if (passedLvl) { stPts = 5; stTxt = `Broke above swing high $${fmt(passedLvl)}`; }
    else if (brokenLo) { stPts = -5; stTxt = `Broke below swing low $${fmt(brokenLo)}`; }
    else stTxt = "Inside range, no break";
    if (sweptRecovered) stTxt += ` · lows swept at $${fmt(rangeLow)} and recovered`;
    add(2, "Structure & liquidity", "4H", stTxt, stPts);

    // 3. ATR volatility (1D)
    const atrD = atr(eth1d, 14);
    const atrPct = atrD / price * 100;
    add(3, "ATR (14) volatility", "1D", `$${fmt(atrD)} · ${atrPct.toFixed(2)}% of price`, 0);

    // 4–5. Not in the free feed
    if ((funding == null || isNaN(funding)) && premium != null && isFinite(premium)) {
      let p = 0, t = "Neutral";
      if (premium >= 0.05) { p = -5; t = "Perp above spot, longs paying (crowded)"; }
      else if (premium <= -0.05) { p = 5; t = "Perp below spot, shorts paying"; }
      const oiTxt = oi ? ` · OI ${Math.round(oi).toLocaleString("en-US")} ETH` : "";
      add(4, "Funding (perp premium proxy)", "Live", `${premium >= 0 ? "+" : ""}${premium.toFixed(4)}% · ${t}${oiTxt}`, p);
    }
    else if (funding == null || isNaN(funding)) add(4, "Funding rate", "8H", "Not in feed · enter it below to score", 0);
    else {
      let p = 0, t = "Neutral";
      if (funding >= 0.01) { p = -5; t = "Longs paying a high premium (crowded)"; }
      else if (funding < 0) { p = 5; t = "Shorts paying (squeeze fuel)"; }
      const oiT = oi ? ` · OI ${Math.round(oi).toLocaleString("en-US")} ETH` : "";
      add(4, "Funding rate", "8H", `${funding.toFixed(4)}% · ${t}${oiT} · ${fundingSrc}`, p);
    }
    if (lsLong == null || isNaN(lsLong)) add(5, "Long/short ratio", "8H", "Not in feed · enter it below to score", 0);
    else {
      let p = 0, t = "Balanced";
      if (lsLong >= 60) { p = -5; t = "Retail heavily long (contrarian short)"; }
      else if (lsLong <= 40) { p = 5; t = "Retail heavily short (contrarian long)"; }
      add(5, "Long/short ratio", "8H", `${lsLong.toFixed(0)}% long accounts · ${t} · ${lsSrc}`, p);
    }

    // 6. EMA stack (4H)
    const e10 = ema(closes4h, 10), e20 = ema(closes4h, 20), e50 = ema(closes4h, 50), e100 = ema(closes4h, 100);
    const st = e100 != null ? [e10, e20, e50, e100] : [e10, e20, e50];
    const lbl = e100 != null ? "10/20/50/100" : "10/20/50";
    const up = st.every((v, i) => i === 0 || st[i - 1] > v), dn = st.every((v, i) => i === 0 || st[i - 1] < v);
    let emaPts = 0, emaTxt;
    if (up) { emaPts = 5; emaTxt = `Bullish (${lbl.split("/").join(" > ")})`; }
    else if (dn) { emaPts = -5; emaTxt = `Bearish (${lbl.split("/").join(" < ")})`; }
    else emaTxt = `Mixed (${lbl})`;
    add(6, "EMA stack", "4H", `${emaTxt} · ${st.map(fmt).join(" / ")}`, emaPts);

    // 7. RSI (4H)
    const r = rsi(closes4h, 14);
    let rPts = 0, rTxt = "Mid-range";
    if (r >= 70) { rPts = -5; rTxt = "Overbought"; }
    else if (r >= 60) { rPts = 5; rTxt = "Bullish momentum"; }
    else if (r <= 30) { rPts = 5; rTxt = "Oversold"; }
    else if (r <= 40) { rPts = -5; rTxt = "Bearish momentum"; }
    add(7, "RSI momentum", "4H", `${r.toFixed(1)} · ${rTxt}`, rPts);

    // 8. Taker flow (CVD proxy) from recent trades
    let buy = 0, sell = 0;
    for (const t of trades) { if (t.side === "buy") buy += t.q; else sell += t.q; }
    const buyShare = buy + sell > 0 ? buy / (buy + sell) * 100 : 50;
    let fPts = 0, fTxt = "Balanced";
    if (buyShare > 55) { fPts = 5; fTxt = "Takers buying"; }
    else if (buyShare < 45) { fPts = -5; fTxt = "Takers selling"; }
    add(8, "Taker flow (CVD proxy)", "Live", `${fTxt} · ${buyShare.toFixed(0)}% buy of last ${trades.length} trades`, fPts);

    // 9. Volume (last closed 4H vs prior 20)
    const lastC = closed4h[closed4h.length - 1];
    const prev20 = closed4h.slice(-21, -1);
    const avgV = prev20.reduce((a, x) => a + x.v, 0) / prev20.length;
    const ratio = lastC.v / avgV;
    const move6 = closes4h[closes4h.length - 1] - closes4h[closes4h.length - 7];
    let vPts = 0, vTxt;
    if (ratio >= 1.2) { vPts = lastC.c >= lastC.o ? 5 : -5; vTxt = `Above average (${ratio.toFixed(2)}×), confirms ${lastC.c >= lastC.o ? "up" : "down"} candle`; }
    else if (ratio <= 0.8) { vPts = move6 > 0 ? -5 : 5; vTxt = `Below average (${ratio.toFixed(2)}×), recent ${move6 > 0 ? "rise" : "drop"} unconfirmed`; }
    else vTxt = `Near average (${ratio.toFixed(2)}×)`;
    add(9, "Volume", "4H", vTxt, vPts);

    long = Math.max(5, Math.min(95, long));
    return {
      price,
      support: rangeLow, supportDate: rangeLowBar && rangeLowBar.t, sweptRecovered,
      nearSupport, passedLvl,
      resistance, resistanceNote,
      long, short: 100 - long,
      rows,
    };
  }
  // Liquidity pools: stops rest just beyond swing highs/lows that price has not traded through since.
  // Equal highs/lows (within 0.15%) are flagged as stronger pools.
  function pools(c, price, w, label) {
    const pv = pivots(c, w);
    const unsweptHi = pv.hi.filter(p => { for (let j = p.i + 1; j < c.length; j++) if (c[j].h > p.p) return false; return p.p > price; });
    const unsweptLo = pv.lo.filter(p => { for (let j = p.i + 1; j < c.length; j++) if (c[j].l < p.p) return false; return p.p < price; });
    const tag = (arr, p) => {
      const eq = arr.filter(q => q !== p && Math.abs(q.p - p.p) / p.p < 0.0015).length;
      return { price: p.p, t: p.t, equal: eq > 0, tf: label, dist: (p.p - price) / price * 100 };
    };
    return {
      above: unsweptHi.sort((a, b) => a.p - b.p).map(p => tag(unsweptHi, p)),
      below: unsweptLo.sort((a, b) => b.p - a.p).map(p => tag(unsweptLo, p)),
    };
  }
  function liquidity({ price, eth4h, eth1d, book }) {
    const closed4h = eth4h.slice(0, -1), closed1d = eth1d.slice(0, -1);
    const p4 = pools(closed4h, price, 2, "4H"), pD = pools(closed1d, price, 2, "1D");
    const merge = (a, b, dir) => {
      const all = a.concat(b).sort((x, y) => dir * (x.price - y.price));
      const out = [];
      for (const p of all) if (!out.some(q => Math.abs(q.price - p.price) / p.price < 0.002)) out.push(p);
      return out.slice(0, 3);
    };
    const above = merge(p4.above, pD.above, 1);
    const below = merge(p4.below, pD.below, -1);
    // Fallback when no unswept swing exists on a side: the window extreme
    if (!above.length) { const h = Math.max(...closed1d.map(x => x.h)); above.push({ price: h, tf: "range high", equal: false, dist: (h - price) / price * 100 }); }
    if (!below.length) { const l = Math.min(...closed1d.map(x => x.l)); below.push({ price: l, tf: "range low", equal: false, dist: (l - price) / price * 100 }); }
    let wallAsk = null, wallBid = null, bookDepth = null;
    if (book && book.asks && book.bids && book.asks.length && book.bids.length) {
      wallAsk = book.asks.reduce((m, x) => x.q > m.q ? x : m);
      wallBid = book.bids.reduce((m, x) => x.q > m.q ? x : m);
      bookDepth = { askTop: book.asks[book.asks.length - 1].p, bidBottom: book.bids[book.bids.length - 1].p };
    }
    return { above, below, wallAsk, wallBid, bookDepth };
  }
  function bookFrom(payload) {
    const d = payload && (payload.asks ? payload : payload.data && !Array.isArray(payload.data) ? payload.data : Array.isArray(payload.data) ? payload.data[0] : payload.result && payload.result.data && payload.result.data[0]);
    if (!d) return null;
    const m = arr => (arr || []).map(x => Array.isArray(x) ? { p: +x[0], q: +x[1] } : { p: +x.price, q: +x.qty });
    return { asks: m(d.asks), bids: m(d.bids) };
  }
  function fmt(n) { return n == null ? "–" : Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  // Normalisers for Crypto.com connector payloads
  function candlesFrom(payload) {
    const d = (payload && (payload.data || (payload.result && payload.result.data))) || [];
    return d.map(x => ({ t: x.timestamp || x.t, o: +(x.open ?? x.o), h: +(x.high ?? x.h), l: +(x.low ?? x.l), c: +(x.close ?? x.c), v: +(x.volume ?? x.v) }))
      .sort((a, b) => new Date(a.t) - new Date(b.t));
  }
  function tradesFrom(payload) {
    const d = (payload && (payload.data || (payload.result && payload.result.data))) || [];
    return d.map(x => ({ side: String(x.side || x.s || "").toLowerCase(), q: +(x.qty ?? x.q) }));
  }
  function priceFrom(payload) {
    const p = payload && (payload.data && !Array.isArray(payload.data) ? payload.data : payload);
    const x = Array.isArray(p && p.data) ? p.data[0] : p;
    return x ? +(x.last ?? x.a ?? x.k) : NaN;
  }

  root.EthEngine = { liquidity, bookFrom, analyze, ema, rsi, atr, pivots, fmt, candlesFrom, tradesFrom, priceFrom };
})(typeof window !== "undefined" ? window : globalThis);
