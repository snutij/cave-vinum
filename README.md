# Cave Vinum

Generate a mobile-friendly wine inventory report.

## Build

Use the same command locally and in your build service:

```bash
npm run build
```

The script reads a CSV, parses it, and writes the report to `dist/`.

- **Local:** put your CSV at `data/inventory.csv`.
- **Remote:** set `INVENTORY_URL` to a URL that returns the CSV. When set, it is used instead of the local file.

```bash
INVENTORY_URL='https://example.com/inventory.csv' npm run build
```

Set `INVENTORY_URL` in the environment of whichever service runs the build. Keep it out of the repository. If it is not set, the script reads `data/inventory.csv`.

## Automated builds

The included GitHub Actions workflow commits an updated `time_stamp.txt` every day, or when run manually. A build service connected to the repository can use that commit to run `npm run build` and publish `dist/`.

GitHub Actions only updates the timestamp; it does not generate or commit the report. Configure your build service to run `npm run build` on the repository branch. It will use `INVENTORY_URL` if configured, otherwise `data/inventory.csv`.

## Inventory format

Start with [`template/cave-vinum-template.xlsx`](template/cave-vinum-template.xlsx). Export its `Inventory` tab as CSV and save it as `data/inventory.csv`, or host the CSV and set `INVENTORY_URL`.

The script reads columns by position, not by header name. Keep the template's 12 columns in A–L order, including calculated columns H and I.

## Git

- `data/inventory.csv` is allowed in Git; other CSV exports are ignored.
- `dist/` is ignored by default. To commit the generated report, remove the `dist/` line from `.gitignore`.
