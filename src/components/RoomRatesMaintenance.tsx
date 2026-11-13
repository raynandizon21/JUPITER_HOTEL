import React, { useState } from 'react';
import { CasinoRatesConfig } from '../types/hotel';
import { Check, Settings2, X, Utensils, Coffee, BedDouble } from 'lucide-react';
import { Language } from '../i18n/translations';
import { PageHeader, toast } from './ui';

interface RoomRatesMaintenanceProps {
  casinoRates: CasinoRatesConfig;
  setCasinoRates: React.Dispatch<React.SetStateAction<CasinoRatesConfig>>;
  language: Language;
}

type RateField = 'singleDoubleWeekday' | 'tripleWeekday' | 'singleDoubleWeekend' | 'tripleWeekend';
type VoucherField = 'breakfast' | 'dinner' | 'extraBed';
const toNum = (v: string) => parseInt(v.replace(/[^0-9]/g, ''), 10) || 0;

export const RoomRatesMaintenance: React.FC<RoomRatesMaintenanceProps> = ({ casinoRates, setCasinoRates, language }) => {
  const en = language === 'en';
  // While editing, changes go to a draft; Save commits, Cancel discards.
  const [draft, setDraft] = useState<CasinoRatesConfig | null>(null);
  const editing = draft !== null;
  const data = draft ?? casinoRates;

  const setRoomRate = (index: number, field: RateField, value: string) =>
    setDraft((prev) => prev && { ...prev, rooms: prev.rooms.map((r, i) => (i === index ? { ...r, [field]: toNum(value) } : r)) });

  const setVoucher = (field: VoucherField, value: string) =>
    setDraft((prev) => prev && { ...prev, vouchers: { ...prev.vouchers, [field]: toNum(value) } });

  const startEdit = () => setDraft(structuredClone(casinoRates));
  const cancelEdit = () => {
    setDraft(null);
    toast(en ? 'Changes discarded' : '변경 취소됨', en ? 'Room rates were not changed' : '요금표가 변경되지 않았습니다', 'info');
  };
  const saveEdit = () => {
    if (draft) setCasinoRates(draft);
    setDraft(null);
    toast(en ? 'Room rates saved' : '요금표 저장됨', en ? 'New rates apply to new bookings and quotes' : '새 요금이 예약과 견적에 적용됩니다');
  };

  const filteredRooms = data.rooms;
  const fieldCls = (big = false) =>
    `num ${big ? 'text-[13.5px]' : 'text-[13px]'} font-medium text-ink rounded-lg border transition focus:outline-none ${
      editing
        ? 'bg-surface border-line-strong hover:border-faint focus:border-ink focus:shadow-[0_0_0_3px_rgb(17_18_20/0.06)]'
        : 'bg-transparent border-transparent cursor-default'
    }`;

  const rateInput = (idx: number, field: RateField, value: number) => (
    <label className={`flex items-center justify-center gap-1 w-full max-w-[150px] h-9 px-3 focus-within:border-ink focus-within:shadow-[0_0_0_3px_rgb(17_18_20/0.06)] ${fieldCls(true)} ${editing ? 'cursor-text' : ''}`}>
      <span className="text-muted font-normal select-none">₱</span>
      <input
        type="text"
        inputMode="numeric"
        readOnly={!editing}
        tabIndex={editing ? 0 : -1}
        value={value.toLocaleString()}
        onChange={(e) => setRoomRate(idx, field, e.target.value)}
        style={{ width: `${Math.max(value.toLocaleString().length, 1) + 0.5}ch` }}
        className={`min-w-0 bg-transparent focus:outline-none ${editing ? '' : 'cursor-default'}`}
      />
    </label>
  );

  const groups = [
    { key: 'wd', title: en ? 'Sunday – Thursday' : '일요일 – 목요일', cols: ['singleDoubleWeekday', 'tripleWeekday'] as RateField[], top: 'bg-[#3567d6] text-white', sub: 'bg-[#e9effc] text-[#2350b5]' },
    { key: 'we', title: en ? 'Friday – Saturday' : '금요일 – 토요일', cols: ['singleDoubleWeekend', 'tripleWeekend'] as RateField[], top: 'bg-[#c0662b] text-white', sub: 'bg-[#fbefe5] text-[#a3521d]' },
  ];
  const colLabel = (f: RateField) => (f.startsWith('triple') ? (en ? 'Triple' : '3인') : en ? 'Single / Double' : '1~2인');
  const cell = 'border-b border-r border-line last:border-r-0';

  const vouchers: { key: VoucherField; name: string; desc: string; Icon: React.ElementType }[] = [
    { key: 'breakfast', name: en ? 'Breakfast voucher' : '조식 바우처', desc: en ? 'Buffet breakfast, per person' : '조식 뷔페 1인 이용권', Icon: Coffee },
    { key: 'dinner', name: en ? 'Dinner voucher' : '석식 바우처', desc: en ? 'Buffet dinner, per person' : '석식 뷔페 1인 이용권', Icon: Utensils },
    { key: 'extraBed', name: en ? 'Extra bed' : '엑스트라 베드', desc: en ? 'Rollaway bed, per night' : '1박당 추가 요금', Icon: BedDouble },
  ];

  return (
    <div className="flex flex-col min-h-[calc(100vh-176px)]">
      <PageHeader
        title={en ? 'Room rates' : '객실 요금표'}
        actions={
          editing ? (
            <>
              <span className="text-[12px] text-warn font-medium mr-1">{en ? 'Editing — unsaved changes' : '편집 중 — 저장되지 않음'}</span>
              <button onClick={cancelEdit} className="btn btn-outline">
                <X className="w-3.5 h-3.5" />
                {en ? 'Cancel' : '취소'}
              </button>
              <button onClick={saveEdit} className="btn btn-primary">
                <Check className="w-4 h-4" />
                {en ? 'Save rates' : '요금 저장'}
              </button>
            </>
          ) : (
            <button onClick={startEdit} className="btn btn-outline">
              <Settings2 className="w-4 h-4" />
              {en ? 'Settings' : '설정'}
            </button>
          )
        }
      />

      <div className="card overflow-hidden mb-4 flex-1 flex flex-col">
        <div className="overflow-x-auto flex-1 flex flex-col">
          <table className="w-full flex-1 min-w-[720px] border-collapse text-[13px]">
            <thead>
              <tr className="h-[40px]">
                <th rowSpan={2} className={`${cell} w-[26%] px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.06em] bg-ink text-white !border-r-white/10`}>
                  {en ? 'Room type' : '객실 타입'}
                </th>
                {groups.map((g) => (
                  <th key={g.key} colSpan={2} className={`${cell} px-4 py-2 text-center text-[11.5px] font-semibold uppercase tracking-[0.06em] ${g.top} !border-white/20`}>
                    {g.title}
                  </th>
                ))}
              </tr>
              <tr className="h-[34px]">
                {groups.flatMap((g) =>
                  g.cols.map((f) => (
                    <th key={f} className={`${cell} px-4 py-1.5 text-center text-[11px] font-semibold uppercase tracking-[0.06em] ${g.sub}`}>
                      {colLabel(f)}
                    </th>
                  ))
                )}
              </tr>
            </thead>
            <tbody>
              {filteredRooms.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-muted">{en ? 'No room types match' : '일치하는 객실 타입이 없습니다'}</td>
                </tr>
              )}
              {filteredRooms.map((room) => {
                const idx = data.rooms.findIndex((r) => r.id === room.id);
                return (
                  <tr key={room.id} className="hover:bg-sunken/60 transition-colors">
                    <td className={`${cell} px-4 py-1 font-medium text-ink`}>{room.name}</td>
                    {groups.flatMap((g) =>
                      g.cols.map((f) => (
                        <td key={f} className={`${cell} px-4 py-1 text-center`}>
                          <div className="flex justify-center">{rateInput(idx, f, room[f])}</div>
                        </td>
                      ))
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card px-5 py-3.5 flex flex-col lg:flex-row lg:items-center gap-3 lg:gap-6">
        <div className="shrink-0 lg:w-[150px]">
          <div className="text-[13.5px] font-semibold text-ink">{en ? 'Vouchers & add-ons' : '바우처 & 부가 요금'}</div>
          <div className="text-[11.5px] text-muted">{en ? 'Same rate every day' : '전일 공통 적용'}</div>
        </div>
        <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-3">
          {vouchers.map(({ key, name, desc, Icon }) => (
            <div key={key} className="flex items-center gap-3 rounded-xl border border-line bg-sunken px-3 py-2">
              <span className="w-8 h-8 shrink-0 rounded-lg bg-accent-soft text-accent grid place-items-center">
                <Icon className="w-4 h-4" />
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-[12.5px] font-semibold text-ink truncate">{name}</div>
                <div className="text-[11px] text-muted truncate">{desc}</div>
              </div>
              <label className={`flex items-center justify-end gap-1 w-[110px] shrink-0 h-[30px] px-2.5 font-semibold focus-within:border-ink focus-within:shadow-[0_0_0_3px_rgb(17_18_20/0.06)] ${fieldCls()} ${editing ? 'cursor-text' : ''}`}>
                <span className="text-muted font-normal select-none">₱</span>
                <input
                  type="text"
                  inputMode="numeric"
                  readOnly={!editing}
                  tabIndex={editing ? 0 : -1}
                  value={data.vouchers[key].toLocaleString()}
                  onChange={(e) => setVoucher(key, e.target.value)}
                  style={{ width: `${Math.max(data.vouchers[key].toLocaleString().length, 1) + 0.5}ch` }}
                  className={`min-w-0 bg-transparent focus:outline-none ${editing ? '' : 'cursor-default'}`}
                />
              </label>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
};
