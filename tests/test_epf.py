import csv
import os
import sys
import tempfile
import unittest
from decimal import Decimal as D

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import epf_calculator as epf  # noqa: E402

BASE = dict(balance=D(500000), employee=D(6000), employer=D(3500), vpf=D(2000),
            base_rate=D("8.25"), rate_changes={}, start_month=11, start_year=2026, years=3)


class ProjectionTests(unittest.TestCase):
    def test_baseline_matches_reference(self):
        rows = epf.project(**BASE)
        self.assertEqual([r.fy for r in rows],
                         ["FY 2026-27", "FY 2027-28", "FY 2028-29", "FY 2029-30"])
        self.assertEqual(rows[0].interest, D("17978.13"))
        self.assertEqual(rows[-1].closing, D("1101567.33"))
        self.assertEqual(rows[-1].cum_interest, D("187567.33"))

    def test_year_end_balance_is_principal_plus_cumulative_interest(self):
        for r in epf.project(**{**BASE, "rate_changes": {2027: D("8.10")}, "hike": D(10)}):
            self.assertEqual(r.closing, r.principal + r.cum_interest)

    def test_rate_changes_and_hike_match_reference(self):
        rows = epf.project(**{**BASE, "rate_changes": {2027: D("8.10"), 2028: D("7.9")}, "hike": D(10)})
        self.assertEqual([f"{r.rate:.2f}" for r in rows], ["8.25", "8.10", "7.90", "7.90"])
        self.assertEqual(rows[1].contributed, D("149400.00"))
        self.assertEqual(rows[-1].closing, D("1157134.38"))

    def test_hike_not_applied_in_start_month_or_to_vpf_by_default(self):
        rows = epf.project(**{**BASE, "start_month": 4, "start_year": 2026, "years": 2, "hike": D(10)})
        self.assertEqual(rows[0].employee, D(6000) * 12)
        self.assertEqual(rows[1].employee, D(6600) * 12)
        self.assertEqual(rows[1].vpf, D(2000) * 12)
        rows = epf.project(**{**BASE, "start_month": 4, "start_year": 2026, "years": 2,
                              "hike": D(10), "hike_vpf": True})
        self.assertEqual(rows[1].vpf, D(2200) * 12)

    def test_zero_balance_one_full_year(self):
        rows = epf.project(D(0), D(1000), D(1000), D(0), D(8), {}, 4, 2026, 1)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].interest, D("880.00"))
        self.assertEqual(rows[0].closing, D("24880.00"))

    def test_rate_for_carries_forward(self):
        ch = {2028: D("7.0")}
        self.assertEqual(epf.rate_for(2027, D(8), ch), D(8))
        self.assertEqual(epf.rate_for(2028, D(8), ch), D(7))
        self.assertEqual(epf.rate_for(2031, D(8), ch), D(7))


class HelperTests(unittest.TestCase):
    def test_indian_grouping(self):
        self.assertEqual(epf.inr(D("1101567.33")), "11,01,567.33")
        self.assertEqual(epf.inr(D("999")), "999.00")
        self.assertEqual(epf.inr(D("12345678.9")), "1,23,45,678.90")

    def test_parse_month(self):
        self.assertEqual(epf.parse_month("Nov"), 11)
        self.assertEqual(epf.parse_month("december"), 12)
        self.assertEqual(epf.parse_month("3"), 3)
        with self.assertRaises(ValueError):
            epf.parse_month("13")

    def test_parse_rate_changes(self):
        self.assertEqual(epf.parse_rate_changes("2027-28=8.10, FY2029-30=7.9"),
                         {2027: D("8.10"), 2029: D("7.9")})
        self.assertEqual(epf.parse_rate_changes(""), {})
        with self.assertRaises(ValueError):
            epf.parse_rate_changes("abc")

    def test_csv_export(self):
        rows = epf.project(**BASE)
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "out.csv")
            epf.write_csv(path, rows)
            with open(path, newline="") as f:
                data = list(csv.DictReader(f))
        self.assertEqual(len(data), 4)
        self.assertEqual(data[-1]["total_balance_end"], "1101567.33")
        self.assertEqual(data[0]["interest_rate_pct"], "8.25")


if __name__ == "__main__":
    unittest.main()
