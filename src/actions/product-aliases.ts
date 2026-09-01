"use server";

import { revalidatePath } from "next/cache";
import { productAliasesRepository, type UnmappedProductName } from "@/lib/repositories/product-aliases.repository";
import { productsRepository } from "@/lib/repositories/products.repository";
import { tenantsRepository } from "@/lib/repositories/tenants.repository";
import { toActionError } from "@/lib/utils/action-error";
import { ownerScopeFor, requireSession } from "@/lib/auth/current-session";
import type { ProductAlias } from "@/types/domain";

export interface ProductAliasActionState {
  ok: boolean;
  error: string | null;
}

/** admin은 전체 계정의 별칭을, 일반 계정은 자신의 별칭만 본다. */
export async function listProductAliasesAction(): Promise<ProductAlias[]> {
  const session = await requireSession();
  return productAliasesRepository.listAll(ownerScopeFor(session));
}

/** STEP12-8F Phase3(R05): 아직 표준 상품에 안 묶인 원본 상품명 후보 목록. */
export async function listUnmappedProductNamesAction(): Promise<UnmappedProductName[]> {
  const session = await requireSession();
  if (session.role === "admin") return [];
  return productAliasesRepository.listUnmappedProductNames(session.username);
}

export async function createProductAliasAction(
  _prevState: ProductAliasActionState,
  formData: FormData
): Promise<ProductAliasActionState> {
  try {
    const session = await requireSession();
    const aliasName = String(formData.get("aliasName") || "").trim();
    if (!aliasName) return { ok: false, error: "연결할 원본 상품명을 입력해주세요." };
    const productId = String(formData.get("productId") || "").trim();
    if (!productId) return { ok: false, error: "연결할 표준 상품을 선택해주세요." };

    const product = await productsRepository.findById(productId);
    if (!product) return { ok: false, error: "선택한 상품을 찾을 수 없습니다." };

    let ownerUsername = session.username;
    if (session.role === "admin") {
      ownerUsername = product.owner_username;
    } else if (product.owner_username !== session.username) {
      return { ok: false, error: "이 상품에 별칭을 추가할 권한이 없습니다." };
    }

    const tenant = await tenantsRepository.findByUsername(ownerUsername);
    if (!tenant) return { ok: false, error: "해당 계정의 tenant 정보를 찾을 수 없습니다." };

    await productAliasesRepository.create({ product_id: productId, alias_name: aliasName, owner_username: ownerUsername, tenant_id: tenant.id });
    revalidatePath("/settings");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: toActionError(e, "별칭 등록 중 오류가 발생했습니다(같은 상품명이 이미 등록되어 있을 수 있습니다).") };
  }
}

export async function deleteProductAliasAction(aliasId: string): Promise<ProductAliasActionState> {
  try {
    const session = await requireSession();
    const alias = await productAliasesRepository.findById(aliasId);
    if (!alias) return { ok: false, error: "별칭을 찾을 수 없습니다." };
    if (session.role !== "admin" && alias.owner_username !== session.username) {
      return { ok: false, error: "이 별칭을 삭제할 권한이 없습니다." };
    }
    await productAliasesRepository.delete(aliasId, session.role === "admin" ? undefined : session.username);
    revalidatePath("/settings");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: toActionError(e, "삭제 중 오류가 발생했습니다.") };
  }
}
