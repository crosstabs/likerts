/** Selected option IDs have the same meaning across legacy and structured answers. */
export function selectedChoices(value) {
    if (typeof value === 'string')
        return value ? [value] : [];
    if (Array.isArray(value))
        return value.filter((v) => typeof v === 'string');
    if (value && typeof value === 'object' && 'selected' in value && Array.isArray(value.selected))
        return value.selected.filter((v) => typeof v === 'string');
    return [];
}
export function otherTexts(value) {
    if (!value || typeof value !== 'object' || !('otherText' in value) || !value.otherText || typeof value.otherText !== 'object' || Array.isArray(value.otherText))
        return {};
    return Object.fromEntries(Object.entries(value.otherText).filter((entry) => typeof entry[1] === 'string'));
}
export function choiceAnswer(q, selected, text = {}) {
    if (q.options?.some(o => o.other !== undefined))
        return { selected: [...selected], otherText: Object.fromEntries((q.options ?? []).filter(o => o.other !== undefined && selected.includes(o.id)).map(o => [o.id, text[o.id] ?? ''])) };
    return q.type === 'single_choice' ? selected[0] ?? '' : [...selected];
}
export function toggleChoice(q, value, id) {
    const option = q.options?.find(o => o.id === id);
    if (!option)
        throw new TypeError('Unknown choice');
    const current = selectedChoices(value);
    const selected = q.type === 'single_choice' ? [id] : current.includes(id) ? current.filter(v => v !== id) : option.exclusive ? [id] : [...current.filter(v => !q.options?.find(o => o.id === v)?.exclusive), id];
    return choiceAnswer(q, selected, otherTexts(value));
}
export function setOtherText(q, value, id, text) {
    return choiceAnswer(q, selectedChoices(value), { ...otherTexts(value), [id]: text });
}
/** Local feedback only; the server validates every accepted answer again. */
export function choiceError(q, value) {
    if (value === undefined || value === '')
        return q.required ? 'required' : undefined;
    const hasOther = q.options?.some(o => o.other !== undefined);
    if (hasOther) {
        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 2 || !('selected' in value) || !Array.isArray(value.selected) || !value.selected.every(v => typeof v === 'string') || !('otherText' in value) || !value.otherText || typeof value.otherText !== 'object' || Array.isArray(value.otherText))
            return 'invalid';
    }
    else if (q.type === 'single_choice' ? typeof value !== 'string' : !Array.isArray(value) || !value.every(v => typeof v === 'string'))
        return 'invalid';
    const selected = selectedChoices(value);
    if (new Set(selected).size !== selected.length || selected.some(id => !q.options?.some(o => o.id === id)))
        return 'invalid';
    const exclusive = selected.some(id => q.options?.some(o => o.id === id && o.exclusive));
    if (exclusive && selected.length !== 1)
        return 'invalid';
    if (q.type === 'single_choice' ? selected.length !== 1 : selected.length > (q.maxSelections ?? q.options?.length ?? 0) || (!exclusive && selected.length < Math.max(q.required ? 1 : 0, q.minSelections ?? 0)))
        return 'range';
    if (hasOther) {
        const text = otherTexts(value), expected = (q.options ?? []).filter(o => o.other !== undefined && selected.includes(o.id));
        if (Object.keys(value.otherText).length !== expected.length)
            return 'other';
        if (expected.some(o => typeof text[o.id] !== 'string' || !text[o.id].trim() || Array.from(text[o.id]).length > o.other.maxLength))
            return 'other';
    }
    return undefined;
}
