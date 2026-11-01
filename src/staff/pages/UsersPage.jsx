import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { staffApi } from '../../api/generated';
import { errorMessage } from '../../api/axiosClient';
import { useAuth } from '../../features/auth/AuthContext';
import { Roles } from '../../features/auth/roles';
import Icon from '../../customer/components/Icon.jsx';
import { formatDate } from '../../customer/components/format.js';
import { initials } from '../../customer/layout/CustomerLayout.jsx';
import { Filters, Modal, PageHeader, SearchFilter, SelectFilter, Status, TableState, matches } from '../components/ui.jsx';
import { PERMISSIONS, ROLE_INFO } from '../permissions.js';
import { humanize, useStaff } from '../queries.js';
import { FacilityPicker } from '../components/FacilityPicker.jsx';
import { useT } from '../../i18n/I18n.jsx';

const STATUSES = ['Active', 'Disabled'];

export function PermissionMatrix({ highlight, search = '' }) {
    const tr = useT();
    const rows = PERMISSIONS.filter((p) => matches(search, tr(p.feature), tr(p.group)));
    return (
        <div className="se-table-wrap">
            <table className="se-table sa-matrix">
                <thead><tr><th>{tr('Feature')}</th>{ROLE_INFO.map((r) => <th key={r.role} className={highlight === r.role ? 'hl' : ''} title={r.title}>{r.short}</th>)}</tr></thead>
                <tbody>
                    {rows.map((p) => (
                        <tr key={p.feature}>
                            <td>{tr(p.feature)}</td>
                            {ROLE_INFO.map((r) => (
                                <td key={r.role} className={highlight === r.role ? 'hl' : ''}>
                                    {p.roles.includes(r.role) ? <span className="sa-yes" aria-label={tr('Allowed')}><Icon name="check" size={12} /></span> : <span className="sa-no" aria-label={tr('Not allowed')} />}
                                </td>
                            ))}
                        </tr>
                    ))}
                    {!rows.length && <tr><td colSpan={ROLE_INFO.length + 1} className="sa-muted">{tr('No feature matches “{search}”.', { search })}</td></tr>}
                </tbody>
            </table>
        </div>
    );
}

/** The roles and what each may do, opened from a help button so the users table keeps the full width. */
function PermissionHelp({ onClose }) {
    const tr = useT();
    const [search, setSearch] = useState('');
    return (
        <Modal onClose={onClose}>
        <section className="se-panel sa-dialog" aria-labelledby="perm-help-title">
            <div className="sa-card-title"><h2 id="perm-help-title">{tr('Who can do what?')}</h2>
                <button type="button" className="sa-close" onClick={onClose} aria-label={tr('Close')}>×</button></div>
            <dl className="se-kv sa-role-legend">
                {ROLE_INFO.map((r) => <div key={r.role}><dt><span className="se-badge info">{r.short}</span> {tr(r.title)}</dt><dd>{tr(r.text)}</dd></div>)}
            </dl>
            <label><span className="se-label">{tr('Find a feature')}</span>
                <div className="se-input"><Icon name="search" size={16} /><input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tr('e.g. refund, handover, pricing')} /></div></label>
            <PermissionMatrix search={search} />
            <p className="sa-muted">{tr('Enforced by the API: a role without a tick gets “not allowed” even if it finds the screen.')}</p>
        </section>
        </Modal>
    );
}

/** `managed` is null for an admin; for a facility manager, the facility ids they may add or remove. */
function EditUser({ user, managed, onClose }) {
    const tr = useT();
    const queryClient = useQueryClient();
    // The API refuses to let an admin lock or demote themselves (nobody could undo it), so don't offer it.
    const self = useAuth().session?.userId === user.userId;
    const isManager = managed !== null;
    const [form, setForm] = useState({ fullName: user.fullName ?? '', phoneNumber: user.phoneNumber ?? '', role: user.role, status: user.status });
    const [facilityIds, setFacilityIds] = useState((user.facilities ?? []).map((f) => f.facilityId));
    const save = useMutation({
        mutationFn: async () => {
            // Managers may only change facility assignments; account details stay with the admin.
            if (!isManager) await staffApi.update(user.userId, form);
            await staffApi.facilities(user.userId, { facilityIds });
        },
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['staff'] }); onClose(); },
    });

    return (
        <aside className="se-panel sa-side-panel">
            <div className="sa-card-title"><h2>{tr('Edit {name}', { name: user.fullName })}</h2><button type="button" className="sa-close" onClick={onClose} aria-label={tr('Close')}><Icon name="arrowLeft" size={16} /></button></div>
            <p className="sa-muted">{user.email}</p>
            {isManager ? (
                <p className="se-hint">{self ? tr('Only a system administrator can change your own facilities.') : tr('You can add or remove the facilities you manage.')}</p>
            ) : (<>
            <label><span className="se-label">{tr('Full name')}</span><div className="se-input"><input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></div></label>
            <label><span className="se-label">{tr('Phone')}</span><div className="se-input"><input value={form.phoneNumber} onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })} /></div></label>
            <label><span className="se-label">{tr('Role')}</span>
                <div className="se-field"><select value={form.role} disabled={self} onChange={(e) => setForm({ ...form, role: e.target.value })}>{ROLE_INFO.map((r) => <option key={r.role} value={r.role}>{tr(r.title)}</option>)}</select></div></label>
            <label><span className="se-label">{tr('Status')}</span>
                <div className="se-field"><select value={form.status} disabled={self} onChange={(e) => setForm({ ...form, status: e.target.value })}>{STATUSES.map((s) => <option key={s} value={s}>{tr(s)}</option>)}</select></div>
                <p className="se-hint">{self ? tr('You cannot change your own role or status.') : tr('Disabled accounts cannot sign in or be assigned work.')}</p></label>
            </>)}
            <FacilityPicker value={facilityIds} onChange={setFacilityIds} canChange={(id) => !isManager || (!self && managed.includes(id))} />
            {save.isError && <div className="se-alert" role="alert">{errorMessage(save.error)}</div>}
            <button type="button" className="se-btn se-btn-primary se-btn-block" disabled={save.isPending || !form.fullName.trim() || (isManager && self)} onClick={() => save.mutate()}>{save.isPending ? tr('Saving…') : tr('Save changes')}</button>
        </aside>
    );
}

/** A10: staff accounts, their roles and facilities, plus what each role may do. */
export default function UsersPage() {
    const tr = useT();
    const { session } = useAuth();
    const isAdmin = session?.role === Roles.SystemAdministrator;
    const [search, setSearch] = useState('');
    const [role, setRole] = useState('');
    const [selected, setSelected] = useState(null);
    const [help, setHelp] = useState(false);
    const staff = useStaff();
    const all = staff.data ?? [];
    const shown = all.filter((u) => (!role || u.role === role) && matches(search, u.fullName, u.email));
    const current = all.find((u) => u.userId === selected);
    // A facility manager's list includes their own account, which says which facilities they manage.
    const managed = isAdmin ? null : (all.find((u) => u.userId === session?.userId)?.facilities ?? []).map((f) => f.facilityId);

    return (
        <>
            <PageHeader title={tr('Users & roles')} subtitle={isAdmin ? tr('Manage staff accounts, assign roles and control access by facility') : tr('Assign facility staff to the facilities you manage')}>
                <button type="button" className="se-btn se-btn-ghost" onClick={() => setHelp(true)}><Icon name="shield" size={16} /> {tr('Who can do what?')}</button>
                {isAdmin && <Link to="/admin/users/invite" className="se-btn se-btn-primary"><Icon name="shield" size={16} /> {tr('Add user')}</Link>}
            </PageHeader>
            <Filters>
                <SearchFilter value={search} onChange={setSearch} placeholder={tr('Search name or email')} />
                <SelectFilter label="Role" value={role} onChange={setRole} all="All roles" options={ROLE_INFO.map((r) => ({ value: r.role, label: r.title }))} />
            </Filters>
            {help && <PermissionHelp onClose={() => setHelp(false)} />}
            <div className={`sa-split${current ? ' open' : ''}`}>
                <div className="se-card se-table-wrap">
                    <table className="se-table sa-table">
                        <thead><tr><th>{tr('User')}</th><th>{tr('Role')}</th><th>{tr('Facilities')}</th><th>{tr('Status')}</th><th>{tr('Created')}</th></tr></thead>
                        <tbody>
                            {shown.map((u) => (
                                <tr key={u.userId} className={selected === u.userId ? 'active' : ''} onClick={() => setSelected(u.userId)}>
                                    <td><span className="sa-person"><span className="se-avatar">{initials(u.fullName)}</span><span><strong>{u.fullName}</strong><div className="sa-muted">{u.email}</div></span></span></td>
                                    <td><span className="se-badge info">{tr(humanize(u.role))}</span></td>
                                    <td>{u.facilities?.map((f) => f.facilityName ?? f.facilityId).join(', ') || '—'}</td>
                                    <td><Status value={u.status} /></td>
                                    <td>{formatDate(u.createdAt)}</td>
                                </tr>
                            ))}
                            <TableState query={staff} rows={shown} cols={5} empty="No staff accounts match." />
                        </tbody>
                    </table>
                </div>
                {current && <EditUser key={current.userId} user={current} managed={managed} onClose={() => setSelected(null)} />}
            </div>
        </>
    );
}
