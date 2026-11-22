// Run with: node --test tests/
// These expected values are the same ones asserted in tests/test_epf.py, so the
// website engine stays in step with the Python CLI.
const test = require("node:test");
const assert = require("node:assert/strict");
const EPF = require("../docs/epf.js");

const BASE = {
  balance: 500000, employee: 6000, employer: 3500, vpf: 2000, rate: 8.25,
  rateChanges: {}, startMonth: 11, startYear: 2026, years: 3,
};

test("baseline matches the Python reference", () => {
  const rows = EPF.project(BASE);
  assert.deepEqual(rows.map((r) => r.fy), ["FY 2026-27", "FY 2027-28", "FY 2028-29", "FY 2029-30"]);
  assert.equal(rows[0].interest, 17978.13);
  assert.equal(rows[3].closing, 1101567.33);
  assert.equal(rows[3].cumInterest, 187567.33);
});

test("rate changes and hike match the Python reference", () => {
  const rows = EPF.project({ ...BASE, rateChanges: { 2027: 8.1, 2028: 7.9 }, hike: 10 });
  assert.deepEqual(rows.map((r) => r.rate), [8.25, 8.1, 7.9, 7.9]);
  assert.equal(rows[1].contributed, 149400);
  assert.equal(rows[3].closing, 1157134.38);
});

test("closing equals principal plus cumulative interest", () => {
  EPF.project({ ...BASE, rateChanges: { 2027: 8.1 }, hike: 10 }).forEach((r) => {
    assert.equal(EPF.money(r.principal + r.cumInterest), r.closing);
  });
});

test("hike skips the start month and VPF unless asked", () => {
  const o = { ...BASE, startMonth: 4, startYear: 2026, years: 2, hike: 10 };
  let rows = EPF.project(o);
  assert.equal(rows[0].employee, 72000);
  assert.equal(rows[1].employee, 79200);
  assert.equal(rows[1].vpf, 24000);
  rows = EPF.project({ ...o, hikeVpf: true });
  assert.equal(rows[1].vpf, 26400);
});

test("zero balance, one full year", () => {
  const rows = EPF.project({ balance: 0, employee: 1000, employer: 1000, vpf: 0, rate: 8, startMonth: 4, startYear: 2026, years: 1 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].interest, 880);
  assert.equal(rows[0].closing, 24880);
});

test("parseRateChanges", () => {
  assert.deepEqual(EPF.parseRateChanges("2027-28=8.10, FY2029-30=7.9"), { 2027: 8.1, 2029: 7.9 });
  assert.deepEqual(EPF.parseRateChanges(""), {});
  assert.throws(() => EPF.parseRateChanges("abc"));
});

test("validate flags bad input", () => {
  assert.equal(EPF.validate({ ...BASE }).length, 0);
  assert.ok(EPF.validate({ ...BASE, balance: NaN }).length > 0);
  assert.ok(EPF.validate({ ...BASE, years: 0 }).length > 0);
  assert.ok(EPF.validate({ ...BASE, employee: -1 }).length > 0);
});

test("CSV and INR formatting", () => {
  const csv = EPF.toCSV(EPF.project(BASE)).trim().split("\n");
  assert.equal(csv.length, 5);
  assert.ok(csv[4].endsWith(",1101567.33"));
  assert.equal(EPF.formatINR(1101567.33), "11,01,567.33");
});

test("both sums equal the total balance in every row, across scenarios", () => {
  for (let month = 1; month <= 12; month++) {
    for (const years of [1, 2, 7, 30]) {
      for (const hike of [0, 7.5]) {
        const o = { balance: 123456.78, employee: 4321.5, employer: 1250.25, vpf: 999.99, rate: 8.25,
          rateChanges: { 2028: 7.85, 2031: 8.6 }, startMonth: month, startYear: 2026, years, hike, hikeVpf: hike > 0 };
        const rows = EPF.project(o);
        assert.deepEqual(EPF.verify(rows, o.balance), [], JSON.stringify([month, years, hike]));
      }
    }
  }
});

test("verify detects a broken row", () => {
  const rows = EPF.project(BASE);
  rows[1].closing += 0.01;
  assert.ok(EPF.verify(rows, BASE.balance).length > 0);
});
