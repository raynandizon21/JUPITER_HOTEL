import React, { useLayoutEffect, useRef, useState } from 'react';
import { CasinoRatesConfig, Reservation } from '../types/hotel';
import { Check, Settings2, X, Utensils, Coffee, BedDouble, Plus, Trash2 } from 'lucide-react';
import { Language } from '../i18n/translations';
import { PageHeader, Pager, toast } from './ui';

interface RoomRatesMaintenanceProps {
  casinoRates: CasinoRatesConfig;
  /** Saves the new rates (App also renames the room type on existing bookings when a room is renamed). */
  onSave: (next: CasinoRatesConfig) => void;
  /** Used to stop deleting a room type that bookings still use. */
  reservations: Reservation[];
  language: Language;
}

type RateField = 'singleDoubleWeekday' | 'tripleWeekday' | 'singleDoubleWeekend' | 'tripleWeekend';
type VoucherField = 'breakfast' | 'dinner' | 'extraBed';
const toNum = (v: string) => parseInt(v.replace(/[^0-9]/g, ''), 10) || 0;

/** smallest height of a room row (px); rows grow from here to fill the card */
const MIN_ROW = 33;

export const RoomRatesMaintenance: React.FC<RoomRatesMaintenanceProps> = ({ casinoRates, onSave, reservations, language }) => {
  const en = language === 'en';
  // While editing, changes go to a draft; Save commits, Cancel discards.
  const [draft, setDraft] = useState<CasinoRatesConfig | null>(null);
  const editing = draft !== null;
  const data = draft ?? casinoRates;

  const setRoomRate = (index: number, field: RateField, value: string) =>
    setDraft((prev) => prev && { ...prev, rooms: prev.rooms.map((r, i) => (i === index ? { ...r, [field]: toNum(value) } : r)) });

  const setVoucher = (field: VoucherField, value: string) =>
    setDraft((prev) => prev && { ...prev, vouchers: { ...prev.vouchers, [field]: toNum(value) } });

  const setRoomName = (index: number, value: string) =>
    setDraft((prev) => prev && { ...prev, rooms: prev.rooms.map((r, i) => (i === index ? { ...r, name: value.toUpperCase() } : r)) });

  const addRoom = () => {
    setPage(Number.MAX_SAFE_INTEGER); // clamped to the last page, where the new row is
    setDraft(
      (prev) =>
        prev && {
          ...prev,
          rooms: [
            ...prev.rooms,
            { id: `room_${Date.now().toString(36)}`, name: '', singleDoubleWeekday: 0, tripleWeekday: 0, singleDoubleWeekend: 0, tripleWeekend: 0 },
          ],
        }
    );
  };

  // bookings that use a room type (by its saved name) — such a room can't be deleted
  const usedBy = (id: string) => {
    const saved = casinoRates.rooms.find((r) => r.id === id);
    return saved ? reservations.filter((r) => r.roomType.toLowerCase() === saved.name.toLowerCase()).length : 0;
  };
  const removeRoom = (index: number) => {
    const room = draft?.rooms[index];
    if (!room) return;
    const n = usedBy(room.id);
    if (n) {
      toast(en ? 'Room type is in use' : '사용 중인 객실 타입', en ? `${room.name} has ${n} booking(s) — it can't be deleted` : `${room.name} — 예약 ${n}건이 사용 중이라 삭제할 수 없습니다`, 'bad');
      return;
    }
    setDraft((prev) => prev && { ...prev, rooms: prev.rooms.filter((_, i) => i !== index) });
  };

  const startEdit = () => setDraft(structuredClone(casinoRates));
  const cancelEdit = () => {
    setDraft(null);
    toast(en ? 'Changes discarded' : '변경 취소됨', en ? 'Room rates were not changed' : '요금표가 변경되지 않았습니다', 'info');
  };
  const saveEdit = () => {
    if (!draft) return;
    const rooms = draft.rooms.map((r) => ({ ...r, name: r.name.trim().replace(/\s+/g, ' ') }));
    if (rooms.some((r) => !r.name)) {
      toast(en ? 'Room name is missing' : '객실 이름이 비어 있습니다', en ? 'Type a name for every room type' : '모든 객실 타입에 이름을 입력하세요', 'bad');
      return;
    }
    const dup = rooms.find((r, i) => rooms.findIndex((x) => x.name.toLowerCase() === r.name.toLowerCase()) !== i);
    if (dup) {
      toast(en ? 'Duplicate room name' : '중복된 객실 이름', dup.name, 'bad');
      return;
    }
    const added = rooms.filter((r) => !casinoRates.rooms.some((x) => x.id === r.id)).length;
    const removed = casinoRates.rooms.filter((x) => !rooms.some((r) => r.id === x.id)).length;
    onSave({ ...draft, rooms });
    setDraft(null);
    toast(
      en ? 'Room rates saved' : '요금표 저장됨',
      [added && (en ? `${added} added` : `${added}개 추가`), removed && (en ? `${removed} deleted` : `${removed}개 삭제`)].filter(Boolean).join(' · ') ||
        (en ? 'New rates apply to new bookings and quotes' : '새 요금이 예약과 견적에 적용됩니다')
    );
  };

  const filteredRooms = data.rooms;

  // The rate table fills the card; when the room types don't all fit, it pages instead of scrolling.
  const areaRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(20);
  const [avail, setAvail] = useState(0); // height left for the room rows
  const [page, setPage] = useState(0);
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const measure = () => {
      const head = el.querySelector('thead')?.getBoundingClientRect().height ?? 74;
      const extra = el.querySelector('tr[data-add-row]')?.getBoundingClientRect().height ?? 0;
      const space = el.clientHeight - head - extra;
      const n = Math.max(3, Math.floor(space / MIN_ROW));
      setFit((prev) => (prev === n ? prev : n));
      setAvail((prev) => (prev === space ? prev : space));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [editing]);
  const pages = Math.max(1, Math.ceil(filteredRooms.length / fit));
  const cur = Math.min(page, pages - 1);
  const pageRooms = filteredRooms.slice(cur * fit, cur * fit + fit);
  // rows grow to fill the card (no blank space under the table); same height on every page
  const rowH = avail > 0 && pageRooms.length ? Math.max(MIN_ROW, Math.floor(avail / (pages > 1 ? fit : pageRooms.length))) : undefined;
  const fieldCls = (big = false) =>
    `num ${big ? 'text-[13.5px]' : 'text-[13px]'} font-medium text-ink rounded-lg border transition focus:outline-none ${
      editing
        ? 'bg-surface border-line-strong hover:border-faint focus:border-ink focus:shadow-[0_0_0_3px_rgb(17_18_20/0.06)]'
        : 'bg-transparent border-transparent cursor-default'
    }`;

  const rateInput = (idx: number, field: RateField, value: number) => (
    <label className={`flex items-center justify-center gap-1 w-full max-w-[150px] h-7 px-3 focus-within:border-ink focus-within:shadow-[0_0_0_3px_rgb(17_18_20/0.06)] ${fieldCls(true)} ${editing ? 'cursor-text' : ''}`}>
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
    <div className="flex-1 flex flex-col">
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

      <div className="card overflow-hidden mb-3 flex-1 min-h-[240px] flex flex-col">
        <div ref={areaRef} className="flex-1 relative overflow-hidden">
        <div className="absolute inset-0 overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-[13px]">
            <thead>
              <tr className="h-[34px]">
                <th rowSpan={2} className={`${cell} w-[26%] px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.06em] bg-ink text-white !border-r-white/10`}>
                  {en ? 'Room type' : '객실 타입'}
                </th>
                {groups.map((g) => (
                  <th key={g.key} colSpan={2} className={`${cell} px-4 py-2 text-center text-[11.5px] font-semibold uppercase tracking-[0.06em] ${g.top} !border-white/20`}>
                    {g.title}
                  </th>
                ))}
              </tr>
              <tr className="h-[28px]">
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
              {pageRooms.map((room) => {
                const idx = data.rooms.findIndex((r) => r.id === room.id);
                return (
                  <tr key={room.id} data-room-row style={{ height: rowH }} className="hover:bg-sunken/60 transition-colors">
                    <td className={`${cell} px-4 py-0.5 font-medium text-ink`}>
                      {editing ? (
                        <div className="flex items-center gap-2">
                          <input
                            value={room.name}
                            onChange={(e) => setRoomName(idx, e.target.value)}
                            placeholder={en ? 'ROOM TYPE NAME' : '객실 타입 이름'}
                            autoFocus={!room.name}
                            maxLength={100}
                            className="input input-sm uppercase flex-1 min-w-0"
                          />
                          <button
                            onClick={() => removeRoom(idx)}
                            className="icon-btn hover:!text-bad shrink-0"
                            title={usedBy(room.id) ? (en ? `Used by ${usedBy(room.id)} booking(s)` : `예약 ${usedBy(room.id)}건 사용 중`) : en ? 'Delete room type' : '객실 타입 삭제'}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        room.name
                      )}
                    </td>
                    {groups.flatMap((g) =>
                      g.cols.map((f) => (
                        <td key={f} className={`${cell} px-4 py-0.5 text-center`}>
                          <div className="flex justify-center">{rateInput(idx, f, room[f])}</div>
                        </td>
                      ))
                    )}
                  </tr>
                );
              })}
              {editing && (
                <tr data-add-row>
                  <td colSpan={5} className="px-4 py-1.5 border-b border-line">
                    <button onClick={addRoom} className="btn btn-outline btn-sm">
                      <Plus className="w-3.5 h-3.5" />
                      {en ? 'Add room type' : '객실 타입 추가'}
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        </div>
        {pages > 1 && <Pager page={cur} pages={pages} total={filteredRooms.length} size={fit} onPage={setPage} en={en} unitLabel={en ? 'room types' : '객실 타입'} />}
      </div>

      <div className="card px-5 py-2.5 flex flex-col lg:flex-row lg:items-center gap-3 lg:gap-6">
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
