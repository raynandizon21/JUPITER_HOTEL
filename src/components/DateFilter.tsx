import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { addDays, formatLongDate } from '../utils/hotelHelpers';

const pad = (n: number) => String(n).padStart(2, '0');
const ymOf = (d: string) => d.slice(0, 7);
const shiftYm = (ym: string, n: number) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
};
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/**
 * Date filter like the settlement screens: "Date" (one day, ‹ › to step) or "Date Range"
 * (3-month calendar: click the first day, then the last day).
 */
export const DateFilter: React.FC<{
  mode: 'date' | 'range';
  onMode: (m: 'date' | 'range') => void;
  date: string;
  onDate: (d: string) => void;
  from: string;
  to: string;
  onRange: (from: string, to: string) => void;
  en: boolean;
  /** 'md' = 36px tall, to line up with regular .btn buttons (default 'sm' = 30px, next to input-sm) */
  size?: 'sm' | 'md';
}> = ({ mode, onMode, date, onDate, from, to, onRange, en, size = 'sm' }) => {
  const h = size === 'md' ? 'h-9' : 'h-[30px]';
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => shiftYm(ymOf(mode === 'date' ? date || todayIso() : from || todayIso()), -1)); // left month
  const [start, setStart] = useState<string | null>(null); // first click of a range
  const [hover, setHover] = useState<string | null>(null);
  const anchor = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<React.CSSProperties>({});

  // place the calendar under the field, kept inside the window
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      const w = Math.min(window.innerWidth - 24, 800);
      setPos({ position: 'fixed', top: r.bottom + 6, left: Math.max(12, Math.min(r.left, window.innerWidth - w - 12)), width: w, zIndex: 80 });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!anchor.current?.contains(e.target as Node) && !pop.current?.contains(e.target as Node)) {
        setOpen(false);
        setStart(null);
      }
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && (setOpen(false), setStart(null));
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const openPicker = () => {
    setView(shiftYm(ymOf(mode === 'date' ? date || todayIso() : from || todayIso()), mode === 'date' ? -1 : 0));
    setStart(null);
    setOpen((o) => !o);
  };

  const pick = (d: string) => {
    if (mode === 'date') {
      onDate(d);
      setOpen(false);
      return;
    }
    if (!start) {
      setStart(d);
      return;
    }
    const [a, b] = d < start ? [d, start] : [start, d];
    onRange(a, b);
    setStart(null);
    setOpen(false);
  };

  // range shown while choosing: first click → hovered day
  const lo = start ? (hover && hover < start ? hover : start) : mode === 'range' ? from : date;
  const hi = start ? (hover && hover > start ? hover : start) : mode === 'range' ? to : date;
  const today = todayIso();

  const month = (ym: string) => {
    const [y, m] = ym.split('-').map(Number);
    const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const cells: (string | null)[] = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => `${ym}-${pad(i + 1)}`)];
    const title = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(en ? 'en-US' : 'ko-KR', { month: 'long', timeZone: 'UTC' });
    return (
      <div key={ym} className="flex-1 min-w-[224px] px-3">
        <div className="text-[13.5px] font-semibold text-ink text-center mb-2.5">
          {title} <span className="text-muted font-normal">{y}</span>
        </div>
        <div className="grid grid-cols-7 text-center text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted mb-1">
          {(en ? ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] : ['일', '월', '화', '수', '목', '금', '토']).map((w, i) => (
            <div key={w} className={`py-1 ${i === 0 ? 'text-bad' : ''}`}>
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((d, i) => {
            if (!d) return <div key={`b${i}`} className="h-9" />;
            const single = lo && hi && lo === hi;
            const inRange = !!(lo && hi && d >= lo && d <= hi);
            const isLo = d === lo;
            const isHi = d === hi;
            const edge = isLo || isHi;
            const dow = (first + Number(d.slice(8)) - 1) % 7;
            // continuous band behind the range; ends are rounded, the picked days are solid
            const band = inRange && !single ? `bg-canvas ${isLo || dow === 0 ? 'rounded-l-full' : ''} ${isHi || dow === 6 ? 'rounded-r-full' : ''}` : '';
            return (
              <div key={d} className={`h-9 py-0.5 ${band}`}>
                <button
                  type="button"
                  onClick={() => pick(d)}
                  onMouseEnter={() => setHover(d)}
                  className={`relative w-full h-full rounded-full text-[12.5px] cursor-pointer transition-colors ${
                    edge && lo ? 'bg-ink text-white font-semibold' : inRange ? 'text-ink font-medium hover:bg-line' : dow === 0 ? 'text-bad hover:bg-canvas' : 'text-ink-2 hover:bg-canvas'
                  }`}
                >
                  {Number(d.slice(8))}
                  {d === today && <span className={`absolute left-1/2 -translate-x-1/2 bottom-1 w-1 h-1 rounded-full ${edge ? 'bg-white' : 'bg-accent'}`} />}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // quick picks (whole months)
  const monthOf = (ym: string): [string, string] => [`${ym}-01`, `${ym}-${pad(new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate())}`];
  const presets =
    mode === 'range'
      ? [
          { label: en ? 'This month' : '이번 달', r: monthOf(ymOf(today)) },
          { label: en ? 'Last month' : '지난달', r: monthOf(shiftYm(ymOf(today), -1)) },
          { label: en ? 'Next month' : '다음 달', r: monthOf(shiftYm(ymOf(today), 1)) },
        ]
      : [];

  const label =
    mode === 'date'
      ? formatLongDate(date)
      : from && to
      ? from === to
        ? formatLongDate(from)
        : `${formatLongDate(from)} – ${formatLongDate(to)}`
      : en
      ? 'Select date range'
      : '기간 선택';

  return (
    <div className="flex flex-col gap-1">
      {/* mode */}
      <div className="flex items-center gap-4 text-[12px] text-ink-2 pl-1">
        {(['date', 'range'] as const).map((m) => (
          <label key={m} className="inline-flex items-center gap-1.5 cursor-pointer">
            <input type="radio" checked={mode === m} onChange={() => onMode(m)} className="accent-[#3567d6] cursor-pointer" />
            {m === 'date' ? (en ? 'Date' : '날짜') : en ? 'Date Range' : '기간'}
          </label>
        ))}
      </div>

      {/* field */}
      <div className="flex items-center">
        {mode === 'date' && (
          <button type="button" onClick={() => onDate(addDays(date, -1))} className={`${h} w-8 grid place-items-center rounded-l-lg border border-r-0 border-line-strong bg-surface text-muted hover:text-ink cursor-pointer`} aria-label="Previous day">
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}
        <button
          ref={anchor}
          type="button"
          onClick={openPicker}
          className={`${h} px-3 border border-line-strong bg-surface text-[12.5px] inline-flex items-center gap-2 cursor-pointer hover:border-faint min-w-[200px] justify-center ${
            mode === 'date' ? '' : 'rounded-lg'
          } ${mode === 'range' && !(from && to) ? 'text-muted' : 'text-ink'}`}
        >
          <CalendarDays className="w-3.5 h-3.5 text-muted" />
          {label}
          {mode === 'range' && from && to && (
            <span
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                onRange('', '');
              }}
              className="text-faint hover:text-ink -mr-1"
              title={en ? 'Clear dates' : '날짜 지우기'}
            >
              <X className="w-3.5 h-3.5" />
            </span>
          )}
        </button>
        {mode === 'date' && (
          <button type="button" onClick={() => onDate(addDays(date, 1))} className={`${h} w-8 grid place-items-center rounded-r-lg border border-l-0 border-line-strong bg-surface text-muted hover:text-ink cursor-pointer`} aria-label="Next day">
            <ChevronRight className="w-4 h-4" />
          </button>
        )}
      </div>

      {open &&
        createPortal(
          <div ref={pop} style={{ ...pos, boxShadow: 'var(--shadow-pop)' }} className="card !rounded-2xl overflow-hidden animate-scale-in" onMouseLeave={() => setHover(null)}>
            <div className="flex items-start px-3 pt-4 pb-3">
              <button type="button" onClick={() => setView(shiftYm(view, -1))} className="icon-btn shrink-0 mt-[-2px]" aria-label="Previous month">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div className="flex-1 flex divide-x divide-line">{[0, 1, 2].map((i) => month(shiftYm(view, i)))}</div>
              <button type="button" onClick={() => setView(shiftYm(view, 1))} className="icon-btn shrink-0 mt-[-2px]" aria-label="Next month">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
            <div className="px-5 py-2.5 border-t border-line bg-sunken flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                {presets.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => {
                      onRange(p.r[0], p.r[1]);
                      setStart(null);
                      setOpen(false);
                    }}
                    className={`btn btn-sm ${from === p.r[0] && to === p.r[1] ? 'btn-primary' : 'btn-outline'}`}
                  >
                    {p.label}
                  </button>
                ))}
                {mode === 'date' && (
                  <button
                    type="button"
                    onClick={() => {
                      onDate(today);
                      setOpen(false);
                    }}
                    className="btn btn-outline btn-sm"
                  >
                    {en ? 'Today' : '오늘'}
                  </button>
                )}
              </div>
              <span className="text-[11.5px] text-muted">
                {mode === 'date'
                  ? en ? 'Pick a day' : '날짜를 선택하세요'
                  : start
                  ? en ? `From ${formatLongDate(start)} — now click the last day` : `${formatLongDate(start)}부터 — 마지막 날짜를 선택하세요`
                  : en ? 'Click the first day, then the last day' : '시작일과 종료일을 차례로 선택하세요'}
              </span>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};
