import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { facilitiesApi, storageUnitsApi } from '../../api/generated';
import { errorMessage } from '../../api/axiosClient';
import { Roles } from '../../features/auth/roles';
import { useAuth } from '../../features/auth/AuthContext';
import Icon from '../../customer/components/Icon.jsx';
import { formatDate, formatVnd } from '../../customer/components/format.js';
import { Filters, PageHeader, SearchFilter, SelectFilter, Status, TableState, matches } from '../components/ui.jsx';
import { humanize, useContracts, useFacilities, useSizePrices, useUnitTypes, useUnits } from '../queries.js';
import { useT } from '../../i18n/I18n.jsx';

const STATUSES = ['Available', 'Reserved', 'Occupied', 'Maintenance', 'Retired'];
const LIVE = ['Draft', 'Active', 'PendingReturn', 'Overdue', 'Suspended'];

/** Edit a unit (managers and admins). Floor and size can change only while it is Available, as the API requires. */
function UnitEditor({ unit }) {
    const tr = useT();
    const queryClient = useQueryClient();
    const floors = useQuery({ queryKey: ['facilities', unit.facilityId, 'floors'], queryFn: () => facilitiesApi.getFloors(unit.facilityId) });
    const types = useUnitTypes().data ?? [];
    const [form, setForm] = useState({
        floorId: String(unit.floorId), unitTypeId: String(unit.unitTypeId), unitCode: unit.unitCode,
        zone: unit.zone ?? '', note: unit.note ?? '',
    });
    const done = { onSuccess: () => ['storage-units', 'facilities'].forEach((k) => queryClient.invalidateQueries({ queryKey: [k] })) };
    const save = useMutation({
        mutationFn: () => storageUnitsApi.update(unit.storageUnitId, {
            floorId: Number(form.floorId), unitTypeId: Number(form.unitTypeId), unitCode: form.unitCode.trim(),
            zone: form.zone.trim() || null, note: form.note.trim() || null,
        }),
        ...done,
    });
    const retire = useMutation({ mutationFn: () => (unit.status === 'Retired' ? storageUnitsApi.restore : storageUnitsApi.retire)(unit.storageUnitId), ...done });
    const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
    const movable = unit.status === 'Available';
    return (
        <form className="se-form" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
            <h3>{tr('Edit unit')}</h3>
            <label><span className="se-label">{tr('Floor')}</span><div className="se-input">
                <select value={form.floorId} onChange={set('floorId')} disabled={!movable}>
                    {(floors.data ?? [{ floorId: unit.floorId, name: unit.floorName }]).map((f) => (
                        <option key={f.floorId} value={f.floorId}>{f.floorNumber != null ? `${tr('Floor')} ${f.floorNumber}` : ''}{f.name ? `${f.floorNumber != null ? ' · ' : ''}${f.name}` : ''}</option>
                    ))}
                </select></div></label>
            <label><span className="se-label">{tr('Size')}</span><div className="se-input">
                <select value={form.unitTypeId} onChange={set('unitTypeId')} disabled={!movable}>
                    {(types.length ? types : [{ unitTypeId: unit.unitTypeId, code: unit.unitTypeCode, areaM2: unit.areaM2 }]).map((t) => (
                        <option key={t.unitTypeId} value={t.unitTypeId}>{t.code} · {t.areaM2} m²</option>
                    ))}
                </select></div></label>
            {!movable && <p className="se-hint">{tr('Floor and size can change only while the unit is Available.')}</p>}
            <label><span className="se-label">{tr('Unit code')}</span><div className="se-input"><input value={form.unitCode} onChange={set('unitCode')} required maxLength={20} pattern="[A-Za-z0-9\-]+" title={tr('Letters, digits and dashes')} /></div></label>
            <label><span className="se-label">{tr('Zone')}</span><div className="se-input"><input value={form.zone} onChange={set('zone')} maxLength={10} /></div></label>
            <label><span className="se-label">{tr('Note')}</span><div className="se-input"><input value={form.note} onChange={set('note')} maxLength={200} /></div></label>
            {[save, retire].map((m, i) => m.isError && <div key={i} className="se-alert" role="alert">{errorMessage(m.error)}</div>)}
            {save.isSuccess && <div className="se-alert info" role="status">{tr('Unit saved.')}</div>}
            <div className="sa-form-actions">
                {['Available', 'Retired'].includes(unit.status) && (
                    <button type="button" className="se-btn se-btn-ghost" disabled={retire.isPending} onClick={() => retire.mutate()}>
                        {unit.status === 'Retired' ? tr('Return to service') : tr('Retire unit')}
                    </button>
                )}
                <button type="submit" className="se-btn se-btn-primary" disabled={save.isPending}>{save.isPending ? tr('Saving…') : tr('Save unit')}</button>
            </div>
        </form>
    );
}

/** A04: unit board — every unit, its status and who rents it. */
export default function UnitsPage() {
    const tr = useT();
    const [status, setStatus] = useState('');
    const [facilityId, setFacilityId] = useState('');
    const [size, setSize] = useState('');
    const [search, setSearch] = useState('');
    const [selected, setSelected] = useState(null);
    const facilities = useFacilities();
    const units = useUnits(facilityId ? { facilityId: Number(facilityId) } : undefined);
    const contracts = useContracts();
    const sizePrice = useSizePrices();
    const canEdit = [Roles.FacilityManager, Roles.SystemAdministrator].includes(useAuth().session?.role);

    const all = units.data ?? [];
    const contractOf = Object.fromEntries((contracts.data ?? []).filter((c) => LIVE.includes(c.status)).map((c) => [c.storageUnitId, c]));
    const sizes = [...new Set(all.map((u) => u.unitTypeCode).filter(Boolean))];
    const shown = all.filter((u) => (!status || u.status === status) && (!size || u.unitTypeCode === size)
        && matches(search, u.unitCode, contractOf[u.storageUnitId]?.customerName));
    const unit = all.find((u) => u.storageUnitId === selected);
    const contract = unit && contractOf[unit.storageUnitId];

    return (
        <>
            <PageHeader title={tr('Storage units')} subtitle={`${tr('{n} units', { n: all.length })}${facilityId ? '' : tr(' across all facilities')}`} />
            <div className="sa-chip-row" role="tablist">
                <button type="button" role="tab" aria-selected={!status} className={!status ? 'active' : ''} onClick={() => setStatus('')}>{tr('All')} <b>{all.length}</b></button>
                {STATUSES.map((s) => (
                    <button key={s} type="button" role="tab" aria-selected={status === s} className={status === s ? 'active' : ''} onClick={() => setStatus(s)}>
                        <i className={`dot ${s}`} />{tr(humanize(s))} <b>{all.filter((u) => u.status === s).length}</b>
                    </button>
                ))}
            </div>
            <Filters>
                <SearchFilter value={search} onChange={setSearch} placeholder={tr('Search unit code or customer')} />
                <SelectFilter label="Facility" value={facilityId} onChange={setFacilityId} all="All facilities"
                    options={(facilities.data ?? []).map((f) => ({ value: f.facilityId, label: f.name }))} />
                <SelectFilter label="Size" value={size} onChange={setSize} options={sizes} all="All sizes" />
            </Filters>
            <div className={`sa-split${unit ? ' open' : ''}`}>
                <div className="se-card se-table-wrap">
                    <table className="se-table sa-table">
                        <thead><tr><th>{tr('Unit')}</th><th>{tr('Size')}</th><th>{tr('Floor')}</th><th>{tr('Price / mo')}</th><th>{tr('Status')}</th><th>{tr('Customer')}</th><th>{tr('Contract end')}</th></tr></thead>
                        <tbody>
                            {shown.map((u) => {
                                const c = contractOf[u.storageUnitId];
                                return (
                                    <tr key={u.storageUnitId} className={selected === u.storageUnitId ? 'active' : ''} onClick={() => setSelected(u.storageUnitId)}>
                                        <td className="strong">{u.unitCode}</td>
                                        <td>{u.unitTypeCode} · {u.areaM2} m²</td>
                                        <td>{u.floorName}{u.zone ? ` · ${u.zone}` : ''}</td>
                                        <td className="price">{formatVnd(sizePrice[u.unitTypeId])}</td>
                                        <td><Status value={u.status} /></td>
                                        <td>{c?.customerName ?? '—'}</td>
                                        <td>{c ? formatDate(c.endDate) : '—'}</td>
                                    </tr>
                                );
                            })}
                            <TableState query={units} rows={shown} cols={7} empty="No units match." />
                        </tbody>
                    </table>
                </div>
                {unit && (
                    <aside className="se-panel sa-side-panel">
                        <div className="sa-card-title"><h2>{tr('Unit')} {unit.unitCode} <Status value={unit.status} /></h2>
                            <button type="button" className="sa-close" onClick={() => setSelected(null)} aria-label={tr('Close')}><Icon name="arrowLeft" size={16} /></button></div>
                        <dl className="se-kv">
                            <div><dt>{tr('Size')}</dt><dd>{unit.unitTypeName} · {unit.areaM2} m²</dd></div>
                            <div><dt>{tr('Floor / zone')}</dt><dd>{unit.floorName}{unit.zone ? ` · ${unit.zone}` : ''}</dd></div>
                            <div><dt>{tr('Monthly price')}</dt><dd>{formatVnd(sizePrice[unit.unitTypeId])}<small className="sa-muted"> {tr('· set per size in Pricing & Policies')}</small></dd></div>
                            <div><dt>{tr('Customer')}</dt><dd>{contract?.customerName ?? '—'}</dd></div>
                            <div><dt>{tr('Contract')}</dt><dd>{contract ? `${contract.contractNumber} · ${tr(humanize(contract.status))}` : '—'}</dd></div>
                            {contract && <div><dt>{tr('Period')}</dt><dd>{formatDate(contract.startDate)} → {formatDate(contract.endDate)}</dd></div>}
                        </dl>
                        {canEdit && <UnitEditor key={unit.storageUnitId} unit={unit} />}
                    </aside>
                )}
            </div>
        </>
    );
}
