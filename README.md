# Cave Vinum

Turn a wine inventory spreadsheet into a mobile-friendly cellar website with search, filters, and drinking-window indicators. This repository is designed to be **forked and personalized**: each person uses their own spreadsheet or CSV export.

## Quick start

1. **Fork** this repository to your GitHub account.
2. In your fork, download `template/cave-vinum-template.xlsx` and import it into Google Sheets, or open it in Excel/LibreOffice. Replace or remove the sample wine, then enter your inventory.
3. Choose a data source:
   - **Google Sheets:** publish the `Inventory` tab as CSV and configure `CAVE_CSV_URL` in Cloudflare Pages.
   - **Local CSV file:** export the tab as `inventaire.csv`, then add and push that file to your fork. The repository is configured to track this particular CSV.
4. Connect your GitHub fork to Cloudflare Pages and configure the build as described below.
5. Enable the GitHub Actions workflow **Refresh Cave Vinum**. It will trigger a new build and deployment every day.

> **Privacy:** Anyone who knows your Pages URL can access the site. `noindex` and `robots.txt` do not restrict access. A CSV published from Google Sheets is also accessible to anyone with its link. Do not use this setup for information you do not want to expose. To restrict access, set up authentication (for example, Cloudflare Access) before sharing the site.

## Spreadsheet template

[`template/cave-vinum-template.xlsx`](template/cave-vinum-template.xlsx) contains the `Inventory` tab, dropdown lists, calculated columns, and 200 prepared rows. It includes a sample wine: **replace or remove it before publishing**.

The workbook and its headers are in English. The generator reads values by column position, not by header text, so changing header language does not affect the import. **Keep all 12 columns in the template's A–L order**, including the two calculated columns H and I; the generator skips those calculated columns and uses J–L for food pairings, location, and notes.

| Column | Header | Required | Description |
|---|---|---:|---|
| A | `Producer / Cuvée` | Yes | Wine name; rows without a name are skipped |
| B | `Vintage` | Yes | Vintage year, or blank for non-vintage |
| C | `Quantity` | Yes | Integer bottle count |
| D | `Color` | No | Wine color and filter |
| E | `Appellation / Region` | No | Appellation shown on the wine card |
| F | `Drink from` | Yes | Estimated first year of the drinking window |
| G | `Drink by` | Yes | Estimated last year of the drinking window |
| H | `Status (auto)` | No | Calculated by the workbook; ignored by the site |
| I | `Years left (auto)` | No | Calculated by the workbook; ignored by the site |
| J | `Food pairings` | No | Tags separated by commas or semicolons |
| K | `Location` | No | Bottle storage location |
| L | `Notes / Serving` | No | Notes shown as a list; separate notes with ` · ` |

The generator calculates each wine's status from its quantity and drinking-window years. It distinguishes wines that are urgent, ready to drink this year, ready to drink, still worth keeping, incomplete, or out of stock. The workbook's calculated columns are informational; the site recalculates statuses on every build.

## Deploy your fork

### 1. Allow the refresh workflow

After forking, open the new repository's **Actions** tab and enable workflows if GitHub prompts you. Under **Settings → Actions → General → Workflow permissions**, allow workflows to read and write to the repository: the refresh workflow updates `time_stamp.txt`.

The workflow in `.github/workflows/cave.yml` runs daily at **04:00 UTC** and can also be started manually from **Actions → Refresh Cave Vinum → Run workflow**. It runs on the default branch. Each run pushes a commit, which triggers a Cloudflare build.

### 2. Connect Cloudflare Pages

In Cloudflare, choose **Workers & Pages → Create application → Pages → Connect to Git**, then select your fork.

Set these build options:

| Setting | Value |
|---|---|
| Framework preset | `None` |
| Build command | `npm run build` |
| Build output directory | `dist` |

The project uses Node.js 24, as specified in `.node-version`. You do not need to add a Cloudflare API token to GitHub; Cloudflare fetches the repository through its Git integration.

### 3. Configure the data source

**Option A — Google Sheets**

In Google Sheets, open **File → Share → Publish to web**, select the `Inventory` tab and CSV format, then copy the provided CSV URL. In Cloudflare Pages, add `CAVE_CSV_URL` with that URL. Use the Secret/Encrypt type if available. The generator fetches this CSV on every build. Do not put the link in the repository or in a commit message.

**Option B — CSV in your fork**

Export the `Inventory` tab as a UTF-8 CSV named `inventaire.csv` in the repository root. Push it to the default branch, then set the **Cloudflare build command** to:

```bash
npm run build -- --file inventaire.csv
```

The daily workflow updates `time_stamp.txt` and triggers a build that reads the committed CSV. Update and push `inventaire.csv` when your inventory changes. If your fork is public, the CSV is public too. For a local build, you can also use a CSV without committing it (see below).

### 4. Verify the first deployment

Run the workflow from GitHub Actions. Confirm that a new `time_stamp.txt` commit appears on the default branch, then check that the corresponding Cloudflare Pages deployment succeeds. Open the Pages URL to check the website and its data.

## Using the website

- Search by wine name, vintage, appellation, color, location, notes, or food pairing.
- Filter by color and food pairing; the results and bottle count update together.
- Wines are sorted by drinking priority, and the first in-stock bottle matching your filters is highlighted.
- Enable **Show out of stock** to include wines with a zero or negative quantity.
- The site follows your phone's light or dark theme.
- The site can be used offline after its first online visit, in the same browser and on the same device. Reconnect and refresh to get the latest data.

## Build locally

Requirements: Node.js 22.18 or later. You do not need to install dependencies to generate the site.

After downloading a CSV export:

```bash
node scripts/build-report.ts --file ./inventaire.csv
open dist/index.html
```

To simulate another year or choose an output directory:

```bash
node scripts/build-report.ts --file ./inventaire.csv --year 2027 --out ./dist-test
```

To test the Google Sheets path locally, pass the URL to the process instead of saving it in the repository:

```bash
CAVE_CSV_URL='https://…' npm run build
```

`npm run typecheck` checks the generator's types. Install the development dependencies first with `npm install`.

## Refreshes and troubleshooting

- **After editing the Google Sheet:** manually run the workflow to refresh immediately instead of waiting for the next daily run. It triggers a build that fetches the CSV again.
- **After editing the local CSV:** push the file to your fork. The commit triggers a Cloudflare build; the next scheduled run will rebuild it as well.
- **The site shows an old date:** check the GitHub Actions run, the latest `time_stamp.txt` commit, and the Cloudflare build log triggered by that commit.
- **Build fails with a data-source error:** check that `CAVE_CSV_URL` is set in Cloudflare or that `inventaire.csv` exists in the repository root and the build command matches your chosen source. A Google link must return CSV, not an HTML page.
- **Not enough columns:** make sure your CSV export contains all 12 columns in the template's A–L order. Header names do not matter, but do not remove the calculated H and I columns.
- **Empty CSV or no wines found:** make sure the export contains at least one row with the wine name in column A.
- **The site stays available after a failed build:** Cloudflare generally keeps the last successful deployment. Fix the error, then run the workflow again.

CSV exports are ignored by Git except for `inventaire.csv`, which is allowed for the versioned local-source option. Do not commit other exports or data you do not want to make public.
