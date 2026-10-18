# Cave Vinum

Turn a wine inventory into a mobile-friendly website with search, filters, and drinking-window indicators. Fork this repository, choose where your inventory lives, and connect your fork to Cloudflare Pages.

## How publishing works

```text
GitHub Actions (daily or manual)
  └─ commits an updated time_stamp.txt to your default branch
       └─ Cloudflare Pages sees the new commit
            └─ runs the build command and reads your inventory
                 └─ creates and publishes the website from dist/
```

**The GitHub workflow does not generate or commit the website HTML.** Cloudflare Pages builds the site after each push to the connected branch. The generated `dist/` directory is a deployment output; it is not committed to the repository.

## Pick an inventory source

The generator reads columns by position, so header text and language do not matter. Keep all 12 columns in the template's A–L order, including the calculated columns H and I.

### Option 1: Google Sheets

1. Download [`template/cave-vinum-template.xlsx`](template/cave-vinum-template.xlsx), open it in Google Sheets, and replace or remove the sample wine.
2. In Google Sheets, choose **File → Share → Publish to web**. Publish the `Inventory` tab in CSV format and copy its CSV URL.
3. In **Cloudflare Pages → your project → Settings → Variables and Secrets**, add `CAVE_CSV_URL` with that URL. Store it as a **Secret** if Cloudflare offers that type.
4. Set the Cloudflare build command to `npm run build` and the output directory to `dist`.

**Store `CAVE_CSV_URL` in Cloudflare Pages, not in a GitHub Actions secret.** Cloudflare runs the build and needs the URL to fetch the sheet. The GitHub workflow only pushes the timestamp that triggers the Cloudflare build; it does not read this variable.

> Google Sheets "Publish to web" makes the CSV accessible to anyone with its link. A Cloudflare secret keeps the URL out of the repository and build settings display, but it does not make the published CSV private. The deployed website is also public to anyone who knows its address unless you add access protection such as Cloudflare Access.

### Option 2: CSV committed in your fork

1. Fill in the template, then export its `Inventory` tab as UTF-8 CSV named `inventaire.csv`.
2. Put `inventaire.csv` in the repository root and commit it to your default branch.
3. Set the Cloudflare build command to:

   ```bash
   npm run build -- --file inventaire.csv
   ```

   Keep the output directory set to `dist`. Do not set `CAVE_CSV_URL` for this option.

Now Cloudflare reads the committed CSV on every build. Push a new CSV when your inventory changes; the scheduled workflow also causes a daily rebuild. **The CSV is part of your Git history. If the fork is public, your inventory is public too.**

## Set up the scheduled refresh

1. Fork this repository and connect the fork's default branch to Cloudflare Pages using the selected source option above.
2. In the fork's **Settings → Actions → General → Workflow permissions**, allow workflows to read and write to the repository. GitHub Actions needs this to commit `time_stamp.txt`.
3. Enable Actions for the fork. The **Refresh Cave Vinum** workflow runs daily at 04:00 UTC. To refresh immediately, use **Actions → Refresh Cave Vinum → Run workflow**.

The workflow's timestamp commit is what tells Cloudflare Pages to rebuild. Check the Cloudflare deployment logs if the timestamp was committed but the site did not update.

## Template and column order

The supplied workbook, [`template/cave-vinum-template.xlsx`](template/cave-vinum-template.xlsx), has an `Inventory` tab with dropdowns, calculated fields, 200 prepared rows, and one sample wine. Replace or remove the example before publishing.

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
node scripts/build-report.ts --file ./inventaire.csv
open dist/index.html
```

You can also test the Google Sheets build locally by passing the URL through an environment variable. Do not save it in the repository:

```bash
CAVE_CSV_URL='https://…' npm run build
```

## What is committed?

| Item | In Git? | Purpose |
|---|---:|---|
| Generator, workflow, config, README, and workbook template | Yes | Source project |
| `time_stamp.txt` | Yes, updated daily by Actions | Triggers a Cloudflare rebuild |
| `inventaire.csv` | Only if you choose the committed-CSV option | Input data; public if the fork is public |
| Google Sheets CSV URL | No | Set as `CAVE_CSV_URL` in Cloudflare Pages |
| Generated `dist/` website files | No | Built and published by Cloudflare Pages |

CSV exports are ignored by Git except for `inventaire.csv`. Do not commit other exports or data you do not want to expose.
