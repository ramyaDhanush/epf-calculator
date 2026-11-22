/*
 * EPF projection engine (browser + Node). Mirrors epf_calculator.py.
 *
 * Interest accrues monthly on the month's opening balance at rate/12, is not
 * compounded within the year, and is credited on 31 March. Rows are financial
 * years; the first and last rows can be part years.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.EPF = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  const MONTH_ABBR = MONTH_NAMES.map((m) => m.slice(0, 3));

  // Round half up to 2 decimals (small epsilon absorbs binary float error).
  function money(x) {
    return Math.round(x * 100 + (x >= 0 ? 1e-6 : -1e-6)) / 100;
  }

  function fyStart(year, month) {
    return month >= 4 ? year : year - 1;
  }

  function fyLabel(year, month) {
    const s = fyStart(year, month);
    return "FY " + s + "-" + String(s + 1).slice(-2);
  }

  // "2027-28=8.10, FY2029-30=7.9" -> { 2027: 8.1, 2029: 7.9 } (key = FY start year)
  function parseRateChanges(text) {
    const out = {};
    if (!text || !text.trim()) return out;
    for (let item of text.split(",")) {
      item = item.trim();
      if (!item) continue;
      const m = /^(?:FY\s*)?(\d{4})(?:\s*-\s*\d{2,4})?\s*[=:]\s*(\d+(?:\.\d+)?)\s*%?$/i.exec(item);
      if (!m) throw new Error("Invalid rate entry '" + item + "'. Use e.g. 2027-28=8.10");
      out[Number(m[1])] = Number(m[2]);
    }
    return out;
  }

  function rateFor(fyStartYear, baseRate, changes) {
    let rate = baseRate;
    Object.keys(changes).map(Number).sort((a, b) => a - b).forEach((k) => {
      if (k <= fyStartYear) rate = changes[k];
    });
    return rate;
  }

  function validate(o) {
    const errors = [];
    const nonNeg = (v, name) => {
      if (typeof v !== "number" || !isFinite(v) || v < 0) errors.push(name + " must be a number, 0 or more.");
    };
    nonNeg(o.balance, "Current balance");
    nonNeg(o.employee, "Employee contribution");
    nonNeg(o.employer, "Employer contribution");
    nonNeg(o.vpf, "Voluntary PF");
    nonNeg(o.rate, "Interest rate");
    nonNeg(o.hike || 0, "Salary hike");
    if (!Number.isInteger(o.years) || o.years < 1 || o.years > 60) errors.push("Years must be a whole number from 1 to 60.");
    if (!Number.isInteger(o.startMonth) || o.startMonth < 1 || o.startMonth > 12) errors.push("Choose a start month.");
    if (!Number.isInteger(o.startYear) || o.startYear < 1990 || o.startYear > 2200) errors.push("Start year looks wrong.");
    return errors;
  }

  /**
   * @param {object} o balance, employee, employer, vpf, rate (% p.a.),
   *   rateChanges ({fyStartYear: rate}), startMonth (1-12), startYear, years,
   *   hike (%), hikeMonth (1-12, default 4), hikeVpf (bool)
   * @returns {Array} one row per financial year
   */
  function project(o) {
    const changes = o.rateChanges || {};
    const hike = o.hike || 0;
    const hikeMonth = o.hikeMonth || 4;

    let bal = o.balance;
    let principal = o.balance;
    let cumInterest = 0;
    let emp = o.employee, er = o.employer, v = o.vpf;
    let rowOpen = bal, rEmp = 0, rEr = 0, rV = 0, accrued = 0;
    let first = { year: o.startYear, month: o.startMonth };
    let y = o.startYear, m = o.startMonth;
    const total = o.years * 12;
    const rows = [];

    for (let i = 0; i < total; i++) {
      if (i > 0 && m === hikeMonth && hike) {
        const f = 1 + hike / 100;
        emp = money(emp * f);
        er = money(er * f);
        if (o.hikeVpf) v = money(v * f);
      }
      const rate = rateFor(fyStart(y, m), o.rate, changes);
      accrued += (bal * rate) / 1200; // interest on the month's opening balance
      bal += emp + er + v;
      principal += emp + er + v;
      rEmp += emp; rEr += er; rV += v;

      const last = i === total - 1;
      if (m === 3 || last) {
        const credited = money(accrued);
        bal = money(bal + credited);
        cumInterest = money(cumInterest + credited);
        principal = money(principal);
        rows.push({
          fy: fyLabel(y, m),
          period: MONTH_ABBR[first.month - 1] + " " + first.year + " - " + MONTH_ABBR[m - 1] + " " + y,
          rate: rate,
          opening: money(rowOpen),
          employee: money(rEmp), employer: money(rEr), vpf: money(rV),
          contributed: money(rEmp + rEr + rV),
          principal: principal,
          interest: credited,
          cumInterest: cumInterest,
          closing: bal,
        });
        rowOpen = bal; accrued = 0; rEmp = rEr = rV = 0;
        first = { year: m === 12 ? y + 1 : y, month: (m % 12) + 1 };
      }
      if (m === 12) { y += 1; m = 1; } else { m += 1; }
    }
    return rows;
  }

  // Returns a list of problems; an empty list means every identity holds.
  function verify(rows, balance) {
    const problems = [];
    const near = (a, b) => Math.abs(a - b) < 0.005;
    let interestSum = 0;
    rows.forEach((r, i) => {
      if (!near(r.opening + r.contributed + r.interest, r.closing))
        problems.push(r.fy + ": opening + contributed + interest does not equal total balance");
      if (!near(r.principal + r.cumInterest, r.closing))
        problems.push(r.fy + ": principal + total interest does not equal total balance");
      if (!near(r.employee + r.employer + r.vpf, r.contributed))
        problems.push(r.fy + ": contribution parts do not add up");
      const prev = i === 0 ? balance : rows[i - 1].closing;
      if (!near(r.opening, prev))
        problems.push(r.fy + ": opening balance differs from the previous closing balance");
      interestSum += r.interest;
      if (!near(interestSum, r.cumInterest))
        problems.push(r.fy + ": total interest to date does not match the yearly interest");
    });
    return problems;
  }

  function summarize(rows, balance) {
    const sum = (k) => money(rows.reduce((a, r) => a + r[k], 0));
    const last = rows[rows.length - 1];
    return {
      opening: balance,
      employee: sum("employee"), employer: sum("employer"), vpf: sum("vpf"),
      contributed: sum("contributed"),
      principal: last.principal,
      interest: last.cumInterest,
      closing: last.closing,
      endPeriod: last.period.split(" - ")[1],
    };
  }

  const CSV_HEADER = ["financial_year", "period", "interest_rate_pct", "opening_balance",
    "employee_contribution", "employer_contribution", "voluntary_pf", "total_contributed",
    "principal_end", "interest_earned", "cumulative_interest", "total_balance_end"];

  function toCSV(rows) {
    const lines = [CSV_HEADER.join(",")];
    const f = (n) => n.toFixed(2);
    rows.forEach((r) => {
      lines.push([r.fy, r.period, f(r.rate), f(r.opening), f(r.employee), f(r.employer), f(r.vpf),
        f(r.contributed), f(r.principal), f(r.interest), f(r.cumInterest), f(r.closing)].join(","));
    });
    return lines.join("\n") + "\n";
  }

  const inrFmt = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function formatINR(n) {
    return inrFmt.format(n);
  }

  return { MONTH_NAMES, MONTH_ABBR, money, fyLabel, parseRateChanges, validate, project, verify, summarize, toCSV, formatINR };
});
