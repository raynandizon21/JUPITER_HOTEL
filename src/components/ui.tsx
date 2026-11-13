import React from 'react';
import { ChevronLeft, ChevronRight, MoreVertical, X } from 'lucide-react';
import { formatMonth } from '../utils/hotelHelpers';

export const PageHeader: React.FC<{
  eyebrow?: string;
  title: React.ReactNode;
  lede?: React.ReactNode;
  actions?: React.ReactNode;
}> = ({ title, lede, actions }) => (
  <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 mb-5">
    <div className="min-w-0">
      <h1 className="page-title">{title}</h1>
      {lede && <p className="page-lede mt-1">{lede}</p>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
  </div>
);

export const Dialog: React.FC<{
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  onClose: () => void;
  width?: string;
  children: React.ReactNode;
}> = ({ title, subtitle, onClose, width = 'max-w-lg', children }) => {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`dialog ${width}`} role="dialog" aria-modal="true">
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4 border-b border-line">
          <div>
            <h2 className="text-[16px] font-semibold tracking-tight text-ink">{title}</h2>
            {subtitle && <div className="text-[12.5px] text-muted mt-0.5">{subtitle}</div>}
          </div>
          <button onClick={onClose} className="icon-btn -mr-1.5" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
};

export const MonthSelect: React.FC<{
  value: string;
  onChange: (v: string) => void;
  months: string[];
  allLabel?: string;
}> = ({ value, onChange, months, allLabel }) => (
  <select value={value} onChange={(e) => onChange(e.target.value)} className="input input-sm w-auto min-w-[150px]">
    {allLabel !== undefined && <option value="">{allLabel}</option>}
    {months.map((m) => (
      <option key={m} value={m}>
        {formatMonth(m)}
      </option>
    ))}
  </select>
);

export const MONTHS = ['2026-09', '2026-10', '2026-11', '2026-12', '2027-01'];

// ---------- Toast notifications ----------
type ToastTone = 'ok' | 'bad' | 'info';
type ToastItem = { id: number; title: string; detail?: string; tone: ToastTone };
const toastListeners = new Set<(t: ToastItem) => void>();

/** Show a short pop-up notice in the corner. */
export const toast = (title: string, detail?: string, tone: ToastTone = 'ok') => {
  const t = { id: Date.now() + Math.random(), title, detail, tone };
  toastListeners.forEach((l) => l(t));
};

export const Toaster: React.FC = () => {
  const [items, setItems] = React.useState<ToastItem[]>([]);
  React.useEffect(() => {
    const onToast = (t: ToastItem) => {
      setItems((prev) => [t, ...prev]);
      setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== t.id)), 3200);
    };
    toastListeners.add(onToast);
    return () => {
      toastListeners.delete(onToast);
    };
  }, []);
  return (
    <div className="fixed top-[76px] right-6 z-[70] flex flex-col gap-2 w-[320px] pointer-events-none">
      {items.map((t) => (
        <div
          key={t.id}
          role="status"
          className="pointer-events-auto flex items-start gap-3 rounded-xl bg-ink text-white px-4 py-3 animate-fade-in"
          style={{ boxShadow: 'var(--shadow-pop)' }}
        >
          <span className={`mt-0.5 w-5 h-5 shrink-0 rounded-full grid place-items-center text-[11px] font-bold ${t.tone === 'ok' ? 'bg-ok' : t.tone === 'bad' ? 'bg-bad' : 'bg-accent'}`}>
            {t.tone === 'ok' ? '✓' : t.tone === 'bad' ? '−' : 'i'}
          </span>
          <div className="min-w-0">
            <div className="text-[13px] font-medium">{t.title}</div>
            {t.detail && <div className="text-[12px] text-white/65 mt-0.5">{t.detail}</div>}
          </div>
        </div>
      ))}
    </div>
  );
};

/** "⋮" button that opens a small menu of row actions (e.g. Edit / Delete). */
export const RowMenu: React.FC<{
  items: { label: string; Icon?: React.ElementType; onClick: () => void; danger?: boolean }[];
  title?: string;
}> = ({ items, title }) => {
  const [pos, setPos] = React.useState<{ top: number; right: number } | null>(null);
  const btn = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('mousedown', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [pos]);
  const toggle = () => {
    if (pos) return setPos(null);
    const r = btn.current!.getBoundingClientRect();
    setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
  };
  return (
    <>
      <button ref={btn} onClick={toggle} className="icon-btn" title={title} aria-haspopup="menu" aria-expanded={!!pos}>
        <MoreVertical className="w-4 h-4" />
      </button>
      {pos && (
        // fixed so it isn't clipped by scrolling lists; mousedown inside must not close it before the click lands
        <div
          role="menu"
          onMouseDown={(e) => e.stopPropagation()}
          className="fixed z-50 min-w-[140px] py-1 rounded-[10px] border border-line bg-surface"
          style={{ top: pos.top, right: pos.right, boxShadow: 'var(--shadow-pop)' }}
        >
          {items.map(({ label, Icon, onClick, danger }) => (
            <button
              key={label}
              role="menuitem"
              onClick={() => {
                setPos(null);
                onClick();
              }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-left cursor-pointer hover:bg-canvas ${danger ? 'text-bad' : 'text-ink'}`}
            >
              {Icon && <Icon className="w-3.5 h-3.5" />}
              {label}
            </button>
          ))}
        </div>
      )}
    </>
  );
};

/** Yes/No confirmation pop-up (use instead of the browser's confirm()). */
export const ConfirmDialog: React.FC<{
  title: React.ReactNode;
  message: React.ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ title, message, confirmLabel, cancelLabel, danger, onConfirm, onCancel }) => (
  <Dialog title={title} onClose={onCancel} width="max-w-sm">
    <div className="px-6 py-5 text-[13.5px] text-ink-2">{message}</div>
    <div className="px-6 py-4 border-t border-line bg-sunken flex justify-end gap-2">
      <button onClick={onCancel} className="btn btn-ghost">
        {cancelLabel}
      </button>
      <button
        onClick={onConfirm}
        autoFocus
        className={danger ? 'btn border border-bad-line bg-bad text-white hover:opacity-90' : 'btn btn-primary'}
      >
        {confirmLabel}
      </button>
    </div>
  </Dialog>
);

/**
 * Page numbers under a table. With `onSize`, also shows a page-length picker (rows per page).
 * Tables paginate instead of scrolling inside the card.
 */
export const Pager: React.FC<{
  page: number;
  pages: number;
  total: number;
  size: number;
  onPage: (p: number) => void;
  en: boolean;
  unitLabel?: string;
  onSize?: (n: number) => void;
  sizes?: number[];
}> = ({ page, pages, total, size, onPage, en, unitLabel = '', onSize, sizes = [10, 25, 50] }) => (
  <div className="px-5 py-3 border-t border-line flex items-center justify-between gap-3 text-[12.5px]">
    <div className="flex items-center gap-3">
      <span className="text-muted num">
        {total === 0 ? 0 : page * size + 1}–{Math.min(total, page * size + size)} {en ? 'of' : '/'} {total} {unitLabel}
      </span>
      {onSize && (
        <label className="flex items-center gap-1.5 text-muted">
          {en ? 'Show' : '표시'}
          <select
            value={size}
            onChange={(e) => {
              onSize(Number(e.target.value));
              onPage(0);
            }}
            className="input input-sm !h-7 !w-auto !py-0 pr-7"
          >
            {sizes.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          {en ? 'per page' : '개씩'}
        </label>
      )}
    </div>
    {pages > 1 && (
      <div className="flex items-center gap-1">
        <button onClick={() => onPage(page - 1)} disabled={page === 0} className="icon-btn disabled:opacity-30" aria-label="Previous page">
          <ChevronLeft className="w-4 h-4" />
        </button>
        {Array.from({ length: pages }, (_, i) => (
          <button
            key={i}
            onClick={() => onPage(i)}
            className={`min-w-[28px] h-7 px-2 rounded-lg num cursor-pointer ${i === page ? 'bg-ink text-white font-semibold' : 'text-ink-2 hover:bg-canvas'}`}
          >
            {i + 1}
          </button>
        ))}
        <button onClick={() => onPage(page + 1)} disabled={page >= pages - 1} className="icon-btn disabled:opacity-30" aria-label="Next page">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    )}
  </div>
);
