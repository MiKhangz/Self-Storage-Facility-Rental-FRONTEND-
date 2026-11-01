import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { portalOf } from '../api/axiosClient';
import EN from './en.js';
import VI from './vi.js';
import { fill } from './fill.js';

export { fill };

/**
 * Screens keep their text as written (Vietnamese on the customer site, English in the staff portal) and wrap it in
 * t(). In the other language t() looks it up in that language's dictionary; text not yet translated shows as written,
 * so a half-translated screen still works.
 */
const LanguageContext = createContext(null);
const KEY = 'storease.lang';

const stored = () => { try { return localStorage.getItem(KEY); } catch { return null; } };

export function LanguageProvider({ children }) {
    const [chosen, setChosen] = useState(stored);
    // Until someone picks, each side opens in the language it is written in.
    const lang = chosen ?? (portalOf(useLocation().pathname) === 'staff' ? 'en' : 'vi');
    // Before the children's effects, so the first requests already carry the language.
    useLayoutEffect(() => { document.documentElement.lang = lang; }, [lang]);
    const setLang = useCallback((next) => {
        setChosen(next);
        try { localStorage.setItem(KEY, next); } catch { /* private mode: the choice lasts for this visit */ }
    }, []);
    const value = useMemo(() => ({ lang, setLang }), [lang, setLang]);
    return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export const useLang = () => useContext(LanguageContext);

export function useT() {
    const { lang } = useLang();
    return useCallback((text, vars) => fill((lang === 'en' ? EN[text] : VI[text]) ?? text, vars), [lang]);
}

/** The VI | EN selector for both headers. */
export function LanguageSelect({ className = '' }) {
    const { lang, setLang } = useLang();
    return (
        <label className={`se-lang ${className}`}>
            <span className="sr-only">{lang === 'en' ? 'Language' : 'Ngôn ngữ'}</span>
            <select value={lang} onChange={(e) => setLang(e.target.value)}>
                <option value="vi">Tiếng Việt</option>
                <option value="en">English</option>
            </select>
        </label>
    );
}
