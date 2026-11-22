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

  function renderChart(rows) {
    const W = 640, H = 260, padL = 58, padR = 8, padT = 10, padB = 28;
    const plotH = H - padT - padB;
    const max = Math.max.apply(null, rows.map((r) => r.closing)) || 1;
    const bw = (W - padL - padR) / rows.length;
    const barW = Math.min(bw * 0.7, 48);
    const step = Math.ceil(rows.length / 12);
    let s = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" ' +
      'aria-label="Stacked bars of principal and interest at the end of each financial year">';
    for (let t = 0; t <= 4; t++) {
      const y = padT + plotH * (1 - t / 4);
      s += '<line class="gl" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y + '" y2="' + y + '"/>';
      s += '<text class="axis" x="' + (padL - 6) + '" y="' + (y + 4) + '" text-anchor="end">' + compact((max * t) / 4) + "</text>";
    }
    rows.forEach((r, i) => {
      const x = padL + i * bw + (bw - barW) / 2;
      const pH = (r.principal / max) * plotH;
      const iH = (r.cumInterest / max) * plotH;
      const yP = padT + plotH - pH;
      const yI = yP - iH;
      const tip = r.fy + ": ₹ " + fmt(r.closing);
      s += '<g><title>' + tip + "</title>" +
        '<rect class="bar-principal" x="' + x + '" y="' + yP + '" width="' + barW + '" height="' + pH + '"/>' +
        '<rect class="bar-interest" x="' + x + '" y="' + yI + '" width="' + barW + '" height="' + iH + '"/></g>';
      if (i % step === 0) {
        const label = r.fy.slice(5, 7) + "-" + r.fy.slice(-2);
        s += '<text class="axis" x="' + (x + barW / 2) + '" y="' + (H - 8) + '" text-anchor="middle">' + label + "</text>";
      }
    });
    s += "</svg>";
    $("chart").innerHTML = s; // built only from numbers and fixed labels
  }

  function renderTable(rows) {
    const body = $("table").tBodies[0];
    body.replaceChildren();
    rows.forEach((r) => {
      const tr = document.createElement("tr");
      const cells = [r.fy, r.period, r.rate.toFixed(2), fmt(r.opening), fmt(r.contributed),
        fmt(r.principal), fmt(r.interest), fmt(r.closing)];
      cells.forEach((text, i) => {
        const td = document.createElement("td");
        td.textContent = text;
        if (i >= 2) td.className = "num";
        if (i === 7) td.className = "num total";
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
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

  update();
})();
