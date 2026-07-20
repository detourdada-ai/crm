import "server-only";
import { customersRepository } from "@/lib/repositories/customers.repository";
import { ordersRepository } from "@/lib/repositories/orders.repository";
import { duplicatesRepository } from "@/lib/repositories/duplicates.repository";
import { mergeHistoryRepository } from "@/lib/repositories/merge-history.repository";
import { changeLogRepository } from "@/lib/repositories/change-log.repository";
import type { SessionPayload } from "@/lib/auth/session";

export class MergeError extends Error {}

function assertCanActOn(ownerUsername: string, session: SessionPayload) {
  if (session.role !== "admin" && session.username !== ownerUsername) {
    throw new MergeError("이 항목을 처리할 권한이 없습니다.");
  }
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
 */
export async function mergeDuplicateCandidate(candidateId: string, session: SessionPayload) {
  const candidate = await duplicatesRepository.findById(candidateId);
  if (!candidate) throw new MergeError("동일인 후보를 찾을 수 없습니다.");
  if (candidate.status !== "pending") throw new MergeError("이미 처리된 후보입니다.");
  assertCanActOn(candidate.owner_username, session);

  const [existing, incoming] = await Promise.all([
    customersRepository.findById(candidate.existing_customer_id),
    customersRepository.findById(candidate.new_customer_id),
  ]);
  if (!existing || !incoming) throw new MergeError("고객 정보를 찾을 수 없습니다.");

  const ordersMoved = await ordersRepository.reassignCustomer(incoming.id, existing.id);

  await mergeHistoryRepository.create({
    duplicate_candidate_id: candidate.id,
    kept_customer_id: existing.id,
    removed_customer_id: incoming.id,
    orders_moved: ordersMoved,
    performed_by: session.username,
  });

  await changeLogRepository.create({
    customer_id: existing.id,
    entity: "customer_merge",
    field: "customer_code",
    old_value: incoming.customer_code,
    new_value: existing.customer_code,
    performed_by: session.username,
  });

  await customersRepository.update(incoming.id, { status: "merged", merged_into_id: existing.id });
  await duplicatesRepository.updateStatus(candidate.id, "merged");
  await duplicatesRepository.rejectOtherPendingReferencing(incoming.id, candidate.id);

  return { keptCustomerId: existing.id, removedCustomerId: incoming.id, ordersMoved };
}

export async function rejectDuplicateCandidate(candidateId: string, session: SessionPayload): Promise<void> {
  const candidate = await duplicatesRepository.findById(candidateId);
  if (!candidate) throw new MergeError("동일인 후보를 찾을 수 없습니다.");
  assertCanActOn(candidate.owner_username, session);
  await duplicatesRepository.updateStatus(candidateId, "rejected");
}

export async function holdDuplicateCandidate(candidateId: string, session: SessionPayload): Promise<void> {
  const candidate = await duplicatesRepository.findById(candidateId);
  if (!candidate) throw new MergeError("동일인 후보를 찾을 수 없습니다.");
  assertCanActOn(candidate.owner_username, session);
  await duplicatesRepository.updateStatus(candidateId, "held");
}
