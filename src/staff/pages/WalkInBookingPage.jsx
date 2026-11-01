import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { customersApi, reservationsApi, unitTypesApi } from '../../api/generated';
import { errorMessage } from '../../api/axiosClient';
import Icon from '../../customer/components/Icon.jsx';
import { formatDate, formatVnd, todayIso } from '../../customer/components/format.js';
import { PageHeader } from '../components/ui.jsx';
import { useFacilities, useUnitTypes, useUnits } from '../queries.js';
import { useT } from '../../i18n/I18n.jsx';

const EMPTY_CUSTOMER = { fullName: '', email: '', phoneNumber: '', citizenId: '' };
const PERIODS = [1, 3, 6, 12];

/** Step 1: find the customer, or create their account at the desk (they set a password later with "forgot password"). */
function CustomerStep({ value, onChange }) {
    const tr = useT();
    const [search, setSearch] = useState('');
    const found = useQuery({
        queryKey: ['customers', search],
        queryFn: () => customersApi.list({ search, page: 1, pageSize: 8 }),
        enabled: search.trim().length >= 2,
    });
    const isNew = value.mode === 'new';
    const set = (key) => (e) => onChange({ ...value, customer: { ...value.customer, [key]: e.target.value } });
    return (
        <section className="se-panel">
            <h2>{tr('1. Customer')}</h2>
            <div className="se-tabs se-tabs-line" role="tablist">
                <button type="button" role="tab" aria-selected={!isNew} className={!isNew ? 'active' : ''} onClick={() => onChange({ mode: 'existing', customer: null })}>{tr('Existing customer')}</button>
                <button type="button" role="tab" aria-selected={isNew} className={isNew ? 'active' : ''} onClick={() => onChange({ mode: 'new', customer: { ...EMPTY_CUSTOMER } })}>{tr('New customer')}</button>
            </div>
            {!isNew ? (
                <>
                    <label><span className="se-label">{tr('Search by name, email or phone')}</span>
                        <div className="se-input"><Icon name="search" size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="0901 234 567" /></div></label>
                    <ul className="sa-people">
                        {(found.data?.items ?? []).map((c) => (
                            <li key={c.userId}>
                                <label className="se-check">
                                    <input type="radio" name="customer" checked={value.customer?.userId === c.userId} onChange={() => onChange({ mode: 'existing', customer: c })} />
                                    <span><strong>{c.fullName}</strong> <small>{c.email} · {c.phoneNumber}{c.citizenId ? ` · CCCD ${c.citizenId}` : ''}</small></span>
                                </label>
                            </li>
                        ))}
                        {search.trim().length >= 2 && found.data && !found.data.items?.length && <li className="sa-muted">{tr('No customer found. Use “New customer”.')}</li>}
                    </ul>
                </>
            ) : (
                <div className="se-panel-grid">
                    <label><span className="se-label">{tr('Full name *')}</span><div className="se-input"><input value={value.customer.fullName} onChange={set('fullName')} maxLength={100} /></div></label>
                    <label><span className="se-label">{tr('Phone *')}</span><div className="se-input"><input type="tel" value={value.customer.phoneNumber} onChange={set('phoneNumber')} maxLength={20} /></div></label>
                    <label><span className="se-label">{tr('Email *')}</span><div className="se-input"><input type="email" value={value.customer.email} onChange={set('email')} maxLength={100} /></div></label>
                    <label><span className="se-label">{tr("Citizen ID (CCCD)")}</span><div className="se-input"><input inputMode="numeric" value={value.customer.citizenId} onChange={set('citizenId')} maxLength={12} /></div></label>
                </div>
            )}
        </section>
    );
}

/** A18: book at the front desk — the unit is assigned now and the deposit is taken in cash, ready for handover. */
export default function WalkInBookingPage() {
    const tr = useT();
    const queryClient = useQueryClient();
    const [who, setWho] = useState({ mode: 'existing', customer: null });
    const [form, setForm] = useState({ facilityId: '', unitTypeId: '', storageUnitId: '', moveInDate: todayIso(), rentalMonths: 1 });
    const set = (patch) => setForm((f) => ({ ...f, ...patch }));
    const facilities = useFacilities().data ?? [];
    const types = useUnitTypes().data ?? [];
    const units = (useUnits(form.facilityId ? { facilityId: Number(form.facilityId) } : undefined).data ?? [])
        .filter((u) => u.status === 'Available' && String(u.unitTypeId) === String(form.unitTypeId));
    const quoteParams = { facilityId: Number(form.facilityId), moveInDate: form.moveInDate, rentalMonths: form.rentalMonths };
    const quote = useQuery({
        queryKey: ['quote', { unitTypeId: Number(form.unitTypeId), ...quoteParams }],
        queryFn: () => unitTypesApi.quote(Number(form.unitTypeId), quoteParams),
        enabled: !!form.facilityId && !!form.unitTypeId,
    });

    const book = useMutation({
        mutationFn: () => reservationsApi.walkIn({
            customerId: who.mode === 'existing' ? who.customer?.userId : null,
            newCustomer: who.mode === 'new' ? { ...who.customer, citizenId: who.customer.citizenId.trim() || null } : null,
            facilityId: Number(form.facilityId), unitTypeId: Number(form.unitTypeId), storageUnitId: Number(form.storageUnitId),
            moveInDate: form.moveInDate, rentalMonths: form.rentalMonths,
        }),
        onSuccess: () => ['reservations', 'storage-units', 'invoices', 'customers'].forEach((k) => queryClient.invalidateQueries({ queryKey: [k] })),
    });

    const customerReady = who.mode === 'existing'
        ? !!who.customer
        : ['fullName', 'email', 'phoneNumber'].every((k) => who.customer?.[k]?.trim());
    const ready = customerReady && form.storageUnitId && form.moveInDate && !book.isPending;

    if (book.data) {
        const r = book.data;
        return (
            <>
                <PageHeader title={tr('Walk-in booked')} subtitle={`${r.customerName} · ${r.facilityName}`} />
                <section className="se-panel sa-checkin-done">
                    <span className="se-confirm-icon"><Icon name="check" size={28} /></span>
                    <h2>{tr('Reservation {code} — unit {unit} reserved', { code: r.reservationCode, unit: r.unitCode })}</h2>
                    <p className="sa-muted">{tr('Move-in {date} · {n} month(s). Deposit {amount} recorded as paid in cash.', { date: formatDate(r.moveInDate), n: r.rentalMonths, amount: formatVnd(r.depositAmount) })}</p>
                    <p className="sa-muted">{tr('Next: draft the contract and let the customer sign, then complete the handover.')}</p>
                    <div className="sa-form-actions">
                        <Link to="/admin/handover" className="se-btn se-btn-primary">{tr('Go to handover')}</Link>
                        <button type="button" className="se-btn se-btn-ghost" onClick={() => book.reset()}>{tr('New walk-in')}</button>
                    </div>
                </section>
            </>
        );
    }

    return (
        <>
            <Link to="/admin/reservations" className="se-back"><Icon name="arrowLeft" size={16} /> {tr('Back to reservations')}</Link>
            <PageHeader title={tr('New walk-in booking')} subtitle="Book a unit for a customer at the desk; the deposit is taken in cash" />
            <CustomerStep value={who} onChange={setWho} />

            <section className="se-panel">
                <h2>{tr('2. Unit & rental period')}</h2>
                <div className="se-panel-grid">
                    <label><span className="se-label">{tr('Facility *')}</span><div className="se-input">
                        <select value={form.facilityId} onChange={(e) => set({ facilityId: e.target.value, storageUnitId: '' })}>
                            <option value="">{tr('Choose a facility')}</option>
                            {facilities.map((f) => <option key={f.facilityId} value={f.facilityId}>{f.name}</option>)}
                        </select></div></label>
                    <label><span className="se-label">{tr('Size *')}</span><div className="se-input">
                        <select value={form.unitTypeId} onChange={(e) => set({ unitTypeId: e.target.value, storageUnitId: '' })}>
                            <option value="">{tr('Choose a size')}</option>
                            {types.map((t) => <option key={t.unitTypeId} value={t.unitTypeId}>{t.code} · {t.areaM2} m²</option>)}
                        </select></div></label>
                    <label><span className="se-label">{tr('Unit *')}</span><div className="se-input">
                        <select value={form.storageUnitId} onChange={(e) => set({ storageUnitId: e.target.value })} disabled={!units.length}>
                            <option value="">{form.facilityId && form.unitTypeId ? (units.length ? tr('Choose a free unit') : tr('No free unit of this size')) : tr('Choose facility and size first')}</option>
                            {units.map((u) => <option key={u.storageUnitId} value={u.storageUnitId}>{u.unitCode}{u.zone ? ` · ${u.zone}` : ''} · {u.floorName}</option>)}
                        </select></div></label>
                    <label><span className="se-label">{tr('Move-in date *')}</span><div className="se-input">
                        <input type="date" min={todayIso()} value={form.moveInDate} onChange={(e) => set({ moveInDate: e.target.value })} /></div></label>
                </div>
                <div className="se-chips" role="radiogroup" aria-label={tr('Rental period')}>
                    {PERIODS.map((m) => (
                        <button key={m} type="button" role="radio" aria-checked={form.rentalMonths === m} className={`se-chip${form.rentalMonths === m ? ' active' : ''}`} onClick={() => set({ rentalMonths: m })}>
                            {m} {m === 1 ? 'month' : 'months'}
                        </button>
                    ))}
                </div>
                {quote.data && (
                    <dl className="se-kv">
                        <div><dt>{tr('Monthly rent')}</dt><dd>{formatVnd(quote.data.monthlyRent)}</dd></div>
                        <div><dt>{tr("Deposit (cash now)")}</dt><dd>{formatVnd(quote.data.depositAmount)}</dd></div>
                    </dl>
                )}
            </section>

            {book.isError && <div className="se-alert" role="alert">{errorMessage(book.error)}</div>}
            <div className="sa-form-actions">
                <span className="sa-muted">{tr('Confirming reserves the unit and records the deposit as cash received by you.')}</span>
                <button type="button" className="se-btn se-btn-primary" disabled={!ready} onClick={() => book.mutate()}>
                    {book.isPending ? tr('Booking…') : tr('Confirm booking & take deposit')}
                </button>
            </div>
        </>
    );
}
