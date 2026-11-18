import React from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, ChevronDown, MoreVertical, X, Check, Info } from 'lucide-react';
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
  <Select value={value} onChange={(e) => onChange(e.target.value)} className="input input-sm w-auto min-w-[150px]">
    {allLabel !== undefined && <option value="">{allLabel}</option>}
    {months.map((m) => (
      <option key={m} value={m}>
        {formatMonth(m)}
      </option>
    ))}
  </Select>
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

// Soft tinted card per tone: colored border + filled icon + colored text, small × on the top-left corner.
const TOAST_STYLE: Record<ToastTone, { Icon: React.ElementType; box: string; icon: string; text: string; close: string; ms: number }> = {
  ok: { Icon: Check, box: 'bg-ok-soft border-ok-line', icon: 'bg-ok', text: 'text-ok', close: 'text-ok border-ok-line', ms: 3200 },
  info: { Icon: Info, box: 'bg-info-soft border-info-line', icon: 'bg-info', text: 'text-info', close: 'text-info border-info-line', ms: 4000 },
  bad: { Icon: X, box: 'bg-bad-soft border-bad-line', icon: 'bg-bad', text: 'text-bad', close: 'text-bad border-bad-line', ms: 6000 }, // errors stay longer
};

export const Toaster: React.FC = () => {
  const [items, setItems] = React.useState<ToastItem[]>([]);
  const dismiss = (id: number) => setItems((prev) => prev.filter((x) => x.id !== id));
  React.useEffect(() => {
    const onToast = (t: ToastItem) => {
      setItems((prev) => [t, ...prev].slice(0, 4));
      setTimeout(() => dismiss(t.id), TOAST_STYLE[t.tone].ms);
    };
    toastListeners.add(onToast);
    return () => {
      toastListeners.delete(onToast);
    };
  }, []);
  return (
    <div className="fixed top-[84px] right-5 z-[70] flex flex-col gap-3 w-[360px] pointer-events-none">
      {items.map((t) => {
        const st = TOAST_STYLE[t.tone];
        return (
          <div
            key={t.id}
            role={t.tone === 'bad' ? 'alert' : 'status'}
            className={`toast pointer-events-auto relative rounded-xl border flex items-center gap-3 px-4 py-3.5 ${st.box}`}
            style={{ boxShadow: '0 6px 18px -8px rgb(17 18 20 / 0.18)' }}
          >
            <button
              onClick={() => dismiss(t.id)}
              aria-label="Close"
              className={`absolute -top-2 -left-2 w-5 h-5 rounded-full bg-surface border grid place-items-center cursor-pointer hover:scale-110 transition-transform ${st.close}`}
            >
              <X className="w-3 h-3" strokeWidth={2.5} />
            </button>
            <span className={`w-6 h-6 shrink-0 rounded-full grid place-items-center text-white ${st.icon}`}>
              <st.Icon className="w-3.5 h-3.5" strokeWidth={3} />
            </span>
            <div className={`min-w-0 flex-1 ${st.text}`}>
              <div className="text-[13.5px] font-semibold leading-snug">{t.title}</div>
              {t.detail && <div className="text-[12.5px] font-medium opacity-80 mt-0.5 leading-snug break-words">{t.detail}</div>}
            </div>
          </div>
        );
      })}
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
          <Select
            value={size}
            onChange={(e) => {
              onSize(Number(e.target.value));
              onPage(0);
            }}
            className="input input-sm !h-7 !w-auto !py-0 !px-2.5"
          >
            {sizes.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
          {en ? 'per page' : '개씩'}
        </label>
      )}
    </div>
    <PageButtons page={page} pages={pages} onPage={onPage} />
  </div>
);

/** ‹ 1 2 3 › — the page numbers of a list (nothing when there is only one page). */
export const PageButtons: React.FC<{ page: number; pages: number; onPage: (p: number) => void }> = ({ page, pages, onPage }) =>
  pages > 1 ? (
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
  ) : null;

/**
 * Text input with the app's own suggestion dropdown (instead of <datalist>, which the browser
 * draws in its own — often black — style). Free text is allowed; suggestions filter as you type.
 * Keyboard: ↑ ↓ to move, Enter to pick, Esc to close.
 */
export const ComboInput: React.FC<{
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  maxLength?: number;
  emptyText?: string;
}> = ({ value, onChange, options, placeholder, className = '', autoFocus, maxLength, emptyText }) => {
  const [open, setOpen] = React.useState(false);
  const [hi, setHi] = React.useState(0);
  const box = React.useRef<HTMLDivElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const style = useFloating(box, open);
  useOutsideClose(open, [box, listRef], () => setOpen(false));
  const q = value.trim().toLowerCase();
  const list = React.useMemo(() => {
    const uniq = Array.from(new Set(options.filter(Boolean)));
    const hits = q ? uniq.filter((o) => o.toLowerCase().includes(q)) : uniq;
    // names that start with what was typed come first
    return hits.sort((a, b) => Number(!a.toLowerCase().startsWith(q)) - Number(!b.toLowerCase().startsWith(q)) || a.localeCompare(b)).slice(0, 8);
  }, [options, q]);
  React.useEffect(() => setHi(0), [q]);
  const exact = list.some((o) => o.toLowerCase() === q);
  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  return (
    <div ref={box} className="relative">
      <input
        type="text"
        value={value}
        autoFocus={autoFocus}
        maxLength={maxLength}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setHi((h) => Math.min(h + 1, list.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHi((h) => Math.max(h - 1, 0));
          } else if (e.key === 'Enter' && open && list[hi] && !exact) {
            e.preventDefault();
            pick(list[hi]);
          } else if (e.key === 'Escape' && open) {
            e.stopPropagation();
            setOpen(false);
          }
        }}
        className={`input pr-8 ${className}`}
        autoComplete="off"
      />
      <button
        type="button"
        tabIndex={-1}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 w-6 h-6 grid place-items-center text-faint hover:text-ink-2 cursor-pointer"
        aria-label="Show suggestions"
      >
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (list.length > 0 || emptyText) && (
        <DropList
          style={style}
          listRef={listRef}
          items={list.map((o) => ({ key: o, label: o, selected: o.toLowerCase() === q }))}
          hi={hi}
          setHi={setHi}
          onPick={(i) => pick(list[i])}
          empty={emptyText}
        />
      )}
    </div>
  );
};

// ---------- Dropdowns ----------
/**
 * Position of a dropdown list under (or above, if there's no room) its trigger. The list is drawn
 * in a portal with position: fixed, so cards / dialogs with overflow: hidden never cut it off.
 */
const useFloating = (anchor: React.RefObject<HTMLElement | null>, open: boolean, maxH = 240) => {
  const [style, setStyle] = React.useState<React.CSSProperties>({});
  React.useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      const below = window.innerHeight - r.bottom;
      const up = below < Math.min(maxH, 160) + 12 && r.top > below;
      setStyle({
        position: 'fixed',
        left: r.left,
        minWidth: r.width,
        zIndex: 80,
        maxHeight: Math.min(maxH, (up ? r.top : below) - 12),
        ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor, open, maxH]);
  return style;
};

const useOutsideClose = (open: boolean, refs: React.RefObject<HTMLElement | null>[], close: () => void) => {
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (refs.every((r) => !r.current || !r.current.contains(e.target as Node))) close();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
};

/** The shared dropdown list look (white card, grey highlight, ✓ on the selected item). */
const DropList: React.FC<{
  style: React.CSSProperties;
  listRef: React.RefObject<HTMLDivElement | null>;
  items: { key: string; label: React.ReactNode; selected: boolean }[];
  hi: number;
  setHi: (i: number) => void;
  onPick: (i: number) => void;
  empty?: React.ReactNode;
}> = ({ style, listRef, items, hi, setHi, onPick, empty }) =>
  createPortal(
    <div ref={listRef} style={{ ...style, boxShadow: 'var(--shadow-pop)' }} className="card !rounded-xl p-1 overflow-y-auto animate-scale-in">
      {items.length === 0 ? (
        <div className="px-3 py-2 text-[12.5px] text-muted">{empty}</div>
      ) : (
        items.map((it, i) => (
          <button
            key={it.key}
            type="button"
            data-i={i}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => setHi(i)}
            onClick={() => onPick(i)}
            className={`w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-left text-[13px] whitespace-nowrap cursor-pointer ${
              i === hi ? 'bg-canvas text-ink' : it.selected ? 'text-ink font-medium' : 'text-ink-2'
            }`}
          >
            <span className="truncate">{it.label}</span>
            {it.selected && <Check className="w-3.5 h-3.5 text-accent shrink-0" />}
          </button>
        ))
      )}
    </div>,
    document.body
  );

type OptionEl = React.ReactElement<{ value?: string | number; children?: React.ReactNode; disabled?: boolean }>;

/**
 * Drop-in replacement for <select>: same props (value, onChange(e), className, <option> children),
 * drawn with the app's own dropdown list instead of the browser's.
 */
export const Select: React.FC<{
  value: string | number;
  onChange: (e: { target: { value: string } }) => void;
  className?: string;
  disabled?: boolean;
  title?: string;
  children: React.ReactNode;
}> = ({ value, onChange, className = 'input', disabled, title, children }) => {
  const opts = React.Children.toArray(children)
    .filter((c): c is OptionEl => React.isValidElement(c))
    .map((c) => ({
      value: String(c.props.value ?? (typeof c.props.children === 'string' ? c.props.children : '')),
      label: c.props.children,
      disabled: !!c.props.disabled,
    }));
  const cur = opts.findIndex((o) => o.value === String(value));
  const [open, setOpen] = React.useState(false);
  const [hi, setHi] = React.useState(0);
  const btn = React.useRef<HTMLButtonElement>(null);
  const list = React.useRef<HTMLDivElement>(null);
  const style = useFloating(btn, open);
  useOutsideClose(open, [btn, list], () => setOpen(false));
  React.useEffect(() => {
    if (open) {
      setHi(Math.max(cur, 0));
      requestAnimationFrame(() => list.current?.querySelector(`[data-i="${Math.max(cur, 0)}"]`)?.scrollIntoView({ block: 'nearest' }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const pick = (i: number) => {
    const o = opts[i];
    if (!o || o.disabled) return;
    if (o.value !== String(value)) onChange({ target: { value: o.value } });
    setOpen(false);
    btn.current?.focus();
  };

  return (
    <>
      <button
        ref={btn}
        type="button"
        title={title}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            if (!open) return setOpen(true);
            setHi((h) => Math.min(Math.max(h + (e.key === 'ArrowDown' ? 1 : -1), 0), opts.length - 1));
          } else if ((e.key === 'Enter' || e.key === ' ') && open) {
            e.preventDefault();
            pick(hi);
          } else if (e.key === 'Escape' && open) {
            e.stopPropagation();
            setOpen(false);
          }
        }}
        className={`${className} !flex items-center justify-between gap-2 text-left cursor-pointer disabled:cursor-not-allowed disabled:opacity-60`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate">{cur >= 0 ? opts[cur].label : ''}</span>
        <ChevronDown className={`w-3.5 h-3.5 shrink-0 text-faint transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <DropList
          style={style}
          listRef={list}
          items={opts.map((o, i) => ({ key: `${o.value}-${i}`, label: o.label, selected: i === cur }))}
          hi={hi}
          setHi={setHi}
          onPick={pick}
        />
      )}
    </>
  );
};
