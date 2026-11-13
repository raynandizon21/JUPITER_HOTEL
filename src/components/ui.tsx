import React from 'react';
import { X } from 'lucide-react';
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
