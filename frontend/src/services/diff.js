/**
 * Find longest common substring between oldText and newText
 * within the given ranges. Recursive diff engine.
 */
function findLCSubstr(oldText, newText, oStart, oEnd, nStart, nEnd) {
  const oLen = oEnd - oStart;
  const nLen = nEnd - nStart;
  let maxLen = 0, maxO = oStart, maxN = nStart;

  const dp = Array.from({ length: oLen + 1 }, () => new Uint16Array(nLen + 1));
  for (let i = 1; i <= oLen; i++) {
    const row = dp[i];
    const prevRow = dp[i - 1];
    const oChar = oldText[oStart + i - 1];
    for (let j = 1; j <= nLen; j++) {
      if (oChar === newText[nStart + j - 1]) {
        row[j] = prevRow[j - 1] + 1;
        if (row[j] > maxLen) {
          maxLen = row[j];
          maxO = oStart + i - maxLen;
          maxN = nStart + j - maxLen;
        }
      }
    }
  }
  return maxLen > 0 ? { oIdx: maxO, nIdx: maxN, length: maxLen } : null;
}

/**
 * Recursively extract changes using LCSubstr.
 */
function extractChanges(oldText, newText, oStart, oEnd, nStart, nEnd) {
  const oLen = oEnd - oStart;
  const nLen = nEnd - nStart;
  if (oLen === 0 && nLen === 0) return [];
  if (oLen === 0) return [{ oldStart: oStart, oldEnd: oStart, newStart: nStart, newEnd: nEnd }];
  if (nLen === 0) return [{ oldStart: oStart, oldEnd: oEnd, newStart: nStart, newEnd: nStart }];

  const match = findLCSubstr(oldText, newText, oStart, oEnd, nStart, nEnd);
  if (!match || match.length === 0) {
    return [{ oldStart: oStart, oldEnd: oEnd, newStart: nStart, newEnd: nEnd }];
  }

  const before = extractChanges(oldText, newText, oStart, match.oIdx, nStart, match.nIdx);
  const after = extractChanges(oldText, newText, match.oIdx + match.length, oEnd, match.nIdx + match.length, nEnd);
  return [...before, ...after];
}

/**
 * Compute multi-segment diff between oldText and newText.
 * Uses recursive longest-common-substring algorithm.
 * Returns array of change segments {oldStart, oldEnd, newStart, newEnd}
 * sorted by oldStart ascending.
 * Empty array when texts are identical.
 */
/**
 * Merge adjacent changes separated by ≤1 common character.
 * LCSubstr can split what is semantically one edit due to
 * coincidental character matches (e.g. "world"→"there"
 * shares 'r' in the middle). Merging fixes this.
 */
function mergeChanges(changes) {
  if (changes.length < 2) return changes;
  const merged = [changes[0]];
  for (let i = 1; i < changes.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = changes[i];
    const gapOld = curr.oldStart - prev.oldEnd;
    const gapNew = curr.newStart - prev.newEnd;
    const prevHasContent = prev.oldEnd > prev.oldStart && prev.newEnd > prev.newStart;
    const currHasContent = curr.oldEnd > curr.oldStart && curr.newEnd > curr.newStart;
    if (gapOld <= 1 && gapNew <= 1 && prevHasContent && currHasContent) {
      merged[merged.length - 1] = {
        oldStart: prev.oldStart, oldEnd: curr.oldEnd,
        newStart: prev.newStart, newEnd: curr.newEnd,
      };
    } else {
      merged.push(curr);
    }
  }
  return merged;
}

export function multiDiff(oldText, newText) {
  if (oldText === newText) return [];
  const raw = extractChanges(oldText, newText, 0, oldText.length, 0, newText.length);
  return mergeChanges(raw);
}

/**
 * S1: Map entities through changes.
 * Entities entirely outside all changes → offset-shifted (kept).
 * Entities intersecting any change → cancelled.
 */
export function mapEntities(entities, changes) {
  const kept = [];
  const cancelled = [];

  for (const entity of entities) {
    let cumulativeDelta = 0;
    let intersects = false;

    for (const ch of changes) {
      if (entity.end <= ch.oldStart) break;
      if (entity.start >= ch.oldEnd) {
        cumulativeDelta += (ch.newEnd - ch.newStart) - (ch.oldEnd - ch.oldStart);
      } else {
        intersects = true;
        break;
      }
    }

    if (intersects) {
      cancelled.push(entity);
    } else {
      kept.push({ ...entity, start: entity.start + cumulativeDelta, end: entity.end + cumulativeDelta });
    }
  }

  return { kept, cancelled };
}

/**
 * S2: Detect ambiguous entities among cancelled list.
 * Entity text appears in newText exactly once → remap.
 * Multiple times → mark needsReselect.
 * Not found → stay cancelled (not returned).
 */
export function detectAmbiguous(cancelled, newText) {
  const remapped = [];
  const needsReselect = [];

  for (const entity of cancelled) {
    const text = entity.original;
    if (!text) continue;

    const positions = [];
    let p = -1;
    while ((p = newText.indexOf(text, p + 1)) !== -1) {
      positions.push(p);
    }

    if (positions.length === 1) {
      remapped.push({ ...entity, start: positions[0], end: positions[0] + text.length });
    } else if (positions.length > 1) {
      needsReselect.push({ ...entity });
    }
  }

  return { remapped, needsReselect };
}

/**
 * S3: Project entities from oldText positions onto draftText for
 * real-time highlight recalculation during editing.
 */
export function projectEntities(entities, oldText, draftText) {
  if (!entities || !entities.length) return [];
  if (oldText === draftText) return entities;
  const changes = multiDiff(oldText, draftText);
  const { kept } = mapEntities(entities, changes);
  return kept;
}
