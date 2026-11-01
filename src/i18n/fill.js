/**
 * Fills {name} holes: fill('Kho {code}', { code: 'A-101' }). {name:s} is the English plural ending of a count:
 * fill('{n} unit{n:s}', { n: 2 }) gives "2 units", and { n: 1 } gives "1 unit".
 */
export const fill = (text, vars) => (vars
    ? text.replace(/\{(\w+)(:s)?\}/g, (hole, name, plural) => {
        if (!(name in vars)) return hole;
        if (plural) return Number(vars[name]) === 1 ? '' : 's';
        return vars[name];
    })
    : text);
