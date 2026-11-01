import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { maintenanceOrdersApi } from '../../api/generated';
import { errorMessage } from '../../api/axiosClient';
import { useAuth } from '../../features/auth/AuthContext';
import { Roles } from '../../features/auth/roles';
import Icon from '../../customer/components/Icon.jsx';
import { formatDate, formatVnd } from '../../customer/components/format.js';
import { Filters, PageHeader, SearchFilter, SelectFilter, Stat, Status, TableState, matches } from '../components/ui.jsx';
import { fetchAll, humanize, useFacilities, useUnits } from '../queries.js';
import { useT } from '../../i18n/I18n.jsx';

const STATUSES = ['Open', 'Scheduled', 'InProgress', 'Done', 'Cancelled'];
const LIVE = ['Open', 'Scheduled', 'InProgress'];
const toUtc = (local) => (local ? new Date(local).toISOString() : null);

function NewOrder({ onClose }) {
    const tr = useT();
    const queryClient = useQueryClient();
    // A unit a customer holds is worked on only from their support ticket (the API refuses it here).
    const units = (useUnits().data ?? []).filter((u) => ['Available', 'Maintenance'].includes(u.status));
    const facilityName = Object.fromEntries((useFacilities().data ?? []).map((f) => [f.facilityId, f.name]));
    const [form, setForm] = useState({ storageUnitId: '', description: '', scheduledAt: '' });
    const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
    const create = useMutation({
        mutationFn: () => maintenanceOrdersApi.create({
            storageUnitId: Number(form.storageUnitId), description: form.description.trim(), scheduledAt: toUtc(form.scheduledAt),
        }),
        onSuccess: () => { ['maintenance-orders', 'storage-units'].forEach((k) => queryClient.invalidateQueries({ queryKey: [k] })); onClose(); },
    });
    return (
        <form className="se-panel sa-side-panel" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
            <div className="sa-card-title"><h2>{tr('New maintenance order')}</h2><button type="button" className="sa-close" onClick={onClose} aria-label={tr('Close')}><Icon name="arrowLeft" size={16} /></button></div>
            <label><span className="se-label">{tr('Unit *')}</span><div className="se-field">
                <select value={form.storageUnitId} onChange={set('storageUnitId')} required>
                    <option value="">{tr('Choose a unit')}</option>
                    {units.map((u) => <option key={u.storageUnitId} value={u.storageUnitId}>{u.unitCode} · {facilityName[u.facilityId] ?? ''} · {tr(humanize(u.status))}</option>)}
                </select></div>
                <p className="se-hint">{tr('Only free units are listed. For a customer\'s unit, order the work from their support ticket.')}</p></label>
            <label><span className="se-label">{tr('What needs doing *')}</span><textarea className="se-textarea" rows={3} maxLength={300} value={form.description} onChange={set('description')} required /></label>
            <label><span className="se-label">{tr("Planned for (optional)")}</span><div className="se-input"><input type="datetime-local" value={form.scheduledAt} onChange={set('scheduledAt')} /></div></label>
            {create.isError && <div className="se-alert" role="alert">{errorMessage(create.error)}</div>}
            <button type="submit" className="se-btn se-btn-primary se-btn-block" disabled={create.isPending || !form.storageUnitId || !form.description.trim()}>{create.isPending ? tr('Creating…') : tr('Create order')}</button>
        </form>
    );
}

/** Moves one order on: Open/Scheduled → Scheduled or In progress → Done; any live order can be cancelled. */
function OrderPanel({ order, canWrite, onClose }) {
    const tr = useT();
    const queryClient = useQueryClient();
    const [scheduledAt, setScheduledAt] = useState('');
    const [cost, setCost] = useState('');
    const [workNote, setWorkNote] = useState(order.workNote ?? '');
    const move = useMutation({
        mutationFn: (status) => maintenanceOrdersApi.status(order.maintenanceOrderId, {
            status,
            scheduledAt: status === 'Scheduled' ? toUtc(scheduledAt) : null,
            cost: status === 'Done' ? Number(cost) : null,
            workNote: workNote.trim() || null,
        }),
        onSuccess: () => ['maintenance-orders', 'storage-units'].forEach((k) => queryClient.invalidateQueries({ queryKey: [k] })),
    });
    const waiting = ['Open', 'Scheduled'].includes(order.status);

    return (
        <aside className="se-panel sa-side-panel">
            <div className="sa-card-title"><h2>{tr('Unit')} {order.unitCode} <Status value={order.status} /></h2><button type="button" className="sa-close" onClick={onClose} aria-label={tr('Close')}><Icon name="arrowLeft" size={16} /></button></div>
            <p>{order.description}</p>
            <dl className="se-kv">
                <div><dt>{tr('Planned for')}</dt><dd>{order.scheduledAt ? formatDate(order.scheduledAt) : '—'}</dd></div>
                {order.ticketId && <div><dt>{tr('Support ticket')}</dt><dd>#{order.ticketId}</dd></div>}
                {order.completedAt && <div><dt>{tr('Completed')}</dt><dd>{formatDate(order.completedAt)}</dd></div>}
                {order.cost != null && <div><dt>{tr('Cost')}</dt><dd>{formatVnd(order.cost)}</dd></div>}
                {order.workNote && <div><dt>{tr('Work note')}</dt><dd>{order.workNote}</dd></div>}
            </dl>
            {canWrite && LIVE.includes(order.status) && (
                <>
                    {waiting && (
                        <>
                            <label><span className="se-label">{tr('Schedule for')}</span><div className="se-input"><input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} /></div></label>
                            <div className="sa-form-actions">
                                <button type="button" className="se-btn se-btn-ghost" disabled={!scheduledAt || move.isPending} onClick={() => move.mutate('Scheduled')}>{tr('Schedule')}</button>
                                <button type="button" className="se-btn se-btn-primary" disabled={move.isPending} onClick={() => move.mutate('InProgress')}>{tr('Start work')}</button>
                            </div>
                        </>
                    )}
                    {order.status === 'InProgress' && (
                        <>
                            <p className="se-hint">{tr('The unit is out of service until the work is done.')}</p>
                            <label><span className="se-label">{tr("Cost (₫) *")}</span><div className="se-input"><input type="number" min="0" value={cost} onChange={(e) => setCost(e.target.value)} /></div></label>
                            <label><span className="se-label">{tr('Work note *')}</span><textarea className="se-textarea" rows={3} maxLength={500} value={workNote} onChange={(e) => setWorkNote(e.target.value)} /></label>
                            <button type="button" className="se-btn se-btn-primary se-btn-block" disabled={cost === '' || !workNote.trim() || move.isPending} onClick={() => move.mutate('Done')}>{tr('Mark done')}</button>
                        </>
                    )}
                    {move.isError && <div className="se-alert" role="alert">{errorMessage(move.error)}</div>}
                    <button type="button" className="se-btn se-btn-ghost se-btn-block" disabled={move.isPending}
                        onClick={() => window.confirm(tr('Cancel this maintenance order?')) && move.mutate('Cancelled')}>{tr('Cancel order')}</button>
                </>
            )}
        </aside>
    );
}

/** TH-05: repairs and cleaning that take a unit out of service. Facility staff and managers act; ops and admin read. */
export default function MaintenancePage() {
    const tr = useT();
    const [search, setSearch] = useState('');
    const [status, setStatus] = useState('');
    const [selected, setSelected] = useState(null);
    const [creating, setCreating] = useState(false);
    const canWrite = [Roles.FacilityStaff, Roles.FacilityManager].includes(useAuth().session?.role);
    const orders = useQuery({
        queryKey: ['maintenance-orders', { status }],
        queryFn: () => fetchAll(maintenanceOrdersApi.list, { status: status || undefined }),
    });
    const all = orders.data ?? [];
    const shown = all.filter((o) => matches(search, o.unitCode, o.description, o.workNote));
    const current = all.find((o) => o.maintenanceOrderId === selected);

    return (
        <>
            <PageHeader title={tr('Maintenance')} subtitle="Repairs and cleaning that take a unit out of service">
                {canWrite && <button type="button" className="se-btn se-btn-primary" onClick={() => { setCreating(true); setSelected(null); }}><Icon name="box" size={16} /> {tr('New order')}</button>}
            </PageHeader>
            <div className="sa-stats">
                <Stat icon="clock" label="Open or scheduled" value={all.filter((o) => ['Open', 'Scheduled'].includes(o.status)).length} />
                <Stat icon="shield" tone="warn" label="In progress" value={all.filter((o) => o.status === 'InProgress').length} />
                <Stat icon="check" label="Done" value={all.filter((o) => o.status === 'Done').length} />
            </div>
            <Filters>
                <SearchFilter value={search} onChange={setSearch} placeholder={tr('Search unit or description')} />
                <SelectFilter label="Status" value={status} onChange={setStatus} all="All statuses" options={STATUSES.map((s) => ({ value: s, label: humanize(s) }))} />
            </Filters>
            <div className={`sa-split${current || creating ? ' open' : ''}`}>
                <div className="se-card se-table-wrap">
                    <table className="se-table sa-table">
                        <thead><tr><th>{tr('Unit')}</th><th>{tr('Description')}</th><th>{tr('Planned')}</th><th>{tr('Cost')}</th><th>{tr('Status')}</th></tr></thead>
                        <tbody>
                            {shown.map((o) => (
                                <tr key={o.maintenanceOrderId} className={selected === o.maintenanceOrderId ? 'active' : ''} onClick={() => { setSelected(o.maintenanceOrderId); setCreating(false); }}>
                                    <td className="strong">{o.unitCode}</td>
                                    <td>{o.description}</td>
                                    <td>{o.scheduledAt ? formatDate(o.scheduledAt) : '—'}</td>
                                    <td>{o.cost != null ? formatVnd(o.cost) : '—'}</td>
                                    <td><Status value={o.status} /></td>
                                </tr>
                            ))}
                            <TableState query={orders} rows={shown} cols={5} empty="No maintenance orders." />
                        </tbody>
                    </table>
                </div>
                {creating && <NewOrder onClose={() => setCreating(false)} />}
                {current && !creating && <OrderPanel key={`${current.maintenanceOrderId}-${current.status}`} order={current} canWrite={canWrite} onClose={() => setSelected(null)} />}
            </div>
        </>
    );
}
