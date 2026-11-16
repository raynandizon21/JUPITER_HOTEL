import React, { useMemo, useState } from 'react';
import { CalendarHeart, Plus, Trash2 } from 'lucide-react';
import { Holiday } from '../types/hotel';
import { formatLongDate } from '../utils/hotelHelpers';
import { Language } from '../i18n/translations';
import { ConfirmDialog, Dialog, Select, toast } from './ui';

/**
 * Holidays — file maintenance list (Philippine holidays). Nights on these dates get the holiday rate
 * ticked automatically in New Reservation, and they are marked on the calendar.
 */
export const HolidaysMaintenance: React.FC<{
  holidays: Holiday[];
  onSave: (h: Holiday) => void;
  language: Language;
  onClose: () => void;
}> = ({ holidays, onSave, language, onClose }) => {
  const en = language === 'en';
  const active = holidays.filter((h) => h.active);
  const years = useMemo(() => Array.from(new Set([...active.map((h) => h.date.slice(0, 4)), String(new Date().getFullYear())])).sort(), [active]);
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<Holiday['type']>('regular');
  const [removing, setRemoving] = useState<Holiday | null>(null);

  const list = active.filter((h) => h.date.startsWith(year)).sort((a, b) => a.date.localeCompare(b.date));
  const taken = active.find((h) => h.date === date);

  const add = () => {
    if (!date || !name.trim()) return;
    onSave({ date, name: name.trim(), type, active: true });
    toast(taken ? (en ? 'Holiday updated' : '공휴일 수정됨') : en ? 'Holiday added' : '공휴일 추가됨', `${formatLongDate(date)} · ${name.trim()}`);
    setYear(date.slice(0, 4));
    setDate('');
    setName('');
  };

  const dow = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString(en ? 'en-US' : 'ko-KR', { weekday: 'short', timeZone: 'UTC' });

  return (
    <Dialog
      width="max-w-3xl"
      onClose={onClose}
      title={
        <span className="flex items-center gap-3">
          {en ? 'Holidays' : '공휴일'}
          <Select value={year} onChange={(e) => setYear(e.target.value)} className="input input-sm w-auto min-w-[96px]">
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
        </span>
      }
      subtitle={en ? 'Philippine holidays — nights on these dates get the holiday rate automatically.' : '필리핀 공휴일 — 해당 날짜 숙박은 공휴일 요금이 자동 적용됩니다.'}
    >
      <div className="max-h-[70vh] overflow-y-auto">
        {/* add */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
          className="px-6 py-4 border-b border-line flex flex-col md:flex-row md:items-end items-stretch gap-3"
        >
          <div>
            <label className="field-label">{en ? 'Date' : '날짜'}</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input input-sm w-[160px]" />
          </div>
          <div className="flex-1 min-w-[180px]">
            <label className="field-label">{en ? 'Holiday name' : '공휴일 이름'}</label>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={150} placeholder={en ? "e.g. Eid'l Fitr" : '예: 이드 알피트르'} className="input input-sm" />
          </div>
          <div>
            <label className="field-label">{en ? 'Type' : '구분'}</label>
            <div className="seg">
              <button type="button" data-active={type === 'regular'} onClick={() => setType('regular')}>
                {en ? 'Regular' : '정규'}
              </button>
              <button type="button" data-active={type === 'special'} onClick={() => setType('special')}>
                {en ? 'Special' : '특별'}
              </button>
            </div>
          </div>
          <button type="submit" disabled={!date || !name.trim()} className="btn btn-primary btn-sm">
            <Plus className="w-3.5 h-3.5" />
            {taken ? (en ? 'Update' : '수정') : en ? 'Add' : '추가'}
          </button>
        </form>
        {taken && <div className="px-5 -mt-2 pb-2 text-[11.5px] text-warn">{en ? `Already a holiday: ${taken.name} — saving replaces it.` : `이미 공휴일: ${taken.name} — 저장하면 바뀝니다.`}</div>}

        <table className="dtable">
          <thead>
            <tr>
              <th>{en ? 'Date' : '날짜'}</th>
              <th>{en ? 'Holiday' : '공휴일'}</th>
              <th className="c">{en ? 'Type' : '구분'}</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr>
                <td colSpan={4} className="!py-12 text-center text-muted">
                  <CalendarHeart className="w-5 h-5 mx-auto mb-1.5 text-faint" />
                  {en ? `No holidays for ${year} yet.` : `${year}년 공휴일이 없습니다.`}
                </td>
              </tr>
            )}
            {list.map((h) => (
              <tr key={h.date}>
                <td className="whitespace-nowrap text-ink-2">
                  {formatLongDate(h.date)} <span className="text-muted text-[11.5px] ml-1">{dow(h.date)}</span>
                </td>
                <td className="font-medium text-ink">{h.name}</td>
                <td className="c">
                  <span className={`badge ${h.type === 'regular' ? 'badge-bad' : 'badge-warn'}`}>{h.type === 'regular' ? (en ? 'Regular' : '정규') : en ? 'Special' : '특별'}</span>
                </td>
                <td className="r">
                  <button onClick={() => setRemoving(h)} className="icon-btn hover:!text-bad" title={en ? 'Remove' : '삭제'}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-5 py-3 border-t border-line text-[11.5px] text-muted">
          {en
            ? "Movable holidays (e.g. Eid'l Fitr, Eid'l Adha) are proclaimed each year — add them here when announced."
            : '이동 공휴일(예: 이드 알피트르)은 매년 발표되므로 발표 후 추가하세요.'}
        </div>
      </div>

      {removing && (
        <ConfirmDialog
          danger
          title={en ? 'Remove this holiday?' : '공휴일을 삭제하시겠습니까?'}
          message={
            <>
              <b className="text-ink">{removing.name}</b> · {formatLongDate(removing.date)}
              <div className="text-[12px] text-muted mt-1.5">{en ? 'Existing bookings keep their holiday rate.' : '기존 예약의 공휴일 요금은 그대로 유지됩니다.'}</div>
            </>
          }
          confirmLabel={en ? 'Remove' : '삭제'}
          cancelLabel={en ? 'Cancel' : '취소'}
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            onSave({ ...removing, active: false });
            toast(en ? 'Holiday removed' : '공휴일 삭제됨', removing.name, 'bad');
            setRemoving(null);
          }}
        />
      )}
    </Dialog>
  );
};
