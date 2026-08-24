# Source files

The repository retains the non-secret confirmed business answers in `must answer2.txt`.

The owner-supplied `Project monitoring report.xls` is real legacy migration data and may contain
customer or credential material. It is intentionally excluded by `.gitignore` and must be
transferred only through an approved private migration channel. The automated parser test uses a
synthetic workbook so clean clones do not depend on the sensitive source file.

Import rules remain:

- Treat the workbook as migration evidence, not the operational database.
- Preserve raw source references during an authorized import.
- Keep ambiguous legacy rows in human review.
- Never commit the real workbook or derived database exports.
