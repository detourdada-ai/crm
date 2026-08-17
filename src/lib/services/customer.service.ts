import "server-only";
import { customersRepository } from "@/lib/repositories/customers.repository";
import { changeLogRepository, type ChangeLogInsert } from "@/lib/repositories/change-log.repository";
import { tenantsRepository } from "@/lib/repositories/tenants.repository";
import { formatPhoneNumber } from "@/lib/utils/phone";
import { cleanAddress, normalizeAddressForCompare } from "@/lib/utils/address";
import type { Customer, CustomerStatus } from "@/types/domain";
import { CUSTOMER_STATUS_LABELS } from "@/lib/constants/customer-status";

export interface ImportCustomerInput {
  name: string;
  rawPhone: string | null;
  rawAddress: string | null;
  ownerUsername: string;
  importId?: string | null;
  bagNo?: string | null;
}

export interface CustomerResolution {
  customer: Customer;
  isNew: boolean;
}

/**
 * Decides whether an import row belongs to an already-known customer or a
 * new one. Only an exact match on name + phone + normalized address counts
 * as "the same customer" — anything less exact creates a new customer
 * record and lets duplicate-detection.service flag it for admin review
 * instead of silently assuming an identity match (see project spec: identity
 * is customer_id, never phone, and merges always require manual approval).
 *
 * Matching is scoped to the uploading account's own customers (owner_username)
 * so user1..user5's customer pools stay separate; "admin" imports are scoped
 * to admin's own pool the same way (admin's *viewing* is what's unrestricted).
 */
export async function resolveCustomerForImportRow(input: ImportCustomerInput): Promise<CustomerResolution> {
  const name = input.name.trim();
  const phone = formatPhoneNumber(input.rawPhone);
  const address = cleanAddress(input.rawAddress);
  const addressNormalized = normalizeAddressForCompare(input.rawAddress);

  if (phone) {
    const samePhone = await customersRepository.findByPhone(phone, input.ownerUsername);
    const exact = samePhone.find((c) => c.name === name && c.address_normalized === addressNormalized);
    if (exact) {
      // Fill in bag_no only if the customer doesn't have one yet — never
      // overwrite a value the shop owner already set/edited.
      if (input.bagNo && !exact.bag_no) {
        const updated = await customersRepository.update(exact.id, { bag_no: input.bagNo });
        return { customer: updated, isNew: false };
      }
      return { customer: exact, isNew: false };
    }
  }

  const tenant = await tenantsRepository.findByUsername(input.ownerUsername);
  if (!tenant) throw new Error(`No tenant membership found for account "${input.ownerUsername}".`);

  const created = await customersRepository.create({
    name,
    phone,
    address,
    address_normalized: addressNormalized,
    owner_username: input.ownerUsername,
    tenant_id: tenant.id,
    created_by_import_id: input.importId ?? null,
    bag_no: input.bagNo ?? null,
  });

  return { customer: created, isNew: true };
}

export interface CreateCustomerDirectInput {
  name: string;
  rawPhone: string | null;
  postalCode: string | null;
  roadAddress: string | null;
  detailAddress: string | null;
  ownerUsername: string;
}

/**
 * F6/F10: 주문 등록 화면에서 사용자가 명시적으로 "신규 고객"을 선택했을 때
 * 쓰는 생성 경로 — resolveCustomerForImportRow와 달리 기존 고객과 자동으로
 * 매칭하지 않는다. 사람이 "기존 고객 검색"에서 못 찾아 신규를 선택한
 * 것이므로, 여기서 뒤로 몰래 매칭해버리면 사용자의 명시적 선택을 무시하는
 * 셈이 된다("자동 병합은 하지 않는다" 원칙과 동일한 이유).
 */
export async function createCustomerDirect(input: CreateCustomerDirectInput): Promise<Customer> {
  const name = input.name.trim();
  const phone = formatPhoneNumber(input.rawPhone);
  const roadAddress = input.roadAddress?.trim() || null;
  const detailAddress = input.detailAddress?.trim() || null;
  const composedAddress = [roadAddress, detailAddress].filter(Boolean).join(" ") || null;

  const tenant = await tenantsRepository.findByUsername(input.ownerUsername);
  if (!tenant) throw new Error(`No tenant membership found for account "${input.ownerUsername}".`);

  return customersRepository.create({
    name,
    phone,
    address: cleanAddress(composedAddress),
    address_normalized: normalizeAddressForCompare(composedAddress),
    postal_code: input.postalCode?.trim() || null,
    road_address: roadAddress,
    detail_address: detailAddress,
    owner_username: input.ownerUsername,
    tenant_id: tenant.id,
  });
}

export interface UpdateCustomerInput {
  name: string;
  phone: string | null;
  // F7: 표준화된 주소 성분 — address(합성 표시값)는 이 셋으로부터 계산된다.
  postalCode: string | null;
  roadAddress: string | null;
  detailAddress: string | null;
  memo: string | null;
  tags: string[];
  status: CustomerStatus;
  bagNo: string | null;
}

/**
 * Applies a profile edit and writes one change-log row per changed field
 * (phone/address get their own dedicated entity types per project spec so
 * they can be audited separately from general info edits).
 */
export async function updateCustomerProfile(
  id: string,
  input: UpdateCustomerInput,
  performedBy = "admin"
): Promise<Customer> {
  const existing = await customersRepository.findById(id);
  if (!existing) throw new Error("고객을 찾을 수 없습니다.");

  const name = input.name.trim();
  const phone = formatPhoneNumber(input.phone);
  const postalCode = input.postalCode?.trim() || null;
  const roadAddress = input.roadAddress?.trim() || null;
  const detailAddress = input.detailAddress?.trim() || null;
  // F7: address는 계속 road_address+detail_address로부터 합성된 표시값이다.
  const composedAddress = [roadAddress, detailAddress].filter(Boolean).join(" ") || null;
  const address = cleanAddress(composedAddress);
  const addressNormalized = normalizeAddressForCompare(composedAddress);
  const memo = input.memo?.trim() || null;
  const tags = input.tags;
  const status = input.status;

  const logs: ChangeLogInsert[] = [];
  if (existing.phone !== phone) {
    logs.push({
      customer_id: id,
      entity: "customer_phone",
      field: "phone",
      old_value: existing.phone,
      new_value: phone,
      performed_by: performedBy,
    });
  }
  if (existing.address !== address) {
    logs.push({
      customer_id: id,
      entity: "customer_address",
      field: "address",
      old_value: existing.address,
      new_value: address,
      performed_by: performedBy,
    });
  }
  if (existing.name !== name) {
    logs.push({
      customer_id: id,
      entity: "customer_info",
      field: "name",
      old_value: existing.name,
      new_value: name,
      performed_by: performedBy,
    });
  }
  if (existing.memo !== memo) {
    logs.push({
      customer_id: id,
      entity: "customer_info",
      field: "memo",
      old_value: existing.memo,
      new_value: memo,
      performed_by: performedBy,
    });
  }
  if (existing.tags.join(",") !== tags.join(",")) {
    logs.push({
      customer_id: id,
      entity: "customer_info",
      field: "tags",
      old_value: existing.tags.join(", "),
      new_value: tags.join(", "),
      performed_by: performedBy,
    });
  }
  if (existing.status !== status) {
    logs.push({
      customer_id: id,
      entity: "customer_info",
      field: "status",
      old_value: CUSTOMER_STATUS_LABELS[existing.status as CustomerStatus] ?? existing.status,
      new_value: CUSTOMER_STATUS_LABELS[status],
      performed_by: performedBy,
    });
  }
  if (existing.bag_no !== input.bagNo) {
    logs.push({
      customer_id: id,
      entity: "customer_info",
      field: "bag_no",
      old_value: existing.bag_no,
      new_value: input.bagNo,
      performed_by: performedBy,
    });
  }

  const updated = await customersRepository.update(id, {
    name,
    phone,
    address,
    address_normalized: addressNormalized,
    postal_code: postalCode,
    road_address: roadAddress,
    detail_address: detailAddress,
    bag_no: input.bagNo,
    memo,
    tags,
    status,
  });

  if (logs.length > 0) await changeLogRepository.createMany(logs);

  return updated;
}

export async function setCustomerFavorite(id: string, isFavorite: boolean): Promise<Customer> {
  return customersRepository.update(id, { is_favorite: isFavorite });
}
