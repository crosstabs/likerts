export const rankingOrder = (question, answer) => Array.isArray(answer) ? answer.filter((id) => typeof id === 'string') : (question.options ?? []).map(option => option.id);
export function moveRanking(question, answer, id, offset) { const order = rankingOrder(question, answer); const from = order.indexOf(id); if (from < 0)
    return order; const to = Math.max(0, Math.min(order.length - 1, from + offset)); const next = [...order]; next.splice(from, 1); next.splice(to, 0, id); return next; }
export function setMatrixChoice(question, answer, rowId, columnId) { const current = answer && typeof answer === 'object' && !Array.isArray(answer) ? answer : {}; if (question.matrixMode === 'single')
    return { ...current, [rowId]: columnId }; const selected = Array.isArray(current[rowId]) ? current[rowId] : []; const next = selected.includes(columnId) ? selected.filter(id => id !== columnId) : [...selected, columnId]; const result = { ...current }; if (next.length)
    result[rowId] = next;
else
    delete result[rowId]; return result; }
export function setAllocation(answer, itemId, value) { const current = answer && typeof answer === 'object' && !Array.isArray(answer) ? answer : {}; return { ...current, [itemId]: value }; }
export function allocationRemaining(question, answer) { const values = answer && typeof answer === 'object' && !Array.isArray(answer) ? Object.values(answer) : []; return (question.total ?? 0) - values.reduce((sum, value) => sum + (Number.isSafeInteger(value) ? value : 0), 0); }
export function advancedAnswerError(question, answer) {
    if (answer === undefined)
        return question.required ? 'required' : undefined;
    if (question.type === 'ranking') {
        const values = Array.isArray(answer) ? answer : [];
        const ids = (question.options ?? []).map(item => item.id);
        return values.length === ids.length && new Set(values).size === values.length && values.every(id => ids.includes(id)) ? undefined : 'ranking';
    }
    if (!answer || typeof answer !== 'object' || Array.isArray(answer))
        return question.type === 'matrix' ? 'matrix' : 'constant_sum';
    const values = answer;
    if (question.type === 'matrix') {
        const rows = (question.rows ?? []).map(item => item.id), columns = (question.columns ?? []).map(item => item.id), entries = Object.entries(values);
        if (!entries.length || question.required && entries.length !== rows.length || entries.some(([row]) => !rows.includes(row)))
            return 'matrix';
        const valid = entries.every(([, value]) => question.matrixMode === 'single' ? typeof value === 'string' && columns.includes(value) : Array.isArray(value) && value.length > 0 && new Set(value).size === value.length && value.every(id => typeof id === 'string' && columns.includes(id)));
        return valid ? undefined : 'matrix';
    }
    const items = (question.items ?? []).map(item => item.id), entries = Object.entries(values);
    return entries.length === items.length && entries.every(([id, value]) => items.includes(id) && Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= (question.total ?? 0)) && allocationRemaining(question, values) === 0 ? undefined : 'constant_sum';
}
