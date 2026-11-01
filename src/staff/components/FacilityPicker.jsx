import { useState } from 'react';
import Icon from '../../customer/components/Icon.jsx';
import { Roles } from '../../features/auth/roles';
import { useFacilities, useStaff } from '../queries.js';
import { matches, Modal } from './ui.jsx';
import { useT } from '../../i18n/I18n.jsx';

const FACILITY_ROLES = [Roles.FacilityStaff, Roles.FacilityManager];

/**
 * The facilities a staff account works at: chips on the form, picked in a searchable pop-up. `canChange(id)` locks
 * facilities the person editing may not add or remove (a manager edits only the facilities they manage).
 */
export function FacilityPicker({ value, onChange, canChange = () => true, label = 'Assigned facilities' }) {
    const tr = useT();
    const facilities = useFacilities().data ?? [];
    const staff = useStaff().data ?? [];
    const [draft, setDraft] = useState(null);
    const [search, setSearch] = useState('');
    const nameOf = Object.fromEntries(facilities.map((f) => [f.facilityId, f.name]));
    // How many active facility staff and managers work at each site, so it is clear where people are needed.
    const headCount = (id) => staff.filter((u) => u.status === 'Active' && FACILITY_ROLES.includes(u.role)
        && u.facilities?.some((f) => f.facilityId === id)).length;
    const shown = facilities.filter((f) => matches(search, f.name, f.address, f.district));
    const toggle = (id) => setDraft(draft.includes(id) ? draft.filter((x) => x !== id) : [...draft, id]);
    const close = () => { setDraft(null); setSearch(''); };

    return (
        <div className="sa-facility-picker">
            <span className="se-label">{tr(label)}</span>
            <div className="sa-chips">
                {value.map((id) => (
                    <span key={id} className="sa-chip">{nameOf[id] ?? `Facility ${id}`}
                        {canChange(id) && <button type="button" aria-label={`${tr('Remove')} ${nameOf[id] ?? id}`} onClick={() => onChange(value.filter((x) => x !== id))}>×</button>}
                    </span>
                ))}
                {!value.length && <span className="sa-muted">{tr('No facility chosen yet.')}</span>}
            </div>
            <button type="button" className="se-btn se-btn-ghost se-btn-sm" onClick={() => setDraft(value)}><Icon name="building" size={14} /> {tr('Choose facilities')}</button>

            {draft && (
                <Modal onClose={close}>
                    <section className="se-panel sa-dialog" aria-labelledby="facility-picker-title">
                        <div className="sa-card-title"><h2 id="facility-picker-title">{tr('Choose facilities')}</h2>
                            <button type="button" className="sa-close" onClick={close} aria-label={tr('Close')}>×</button></div>
                        <label><span className="se-label">{tr('Search by name')}</span>
                            <div className="se-input"><Icon name="search" size={16} />
                                <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tr('Facility name, address or district')} /></div></label>
                        <ul className="sa-facility-list">
                            {shown.map((f) => {
                                const count = headCount(f.facilityId);
                                const locked = !canChange(f.facilityId);
                                return (
                                    <li key={f.facilityId}>
                                        <label className={`se-check${locked ? ' locked' : ''}`}>
                                            <input type="checkbox" checked={draft.includes(f.facilityId)} disabled={locked} onChange={() => toggle(f.facilityId)} />
                                            <span><strong>{f.name}</strong><small>{f.address}{f.district ? `, ${f.district}` : ''}</small></span>
                                        </label>
                                        <span className={`se-badge ${count ? 'info' : 'none'}`}>{count ? `${count} staff` : tr('No staff yet')}</span>
                                    </li>
                                );
                            })}
                            {!shown.length && <li className="sa-muted">No facility matches “{search}”.</li>}
                        </ul>
                        <div className="sa-form-actions">
                            <span className="sa-muted">{tr('{n} selected', { n: draft.length })}</span>
                            <button type="button" className="se-btn se-btn-ghost" onClick={() => setDraft(draft.filter((id) => !canChange(id)))}>{tr('Clear')}</button>
                            <button type="button" className="se-btn se-btn-primary" onClick={() => { onChange(draft); close(); }}>{tr('Done')}</button>
                        </div>
                    </section>
                </Modal>
            )}
        </div>
    );
}
