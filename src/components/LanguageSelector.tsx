import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { Language } from '../i18n/translations';

interface LanguageSelectorProps {
  currentLanguage: Language;
  onLanguageChange: (lang: Language) => void;
  /** Light-on-dark styling for the top bar. */
  dark?: boolean;
}

const languages: { code: Language; label: string; native: string; flag: string; short: string }[] = [
  { code: 'en', label: 'English', native: 'English (PH)', flag: '🇵🇭', short: 'EN' },
  { code: 'ko', label: 'Korean', native: '한국어', flag: '🇰🇷', short: 'KO' },
];

export const LanguageSelector: React.FC<LanguageSelectorProps> = ({ currentLanguage, onLanguageChange, dark = false }) => {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setIsOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const active = languages.find((l) => l.code === currentLanguage) || languages[0];

  return (
    <div className="relative select-none" ref={ref}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={
          dark
            ? 'h-9 px-3 rounded-[10px] inline-flex items-center gap-2 text-white/85 hover:text-white bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 transition-colors cursor-pointer'
            : 'btn btn-outline gap-2 px-2.5'
        }
        aria-label="Select language"
        aria-expanded={isOpen}
      >
        <Flag code={active.code} className="w-[22px] h-[15px]" />
        <span className="text-[12px] font-semibold tracking-wide">{active.short}</span>
        <ChevronDown className={`w-3.5 h-3.5 opacity-60 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-52 card p-1.5 z-50 animate-scale-in" style={{ boxShadow: 'var(--shadow-pop)' }}>
          <div className="eyebrow px-2.5 pt-1.5 pb-2">Language · 언어</div>
          {languages.map((lang) => {
            const sel = lang.code === currentLanguage;
            return (
              <button
                key={lang.code}
                onClick={() => {
                  onLanguageChange(lang.code);
                  setIsOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-left transition-colors cursor-pointer ${
                  sel ? 'bg-accent-soft' : 'hover:bg-canvas'
                }`}
              >
                <Flag code={lang.code} className="w-7 h-[19px]" />
                <span className="flex-1">
                  <span className="block text-[13px] font-medium text-ink">{lang.native}</span>
                  <span className="block text-[11px] text-muted">{lang.label}</span>
                </span>
                {sel && <Check className="w-4 h-4 text-accent" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

/** Inline SVG flags (emoji flags don't render on Windows). */
const Flag: React.FC<{ code: Language; className?: string }> = ({ code, className = '' }) => (
  <svg viewBox="0 0 30 20" className={`shrink-0 rounded-[3px] ring-1 ring-black/10 ${className}`} aria-hidden>
    {code === 'en' ? (
      // Philippines
      <>
        <rect width="30" height="10" fill="#0038a8" />
        <rect y="10" width="30" height="10" fill="#ce1126" />
        <path d="M0 0 L17.3 10 L0 20 Z" fill="#fff" />
        <circle cx="6" cy="10" r="2.3" fill="#fcd116" />
        <circle cx="1.8" cy="2.4" r="0.8" fill="#fcd116" />
        <circle cx="1.8" cy="17.6" r="0.8" fill="#fcd116" />
        <circle cx="14.3" cy="10" r="0.8" fill="#fcd116" />
      </>
    ) : (
      // South Korea
      <>
        <rect width="30" height="20" fill="#fff" />
        <circle cx="15" cy="10" r="5" fill="#0047a0" />
        <path d="M10 10 A5 5 0 0 1 20 10 A2.5 2.5 0 0 1 15 10 A2.5 2.5 0 0 0 10 10 Z" fill="#cd2e3a" />
        {[
          [6.2, 4.6, 33.7],
          [23.8, 4.6, -33.7],
          [6.2, 15.4, -33.7],
          [23.8, 15.4, 33.7],
        ].map(([x, y, r], i) => (
          <g key={i} transform={`translate(${x} ${y}) rotate(${r})`} fill="#000">
            <rect x="-2.2" y="-1.6" width="4.4" height="0.7" />
            <rect x="-2.2" y="-0.35" width="4.4" height="0.7" />
            <rect x="-2.2" y="0.9" width="4.4" height="0.7" />
          </g>
        ))}
      </>
    )}
  </svg>
);
