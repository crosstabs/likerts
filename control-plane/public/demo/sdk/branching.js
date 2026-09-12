import { conditionMatches, visibleAnswers } from './index.js';
const effectivePages = (schema) => schema.pages ?? [{ id: 'survey', questionIds: schema.questions.map(q => q.id) }];
export function pageRoute(schema, answers) {
    const pages = effectivePages(schema), byId = new Map(pages.map((page, index) => [page.id, index]));
    const visible = visibleAnswers(schema.questions, answers);
    const available = new Set();
    const route = [];
    let current = 0;
    while (current < pages.length) {
        route.push(current);
        pages[current].questionIds.forEach(id => available.add(id));
        const branch = pages[current].branches?.find(item => conditionMatches(item.when, available.has(item.when.questionId) ? visible[item.when.questionId] : undefined));
        current = branch ? byId.get(branch.goToPageId) ?? pages.length : current + 1;
    }
    return route;
}
export function routedAnswers(schema, answers) {
    let result = visibleAnswers(schema.questions, answers);
    const pages = effectivePages(schema);
    for (let pass = 0; pass <= schema.questions.length; pass++) {
        const reached = new Set(pageRoute(schema, result).flatMap(index => pages[index].questionIds));
        const filtered = visibleAnswers(schema.questions, Object.fromEntries(Object.entries(result).filter(([id]) => reached.has(id))));
        if (Object.keys(filtered).length === Object.keys(result).length)
            return filtered;
        result = filtered;
    }
    throw new Error('Survey route did not stabilize');
}
export class SurveyFlow {
    schema;
    route;
    history;
    current;
    values;
    constructor(schema, initial = {}) {
        this.schema = schema;
        this.values = routedAnswers(schema, { ...initial });
        this.route = pageRoute(schema, this.values);
        this.current = this.route[0] ?? 0;
        this.history = [this.current];
    }
    get page() { return effectivePages(this.schema)[this.current]; }
    get answers() { return { ...this.values }; }
    get progress() { return { current: this.current + 1, total: effectivePages(this.schema).length, visited: this.history.length }; }
    setAnswer(id, value) { const old = this.history; if (value === undefined)
        delete this.values[id];
    else
        this.values[id] = value; this.values = routedAnswers(this.schema, this.values); this.route = pageRoute(this.schema, this.values); if (!this.route.includes(this.current)) {
        let shared = this.route[0] ?? 0;
        for (let i = 0; i < Math.min(old.length, this.route.length) && old[i] === this.route[i]; i++)
            shared = this.route[i];
        this.current = shared;
    } this.history = this.route.slice(0, this.route.indexOf(this.current) + 1); }
    next() { const at = this.route.indexOf(this.current); if (at < 0 || at + 1 >= this.route.length)
        return false; this.current = this.route[at + 1]; this.history = this.route.slice(0, at + 2); return true; }
    back() { if (this.history.length < 2)
        return false; this.history.pop(); this.current = this.history[this.history.length - 1]; return true; }
}
