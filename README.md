<p align="center"><img src="assets/banner.svg" alt="Cave Vinum banner" width="100%"></p>

# Cave Vinum

Turn a Google Sheet of wines into a mobile-friendly site that shows which bottles to open first. One site can host several caves: yours, your family's, your friends'.

## Get your own cave

1. **Copy the template:** open the [template Google Sheet](https://docs.google.com/spreadsheets/d/1HVfvC8HjS7uJOVGO0yN7BkZPNcbCM1slVq5a4qzZWdc/copy) and click *Make a copy*. The copy keeps the dropdowns, including multiple selection for food pairings.
2. **Fill it in:** one row per wine. See [Inventory format](#inventory-format).
3. **Publish it:** *File > Share > Publish to web*, choose the `Inventaire` tab and *Comma-separated values (.csv)*, then copy the link.
4. **Host it:**
   - **Someone already runs a Cave Vinum site:** send them the CSV link. Your cave will appear at their address, for example `https://example.com/papa/`.
   - **On your own:** fork this repository, connect it to a static host (for example Cloudflare Pages: build command `npm run build`, output directory `dist`), and set `INVENTORIES` as described below.

## Configuration

`INVENTORIES` is the only setting. It is a JSON array with one entry per cave, even if there is only one:

```bash
INVENTORIES='[
  { "slug": "justin", "url": "https://docs.google.com/…/pub?gid=…&output=csv", "title": "La cave de Justin" },
  { "slug": "papa", "url": "https://docs.google.com/…/pub?gid=…&output=csv" }
]' npm run build
```

| Field | Required | Value |
| --- | --- | --- |
| `slug` | Yes | Page address: `papa` is published at `/papa/`. Lowercase letters, digits and dashes. `demo` is reserved. |
| `url` | Yes | HTTPS link to the published CSV, or a relative path to a local CSV for testing (for example `data/inventory.csv`). |
| `title` | No | Shown on the page. Defaults to "Cave de Papa", "Cave d'Axel"… |

Set `INVENTORIES` in the environment of whichever service runs the build and keep it out of the repository: it contains your CSV links.

- One build generates every cave, plus a generic home page (`/`), a demo cave (`/demo/`) and a 404 page.
- The home page never lists or links to the caves. Cave pages are unlisted (`noindex`) but public to anyone with the link, like the published CSVs.
- If any CSV cannot be downloaded or is invalid, the build fails and nothing is written, so the host keeps the previous deployment for everyone. Errors name the cave, never the URL.
- Without `INVENTORIES`, the build still succeeds with the home page and the demo only: a fresh fork deploys right away.

### Home page links

`site.config.json` holds the public links shown on the home page. Leave a value empty to hide its button.

```json
{
  "templateUrl": "https://docs.google.com/spreadsheets/d/1HVfvC8HjS7uJOVGO0yN7BkZPNcbCM1slVq5a4qzZWdc/copy",
  "repoUrl": "https://github.com/snutij/cave-vinum"
}
```

For `templateUrl`, share the template Sheet as *Anyone with the link: Viewer* and replace `/edit…` at the end of its URL with `/copy`.

## Build

```bash
npm run build
INVENTORIES='[{ "slug": "test", "url": "data/inventory.csv" }]' npm run build
```

The second command builds a local CSV at `/test/`. CSV files are ignored by Git, so personal inventories stay out of the repository.

## Automated builds

The included GitHub Actions workflow commits an updated `time_stamp.txt` every day, or when run manually. A build service connected to the repository can use that commit to run `npm run build` and publish `dist/`.

GitHub Actions only updates the timestamp; it does not generate or commit the report. Configure your build service to run `npm run build` on the repository branch, with `INVENTORIES` set.

## Repository checks and updates

Pull requests and pushes to `main` run type-checking and `npm audit`, failing on moderate-or-higher dependency vulnerabilities. CodeQL analyzes JavaScript/TypeScript on pushes, pull requests, and weekly.

Dependabot checks npm dependencies and GitHub Actions daily, grouping minor and patch dependency updates. A dedicated workflow approves eligible minor/patch updates and enables squash auto-merge; major updates require manual review. Merging requires successful quality checks, CodeQL analysis, and the Cloudflare Pages build, enforced by a repository ruleset. Keep GitHub Actions pinned to full commit SHAs when changing workflow dependencies.

The daily timestamp workflow authenticates using the dedicated `REFRESH_DEPLOY_KEY` repository secret. Only this deploy key bypasses the status-check ruleset so scheduled refreshes can push directly. It cannot bypass the separate force-push and deletion protections, and the Dependabot merge workflow has no bypass.

## Inventory format

The script reads the `Inventaire` tab's columns by position, not by header name. Keep the template's 9 columns in A–I order:

| Col | Header | Required | Value |
| --- | --- | --- | --- |
| A | Vin | Yes | Producer and cuvée |
| B | Millésime | No | 4-digit year, blank for non-vintage |
| C | Quantité | Yes | Whole number ≥ 0 (0 = out of stock) |
| D | Couleur | Yes | `Rouge`, `Blanc`, `Rosé` or `Bulles` |
| E | Région | No | One of the template's 12 regions |
| F | Boire dès | No | Start of drinking window (year) |
| G | Boire avant | Yes | End of drinking window (year), drives the status |
| H | Accords | No | Comma-separated tags from the template's list |
| I | Notes | No | Free text, `·` separates items |

Status and years left are computed by the script.

## Git

- CSV files are ignored: inventories are personal data.
- `dist/` is ignored by default. To commit the generated report, remove the `dist/` line from `.gitignore`.
