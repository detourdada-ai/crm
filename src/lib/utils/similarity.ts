/**
 * Lightweight string similarity for duplicate-candidate name matching
 * (e.g. "김민지" vs "김민지 " typos, or family members "김민지"/"김민수").
 * No external dependency needed for short Korean names.
 */

export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);

  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }

  return prev[b.length];
}

/** Returns a 0-1 similarity score (1 = identical). */
export function stringSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshteinDistance(a, b) / maxLen;
}

/**
 * Heuristic for "similar name" used by duplicate detection CASE4/CASE5
 * (family members sharing an address, or minor typos on re-entry).
 * Same name (identical) is intentionally excluded here — callers should
 * check exact equality separately since it implies a different case.
 */
export function isSimilarButNotIdenticalName(a: string, b: string): boolean {
  const nameA = a.trim();
  const nameB = b.trim();
  if (!nameA || !nameB || nameA === nameB) return false;
  if (nameA.length < 2 || nameB.length < 2) return false;
  // Same family surname (first character) + short edit distance covers
  // typical Korean sibling/parent-child name variance ("김민지" vs "김민수").
  const sameSurname = nameA[0] === nameB[0];
  const distance = levenshteinDistance(nameA, nameB);
  return sameSurname && distance <= 1;
}
