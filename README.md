# Cave Vinum

Turn a wine inventory into a mobile-friendly website with search, filters, and drinking-window indicators. Fork this repository, choose how to provide your inventory, and build the report locally or with your own hosting service.

## Choose how to build

The generator accepts either a local CSV file or a URL that returns a CSV export:

| Build location | Inventory source | Command |
|---|---|---|
| Local | CSV file | `node scripts/build-report.ts --file ./inventory.csv` |
| Local or remote | CSV export URL | `CAVE_CSV_URL='https://…' npm run build` |

For a remote build, configure `CAVE_CSV_URL` as an environment variable in whichever service runs the build. Keep it out of the repository; use that service's secret-variable feature if available. The URL must return the CSV data directly. The generator fetches it each time the build runs.

Alternatively, commit a CSV file in your fork and configure your build command to read it:

```bash
npm run build -- --file inventory.csv
```

If you commit your inventory, it is part of your Git history and visible to anyone who can access the repository. Treat the generated website as public too unless you protect it with access controls.

## How automated publishing works

This repository includes a GitHub Actions workflow that runs daily at 04:00 UTC or on demand:

```text
GitHub Actions commits an updated time_stamp.txt
  └─ your hosting/build service sees the new commit
       └─ runs the configured build command
            └─ the generator reads the CSV source and writes dist/
                 └─ your hosting service publishes dist/
```

**The GitHub workflow does not run the generator or commit the generated website.** It only updates `time_stamp.txt` and pushes that commit. Your hosting service must be connected to the repository, build on pushes to the branch, and publish the generated `dist/` directory. `dist/` is build output and is not committed to Git.

To enable the scheduled workflow in a fork, allow GitHub Actions to write to the repository under **Settings → Actions → General → Workflow permissions**. Run it immediately from **Actions → Refresh Cave Vinum → Run workflow**. If the timestamp commit appears but the site does not change, check the build and deployment logs from your hosting service.

## Spreadsheet template

[`template/cave-vinum-template.xlsx`](template/cave-vinum-template.xlsx) contains an `Inventory` tab with dropdowns, calculated fields, 200 prepared rows, and one sample wine. Replace or remove the example before publishing.

The generator reads values by column position, not by header text. Header names and language do not matter, but **keep all 12 columns in the template's A–L order**, including the calculated H and I columns.

| Column | Field | Use |
|---|---|---|
| A | Producer / Cuvée | Wine name; rows without a name are skipped |
| B | Vintage | Vintage year, or blank for non-vintage |
| C | Quantity | Bottle count; zero or less means out of stock |
| D | Color | Color filter and display |
| E | Appellation / Region | Appellation shown on the wine card |
| F | Drink from | First estimated year of the drinking window |
| G | Drink by | Last estimated year of the drinking window |
| H | Status (auto) | Workbook-calculated; ignored by the site |
| I | Years left (auto) | Workbook-calculated; ignored by the site |
| J | Food pairings | Comma- or semicolon-separated tags |
| K | Location | Bottle storage location |
| L | Notes / Serving | Notes separated by ` · ` |

The site recalculates statuses from quantity and drinking-window years at each build. Missing or invalid quantities and end years are reported as incomplete.

## Build locally

Requires Node.js 22.18 or later. No dependency installation is needed to generate the site from a CSV:

```bash
node scripts/build-report.ts --file ./inventory.csv
open dist/index.html
```

Or build from a CSV URL:

```bash
CAVE_CSV_URL='https://…' npm run build
```

The output is written to `dist/`. To check the generator's types, install development dependencies with `npm install`, then run `npm run typecheck`.

## What is committed?

| Item | In Git? | Purpose |
|---|---:|---|
| Generator, workflow, config, README, and workbook template | Yes | Source project |
| `time_stamp.txt` | Yes; updated daily by GitHub Actions | Triggers builds for connected hosting services |
| `inventory.csv` | Only if you choose the committed-CSV option | Build input; visible to repository readers |
| `CAVE_CSV_URL` | No | Configure as an environment variable for the build service |
| Generated `dist/` website files | No | Build output for your hosting service to publish |

CSV exports are ignored by Git except for `inventory.csv`. Do not commit inventory data you do not want to share.
