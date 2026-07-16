import "server-only";
import { customersRepository } from "@/lib/repositories/customers.repository";
import { isSimilarButNotIdenticalName } from "@/lib/utils/similarity";
import type { DuplicateConfidence, DuplicateMatchType } from "@/types/domain";

/**
 * Same-person ("동일인") candidate detection.
 *
 * IMPORTANT: this only ever produces candidates for manual admin review
 * (duplicate_candidates table). Nothing here merges customers automatically
 * — see merge.service.ts, which requires an explicit admin action.
 *
 * Rule set (see project spec CASE1-5). Cases are checked in order of
 * specificity so a single existing/new pair is labeled with the most
 * precise match_type rather than a generic one (first match wins per pair).
 */

export interface DuplicateCheckInput {
  newCustomerId: string;
  name: string;
  phone: string | null;
  addressNormalized: string | null;
}

export interface DetectedCandidate {
  existingCustomerId: string;
  matchType: DuplicateMatchType;
  confidence: DuplicateConfidence;
  reason: string;
}

export async function detectDuplicateCandidates(input: DuplicateCheckInput): Promise<DetectedCandidate[]> {
  const { newCustomerId, name, phone, addressNormalized } = input;
  const matched = new Map<string, DetectedCandidate>();

  const addOnce = (existingId: string, candidate: DetectedCandidate) => {
    if (existingId === newCustomerId) return;
    if (!matched.has(existingId)) matched.set(existingId, candidate);
  };

  if (phone) {
    const samePhone = await customersRepository.findByPhone(phone);

    // CASE3: name same + phone same + address different -> shipping address changed (HIGH)
    for (const existing of samePhone) {
      if (existing.id === newCustomerId) continue;
      if (existing.name === name && existing.address_normalized !== addressNormalized) {
        addOnce(existing.id, {
          existingCustomerId: existing.id,
          matchType: "shipping_changed",
          confidence: "HIGH",
          reason: `이름/전화번호 동일, 주소 다름 → 배송지 변경 가능성 (기존 주소: ${existing.address ?? "-"})`,
        });
      }
    }

    // CASE2: phone same + address different (name unspecified) -> address changed (HIGH)
    for (const existing of samePhone) {
      if (existing.id === newCustomerId) continue;
      if (existing.address_normalized !== addressNormalized) {
        addOnce(existing.id, {
          existingCustomerId: existing.id,
          matchType: "address_changed",
          confidence: "HIGH",
          reason: `전화번호 동일, 주소 다름 → 주소 변경 가능성 (기존 주소: ${existing.address ?? "-"})`,
        });
      }
    }
  }

  if (addressNormalized) {
    // CASE1: name same + address same + phone different -> mobile number changed (HIGH)
    const sameNameAddress = await customersRepository.findByNameAndAddress(name, addressNormalized);
    for (const existing of sameNameAddress) {
      if (existing.id === newCustomerId) continue;
      if (existing.phone !== phone) {
        addOnce(existing.id, {
          existingCustomerId: existing.id,
          matchType: "phone_changed",
          confidence: "HIGH",
          reason: `이름/주소 동일, 전화번호 다름 → 휴대폰 번호 변경 가능성 (기존 번호: ${existing.phone ?? "-"})`,
        });
      }
    }

    // CASE4/CASE5: address same + similar-but-not-identical name + phone different (MEDIUM)
    // Heuristic to pick a label: same-length names (e.g. a typo/re-entry) read like the
    // same person changing phones; different-length names (different given name) read
    // like a different family member at the same address. Either way this is a MEDIUM
    // confidence hint only — the admin makes the actual call in the review screen.
    const sameAddress = await customersRepository.findByAddress(addressNormalized);
    for (const existing of sameAddress) {
      if (existing.id === newCustomerId) continue;
      if (existing.phone !== phone && isSimilarButNotIdenticalName(existing.name, name)) {
        const looksLikeSamePerson = existing.name.length === name.length;
        addOnce(existing.id, {
          existingCustomerId: existing.id,
          matchType: looksLikeSamePerson ? "phone_changed_likely" : "family",
          confidence: "MEDIUM",
          reason: `주소 동일, 이름 유사(${existing.name} ↔ ${name}), 전화번호 다름 → ${
            looksLikeSamePerson ? "휴대폰 번호 변경 가능성" : "가족 구성원 가능성"
          }`,
        });
      }
    }
  }

  return Array.from(matched.values());
}
