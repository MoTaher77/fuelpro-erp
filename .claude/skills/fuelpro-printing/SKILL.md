---
name: fuelpro-printing
description: Use when changing FuelPro screens' layout, tables, fonts, the letterhead, or any printed document (statements, daily report, sales register, vouchers, receipts).
---
# FuelPro screens and printing

## Where things are
- Print: `printNode(title, node, receipt)` in `public/app.js` (letterhead, A4 `xdoc`, 80 mm receipt) and `F.printDoc` in `public/books-ui.js` (calls `F.fitTables`).
- Column auto-fit: `fitTable`/`fitTables` in `public/app.js` — classes `f-num f-tight f-act f-wide f-text` on tables with class `fit`; `dense`, `squeeze`, `squeeze2` when too wide; `data-wide` tables print landscape (`@page land`). `.classic` and `.receipt` tables are excluded.
- Styles: `public/app.css` (theme tokens, `--font` stack `'Dubai','Segoe UI',…`, print block at the end).
- Letterhead data: `org_brand` (`GET/PATCH /api/brand`).

## Workflow
1. Reproduce on the demo DB (never the real one).
2. Change CSS/markup; keep amounts without the currency code in tables (currency in the header), numbers right-aligned in RTL as now.
3. Bump `CACHE` in `public/sw.js`.
4. Check every screen you touched at phone and desktop width; ask the owner to print — Chrome's print preview and the Dubai font can only be verified on his Windows laptop.
5. Note the result in `docs/KNOWN-ISSUES.md` (KI-07) and `docs/SESSION-HISTORY.md`.
