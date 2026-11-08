/** An entry hint selects a screen only. Invitations retain their existing path. */
export function readEntryIntent(href) {
  try {
    const query = new URL(href).searchParams;
    if (query.has('room')) return null;
    const values = query.getAll('intent');
    return values.length === 1 && ['create', 'host', 'join'].includes(values[0]) ? values[0] : null;
  } catch { return null; }
}
