# EPF Calculator

Project your Employee Provident Fund (EPF) balance year by year. It comes as a website and as a command-line script, and both give the same numbers.

**Website:** https://ramyadhanush.github.io/epf-calculator/ (once GitHub Pages is enabled, see [Deploy](#deploy-to-github-pages))

## What it does

Inputs:

1. Current PF balance
2. Monthly employee contribution and monthly employer contribution (EPF share)
3. Voluntary PF (VPF), if any
4. Current interest rate
5. Current month
6. Number of years you will contribute

Optional:

- Different interest rates for specific financial years
- A yearly salary hike on employee and employer contributions
- CSV export

Output, for every financial year (April to March) from now on:

- Opening balance and contributions in the year
- Principal at year end (opening balance plus all contributions, no interest)
- Interest earned in the year, total interest to date, and total balance at year end
- Two sums that both equal the total balance, colour-coded in the website table: Opening + Contributed + Interest earned (year), and Principal + Total interest (to date). The site and the CLI check them on every row.

At the end, a summary: total contributions (employee, employer, VPF), total interest, and the final balance.

## How interest is computed

- Interest accrues every month on that month's opening balance (before that month's contribution), at rate / 12.
- Accrued interest is credited once, on 31 March, and earns interest from the next month. It is not compounded within the year.
- The first and last rows are part years if you start or stop mid-year. Interest accrued up to the last month is credited in the last row.
- `--rate` is the starting rate. Each rate change applies from its financial year onwards, until a later change.
- A salary hike applies every April by default (employee and employer only). Voluntary PF stays fixed unless you ask for the hike to include it. No hike applies in the start month.
- Enter only the employer's share that goes into EPF. The EPS pension share (8.33% of wages, capped at wages of ₹15,000, so at most ₹1,250 a month) is not part of the EPF balance.

This is an estimate for planning. EPFO sets the rate each year and your passbook can differ by a few rupees.

## Command line

Python 3.8+, no dependencies.

```bash
python3 epf_calculator.py            # prompts for each input

python3 epf_calculator.py \
  --balance 500000 --employee 6000 --employer 3500 --vpf 2000 \
  --rate 8.25 --month Nov --year 2026 --years 10 \
  --rate-changes "2027-28=8.10,2029-30=7.90" \
  --hike 8 --csv epf.csv
```

| Flag | Meaning |
|---|---|
| `--balance`, `--employee`, `--employer`, `--vpf` | Amounts in ₹ |
| `--rate` | Starting interest rate, % per year |
| `--month`, `--year` | Start month (1-12 or name) and calendar year (default: this year) |
| `--years` | Years you will contribute |
| `--rate-changes` | Year-wise rates, `"2027-28=8.10,2029-30=7.90"` |
| `--hike`, `--hike-month`, `--hike-vpf` | Yearly salary hike %, month it applies (default April), include VPF |
| `--csv FILE` | Write the yearly table to a CSV file |

## Website

The site is plain HTML, CSS and JavaScript in [`docs/`](docs). There is no build step and no dependency, and nothing leaves the browser. To try it locally:

```bash
python3 -m http.server 8000 --bind 127.0.0.1 --directory docs
# open http://127.0.0.1:8000
```

## Deploy to GitHub Pages

Create the repository under your account and push:

```bash
gh repo create ramyaDhanush/epf-calculator --public --source . --remote origin --push
```

Then enable Pages with the `main` branch and the `/docs` folder:

```bash
gh api -X POST repos/ramyaDhanush/epf-calculator/pages \
  -f "source[branch]=main" -f "source[path]=/docs"
```

Or in the browser: repository **Settings, Pages, Build and deployment, Deploy from a branch, `main` and `/docs`**. The site goes live at `https://ramyadhanush.github.io/epf-calculator/` within a minute or two.

To show it on your profile, pin the repository and add the site URL in the repository's **About** box.

## Tests

```bash
python3 -m unittest discover -s tests -v
node --test tests/
```

Both suites assert the same reference numbers, which keeps the Python script and the website in step. GitHub Actions runs them on every push (`.github/workflows/ci.yml`).

## Project layout

```
epf_calculator.py      command-line tool
docs/                  website served by GitHub Pages
  index.html style.css app.js (UI)  epf.js (calculation engine)
tests/                 Python and Node tests
```

## License

MIT, see [LICENSE](LICENSE).
