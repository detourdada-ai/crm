"use server";

import { revalidatePath } from "next/cache";
import { productsRepository } from "@/lib/repositories/products.repository";
import { tenantsRepository } from "@/lib/repositories/tenants.repository";
import { toActionError } from "@/lib/utils/action-error";
import { ownerScopeFor, requireSession } from "@/lib/auth/current-session";
import type { Product } from "@/types/domain";

export interface ProductActionState {
  ok: boolean;
  error: string | null;
}

/** admin은 전체 계정의 상품을 owner_username별로 모아 보고, 일반 계정은 자신의 상품만 본다. */
export async function listProductsAction(): Promise<Product[]> {
  const session = await requireSession();
  return productsRepository.listAll(ownerScopeFor(session));
}

/** 수동 주문 SelectBox용 — 로그인 계정 소유의 사용 중인 상품만. */
export async function listActiveProductsAction(): Promise<Product[]> {
  const session = await requireSession();
  return productsRepository.listActive(session.username);
}

async function assertOwnsProduct(productId: string, session: Awaited<ReturnType<typeof requireSession>>) {
  const product = await productsRepository.findById(productId);
  if (!product) throw new Error("상품을 찾을 수 없습니다.");
  if (session.role !== "admin" && product.owner_username !== session.username) {
    throw new Error("이 상품을 관리할 권한이 없습니다.");
  }
  return product;
}

export async function createProductAction(
  _prevState: ProductActionState,
  formData: FormData
): Promise<ProductActionState> {
  try {
    const session = await requireSession();
    const name = String(formData.get("name") || "").trim();
    if (!name) return { ok: false, error: "상품명을 입력해주세요." };
    const unitPrice = Math.max(0, Number(formData.get("unitPrice")) || 0);

    // admin은 어느 계정 소속 상품인지 지정해야 하고, 일반 계정은 항상 자기 자신 소속으로 등록된다.
    let ownerUsername = session.username;
    if (session.role === "admin") {
      const selected = String(formData.get("ownerUsername") || "").trim();
      if (!selected) return { ok: false, error: "담당 계정을 선택해주세요." };
      ownerUsername = selected;
    }

    const tenant = await tenantsRepository.findByUsername(ownerUsername);
    if (!tenant) return { ok: false, error: "해당 계정의 tenant 정보를 찾을 수 없습니다." };

    await productsRepository.create({ name, unit_price: unitPrice, owner_username: ownerUsername, tenant_id: tenant.id });
    revalidatePath("/settings");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: toActionError(e, "상품 등록 중 오류가 발생했습니다.") };
  }
}

export async function updateProductAction(
  productId: string,
  _prevState: ProductActionState,
  formData: FormData
): Promise<ProductActionState> {
  try {
    const session = await requireSession();
    await assertOwnsProduct(productId, session);
    const name = String(formData.get("name") || "").trim();
    if (!name) return { ok: false, error: "상품명을 입력해주세요." };
    const unitPrice = Math.max(0, Number(formData.get("unitPrice")) || 0);

    await productsRepository.update(
      productId,
      { name, unit_price: unitPrice },
      session.role === "admin" ? undefined : session.username
    );
    revalidatePath("/settings");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: toActionError(e, "상품 수정 중 오류가 발생했습니다.") };
  }
}

export async function toggleProductActiveAction(productId: string, isActive: boolean): Promise<ProductActionState> {
  try {
    const session = await requireSession();
    await assertOwnsProduct(productId, session);
    await productsRepository.update(
      productId,
      { is_active: isActive },
      session.role === "admin" ? undefined : session.username
    );
    revalidatePath("/settings");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: toActionError(e, "처리 중 오류가 발생했습니다.") };
  }
}

/**
 * 이미 과거 주문(order_items.product_id)에서 참조 중인 상품은 완전 삭제를
 * 거부한다 — 삭제해도 과거 주문 자체는 product_name/unit_price 스냅샷으로
 * 영향받지 않지만, FK가 null로 끊기는 것보다 "사용 중지"로 유도하는 편이
 * 더 안전하고 명확하다.
 */
export async function deleteProductAction(productId: string): Promise<ProductActionState> {
  try {
    const session = await requireSession();
    await assertOwnsProduct(productId, session);

    const referencedCount = await productsRepository.countReferencingOrderItems(productId);
    if (referencedCount > 0) {
      return {
        ok: false,
        error: `이미 ${referencedCount}건의 주문에서 사용된 상품입니다. 삭제 대신 "사용 중지"를 이용해주세요.`,
      };
    }

    await productsRepository.delete(productId, session.role === "admin" ? undefined : session.username);
    revalidatePath("/settings");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: toActionError(e, "삭제 중 오류가 발생했습니다.") };
  }
}
