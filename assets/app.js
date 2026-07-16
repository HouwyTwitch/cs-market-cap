/* ===========================================================================
   CS2 Market Cap — front-end
   Dependency-free. Reads data/market.json (built by scripts/build.py).
   =========================================================================== */
(() => {
  "use strict";

  const RANGES = [
    { key: "7D", days: 7 },
    { key: "30D", days: 30 },
    { key: "90D", days: 90 },
    { key: "ALL", days: null },
  ];

  // Fixed look-back windows for price / market-cap change (independent of the
  // chart range). Keyed to the sort keys used on the table headers.
  const WINDOWS = [
    { key: "24h", sort: "w24", days: 1 },
    { key: "7d",  sort: "w7",  days: 7 },
    { key: "30d", sort: "w30", days: 30 },
    { key: "90d", sort: "w90", days: 90 },
  ];

  const state = {
    data: null,
    derived: null,      // per-item computed stats for current range
    totalWindows: null, // total market-cap change per fixed window
    range: "ALL",
    startIdx: 0,
    sortKey: "cap",
    sortDir: "desc",
    search: "",
  };

  /* ---------------------------------------------- fixed-window % change */
  const dayMs = 86400000;
  const isoMs = (s) => Date.parse(s + "T00:00:00Z");

  // Latest index whose snapshot date is on or before `targetMs`, or -1.
  function idxOnOrBefore(iso, targetMs) {
    for (let i = iso.length - 1; i >= 0; i--) {
      if (isoMs(iso[i]) <= targetMs) return i;
    }
    return -1;
  }

  // % change of a value series over the last `days`, using the snapshot
  // closest on-or-before (now - days) as the baseline. null when there isn't
  // enough history or the baseline is unusable.
  function windowChange(arr, iso, days) {
    const n = arr.length;
    if (!n) return null;
    let endI = n - 1;
    while (endI >= 0 && arr[endI] == null) endI--;
    if (endI < 0) return null;
    const target = isoMs(iso[n - 1]) - days * dayMs;
    let bi = idxOnOrBefore(iso, target);
    if (bi < 0 || bi >= endI) return null;         // no earlier snapshot yet
    while (bi >= 0 && arr[bi] == null) bi--;
    if (bi < 0) return null;
    const base = arr[bi], cur = arr[endI];
    if (base == null || base <= 0 || cur == null) return null;
    return ((cur - base) / base) * 100;
  }

  const itemWindows = (arr, iso) => {
    const o = {};
    for (const w of WINDOWS) o[w.key] = windowChange(arr, iso, w.days);
    return o;
  };

  /* ------------------------------------------------------------ formatting */
  const fmtUSD = (n, compact = true) => {
    if (n == null || !isFinite(n)) return "—";
    const s = n < 0 ? "-" : "";
    const a = Math.abs(n);
    if (compact) {
      if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
      if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`;
      if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(1)}K`;
      return `${s}$${a.toFixed(2)}`;
    }
    return `${s}$${a.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };
  const fmtPrice = (n) => {
    if (n == null || !isFinite(n)) return "—";
    if (n >= 10000) return fmtUSD(n, true);
    return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };
  const fmtNum = (n) => {
    if (n == null || !isFinite(n)) return "—";
    const a = Math.abs(n);
    if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
    if (a >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
    if (a >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
    return `${Math.round(n)}`;
  };
  const fmtInt = (n) => (n == null || !isFinite(n) ? "—" : Math.round(n).toLocaleString("en-US"));
  const fmtPct = (p) => {
    if (p == null || !isFinite(p)) return "—";
    const sign = p > 0 ? "+" : p < 0 ? "" : "";
    return `${sign}${p.toFixed(2)}%`;
  };
  const prettyDate = (dmy) => {
    // dd-mm-yyyy -> "5 Jul 2026"
    const [d, m, y] = dmy.split("-").map(Number);
    const mo = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m - 1] || "";
    return `${d} ${mo} ${y}`;
  };

  /* -------------------------------------------------------- nice-number axis */
  function niceNum(x, round) {
    if (x <= 0) return 1;
    const exp = Math.floor(Math.log10(x));
    const f = x / Math.pow(10, exp);
    let nf;
    if (round) nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
    else nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
    return nf * Math.pow(10, exp);
  }
  function niceTicks(min, max, count = 5) {
    if (!isFinite(min) || !isFinite(max)) return [0, 1];
    if (min === max) { min -= Math.abs(min || 1) * 0.1; max += Math.abs(max || 1) * 0.1; }
    const step = niceNum((max - min) / (count - 1), true) || 1;
    const nMin = Math.floor(min / step) * step;
    const nMax = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = nMin; v <= nMax + step * 0.5; v += step) ticks.push(+v.toFixed(10));
    return ticks;
  }

  const SVGNS = "http://www.w3.org/2000/svg";
  const el = (name, attrs = {}) => {
    const e = document.createElementNS(SVGNS, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  };

  /* ----------------------------------------------------------- line chart */
  function buildLineChart(figure, { labels, values, format, interactive = true, height = 300, yTickFmt }) {
    figure.textContent = "";
    const W = 800, H = height;
    const pad = { l: 62, r: 16, t: 14, b: 30 };
    const plotW = W - pad.l - pad.r;
    const plotH = H - pad.t - pad.b;

    const present = [];
    values.forEach((v, i) => { if (v != null && isFinite(v)) present.push({ i, v }); });
    if (present.length === 0) {
      const p = document.createElement("p");
      p.className = "no-results";
      p.textContent = "No data in this range.";
      figure.appendChild(p);
      return;
    }
    const ys = present.map((p) => p.v);
    let ymin = Math.min(...ys), ymax = Math.max(...ys);
    const ticks = niceTicks(ymin, ymax, 5);
    ymin = Math.min(ymin, ticks[0]);
    ymax = Math.max(ymax, ticks[ticks.length - 1]);
    const n = labels.length;
    const span = ymax - ymin || 1;
    const xFor = (i) => pad.l + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
    const yFor = (v) => pad.t + plotH - ((v - ymin) / span) * plotH;

    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", preserveAspectRatio: "xMidYMid meet" });

    // gridlines + y labels
    const fmtTick = yTickFmt || format;
    for (const t of ticks) {
      const y = yFor(t);
      svg.appendChild(el("line", { class: "gridline", x1: pad.l, y1: y, x2: pad.l + plotW, y2: y }));
      const lab = el("text", { class: "axis-label tabnum", x: pad.l - 8, y: y + 3.5, "text-anchor": "end" });
      lab.textContent = fmtTick(t);
      svg.appendChild(lab);
    }
    // baseline
    svg.appendChild(el("line", { class: "baseline", x1: pad.l, y1: pad.t + plotH, x2: pad.l + plotW, y2: pad.t + plotH }));

    // x labels (subset)
    const step = Math.max(1, Math.ceil(n / 7));
    for (let i = 0; i < n; i += step) {
      const x = xFor(i);
      const lab = el("text", { class: "axis-label", x, y: H - 8, "text-anchor": "middle" });
      lab.textContent = shortDate(labels[i]);
      svg.appendChild(lab);
    }

    // area + line
    let lineD = "", areaD = "";
    present.forEach((p, k) => {
      const x = xFor(p.i), y = yFor(p.v);
      lineD += (k === 0 ? "M" : "L") + x.toFixed(2) + " " + y.toFixed(2) + " ";
      if (k === 0) areaD += `M${x.toFixed(2)} ${(pad.t + plotH).toFixed(2)} L${x.toFixed(2)} ${y.toFixed(2)} `;
      else areaD += `L${x.toFixed(2)} ${y.toFixed(2)} `;
    });
    const lastX = xFor(present[present.length - 1].i);
    areaD += `L${lastX.toFixed(2)} ${(pad.t + plotH).toFixed(2)} Z`;
    svg.appendChild(el("path", { class: "series-area", d: areaD }));
    svg.appendChild(el("path", { class: "series-line", d: lineD }));

    // end dot
    const last = present[present.length - 1];
    svg.appendChild(el("circle", { class: "end-dot", cx: xFor(last.i), cy: yFor(last.v), r: 4 }));

    // interactive layer
    let crosshair, focusDot, tooltip;
    if (interactive) {
      crosshair = el("line", { class: "crosshair", x1: 0, y1: pad.t, x2: 0, y2: pad.t + plotH, opacity: 0 });
      focusDot = el("circle", { class: "focus-dot", cx: 0, cy: 0, r: 4.5, opacity: 0 });
      svg.appendChild(crosshair);
      svg.appendChild(focusDot);
      tooltip = document.createElement("div");
      tooltip.className = "chart-tooltip";
      figure.style.position = "relative";
      figure.appendChild(tooltip);
    }

    figure.insertBefore(svg, figure.firstChild);

    if (interactive) {
      const pointsPx = present.map((p) => ({ i: p.i, v: p.v, xSvg: xFor(p.i), ySvg: yFor(p.v) }));
      let curK = -1;
      const showAt = (k) => {
        if (k < 0 || k >= pointsPx.length) return;
        curK = k;
        const p = pointsPx[k];
        crosshair.setAttribute("x1", p.xSvg);
        crosshair.setAttribute("x2", p.xSvg);
        crosshair.setAttribute("opacity", 1);
        focusDot.setAttribute("cx", p.xSvg);
        focusDot.setAttribute("cy", p.ySvg);
        focusDot.setAttribute("opacity", 1);
        tooltip.textContent = "";
        const d = document.createElement("div");
        d.className = "tt-date";
        d.textContent = prettyDate(labels[p.i]);
        const row = document.createElement("div");
        row.className = "tt-row";
        const key = document.createElement("span"); key.className = "tt-key";
        const val = document.createElement("span"); val.className = "tt-val";
        val.textContent = format(p.v);
        row.appendChild(key); row.appendChild(val);
        tooltip.appendChild(d); tooltip.appendChild(row);
        const rect = svg.getBoundingClientRect();
        tooltip.style.left = `${(p.xSvg / W) * rect.width}px`;
        tooltip.style.top = `${(p.ySvg / H) * rect.height}px`;
        tooltip.classList.add("visible");
      };
      const hide = () => {
        crosshair.setAttribute("opacity", 0);
        focusDot.setAttribute("opacity", 0);
        tooltip.classList.remove("visible");
      };
      const nearest = (clientX) => {
        const rect = svg.getBoundingClientRect();
        const xSvg = ((clientX - rect.left) / rect.width) * W;
        let best = 0, bestD = Infinity;
        pointsPx.forEach((p, k) => {
          const dd = Math.abs(p.xSvg - xSvg);
          if (dd < bestD) { bestD = dd; best = k; }
        });
        return best;
      };
      figure.addEventListener("pointermove", (e) => showAt(nearest(e.clientX)));
      figure.addEventListener("pointerleave", hide);
      figure.addEventListener("keydown", (e) => {
        if (e.key === "ArrowRight") { e.preventDefault(); showAt(Math.min(curK < 0 ? pointsPx.length - 1 : curK + 1, pointsPx.length - 1)); }
        else if (e.key === "ArrowLeft") { e.preventDefault(); showAt(Math.max(curK < 0 ? pointsPx.length - 1 : curK - 1, 0)); }
        else if (e.key === "Escape") hide();
      });
      figure.addEventListener("focus", () => { if (curK < 0) showAt(pointsPx.length - 1); });
      figure.addEventListener("blur", hide);
    }
  }

  const shortDate = (dmy) => {
    const [d, m] = dmy.split("-").map(Number);
    const mo = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m - 1] || "";
    return `${d} ${mo}`;
  };

  /* ------------------------------------------------------------- sparkline */
  function sparkline(values, up) {
    const W = 108, H = 30, pad = 3;
    const present = [];
    values.forEach((v, i) => { if (v != null && isFinite(v)) present.push({ i, v }); });
    if (present.length < 2) return `<svg class="spark" viewBox="0 0 ${W} ${H}"></svg>`;
    const ys = present.map((p) => p.v);
    let ymin = Math.min(...ys), ymax = Math.max(...ys);
    if (ymin === ymax) { ymin -= 1; ymax += 1; }
    const n = values.length;
    const xFor = (i) => pad + (i / (n - 1)) * (W - pad * 2);
    const yFor = (v) => pad + (H - pad * 2) - ((v - ymin) / (ymax - ymin)) * (H - pad * 2);
    let d = "", area = "";
    present.forEach((p, k) => {
      const x = xFor(p.i).toFixed(1), y = yFor(p.v).toFixed(1);
      d += (k === 0 ? "M" : "L") + x + " " + y + " ";
      area += (k === 0 ? `M${x} ${H - pad} L${x} ${y} ` : `L${x} ${y} `);
    });
    area += `L${xFor(present[present.length - 1].i).toFixed(1)} ${H - pad} Z`;
    const cls = up ? "up" : "down";
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">` +
      `<path class="spark-area ${cls}" d="${area}"/>` +
      `<path class="spark-line ${cls}" d="${d}"/></svg>`;
  }

  /* ------------------------------------------------------- range handling */
  function computeStartIdx() {
    const { data, range } = state;
    const iso = data.isoDates;
    const cfg = RANGES.find((r) => r.key === range) || RANGES[RANGES.length - 1];
    if (cfg.days == null) return 0;
    const last = new Date(iso[iso.length - 1] + "T00:00:00Z");
    const cutoff = new Date(last.getTime() - cfg.days * 86400000);
    for (let i = 0; i < iso.length; i++) {
      if (new Date(iso[i] + "T00:00:00Z") >= cutoff) return i;
    }
    return iso.length - 1;
  }

  // first / last non-null within [start..end]
  const firstIn = (arr, start, end) => { for (let i = start; i <= end; i++) if (arr[i] != null) return arr[i]; return null; };
  const lastIn = (arr, start, end) => { for (let i = end; i >= start; i--) if (arr[i] != null) return arr[i]; return null; };

  function computeDerived() {
    const { data } = state;
    const start = state.startIdx;
    const end = data.dates.length - 1;
    const totalCapNow = lastIn(data.totals.marketCap, 0, end) || 0;

    const items = data.items.map((it) => {
      const price = lastIn(it.prices, 0, end);
      const count = lastIn(it.counts, 0, end);
      const cap = lastIn(it.caps, 0, end);
      const capStart = firstIn(it.caps, start, end);
      const capEnd = lastIn(it.caps, start, end);
      let change = null;
      if (capStart != null && capEnd != null && capStart > 0) change = ((capEnd - capStart) / capStart) * 100;
      const priceStart = firstIn(it.prices, start, end);
      const priceEnd = lastIn(it.prices, start, end);
      let priceChange = null;
      if (priceStart != null && priceEnd != null && priceStart > 0) priceChange = ((priceEnd - priceStart) / priceStart) * 100;
      return {
        name: it.name,
        prices: it.prices,
        counts: it.counts,
        caps: it.caps,
        price, count, cap, change, priceChange,
        win: itemWindows(it.prices, data.isoDates),
        dominance: totalCapNow > 0 && cap != null ? (cap / totalCapNow) * 100 : null,
        sparkCaps: it.caps.slice(start, end + 1),
      };
    });
    return items;
  }

  /* --------------------------------------------------------------- render */
  function render() {
    state.startIdx = computeStartIdx();
    state.derived = computeDerived();
    state.totalWindows = itemWindows(state.data.totals.marketCap, state.data.isoDates);
    renderRange();
    renderHero();
    renderHistory();
    renderTable();
  }

  function renderRange() {
    const wrap = document.getElementById("range");
    wrap.textContent = "";
    for (const r of RANGES) {
      const b = document.createElement("button");
      b.className = "range-btn";
      b.type = "button";
      b.textContent = r.key;
      b.setAttribute("aria-pressed", String(state.range === r.key));
      b.addEventListener("click", () => { state.range = r.key; render(); });
      wrap.appendChild(b);
    }
  }

  function deltaEl(pct, { pill = false } = {}) {
    const span = document.createElement("span");
    const dir = pct == null ? "flat" : pct > 0.0001 ? "up" : pct < -0.0001 ? "down" : "flat";
    span.className = (pill ? "delta-pill " : "delta ") + dir;
    if (pct != null && dir !== "flat") {
      const a = document.createElement("span");
      a.className = "arrow";
      a.textContent = dir === "up" ? "▲" : "▼";
      span.appendChild(a);
    }
    span.appendChild(document.createTextNode(pct == null ? "—" : fmtPct(pct)));
    return span;
  }

  // Period chip: a label ("24h") over a tonal delta value. Used in the hero.
  function windowPill(label, pct) {
    const dir = pct == null ? "flat" : pct > 0.0001 ? "up" : pct < -0.0001 ? "down" : "flat";
    const chip = document.createElement("div");
    chip.className = "wchip " + dir;
    const l = document.createElement("span");
    l.className = "wchip-label";
    l.textContent = label;
    const v = document.createElement("span");
    v.className = "wchip-val";
    if (pct != null && dir !== "flat") {
      const a = document.createElement("span");
      a.className = "arrow";
      a.textContent = dir === "up" ? "▲" : "▼";
      v.appendChild(a);
    }
    v.appendChild(document.createTextNode(pct == null ? "—" : fmtPct(pct)));
    chip.appendChild(l); chip.appendChild(v);
    return chip;
  }

  function renderHero() {
    const { data, derived, totalWindows } = state;
    const end = data.dates.length - 1;
    const capNow = lastIn(data.totals.marketCap, 0, end);

    document.getElementById("hero-cap").textContent = fmtUSD(capNow, true);

    // fixed-window change chips for the total market cap
    const hw = document.getElementById("hero-windows");
    hw.textContent = "";
    for (const w of WINDOWS) hw.appendChild(windowPill(w.key, totalWindows[w.key]));

    const haveHistory = data.dates.length > 1;
    document.getElementById("hero-range-note").textContent = haveHistory
      ? `as of ${prettyDate(data.dates[end])}`
      : `as of ${prettyDate(data.dates[end])} · add more daily snapshots to unlock 24h / 7d / 30d / 90d change`;

    // tiles
    const tiles = document.getElementById("tiles");
    tiles.textContent = "";
    const items = derived.filter((i) => i.cap != null);
    const gainer = items.filter((i) => i.change != null).sort((a, b) => b.change - a.change)[0];
    const loser = items.filter((i) => i.change != null).sort((a, b) => a.change - b.change)[0];
    const topCap = items.slice().sort((a, b) => b.cap - a.cap)[0];

    const tileData = [
      { label: "Skins tracked", value: fmtInt(data.totals.itemsTracked[end]), sub: `${fmtInt(data.totals.itemsWithCap[end])} with market cap` },
      { label: "Units in existence", value: fmtNum(data.totals.unitsInExistence[end]), sub: "total supply across skins" },
      { label: `Top gainer · ${rangeLabel()}`, value: gainer ? fmtPct(gainer.change) : "—", sub: gainer ? gainer.name : "", cls: "up", small: false },
      { label: `Top loser · ${rangeLabel()}`, value: loser ? fmtPct(loser.change) : "—", sub: loser ? loser.name : "", cls: "down", small: false },
      { label: "Largest cap", value: topCap ? fmtUSD(topCap.cap, true) : "—", sub: topCap ? topCap.name : "", small: true },
      { label: "Avg. skin price", value: fmtPrice(data.totals.avgPrice[end]), sub: "mean listed price" },
    ];
    for (const t of tileData) {
      const div = document.createElement("div");
      div.className = "tile";
      const l = document.createElement("span"); l.className = "tile-sub"; l.textContent = t.label;
      const v = document.createElement("span");
      v.className = "tile-value" + (t.small ? " small" : "");
      if (t.cls) v.classList.add(t.cls === "up" ? "up" : "down"), v.style.color = t.cls === "up" ? "var(--up)" : "var(--down)";
      v.textContent = t.value;
      const s = document.createElement("span"); s.className = "tile-sub"; s.textContent = t.sub || "";
      s.title = t.sub || "";
      div.appendChild(l); div.appendChild(v); div.appendChild(s);
      tiles.appendChild(div);
    }
  }

  const rangeLabel = () => {
    const r = RANGES.find((x) => x.key === state.range);
    return r && r.days ? `${r.days}d` : "all time";
  };

  function renderHistory() {
    const { data, startIdx } = state;
    const end = data.dates.length - 1;
    const labels = data.dates.slice(startIdx, end + 1);
    const values = data.totals.marketCap.slice(startIdx, end + 1);
    buildLineChart(document.getElementById("history-chart"), {
      labels, values,
      format: (v) => fmtUSD(v, false),
      yTickFmt: (v) => fmtUSD(v, true),
      height: 300,
      interactive: true,
    });
    document.getElementById("chart-sub").textContent =
      `${prettyDate(labels[0])} — ${prettyDate(labels[labels.length - 1])} · ${labels.length} snapshots`;
  }

  /* ----------------------------------------------------------------- table */
  function sortedFiltered() {
    let rows = state.derived.slice();
    const q = state.search.trim().toLowerCase();
    if (q) rows = rows.filter((r) => r.name.toLowerCase().includes(q));
    const key = state.sortKey, dir = state.sortDir === "asc" ? 1 : -1;
    const winBySort = { w24: "24h", w7: "7d", w30: "30d", w90: "90d" };
    const val = (r) => {
      if (key === "name") return r.name.toLowerCase();
      if (key === "rank" || key === "cap") return r.cap;
      if (key === "price") return r.price;
      if (key === "count") return r.count;
      if (winBySort[key]) return r.win[winBySort[key]];
      return r.cap;
    };
    rows.sort((a, b) => {
      const av = val(a), bv = val(b);
      if (key === "name") return av < bv ? -dir : av > bv ? dir : 0;
      const an = av == null ? -Infinity : av, bn = bv == null ? -Infinity : bv;
      if (an === bn) return 0;
      return an < bn ? -dir : dir;
    });
    return rows;
  }

  function renderTable() {
    const rows = sortedFiltered();
    const body = document.getElementById("items-body");
    body.textContent = "";
    document.getElementById("table-sub").textContent =
      `${state.derived.length} skins · price change over 24h / 7d / 30d / 90d`;

    // header sort indicators
    document.querySelectorAll("#items-table thead th[data-sort]").forEach((th) => {
      const k = th.getAttribute("data-sort");
      th.removeAttribute("aria-sort");
      let base = th.textContent.replace(/[▲▼]/g, "").trim();
      th.textContent = base;
      const active = k === state.sortKey || (k === "rank" && state.sortKey === "cap");
      if (active) {
        th.setAttribute("aria-sort", state.sortDir === "asc" ? "ascending" : "descending");
        const c = document.createElement("span");
        c.className = "sort-caret";
        c.textContent = state.sortDir === "asc" ? " ▲" : " ▼";
        th.appendChild(c);
      }
    });

    if (rows.length === 0) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 10; td.className = "no-results"; td.textContent = "No skins match your search.";
      tr.appendChild(td); body.appendChild(tr);
      return;
    }

    const frag = document.createDocumentFragment();
    rows.forEach((r, idx) => {
      const tr = document.createElement("tr");
      tr.tabIndex = 0;
      tr.setAttribute("role", "button");
      tr.addEventListener("click", () => openModal(r));
      tr.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openModal(r); } });

      const rank = td("col-rank", String(idx + 1));

      const nameTd = document.createElement("td");
      nameTd.className = "col-name";
      const nm = document.createElement("span"); nm.className = "item-name"; nm.textContent = r.name; nm.title = r.name;
      const sub = document.createElement("span"); sub.className = "item-sub";
      sub.textContent = r.dominance != null ? `${r.dominance.toFixed(2)}% of market` : "—";
      nameTd.appendChild(nm); nameTd.appendChild(sub);

      const priceTd = td("col-price col-num", fmtPrice(r.price));

      const winTds = WINDOWS.map((w) => {
        const cell = document.createElement("td");
        cell.className = "col-num col-win";
        cell.appendChild(deltaEl(r.win[w.key], { pill: true }));
        return cell;
      });

      const capTd = td("col-num", fmtUSD(r.cap, true));
      capTd.title = r.cap != null ? "$" + Math.round(r.cap).toLocaleString("en-US") : "";

      const supplyTd = td("col-num col-supply", fmtNum(r.count));
      supplyTd.title = r.count != null ? Math.round(r.count).toLocaleString("en-US") + " units" : "";

      const sparkTd = document.createElement("td");
      sparkTd.className = "col-spark";
      const sd = r.win["30d"] != null ? r.win["30d"] : r.change;
      sparkTd.innerHTML = sparkline(r.sparkCaps, sd == null ? true : sd >= 0);

      tr.append(rank, nameTd, priceTd, ...winTds, capTd, supplyTd, sparkTd);
      frag.appendChild(tr);
    });
    body.appendChild(frag);
  }

  function td(cls, text) {
    const t = document.createElement("td");
    t.className = cls;
    t.textContent = text;
    return t;
  }

  /* ----------------------------------------------------------------- modal */
  let lastFocused = null;
  function openModal(r) {
    lastFocused = document.activeElement;
    const { data } = state;
    document.getElementById("modal-title").textContent = r.name;

    const stats = document.getElementById("modal-stats");
    stats.textContent = "";
    const items = [
      ["Price", fmtPrice(r.price)],
      ["Market cap", fmtUSD(r.cap, true)],
      ["Supply", r.count != null ? Math.round(r.count).toLocaleString("en-US") : "—"],
      ["Dominance", r.dominance != null ? r.dominance.toFixed(2) + "%" : "—"],
    ];
    for (const [label, value] of items) {
      const ms = document.createElement("div"); ms.className = "ms";
      const l = document.createElement("span"); l.className = "ms-label"; l.textContent = label;
      const v = document.createElement("span"); v.className = "ms-value"; v.textContent = value;
      ms.appendChild(l); ms.appendChild(v); stats.appendChild(ms);
    }
    // fixed-window price change chips
    const winWrap = document.createElement("div");
    winWrap.className = "ms ms-wide";
    const wl = document.createElement("span");
    wl.className = "ms-label";
    wl.textContent = "Price change";
    const wrow = document.createElement("div");
    wrow.className = "window-row";
    for (const w of WINDOWS) wrow.appendChild(windowPill(w.key, r.win[w.key]));
    winWrap.appendChild(wl); winWrap.appendChild(wrow);
    stats.appendChild(winWrap);

    buildLineChart(document.getElementById("modal-price-chart"), {
      labels: data.dates, values: r.prices,
      format: (v) => fmtPrice(v), yTickFmt: (v) => fmtUSD(v, true),
      height: 210, interactive: true,
    });
    buildLineChart(document.getElementById("modal-cap-chart"), {
      labels: data.dates, values: r.caps,
      format: (v) => fmtUSD(v, false), yTickFmt: (v) => fmtUSD(v, true),
      height: 210, interactive: true,
    });

    const modal = document.getElementById("modal");
    modal.hidden = false;
    document.body.style.overflow = "hidden";
    modal.querySelector(".modal-close").focus();
  }
  function closeModal() {
    document.getElementById("modal").hidden = true;
    document.body.style.overflow = "";
    if (lastFocused && lastFocused.focus) lastFocused.focus();
  }

  /* ------------------------------------------------------------- theme */
  function initTheme() {
    const saved = localStorage.getItem("cs2mc-theme");
    if (saved === "dark" || saved === "light") document.documentElement.setAttribute("data-theme", saved);
    document.getElementById("theme-toggle").addEventListener("click", () => {
      const cur = document.documentElement.getAttribute("data-theme");
      const isDark = cur ? cur === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
      const next = isDark ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem("cs2mc-theme", next);
      // re-render charts so surface-colored strokes/rings pick up new theme
      if (state.data) { renderHistory(); }
    });
  }

  /* -------------------------------------------------------------- wiring */
  function wire() {
    document.querySelectorAll("#items-table thead th[data-sort]").forEach((th) => {
      th.addEventListener("click", () => {
        const k = th.getAttribute("data-sort");
        const key = k === "rank" ? "cap" : k;
        if (state.sortKey === key) state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
        else { state.sortKey = key; state.sortDir = key === "name" ? "asc" : "desc"; }
        renderTable();
      });
    });
    let t;
    document.getElementById("search").addEventListener("input", (e) => {
      clearTimeout(t);
      const v = e.target.value;
      t = setTimeout(() => { state.search = v; renderTable(); }, 120);
    });
    document.querySelectorAll("[data-close]").forEach((n) => n.addEventListener("click", closeModal));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !document.getElementById("modal").hidden) closeModal(); });
    window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(() => { if (state.data) renderHistory(); }, 150); });
  }

  /* --------------------------------------------------------------- init */
  async function init() {
    initTheme();
    try {
      const res = await fetch("data/market.json", { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.dates || !data.dates.length) throw new Error("no dates in dataset");
      state.data = data;

      document.getElementById("loading").hidden = true;
      document.getElementById("app").hidden = false;

      const genTxt = data.generatedAt ? `Built ${data.generatedAt.replace("T", " ").replace("Z", " UTC")}` : "";
      document.getElementById("generated").textContent = genTxt;
      document.getElementById("footer-generated").textContent = genTxt;

      wire();
      render();
    } catch (err) {
      document.getElementById("loading").hidden = true;
      const e = document.getElementById("error");
      e.hidden = false;
      e.textContent =
        `Could not load market data (${err.message}). Make sure data/market.json exists ` +
        `(run: python3 scripts/build.py) and that the site is served over HTTP, not opened as a file://.`;
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
