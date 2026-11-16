import React from 'react';
import { LayoutGrid, CalendarRange, BookOpenText, CalendarDays, SlidersHorizontal, Calculator, Menu, UserRound, Trash2 } from 'lucide-react';
import { ActiveModule } from '../types/hotel';
import { Language, translations } from '../i18n/translations';

interface SidebarProps {
  activeModule: ActiveModule;
  setActiveModule: (module: ActiveModule) => void;
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
  language: Language;
  /** Shows the "Clear data" button when set (hidden in production). */
  onClearData?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeModule, setActiveModule, collapsed, setCollapsed, language, onClearData }) => {
  const t = translations[language];
  const en = language === 'en';

  const groups: { label: string; items: { id: ActiveModule; label: string; Icon: React.ElementType }[] }[] = [
    {
      label: en ? 'Overview' : '개요',
      items: [
        { id: 'dashboard', label: t.navDashboard, Icon: LayoutGrid },
        { id: 'daily', label: t.navDaily, Icon: CalendarRange },
      ],
    },
    {
      label: en ? 'Reservations' : '예약',
      items: [
        { id: 'ledger', label: t.navLedger, Icon: BookOpenText },
        { id: 'calendar', label: t.navCalendar, Icon: CalendarDays },
      ],
    },
    {
      label: en ? 'Rates' : '요금',
      items: [
        { id: 'maintenance', label: t.navMaintenance, Icon: SlidersHorizontal },
        { id: 'calculator', label: t.navCalculator, Icon: Calculator },
      ],
    },
    {
      label: en ? 'File maintenance' : '기초 정보',
      items: [{ id: 'agents', label: en ? 'Agents' : '에이전트', Icon: UserRound }],
    },
  ];

  return (
    <aside
      className={`${collapsed ? 'w-[68px]' : 'w-[236px]'} shrink-0 card !rounded-2xl flex flex-col overflow-hidden transition-[width] duration-200 ease-out select-none`}
    >
      <nav className="flex-1 overflow-y-auto px-3 py-5 space-y-5">
        {groups.map((g) => (
          <div key={g.label}>
            {collapsed ? (
              <div className="mx-auto mb-2 h-px w-6 bg-line" />
            ) : (
              <div className="eyebrow !text-ink-2 px-3 pb-2">{g.label}</div>
            )}
            <ul className="space-y-1">
              {g.items.map(({ id, label, Icon }) => {
                const active = activeModule === id;
                return (
                  <li key={id}>
                    <button
                      onClick={() => setActiveModule(id)}
                      title={label}
                      className={`w-full flex items-center rounded-[10px] text-[13.5px] transition-colors cursor-pointer ${
                        collapsed ? 'justify-center h-10' : 'gap-3 h-10 px-3'
                      } ${active ? 'bg-ink text-white font-medium' : 'text-ink-2 hover:bg-canvas'}`}
                    >
                      <Icon className="w-[18px] h-[18px] shrink-0" strokeWidth={1.75} />
                      {!collapsed && <span className="truncate text-left">{label}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="p-3 border-t border-line space-y-2">
        {onClearData && (
          <button
            onClick={onClearData}
            title={en ? 'Clear all saved data' : '저장된 데이터 모두 삭제'}
            className={`w-full h-10 rounded-[10px] border border-bad-line text-bad bg-bad-soft/60 hover:bg-bad-soft flex items-center justify-center gap-2.5 text-[13px] font-medium transition-colors cursor-pointer`}
          >
            <Trash2 className="w-4 h-4" />
            {!collapsed && (en ? 'Clear data' : '데이터 삭제')}
          </button>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full h-10 rounded-[10px] bg-canvas hover:bg-line flex items-center justify-center gap-2.5 text-[13px] text-ink-2 transition-colors cursor-pointer"
          aria-label="Toggle sidebar"
        >
          <Menu className="w-4 h-4" />
          {!collapsed && (en ? 'Collapse' : '접기')}
        </button>
      </div>
    </aside>
  );
};
