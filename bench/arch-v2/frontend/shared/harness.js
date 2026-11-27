// Shared bench harness: URL params + the "first table rows visible" mark.
const p = new URLSearchParams(location.search);
export const MODE = p.get('mode') || 'plain';
export const N = +(p.get('n') || (MODE === 'virtual' ? 10000 : 5000));
export const ROW_H = 32;
export const OVERSCAN = 5;
export function markRowsVisible() {
  const check = () => {
    if (document.querySelector('tbody tr, .vrow')) {
      // DOM has rows in this frame; the next rAF runs after that frame is painted.
      requestAnimationFrame(() => { performance.mark('rows-visible'); window.__rowsVisible = performance.now(); });
    } else requestAnimationFrame(check);
  };
  requestAnimationFrame(check);
}
markRowsVisible();
// Optional experiment: ?fixed=1 switches the plain table to table-layout:fixed (browser layout cost, not framework cost).
if (new URLSearchParams(location.search).has('fixed')) document.documentElement.classList.add('fixed');
