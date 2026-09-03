import "server-only";
import { customersRepository } from "@/lib/repositories/customers.repository";
import { duplicatesRepository } from "@/lib/repositories/duplicates.repository";
import { mergeHistoryRepository } from "@/lib/repositories/merge-history.repository";
import type { SessionPayload } from "@/lib/auth/session";

export class MergeError extends Error {}

function assertCanActOn(ownerUsername: string, session: SessionPayload) {
  if (session.role !== "admin" && session.username !== ownerUsername) {
    throw new MergeError("이 항목을 처리할 권한이 없습니다.");
  }
}

/** merge_customers/unmerge_customers RPC(0052)가 raise exception으로 던지는 코드를 사용자 메시지로 옮긴다. */
function mapMergeRpcError(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  if (message.includes("candidate_not_found")) return "동일인 후보를 찾을 수 없습니다.";
  if (message.includes("candidate_not_pending")) return "이미 처리된 후보입니다.";
  if (message.includes("existing_customer_not_found") || message.includes("incoming_customer_not_found")) {
    return "고객 정보를 찾을 수 없습니다.";
  }
  if (message.includes("merge_history_not_found")) return "병합 이력을 찾을 수 없습니다.";
  if (message.includes("already_unmerged")) return "이미 취소된 병합입니다.";
  if (message.includes("legacy_merge_no_order_tracking")) {
    return "이전 병합 기록은 이동 주문 정보가 없어 자동으로 되돌릴 수 없습니다.";
  }
  return "처리 중 오류가 발생했습니다.";
}

/**
 * Approves a pending duplicate candidate: every order on the "new" customer
 * is repointed to the "existing" customer's id, and the merge is written to
 * merge_history for audit. This is the ONLY path that ever merges a customer
 * — nothing in the import pipeline does this automatically (see project
 * spec: "자동 병합 절대 금지").
 *
 * The "new" customer row is NEVER deleted (spec: "삭제 금지") — it's kept for
 * audit/history and marked status="merged" with merged_into_id pointing at
 * the survivor, then excluded from normal customer search/list/count.
 *
 * STEP12-15: 주문 재할당부터 후보/고객 상태 갱신까지 전부 merge_customers()
 * 단일 Postgres 함수 호출(자동으로 하나의 트랜잭션)로 실행한다 — 예전처럼
 * 여러 개의 독립 REST 호출로 나뉘어 있으면 중간 실패 시 반쪽 병합이 남을 수
 * 있었다. 이 함수가 이동한 주문 id 목록까지 merge_history에 함께 기록해야
 * 병합취소(unmergeCustomer)가 안전해진다.
 */
export async function mergeDuplicateCandidate(candidateId: string, session: SessionPayload) {
  const candidate = await duplicatesRepository.findById(candidateId);
  if (!candidate) throw new MergeError("동일인 후보를 찾을 수 없습니다.");
  if (candidate.status !== "pending") throw new MergeError("이미 처리된 후보입니다.");
  assertCanActOn(candidate.owner_username, session);

  try {
    const result = await mergeHistoryRepository.mergeCustomers(candidateId, session.username);
    return { keptCustomerId: result.kept_customer_id, removedCustomerId: result.removed_customer_id, ordersMoved: result.orders_moved };
  } catch (e) {
    throw new MergeError(mapMergeRpcError(e));
  }
}

/**
 * STEP12-15: 잘못 합친 고객을 되돌린다. moved_order_ids가 없는 과거 병합(이
 * 기능이 생기기 전에 실행된 병합)은 되돌릴 근거 데이터가 없으므로 명시적으로
 * 차단한다 — 추측으로 주문을 되돌리지 않는다. 연쇄 병합(A→B→C) 등으로 이미
 * 다른 곳으로 넘어간 주문은 unmerge_customers() RPC가 알아서 건너뛰고
 * 결과에 "일부만 복구됨"을 표시한다.
 */
export async function unmergeCustomer(mergeHistoryId: string, session: SessionPayload) {
  const history = await mergeHistoryRepository.findById(mergeHistoryId);
  if (!history) throw new MergeError("병합 이력을 찾을 수 없습니다.");

  const keptCustomer = await customersRepository.findById(history.kept_customer_id);
  if (!keptCustomer) throw new MergeError("고객 정보를 찾을 수 없습니다.");
  assertCanActOn(keptCustomer.owner_username, session);

  if (history.unmerged_at) throw new MergeError("이미 취소된 병합입니다.");
  if (!history.moved_order_ids) {
    throw new MergeError("이전 병합 기록은 이동 주문 정보가 없어 자동으로 되돌릴 수 없습니다.");
  }

  try {
    const result = await mergeHistoryRepository.unmergeCustomers(mergeHistoryId, session.username);
    return {
      keptCustomerId: result.kept_customer_id,
      removedCustomerId: result.removed_customer_id,
      ordersRestored: result.orders_restored,
      ordersSkipped: result.orders_skipped,
      ordersTotal: result.orders_total,
    };
  } catch (e) {
    throw new MergeError(mapMergeRpcError(e));
  }
}

export async function rejectDuplicateCandidate(candidateId: string, session: SessionPayload): Promise<void> {
  const candidate = await duplicatesRepository.findById(candidateId);
  if (!candidate) throw new MergeError("동일인 후보를 찾을 수 없습니다.");
  assertCanActOn(candidate.owner_username, session);
  await duplicatesRepository.updateStatus(candidateId, "rejected", session.role === "admin" ? undefined : session.username);
}

export async function holdDuplicateCandidate(candidateId: string, session: SessionPayload): Promise<void> {
  const candidate = await duplicatesRepository.findById(candidateId);
  if (!candidate) throw new MergeError("동일인 후보를 찾을 수 없습니다.");
  assertCanActOn(candidate.owner_username, session);
  await duplicatesRepository.updateStatus(candidateId, "held", session.role === "admin" ? undefined : session.username);
}
