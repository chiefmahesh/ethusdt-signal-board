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

  function analyze({ price, eth4h, eth1d, btc1d, trades, funding = null, lsLong = null, lsHist = null, premium = null, oiChg = null, oiNote = null, pxChg = null, liq = null, oi = null, fundingSrc = "manual", lsSrc = "manual" }) {
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
      if (funding >= 0.03) { p = -5; t = "Elevated, longs paying a high premium (crowded)"; }
      else if (funding < 0) { p = 5; t = "Negative, shorts paying (squeeze fuel)"; }
      else t = "Normal (Binance baseline is 0.01%)";
      const oiT = oi ? ` · OI ${Math.round(oi).toLocaleString("en-US")} ETH` : "";
      add(4, "Funding rate", "8H", `${funding.toFixed(4)}% · ${t}${oiT} · ${fundingSrc}`, p);
    }
    // Retail accounts lean long most of the time, so the ratio is judged against its own recent history.
    let lsCrowd = null;
    if (lsLong == null || isNaN(lsLong)) add(5, "Long/short ratio", "4H", "Not in feed · enter it below to score", 0);
    else {
      const hist = (lsHist || []).filter(v => isFinite(v));
      let p = 0, t;
      if (hist.length >= 10) {
        const mean = hist.reduce((a, v) => a + v, 0) / hist.length;
        const sd = Math.max(Math.sqrt(hist.reduce((a, v) => a + (v - mean) ** 2, 0) / hist.length), 0.5);
        const z = (lsLong - mean) / sd;
        if (z >= 1.5) { p = -5; lsCrowd = "long"; t = "Unusually long for recent days (contrarian short)"; }
        else if (z <= -1.5) { p = 5; lsCrowd = "short"; t = "Unusually short for recent days (contrarian long)"; }
        else t = "Normal for recent days";
        add(5, "Long/short ratio", "4H", `${lsLong.toFixed(1)}% long · 5-day avg ${mean.toFixed(1)}% · ${z >= 0 ? "+" : ""}${z.toFixed(1)}σ · ${t} · ${lsSrc}`, p);
      } else {
        if (lsLong >= 70) { p = -5; lsCrowd = "long"; t = "Very long-heavy (contrarian short)"; }
        else if (lsLong <= 45) { p = 5; lsCrowd = "short"; t = "Unusually few longs (contrarian long)"; }
        else t = "Within the usual range";
        add(5, "Long/short ratio", "4H", `${lsLong.toFixed(0)}% long accounts · ${t} · ${lsSrc}, no history so wide 70/45 bands`, p);
      }
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

    // 10. Open interest vs price over 24h: is new money behind the move?
    if (oiChg == null || !isFinite(oiChg)) add(10, "Open interest", "24h", oiNote || "Not available", 0);
    else {
      const pc = pxChg != null && isFinite(pxChg) ? pxChg : 0;
      const oiT = `OI ${oiChg >= 0 ? "+" : ""}${oiChg.toFixed(1)}%, price ${pc >= 0 ? "+" : ""}${pc.toFixed(1)}%`;
      let p = 0, t;
      if (Math.abs(oiChg) < 2) t = "Flat, no big change in positioning";
      else if (oiChg > 0 && pc > 0.5) { p = 5; t = "New money behind the rise (stronger move)"; }
      else if (oiChg > 0 && pc < -0.5) { p = -5; t = "New shorts behind the drop (stronger move)"; }
      else if (oiChg > 0) t = "Positions building while price is flat (breakout risk)";
      else if (pc > 0.5) t = "Rise driven by shorts closing (weaker move)";
      else if (pc < -0.5) t = "Drop driven by longs closing (weaker move)";
      else t = "Positions closing while price is flat";
      add(10, "Open interest", "24h", `${oiT} · ${t}`, p);
    }

    // 11. Liquidations (Binance stream, last hour): a one-sided flush often snaps back.
    if (!liq) add(11, "Liquidations", "1h", "Binance only: open the downloaded file", 0);
    else if (liq.minutes < 15) add(11, "Liquidations", "1h", `Collecting (${Math.round(liq.minutes)} min so far, needs 15)`, 0);
    else {
      const tot = liq.longUsd + liq.shortUsd, k = v => "$" + (v >= 1e6 ? (v / 1e6).toFixed(2) + "M" : Math.round(v / 1e3) + "K");
      const base = `Longs ${k(liq.longUsd)} · shorts ${k(liq.shortUsd)}`;
      let p = 0, t;
      if (tot < 250000) t = "Light, no forced-selling wave";
      else if (liq.longUsd / tot >= 0.75) { p = 5; t = "Longs flushed (often snaps back up)"; }
      else if (liq.shortUsd / tot >= 0.75) { p = -5; t = "Shorts squeezed (often snaps back down)"; }
      else t = "Two-sided, no clear flush";
      add(11, "Liquidations", "1h", `${base} · ${t}`, p);
    }

    long = Math.max(5, Math.min(95, long));
    return {
      price,
      support: rangeLow, supportDate: rangeLowBar && rangeLowBar.t, sweptRecovered,
      nearSupport, passedLvl,
      resistance, resistanceNote,
      long, short: 100 - long,
      rows,
      m: { emaState: up ? "up" : dn ? "down" : "mixed", btcState: btcPts > 0 ? "up" : btcPts < 0 ? "down" : "mixed", rsi: r, volRatio: ratio, move6, buyShare,
           funding: funding == null || isNaN(funding) ? null : funding, premium: premium == null || !isFinite(premium) ? null : premium,
           lsLong: lsLong == null || isNaN(lsLong) ? null : lsLong, lsCrowd, atr4h, atrD },
    };
  }

  // Reversal watch: for the nearest liquidity pool on each side, how likely price is to turn
  // there if it gets there. Rule-based score: starts at 50%, each factor adds or subtracts.
  function reversal(res, L) {
    const m = res.m, price = res.price;
    if (!m || !L || !L.above.length || !L.below.length) return null;
    const pad = (m.atr4h || res.price * 0.006) * 0.5;
    const crowdLong = (m.funding != null ? m.funding >= 0.03 : m.premium != null && m.premium >= 0.05);
    const crowdShort = (m.funding != null ? m.funding < 0 : m.premium != null && m.premium <= -0.05);
    const pivot = res.nearSupport;
    function side(dir) {
      const top = dir === "top";
      const pool = top ? L.above[0] : L.below[0];
      const opp = top ? L.below[0] : L.above[0];
      const lo = top ? pool.price : pool.price - pad, hi = top ? pool.price + pad : pool.price;
      const f = [];
      const add = (pts, txt) => { if (pts) f.push({ pts, txt }); };
      // trend: a turn that goes WITH the 4H trend is more likely
      if (m.emaState === (top ? "down" : "up")) add(10, `4H trend is ${top ? "down" : "up"}, so a ${top ? "rally" : "drop"} here is counter-trend`);
      else if (m.emaState === (top ? "up" : "down")) add(-10, `4H trend is ${top ? "up" : "down"}, so the move has trend support`);
      if (m.btcState === (top ? "down" : "up")) add(5, `BTC daily trend is ${top ? "bearish" : "bullish"}`);
      else if (m.btcState === (top ? "up" : "down")) add(-5, `BTC daily trend is ${top ? "bullish" : "bearish"}`);
      // momentum exhaustion
      if (top) { if (m.rsi >= 70) add(10, `RSI ${m.rsi.toFixed(0)} is overbought`); else if (m.rsi >= 60) add(5, `RSI ${m.rsi.toFixed(0)} is stretched`); }
      else { if (m.rsi <= 30) add(10, `RSI ${m.rsi.toFixed(0)} is oversold`); else if (m.rsi <= 40) add(5, `RSI ${m.rsi.toFixed(0)} is stretched`); }
      // zone strength
      if (pool.equal) add(8, "Equal levels: a stop sweep then reversal is common");
      if (pool.tf === "1D") add(6, "Daily swing level");
      const second = (top ? L.above[1] : L.below[1]);
      if (second && Math.abs(second.price - pool.price) <= (m.atr4h || 0)) add(4, "Another pool sits right behind it");
      // volume into the move
      if (m.volRatio <= 0.8 && (top ? m.move6 > 0 : m.move6 < 0)) add(6, `Recent ${top ? "rise" : "drop"} is on weak volume`);
      else if (m.volRatio >= 1.2 && (top ? m.move6 > 0 : m.move6 < 0)) add(-6, `Recent ${top ? "rise" : "drop"} is on strong volume`);
      // taker flow
      if (top ? m.buyShare < 45 : m.buyShare > 55) add(5, `Takers are ${top ? "selling" : "buying"} (${m.buyShare.toFixed(0)}% buy)`);
      else if (top ? m.buyShare > 55 : m.buyShare < 45) add(-5, `Takers are ${top ? "buying" : "selling"} (${m.buyShare.toFixed(0)}% buy)`);
      // positioning
      if (top ? crowdLong : crowdShort) add(5, top ? "Longs are paying funding (crowded)" : "Shorts are paying funding (crowded)");
      else if (top ? crowdShort : crowdLong) add(-5, top ? "Shorts are paying funding" : "Longs are paying funding");
      if (m.lsCrowd === (top ? "long" : "short")) add(5, `Accounts are unusually ${top ? "long" : "short"} (${m.lsLong.toFixed(0)}% long)`);
      else if (m.lsCrowd === (top ? "short" : "long")) add(-5, `Accounts are unusually ${top ? "short" : "long"} (${m.lsLong.toFixed(0)}% long)`);
      const prob = Math.round(Math.max(20, Math.min(85, 50 + f.reduce((a, x) => a + x.pts, 0))));
      const mid = (lo + hi) / 2;
      const first = pivot != null && (top ? pivot < price && pivot > opp.price : pivot > lo && pivot <= price && pivot < opp.price) && Math.abs(pivot - mid) > pad ? pivot : null;
      return {
        dir, prob, lo, hi, dist: (pool.price - price) / price * 100,
        atrAway: m.atrD ? Math.abs(pool.price - price) / m.atrD : null,
        first, target: opp.price,
        movePct: (opp.price - mid) / mid * 100,
        cancel: top ? hi : lo,
        factors: f.sort((a, b) => Math.abs(b.pts) - Math.abs(a.pts)),
      };
    }
    const top = side("top"), bottom = side("bottom");
    // Which zone is reached first. Base: driftless random walk, where the chance of touching the
    // upper edge first = distance to the lower edge / total distance. Then tilted by the Long/Short bias.
    const dUp = Math.max(top.lo - price, 0.01), dDn = Math.max(price - bottom.hi, 0.01);
    const baseUp = dDn / (dUp + dDn) * 100;
    const upFirst = Math.round(Math.max(10, Math.min(90, baseUp + (res.long - 50) / 2)));
    return { top, bottom, first: { up: upFirst, down: 100 - upFirst, baseUp } };
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
    return d.map(x => ({ t: (v => typeof v === "number" ? v : Date.parse(v))(x.timestamp ?? x.t), o: +(x.open ?? x.o), h: +(x.high ?? x.h), l: +(x.low ?? x.l), c: +(x.close ?? x.c), v: +(x.volume ?? x.v) }))
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

  // Trade plan: turns each reversal zone into an order. Entry is a limit at the zone's near edge,
  // the stop sits half a 4H ATR beyond the zone's far edge (one 4H ATR from entry), targets are the
  // reversal card's targets. Verdict: Take needs a reversal chance of 60%+ and reward of 1.5x risk or more.
  function tradePlan(res, R, opts) {
    if (!R || !res || !res.m) return null;
    const price = res.price, atr = res.m.atr4h || price * 0.01;
    const account = opts && opts.account > 0 ? opts.account : null;
    const eventDay = !!(opts && opts.eventDay);
    const flat = Math.abs(res.long - 50) < 5;   // overall bias 46-54%: signals balanced
    const riskPct = opts && opts.riskPct > 0 ? opts.riskPct : null;
    function mk(z, dir) {
      const short = dir === "short";
      const entry = short ? z.lo : z.hi;
      const stop = short ? z.hi + atr * 0.5 : z.lo - atr * 0.5;
      const risk = Math.abs(entry - stop);
      const targets = [z.first, z.target]
        .filter(v => v != null && (short ? v < entry : v > entry))
        .map(t => ({ price: t, rr: Math.abs(t - entry) / risk, pct: (t - entry) / entry * 100 }));
      const bestRR = targets.length ? Math.max(...targets.map(t => t.rr)) : 0;
      const p = z.prob;
      let verdict, why;
      if (!targets.length) { verdict = "skip"; why = "No target beyond the entry"; }
      else if (bestRR < 1.5) { verdict = "skip"; why = `Reward is only ${bestRR.toFixed(1)}× the risk`; }
      else if (p < 52) { verdict = "skip"; why = `${p}% reversal chance is no better than a coin flip`; }
      else if (p < 60) { verdict = "weak"; why = `${p}% reversal chance is only slightly better than a coin flip`; }
      else { verdict = "take"; why = `${p}% reversal chance and up to ${bestRR.toFixed(1)}× reward for the risk`; }
      // When the overall bias is near 50/50 the board has no directional edge, so a setup needs a stronger case.
      if (verdict === "take" && flat && p < 65) { verdict = "weak"; why = `${p}% reversal chance, but the overall bias is near 50/50, so it needs 65% or more`; }
      if (verdict === "take" && eventDay) { verdict = "weak"; why += ". Downgraded: news day, levels often fail"; }
      let status;
      if (short) status = price < z.lo ? { k: "wait", txt: `Waiting: price needs to rise ${((z.lo - price) / price * 100).toFixed(2)}% to the entry` }
        : price <= z.hi ? { k: "now", txt: "Price is in the zone now" }
        : { k: "off", txt: "Price is above the zone, so this setup is off unless it falls back in" };
      else status = price > z.hi ? { k: "wait", txt: `Waiting: price needs to fall ${((price - z.hi) / price * 100).toFixed(2)}% to the entry` }
        : price >= z.lo ? { k: "now", txt: "Price is in the zone now" }
        : { k: "off", txt: "Price is below the zone, so this setup is off unless it rises back in" };
      let size = null;
      if (account && riskPct) {
        const riskAmt = account * riskPct / 100, qty = riskAmt / risk, notional = qty * entry;
        size = { riskAmt, qty, notional, lev: notional / account };
        targets.forEach(t => { t.usd = qty * Math.abs(t.price - entry); });
      }
      // Under a random walk a target/stop pair has zero expected value whatever its distances,
      // so the edge comes only from the reversal chance: 2p - 1, in units of the risk (R).
      const edge = 2 * p / 100 - 1;
      return { dir, entry, stop, risk, riskPctMove: risk / entry * 100, targets, bestRR, prob: p, edge, verdict, why, status, size };
    }
    const short = mk(R.top, "short"), long = mk(R.bottom, "long");
    const rank = { take: 2, weak: 1, skip: 0 };
    const live = [short, long].filter(x => x.verdict !== "skip" && x.status.k !== "off")
      .sort((a, b) => rank[b.verdict] - rank[a.verdict] || b.prob - a.prob);
    const best = live[0] || null;
    return { short, long, best, noTrade: !best || best.verdict !== "take", flat, eventDay, bias: res.long };
  }
  // ---- Track record ----
  // A reading is saved once per hour. Grading uses closed 4H candles that opened after the reading:
  //  bias  : a Long call (>= 55%) is right if the 4H close 24h later is above the reading's price; Short mirrors it.
  //  setup : the entry must be touched within 48h; then whichever of Target 1 or the stop is hit first decides it.
  //          If both are hit inside the same candle, it counts as a loss (the order inside a candle is unknown).
  const H4 = 4 * 3600000, H24 = 24 * 3600000;
  function gradeReading(rd, c4, now) {
    const g = rd.g || {}, patch = {};
    const closed = c4.filter(k => k.t + H4 <= now);
    if (!closed.length) return null;
    const windowStart = closed[0].t;
    if (g.bias === undefined) {
      const call = rd.long >= 55 ? "up" : rd.long <= 45 ? "down" : null;
      if (!call) patch.bias = "none";
      else {
        const target = rd.t + H24;
        const k = closed.find(x => x.t <= target && target < x.t + H4);
        if (k) patch.bias = (call === "up" ? k.c > rd.price : k.c < rd.price) ? "win" : "loss";
        else if (target < windowStart) patch.bias = "expired";
      }
    }
    for (const dir of ["short", "long"]) {
      if (g[dir] !== undefined) continue;
      const st = rd.plan && rd.plan[dir];
      if (!st || st.verdict === "skip" || st.status === "off" || st.t1 == null) { patch[dir] = "none"; continue; }
      if (rd.t < windowStart - H4) { patch[dir] = "expired"; continue; }
      const short = dir === "short";
      const after = closed.filter(k => k.t >= rd.t);
      let filled = false, res;
      for (const k of after) {
        const hitStop = short ? k.h >= st.stop : k.l <= st.stop;
        if (!filled) {
          const touched = short ? k.h >= st.entry : k.l <= st.entry;
          if (!touched) { if (k.t - rd.t >= 2 * H24) { res = "nofill"; break; } continue; }
          filled = true;
          if (hitStop) { res = "loss"; break; }
          continue;
        }
        const hitT1 = short ? k.l <= st.t1 : k.h >= st.t1;
        if (hitStop) { res = "loss"; break; }
        if (hitT1) { res = "win"; break; }
      }
      if (!res && filled && now - rd.t > 7 * H24) res = "timeout";
      if (res) patch[dir] = res;
    }
    return Object.keys(patch).length ? patch : null;
  }
  function trackStats(readings) {
    const rs = readings.slice().sort((a, b) => a.t - b.t);
    const out = { count: rs.length, since: rs.length ? rs[0].t : null, last: rs.length ? rs[rs.length - 1].t : null,
      bias: { win: 0, loss: 0, pending: 0 }, take: null, weak: null };
    const blank = () => ({ win: 0, loss: 0, timeout: 0, nofill: 0, pending: 0, netR: 0 });
    out.take = blank(); out.weak = blank();
    const seen = new Set();
    for (const r of rs) {
      const g = r.g || {};
      const callMade = r.long >= 55 || r.long <= 45;
      if (callMade) { if (g.bias === "win") out.bias.win++; else if (g.bias === "loss") out.bias.loss++; else if (g.bias === undefined) out.bias.pending++; }
      for (const dir of ["short", "long"]) {
        const st = r.plan && r.plan[dir];
        if (!st || st.verdict === "skip" || st.status === "off" || st.t1 == null) continue;
        const key = dir + ":" + Math.round(st.entry) + ":" + Math.round(st.stop);
        if (seen.has(key)) continue;          // the same setup repeats hour after hour; count it once
        seen.add(key);
        const b = out[st.verdict]; if (!b) continue;
        const v = g[dir];
        if (v === "win") { b.win++; b.netR += st.rr1 || 0; }
        else if (v === "loss") { b.loss++; b.netR -= 1; }
        else if (v === "timeout") b.timeout++;
        else if (v === "nofill") b.nofill++;
        else if (v === undefined) b.pending++;
      }
    }
    return out;
  }
  root.EthEngine = { gradeReading, trackStats, tradePlan, reversal, liquidity, bookFrom, analyze, ema, rsi, atr, pivots, fmt, candlesFrom, tradesFrom, priceFrom };
})(typeof window !== "undefined" ? window : globalThis);
