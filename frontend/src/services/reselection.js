export function choosePendingReselect(pending, selectedId, selectedText) {
  if (selectedId) {
    const target = pending.find((item) => item.id === selectedId);
    return target ? { status: 'resolve', target } : { status: 'none', target: null };
  }

  const matches = pending.filter((item) => item.original === selectedText);
  if (matches.length === 1) return { status: 'resolve', target: matches[0] };
  if (matches.length > 1) return { status: 'ambiguous', target: null };
  return { status: 'none', target: null };
}
