import { useCallback, useLayoutEffect, useRef, useState } from 'react';

/**
 * How many table rows fit in the element `ref` points at, so a table can page instead of scrolling,
 * on any window / monitor size.
 *
 * The element should get its height from the layout (e.g. `flex-1`) with the table inside it
 * positioned absolutely, so the rows shown never change the element's own height.
 *
 * Loop-proof (this used to blank the page with React error #185 "Maximum update depth exceeded"):
 * - rows are measured by their TALLEST row, so a page of shorter rows can't ask for more rows
 *   that then don't fit;
 * - re-measuring is batched to one per animation frame;
 * - if the count changes 3+ times within a second (it is flip-flopping), it may only go DOWN
 *   until things settle, so it always comes to rest.
 */
export function useFitRows({
  rowSelector = 'tbody tr',
  fallbackRow = 40,
  min = 3,
  initial = 8,
  deps = [],
}: {
  /** rows to measure (leave out filler / add rows) */
  rowSelector?: string;
  /** row height to assume before any row is on screen */
  fallbackRow?: number;
  min?: number;
  initial?: number;
  /** re-measure when these change (e.g. the rows shown); the window size is watched anyway */
  deps?: unknown[];
} = {}) {
  const ref = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(initial);
  const changes = useRef<number[]>([]);
  const opts = useRef({ rowSelector, fallbackRow, min });
  opts.current = { rowSelector, fallbackRow, min };

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const o = opts.current;
    const head = el.querySelector('thead')?.getBoundingClientRect().height ?? 0;
    const foot = el.querySelector('tfoot')?.getBoundingClientRect().height ?? 0;
    const heights = Array.from(el.querySelectorAll(o.rowSelector)).map((r) => r.getBoundingClientRect().height);
    const row = Math.max(heights.length ? Math.max(...heights) : o.fallbackRow, 1);
    const next = Math.max(o.min, Math.floor((el.clientHeight - head - foot + 1) / row));
    setFit((prev) => {
      if (prev === next) return prev;
      const now = performance.now();
      changes.current = changes.current.filter((t) => now - t < 1000);
      if (next > prev && changes.current.length >= 3) return prev; // flip-flopping: only allow shrinking
      changes.current.push(now);
      return next;
    });
  }, []);

  // window / card resized
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    let frame = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, [measure]);

  // the rows on screen changed (taller / shorter content, header wrapping)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(measure, deps);

  return [ref, fit] as const;
}
