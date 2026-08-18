/** group_no(1,2,3...)를 "그룹 A/B/C..." 표기로 변환한다. */
export function groupLabel(groupNo: number): string {
  if (groupNo >= 1 && groupNo <= 26) return `그룹 ${String.fromCharCode(64 + groupNo)}`;
  return `그룹 ${groupNo}`;
}
