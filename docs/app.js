/* UI for the EPF calculator. Calculation lives in epf.js. */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const fmt = EPF.formatINR;
  let lastRows = [];

  function fillMonths(select, selected) {
    EPF.MONTH_NAMES.forEach((name, i) => {
      const opt = document.createElement("option");
      opt.value = String(i + 1);
      opt.textContent = name;
      if (i + 1 === selected) opt.selected = true;
      select.appendChild(opt);
    });
  }

  // ---------- rate-change rows ----------
  function addRateRow(fy, rate) {
    const row = document.createElement("div");
    row.className = "rate-row";

    const fyIn = document.createElement("input");
    fyIn.type = "text";
    fyIn.className = "rate-fy";
    fyIn.placeholder = "From FY, e.g. 2027-28";
    fyIn.setAttribute("aria-label", "Financial year the new rate starts");
    fyIn.value = fy || "";

    const rateIn = document.createElement("input");
    rateIn.type = "number";
    rateIn.className = "rate-val";
    rateIn.min = "0";
    rateIn.step = "any";
    rateIn.placeholder = "Rate %";
    rateIn.setAttribute("aria-label", "New interest rate in percent");
    rateIn.value = rate == null ? "" : rate;

    const rm = document.createElement("button");
    rm.type = "button";
    rm.className = "btn secondary rm";
    rm.textContent = "Remove";

    row.append(fyIn, rateIn, rm);
    $("rate-rows").appendChild(row);
  }

  // ---------- read form ----------
  function readNumber(id, blankValue) {
    const v = $(id).value.trim();
    if (v === "") return blankValue;
    return Number(v);
  }

  function collect() {
    const errors = [];
    const rateChanges = {};
    document.querySelectorAll("#rate-rows .rate-row").forEach((row) => {
      const fy = row.querySelector(".rate-fy").value.trim();
      const val = row.querySelector(".rate-val").value.trim();
      if (!fy && !val) return;
      try {
        Object.assign(rateChanges, EPF.parseRateChanges(fy + "=" + val));
      } catch (e) {
        errors.push("Rate change '" + fy + " = " + val + "' is not valid. Use a financial year like 2027-28 and a rate like 8.10.");
      }
    });

    const opts = {
      balance: readNumber("balance", NaN),
      employee: readNumber("employee", NaN),
      employer: readNumber("employer", NaN),
      vpf: readNumber("vpf", 0),
      rate: readNumber("rate", NaN),
      rateChanges: rateChanges,
      startMonth: Number($("startMonth").value),
      startYear: readNumber("startYear", NaN),
      years: readNumber("years", NaN),
      hike: readNumber("hike", 0),
      hikeMonth: Number($("hikeMonth").value),
      hikeVpf: $("hikeVpf").checked,
    };
    return { opts: opts, errors: errors.concat(EPF.validate(opts)) };
  }

  // ---------- render ----------
  function card(label, value, note, strong) {
    const d = document.createElement("div");
    d.className = "card" + (strong ? " strong" : "");
    const l = document.createElement("div");
    l.className = "card-label";
    l.textContent = label;
    const v = document.createElement("div");
    v.className = "card-value";
    v.textContent = "₹ " + fmt(value);
    d.append(l, v);
    if (note) {
      const n = document.createElement("div");
      n.className = "card-note";
      n.textContent = note;
      d.appendChild(n);
    }
    return d;
  }

  function renderSummary(s) {
    const box = $("summary");
    box.replaceChildren(
      card("Final balance (" + s.endPeriod + ")", s.closing, "", true),
      card("Principal", s.principal, "Opening ₹ " + fmt(s.opening) + " + contributions ₹ " + fmt(s.contributed)),
      card("Interest earned", s.interest, ""),
      card("Contributions", s.contributed,
        "Employee ₹ " + fmt(s.employee) + ", employer ₹ " + fmt(s.employer) + ", VPF ₹ " + fmt(s.vpf))
    );
  }

  function compact(n) {
    if (n >= 1e7) return (n / 1e7).toFixed(1) + " Cr";
    if (n >= 1e5) return (n / 1e5).toFixed(1) + " L";
    if (n >= 1e3) return (n / 1e3).toFixed(0) + " K";
    return String(Math.round(n));
  }

  // ---------- bar chart: one stacked bar per financial year ----------
  const SVG_W = 720, SVG_H = 300, PAD_L = 62, PAD_R = 10, PAD_T = 12;

  function isPartYear(r) {
    const parts = r.period.split(" - ");
    return !(parts[0].startsWith("Apr") && parts[1].startsWith("Mar"));
  }

  function renderChart(rows) {
    hideTip();
    const n = rows.length;
    const slot = (SVG_W - PAD_L - PAD_R) / n;
    const mode = slot >= 78 ? "full" : slot >= 52 ? "short" : slot >= 18 ? "angled" : "vertical";
    const padB = mode === "full" || mode === "short" ? 34 : 62;
    const plotH = SVG_H - PAD_T - padB;
    const max = Math.max.apply(null, rows.map((r) => r.closing)) || 1;
    const barW = Math.min(slot * 0.68, 56);
    const fontPx = slot < 14 ? 8 : slot < 22 ? 9 : 11;

    let s = '<svg viewBox="0 0 ' + SVG_W + " " + SVG_H + '" role="group" ' +
      'aria-label="Stacked bars of principal and interest at the end of each financial year. Hover or focus a bar for details.">';
    for (let t = 0; t <= 4; t++) {
      const y = PAD_T + plotH * (1 - t / 4);
      s += '<line class="gl" x1="' + PAD_L + '" x2="' + (SVG_W - PAD_R) + '" y1="' + y + '" y2="' + y + '"/>';
      s += '<text class="axis" x="' + (PAD_L - 6) + '" y="' + (y + 4) + '" text-anchor="end">₹ ' + compact((max * t) / 4) + "</text>";
    }
    rows.forEach((r, i) => {
      const x = PAD_L + i * slot + (slot - barW) / 2;
      const cx = x + barW / 2;
      const pH = (r.principal / max) * plotH;
      const iH = (r.cumInterest / max) * plotH;
      const yP = PAD_T + plotH - pH;
      const yI = yP - iH;
      const part = isPartYear(r);
      s += '<g class="col" data-i="' + i + '" tabindex="0" role="img" aria-label="' + r.fy + ": total balance ₹ " + fmt(r.closing) + '">' +
        '<rect class="hit" x="' + (PAD_L + i * slot) + '" y="' + PAD_T + '" width="' + slot + '" height="' + plotH + '"/>' +
        '<rect class="seg bar-principal" data-seg="principal" x="' + x + '" y="' + yP + '" width="' + barW + '" height="' + pH + '"/>' +
        '<rect class="seg bar-interest" data-seg="interest" x="' + x + '" y="' + yI + '" width="' + barW + '" height="' + iH + '"/>' +
        "</g>";
      const label = (mode === "full" ? r.fy : r.fy.slice(3)) + (part ? "*" : "");
      const ly = PAD_T + plotH + 14;
      if (mode === "full" || mode === "short") {
        s += '<text class="axis xl" x="' + cx + '" y="' + ly + '" text-anchor="middle" font-size="' + fontPx + '">' + label + "</text>";
      } else {
        const deg = mode === "angled" ? -45 : -90;
        const tx = mode === "angled" ? cx + 4 : cx + fontPx / 3;
        s += '<text class="axis xl" font-size="' + fontPx + '" text-anchor="end" x="' + tx + '" y="' + (ly - 4) +
          '" transform="rotate(' + deg + " " + tx + " " + (ly - 4) + ')">' + label + "</text>";
      }
    });
    s += "</svg>";
    $("chart-plot").innerHTML = s; // built only from numbers and fixed labels
    $("chart-note").hidden = !rows.some(isPartYear);
  }

  // ---------- chart tooltip ----------
  function tipEl(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function tipRow(swatch, label, value, sub, highlighted) {
    const row = tipEl("div", "tip-row" + (highlighted ? " hl" : ""));
    const head = tipEl("div", "tip-line");
    const l = tipEl("span", "tip-label");
    if (swatch) l.appendChild(tipEl("i", "sw " + swatch));
    l.appendChild(document.createTextNode(label));
    head.append(l, tipEl("span", "tip-val", "₹ " + value));
    row.appendChild(head);
    if (sub) row.appendChild(tipEl("div", "tip-sub", sub));
    return row;
  }

  function showTip(i, seg, clientX, clientY) {
    const r = lastRows[i];
    if (!r) return hideTip();
    const tip = $("tip");
    const title = tipEl("div", "tip-title", r.fy + (isPartYear(r) ? " (part year)" : ""));
    const period = tipEl("div", "tip-sub", r.period + " at " + r.rate.toFixed(2) + "% p.a.");
    tip.replaceChildren(
      title, period,
      tipRow("principal", "Principal (end)", fmt(r.principal),
        "Starting balance + all contributions so far. Contributed this year: ₹ " + fmt(r.contributed), seg === "principal"),
      tipRow("interest", "Total interest (to date)", fmt(r.cumInterest),
        "Earned this year: ₹ " + fmt(r.interest), seg === "interest"),
      tipRow("", "Total balance (end)", fmt(r.closing), "", false)
    );
    tip.hidden = false;
    const box = $("chart").getBoundingClientRect();
    const w = tip.offsetWidth || 240, h = tip.offsetHeight || 150;
    let x = clientX - box.left + 14;
    let y = clientY - box.top + 14;
    if (x + w > box.width) x = Math.max(0, clientX - box.left - w - 14);
    if (y + h > box.height) y = Math.max(0, box.height - h);
    tip.style.left = x + "px";
    tip.style.top = y + "px";
  }

  function hideTip() {
    const tip = $("tip");
    if (tip) tip.hidden = true;
  }

  function onChartPointer(e) {
    const col = e.target && e.target.closest ? e.target.closest("[data-i]") : null;
    if (!col) return hideTip();
    const seg = e.target.dataset ? e.target.dataset.seg || null : null;
    showTip(Number(col.dataset.i), seg, e.clientX, e.clientY);
  }

  function onChartFocus(e) {
    const col = e.target && e.target.closest ? e.target.closest("[data-i]") : null;
    if (!col) return;
    const b = col.getBoundingClientRect();
    showTip(Number(col.dataset.i), null, b.left + b.width / 2, b.top + 20);
  }

  function renderTable(rows) {
    const body = $("table").tBodies[0];
    body.replaceChildren();
    rows.forEach((r) => {
      const tr = document.createElement("tr");
      const cells = [
        [r.fy, ""], [r.period, ""], [r.rate.toFixed(2), "num"],
        [fmt(r.opening), "num g-year"], [fmt(r.contributed), "num g-year"], [fmt(r.interest), "num g-year"],
        [fmt(r.principal), "num g-cum"], [fmt(r.cumInterest), "num g-cum"],
        [fmt(r.closing), "num total"],
      ];
      cells.forEach(([text, cls]) => {
        const td = document.createElement("td");
        td.textContent = text;
        td.className = cls;
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
  }

  function renderCheck(rows, balance) {
    const problems = EPF.verify(rows, balance);
    const el = $("check");
    el.className = "check" + (problems.length ? " bad" : " ok");
    el.textContent = problems.length
      ? "Check failed: " + problems.join("; ")
      : "Check passed: both sums equal the total balance on every row, and each year opens with the previous year's closing balance.";
  }

  function update() {
    const { opts, errors } = collect();
    const errBox = $("errors");
    if (errors.length) {
      errBox.hidden = false;
      errBox.replaceChildren(...errors.map((e) => {
        const p = document.createElement("p");
        p.textContent = e;
        return p;
      }));
      $("output").hidden = true;
      lastRows = [];
      return;
    }
    errBox.hidden = true;
    $("output").hidden = false;
    lastRows = EPF.project(opts);
    renderSummary(EPF.summarize(lastRows, opts.balance));
    renderChart(lastRows);
    renderTable(lastRows);
    renderCheck(lastRows, opts.balance);
  }

  function downloadCSV() {
    if (!lastRows.length) return;
    const blob = new Blob([EPF.toCSV(lastRows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "epf-projection.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // ---------- init ----------
  const now = new Date();
  fillMonths($("startMonth"), now.getMonth() + 1);
  fillMonths($("hikeMonth"), 4);
  $("startYear").value = now.getFullYear();

  $("form").addEventListener("input", update);
  $("form").addEventListener("change", update);
  $("form").addEventListener("submit", (e) => e.preventDefault());
  $("add-rate").addEventListener("click", () => {
    addRateRow("", null);
    $("rate-rows").lastElementChild.querySelector(".rate-fy").focus();
  });
  $("rate-rows").addEventListener("click", (e) => {
    if (e.target.classList.contains("rm")) {
      e.target.closest(".rate-row").remove();
      update();
    }
  });
  $("download").addEventListener("click", downloadCSV);
  $("chart").addEventListener("pointermove", onChartPointer);
  $("chart").addEventListener("pointerdown", onChartPointer);
  $("chart").addEventListener("pointerleave", hideTip);
  $("chart").addEventListener("focusin", onChartFocus);
  $("chart").addEventListener("focusout", hideTip);

  update();
})();
