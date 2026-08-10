# Importing

HomeCoin supports CSV-based importing with a preview step before confirmation.

## Flow

1. Select a CSV file or paste tabular data.
2. Parse the incoming rows with Papa Parse.
3. Map source columns to the app's transaction fields.
4. Review duplicates and validation issues.
5. Confirm the import.

## Supported Inputs

- CSV files
- pasted bank export data
- manual transaction-like rows prepared in spreadsheet form

## Preview Behavior

The preview highlights:

- parsed rows
- duplicate rows
- rows with issues
- summary totals

## Duplicate Handling

The importer marks likely duplicates by comparing transaction content and dates.

This is a safeguard, not a hard rule. Manual review is still expected before confirming a large import.

## Recommended Mapping

Typical fields include:

- date
- description
- amount
- payee
- balance
- reference
- currency

## Practical Tips

- Keep source CSVs narrow and consistent.
- Use ISO-style dates when possible.
- Normalize bank descriptions before importing if your institution produces noisy exports.
