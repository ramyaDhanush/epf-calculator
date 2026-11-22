#!/usr/bin/env python3
"""
EPF (Employees' Provident Fund) projection calculator for Indian employees.

Run with no arguments to be prompted for each input, or pass them as flags:

    python3 epf_calculator.py --balance 500000 --employee 6000 --employer 3500 \
        --vpf 2000 --rate 8.25 --month Nov --years 10

Optional features:

    --rate-changes "2027-28=8.10,2029-30=7.90"   year-wise interest rates
    --hike 8                                     8% yearly salary hike
    --csv epf.csv                                export the yearly table

How interest is computed (EPFO method):
  * Interest accrues every month on that month's opening balance, i.e. the
    balance before the month's own contribution is added. Rate/12 per month.
  * Accrued interest is NOT compounded within the year. It is credited once, on
    31 March (end of the financial year), and earns interest from the next month.
  * Rows are financial years (April-March). The first row is a part year if you
    start mid-year, and the last row is a part year if your contribution period
    ends mid-year (interest accrued up to that month is credited in that row).

Year-wise rates:
  * --rate is the starting rate. Each entry in --rate-changes sets a new rate
    from that financial year onwards, until a later entry changes it again.
    Example: --rate 8.25 --rate-changes "2028-29=8.00" gives 8.25% until
    FY 2027-28 and 8.00% from FY 2028-29.

Salary hike (optional, default 0):
  * Employee and employer contributions grow by --hike % every year in
    --hike-month (default April = 4). No hike is applied in the start month.
  * Voluntary PF is a fixed amount unless you pass --hike-vpf.

Notes on the inputs:
  * "Employer" is the amount that goes into the EPF account. Of the employer's
    12%, the EPS pension share (8.33% of wages capped at Rs 15,000, max
    Rs 1,250/month) does not go to the EPF balance. Enter only the EPF share.
  * Contributions are assumed to start in the current month.
"""

import argparse
import calendar
import csv
import re
import sys
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, ROUND_HALF_UP

TWOPL = Decimal("0.01")
ZERO = Decimal(0)


def money(x):
    return Decimal(x).quantize(TWOPL, rounding=ROUND_HALF_UP)


def inr(x):
    """Format with Indian digit grouping (12,34,567.89)."""
    x = money(x)
    sign = "-" if x < 0 else ""
    whole, frac = f"{abs(x):.2f}".split(".")
    if len(whole) > 3:
        head, tail = whole[:-3], whole[-3:]
        parts = []
        while len(head) > 2:
            parts.insert(0, head[-2:])
            head = head[:-2]
        if head:
            parts.insert(0, head)
        whole = ",".join(parts + [tail])
    return f"{sign}{whole}.{frac}"


def parse_month(text):
    t = str(text).strip().lower()
    if t.isdigit():
        m = int(t)
        if 1 <= m <= 12:
            return m
    for i in range(1, 13):
        if t in (calendar.month_name[i].lower(), calendar.month_abbr[i].lower()):
            return i
    raise ValueError(f"Invalid month: {text!r} (use 1-12, 'Nov' or 'November')")


def non_neg_decimal(s):
    v = Decimal(str(s).replace(",", "").replace("%", ""))
    if v < 0:
        raise ValueError("must not be negative")
    return v


def pos_int(s):
    v = int(s)
    if v <= 0:
        raise ValueError("must be a positive whole number")
    return v


def parse_rate_changes(text):
    """'2027-28=8.10, FY2029-30=7.9' -> {2027: Decimal('8.10'), 2029: Decimal('7.9')}.
    Key is the calendar year in which the financial year starts."""
    out = {}
    if not text or not text.strip():
        return out
    for item in text.split(","):
        item = item.strip()
        if not item:
            continue
        m = re.fullmatch(r"(?:FY\s*)?(\d{4})(?:\s*-\s*\d{2,4})?\s*[=:]\s*([\d.]+)%?", item, re.I)
        if not m:
            raise ValueError(f"Invalid rate entry {item!r}. Use e.g. 2027-28=8.10")
        out[int(m.group(1))] = non_neg_decimal(m.group(2))
    return out


def fy_start(year, month):
    return year if month >= 4 else year - 1


def fy_label(year, month):
    s = fy_start(year, month)
    return f"FY {s}-{str(s + 1)[-2:]}"


def rate_for(fy_start_year, base_rate, changes):
    rate = base_rate
    for k in sorted(changes):
        if k <= fy_start_year:
            rate = changes[k]
    return rate


@dataclass
class Row:
    fy: str
    period: str
    rate: Decimal
    opening: Decimal
    employee: Decimal
    employer: Decimal
    vpf: Decimal
    principal: Decimal   # opening balance + all contributions to date, no interest
    interest: Decimal    # interest credited for this row
    cum_interest: Decimal
    closing: Decimal

    @property
    def contributed(self):
        return self.employee + self.employer + self.vpf


def project(balance, employee, employer, vpf, base_rate, rate_changes,
            start_month, start_year, years, hike=ZERO, hike_month=4, hike_vpf=False):
    bal = balance
    principal = balance
    cum_interest = ZERO
    rows = []

    emp, er, v = employee, employer, vpf
    row_open = bal
    r_emp = r_er = r_v = ZERO
    accrued = ZERO
    row_first = (start_year, start_month)

    y, m = start_year, start_month
    total_months = years * 12
    for i in range(total_months):
        if i > 0 and m == hike_month and hike:
            f = 1 + hike / 100
            emp, er = money(emp * f), money(er * f)
            if hike_vpf:
                v = money(v * f)

        rate = rate_for(fy_start(y, m), base_rate, rate_changes)
        accrued += bal * rate / 1200   # interest on opening balance of the month
        bal += emp + er + v
        principal += emp + er + v
        r_emp, r_er, r_v = r_emp + emp, r_er + er, r_v + v

        last = i == total_months - 1
        if m == 3 or last:             # financial year end, or end of contributions
            credited = money(accrued)
            bal += credited
            cum_interest += credited
            rows.append(Row(
                fy=fy_label(y, m),
                period=f"{calendar.month_abbr[row_first[1]]} {row_first[0]} - "
                       f"{calendar.month_abbr[m]} {y}",
                rate=rate,
                opening=row_open,
                employee=r_emp, employer=r_er, vpf=r_v,
                principal=principal,
                interest=credited,
                cum_interest=cum_interest,
                closing=bal,
            ))
            row_open, accrued = bal, ZERO
            r_emp = r_er = r_v = ZERO
            row_first = (y + (m == 12), m % 12 + 1)
        y, m = y + (m == 12), m % 12 + 1

    return rows


def verify(rows, balance):
    """Return a list of problems; empty means every identity holds exactly."""
    problems = []
    interest_sum = ZERO
    prev = balance
    for r in rows:
        if r.opening + r.contributed + r.interest != r.closing:
            problems.append(f"{r.fy}: opening + contributed + interest != total balance")
        if r.principal + r.cum_interest != r.closing:
            problems.append(f"{r.fy}: principal + total interest != total balance")
        if r.opening != prev:
            problems.append(f"{r.fy}: opening != previous closing")
        interest_sum += r.interest
        if interest_sum != r.cum_interest:
            problems.append(f"{r.fy}: total interest != sum of yearly interest")
        prev = r.closing
    return problems


def print_table(rows):
    headers = ["Financial year", "Period", "Rate %", "Opening", "Contributed",
               "Interest earned (year)", "Principal (end)", "Total interest (to date)",
               "Total balance (end)"]
    data = [[r.fy, r.period, f"{r.rate:.2f}", inr(r.opening), inr(r.contributed),
             inr(r.interest), inr(r.principal), inr(r.cum_interest), inr(r.closing)]
            for r in rows]
    widths = [max(len(h), *(len(d[i]) for d in data)) for i, h in enumerate(headers)]

    def line(cells):
        return "  ".join(c.ljust(widths[i]) if i < 2 else c.rjust(widths[i])
                         for i, c in enumerate(cells))

    print(line(headers))
    print("  ".join("-" * w for w in widths))
    for d in data:
        print(line(d))
    print("\nOpening + Contributed + Interest earned (year) = Total balance")
    print("Principal + Total interest (to date)          = Total balance")


def print_summary(rows, balance, years):
    last = rows[-1]
    emp = sum(r.employee for r in rows)
    er = sum(r.employer for r in rows)
    v = sum(r.vpf for r in rows)
    print("\n=== Summary at end of contribution period "
          f"({years} years, {last.period.split(' - ')[1]}) ===")
    print(f"Opening balance                 : Rs {inr(balance)}")
    print(f"Total contributions             : Rs {inr(emp + er + v)}")
    print(f"   Employee                     : Rs {inr(emp)}")
    print(f"   Employer (EPF share)         : Rs {inr(er)}")
    print(f"   Voluntary PF                 : Rs {inr(v)}")
    print(f"Principal (opening + contrib.)  : Rs {inr(last.principal)}")
    print(f"Total interest earned           : Rs {inr(last.cum_interest)}")
    print(f"Final account balance           : Rs {inr(last.closing)}")


def write_csv(path, rows):
    """Plain numbers (no thousands separators) so spreadsheets can read them."""
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["financial_year", "period", "interest_rate_pct", "opening_balance",
                    "employee_contribution", "employer_contribution", "voluntary_pf",
                    "total_contributed", "principal_end", "interest_earned",
                    "cumulative_interest", "total_balance_end"])
        for r in rows:
            w.writerow([r.fy, r.period, f"{r.rate:.2f}", r.opening, r.employee, r.employer,
                        r.vpf, r.contributed, r.principal, r.interest,
                        r.cum_interest, r.closing])


def ask(prompt, default=None, cast=str):
    suffix = f" [{default}]" if default is not None else ""
    while True:
        raw = input(f"{prompt}{suffix}: ").strip()
        if not raw and default is not None:
            raw = str(default)
        try:
            return cast(raw)
        except Exception as e:
            print(f"  Invalid input ({e}). Try again.")


def main():
    ap = argparse.ArgumentParser(description="EPF balance projection (India)")
    ap.add_argument("--balance", type=non_neg_decimal, help="Current EPF balance (Rs)")
    ap.add_argument("--employee", type=non_neg_decimal, help="Monthly employee contribution (Rs)")
    ap.add_argument("--employer", type=non_neg_decimal, help="Monthly employer contribution to EPF (Rs)")
    ap.add_argument("--vpf", type=non_neg_decimal, help="Monthly voluntary PF (Rs), 0 if none")
    ap.add_argument("--rate", type=non_neg_decimal, help="Annual interest rate in %% (e.g. 8.25)")
    ap.add_argument("--month", help="Current month: 1-12 or name (Nov)")
    ap.add_argument("--year", type=int, help="Calendar year of current month (default: this year)")
    ap.add_argument("--years", type=pos_int, help="Number of years you will contribute")
    # optional features
    ap.add_argument("--rate-changes", help='Year-wise rates, e.g. "2027-28=8.10,2029-30=7.90"')
    ap.add_argument("--hike", type=non_neg_decimal, help="Yearly salary hike %% applied to employee+employer contributions (default 0)")
    ap.add_argument("--hike-month", type=parse_month, default=4, help="Month the hike takes effect (default Apr)")
    ap.add_argument("--hike-vpf", action="store_true", help="Also apply the hike to voluntary PF")
    ap.add_argument("--csv", metavar="FILE", help="Write the yearly table to a CSV file")
    a = ap.parse_args()

    today = date.today()
    required = (a.balance, a.employee, a.employer, a.vpf, a.rate, a.month, a.years)
    prompting = any(x is None for x in required)
    extras = prompting and sys.stdin.isatty()   # only nag about optional extras when interactive
    try:
        balance = a.balance if a.balance is not None else ask("1. Current PF balance (Rs)", 0, non_neg_decimal)
        employee = a.employee if a.employee is not None else ask("2a. Monthly employee contribution (Rs)", None, non_neg_decimal)
        employer = a.employer if a.employer is not None else ask("2b. Monthly employer contribution to EPF (Rs)", None, non_neg_decimal)
        vpf = a.vpf if a.vpf is not None else ask("3. Monthly voluntary PF (Rs)", 0, non_neg_decimal)
        rate = a.rate if a.rate is not None else ask("4. Current interest rate (% p.a.)", "8.25", non_neg_decimal)
        month = parse_month(a.month) if a.month else ask("5. Current month (1-12 or name)", calendar.month_abbr[today.month], parse_month)
        years = a.years if a.years is not None else ask("6. Years you will contribute", None, pos_int)

        changes_text = a.rate_changes
        hike = a.hike if a.hike is not None else ZERO
        csv_path = a.csv
        if extras:
            if changes_text is None:
                changes_text = ask("Optional: rate changes by financial year, e.g. 2027-28=8.10,2029-30=7.9 (blank = none)", "", str)
            if a.hike is None:
                hike = ask("Optional: yearly salary hike % (0 = none)", 0, non_neg_decimal)
            if csv_path is None:
                csv_path = ask("Optional: CSV file to export (blank = none)", "", str) or None
        changes = parse_rate_changes(changes_text)
    except (EOFError, KeyboardInterrupt):
        sys.exit("\nAborted.")
    except ValueError as e:
        sys.exit(f"Error: {e}")

    year = a.year or today.year
    rows = project(balance, employee, employer, vpf, rate, changes, month, year, years,
                   hike=hike, hike_month=a.hike_month, hike_vpf=a.hike_vpf)

    print(f"\nEPF projection | start {calendar.month_name[month]} {year} | "
          f"monthly Rs {inr(employee + employer + vpf)} "
          f"(employee {inr(employee)} + employer {inr(employer)} + VPF {inr(vpf)}) | "
          f"rate {rate}% p.a.")
    if changes:
        print("Rate changes: " + ", ".join(f"FY {k}-{str(k + 1)[-2:]} -> {v:g}%" for k, v in sorted(changes.items())))
    if hike:
        print(f"Salary hike: {hike:g}% every {calendar.month_name[a.hike_month]} "
              f"on employee + employer{' + VPF' if a.hike_vpf else ''} contributions")
    print()
    print_table(rows)
    problems = verify(rows, balance)
    print("Check passed: both sums equal the total balance on every row." if not problems
          else "CHECK FAILED: " + "; ".join(problems))
    print_summary(rows, balance, years)

    if csv_path:
        try:
            write_csv(csv_path, rows)
            print(f"\nCSV written to {csv_path}")
        except OSError as e:
            print(f"\nCould not write CSV: {e}", file=sys.stderr)

    print("\nEstimate only. Assumes EPFO's monthly-running-balance interest method; "
          "rates and hikes are as entered.")


if __name__ == "__main__":
    main()
