# PRINT-CHECKLIST — what only the owner can check (laptop Chrome, the thermal printer)

Cloud checks (`node scripts/print-check.js`) cover: page size, «page X of Y», fonts embedded in the PDF, nothing wider than the page,
time to print. They run Chromium in a container — not your Chrome, not your printer driver. Please tick these on the laptop:

## Chrome on the laptop (version 131 or newer: `chrome://version`)
- [ ] Customer statement → «طباعة / حفظ PDF»: the preview shows «صفحة 1 من N» at the bottom of every page.
- [ ] In the print dialog, «More settings → Headers and footers» is **off** (Chrome's own header/footer would overlap ours).
- [ ] Titles in Noto Naskh (formal), table text in IBM Plex Sans Arabic — not Arial/Tahoma. Save as PDF and open «Document properties → Fonts» if unsure.
- [ ] A long statement (2+ pages): the column titles repeat on each page; no row, total, «balance in words» box or signature block is cut between pages.
- [ ] Journal book: an entry (its 2–4 lines) never splits across two pages.
- [ ] Print once in **black and white** («Color: Black and white»): everything is still readable; the closing-balance box stays readable.

## Thermal printer (80 mm, then 58 mm if you have one)
- [ ] Sales → a sale → «فاتورة»: the paper is cut right after the receipt (the page is exactly as long as the receipt).
- [ ] Margins: nothing touches the edge; the right and left edges of the text are about 2–3 mm from the paper edge.
- [ ] 58 mm: set it once from the browser console `localStorage.setItem('fpReceiptW','58')` (a setting in «التفضيلات» comes with the next phase) and print again.
- [ ] A voided sale: the receipt shows the «ملغى / VOID» stamp and the struck-through amounts.
- [ ] The QR scans on your phone (it holds the receipt number, time and total).

Tell Claude what failed (a photo is enough); it goes into `docs/KNOWN-ISSUES.md` (KI-07).
