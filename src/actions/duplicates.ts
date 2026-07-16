"use server";

import { revalidatePath } from "next/cache";
import { duplicatesRepository } from "@/lib/repositories/duplicates.repository";
import { customersRepository } from "@/lib/repositories/customers.repository";
import { ordersRepository } from "@/lib/repositories/orders.repository";
import {
  MergeError,
  holdDuplicateCandidate,
  mergeDuplicateCandidate,
  rejectDuplicateCandidate,
} from "@/lib/services/merge.service";
import type { Customer, CustomerStats, DuplicateCandidate } from "@/types/domain";

export interface DuplicateCandidateView {
  candidate: DuplicateCandidate;
  existingCustomer: Customer;
  newCustomer: Customer;
  existingStats: CustomerStats;
  newStats: CustomerStats;
}

export async function listPendingDuplicatesAction(): Promise<DuplicateCandidateView[]> {
  const candidates = await duplicatesRepository.listByStatus("pending");
  if (candidates.length === 0) return [];

  const ids = Array.from(new Set(candidates.flatMap((c) => [c.existing_customer_id, c.new_customer_id])));
  const customers = await customersRepository.findByIds(ids);
  const byId = new Map(customers.map((c) => [c.id, c]));

  const views: DuplicateCandidateView[] = [];
  for (const candidate of candidates) {
    const existingCustomer = byId.get(candidate.existing_customer_id);
    const newCustomer = byId.get(candidate.new_customer_id);
    if (!existingCustomer || !newCustomer) continue;
    const [existingStats, newStats] = await Promise.all([
      ordersRepository.aggregateStatsByCustomer(existingCustomer.id),
      ordersRepository.aggregateStatsByCustomer(newCustomer.id),
    ]);
    views.push({ candidate, existingCustomer, newCustomer, existingStats, newStats });
  }
  return views;
}

export interface DuplicateActionResult {
  ok: boolean;
  error?: string;
}

export async function mergeDuplicateAction(candidateId: string): Promise<DuplicateActionResult> {
  try {
    await mergeDuplicateCandidate(candidateId);
    revalidatePath("/duplicates");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof MergeError ? e.message : "병합 중 오류가 발생했습니다." };
  }
}

export async function rejectDuplicateAction(candidateId: string): Promise<DuplicateActionResult> {
  try {
    await rejectDuplicateCandidate(candidateId);
    revalidatePath("/duplicates");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof MergeError ? e.message : "처리 중 오류가 발생했습니다." };
  }
}

export async function holdDuplicateAction(candidateId: string): Promise<DuplicateActionResult> {
  try {
    await holdDuplicateCandidate(candidateId);
    revalidatePath("/duplicates");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof MergeError ? e.message : "처리 중 오류가 발생했습니다." };
  }
}
