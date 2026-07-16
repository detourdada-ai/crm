import "server-only";
import { customersRepository } from "@/lib/repositories/customers.repository";
import { changeLogRepository, type ChangeLogInsert } from "@/lib/repositories/change-log.repository";
import { formatPhoneNumber } from "@/lib/utils/phone";
import { cleanAddress, normalizeAddressForCompare } from "@/lib/utils/address";
import type { Customer } from "@/types/domain";

export interface ImportCustomerInput {
  name: string;
  rawPhone: string | null;
  rawAddress: string | null;
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
 */
export async function resolveCustomerForImportRow(input: ImportCustomerInput): Promise<CustomerResolution> {
  const name = input.name.trim();
  const phone = formatPhoneNumber(input.rawPhone);
  const address = cleanAddress(input.rawAddress);
  const addressNormalized = normalizeAddressForCompare(input.rawAddress);

  if (phone) {
    const samePhone = await customersRepository.findByPhone(phone);
    const exact = samePhone.find((c) => c.name === name && c.address_normalized === addressNormalized);
    if (exact) return { customer: exact, isNew: false };
  }

  const created = await customersRepository.create({
    name,
    phone,
    address,
    address_normalized: addressNormalized,
  });

  return { customer: created, isNew: true };
}

export interface UpdateCustomerInput {
  name: string;
  phone: string | null;
  address: string | null;
  memo: string | null;
  tags: string[];
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
  const address = cleanAddress(input.address);
  const addressNormalized = normalizeAddressForCompare(input.address);
  const memo = input.memo?.trim() || null;
  const tags = input.tags;

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

  const updated = await customersRepository.update(id, {
    name,
    phone,
    address,
    address_normalized: addressNormalized,
    memo,
    tags,
  });

  if (logs.length > 0) await changeLogRepository.createMany(logs);

  return updated;
}
