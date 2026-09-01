"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { createProductAliasAction, deleteProductAliasAction } from "@/actions/product-aliases";
import type { Product, ProductAlias } from "@/types/domain";
import type { UnmappedProductName } from "@/lib/repositories/product-aliases.repository";

/**
 * STEP12-8F Phase3(R05): "표준상품 ↔ 별칭" 관리 화면 — order_items.product_name
 * 원본 텍스트를 절대 다시 쓰지 않는다(문자열 치환 금지). 여기서 하는 일은
 * 오직 "이 원본 문자열을 다음 번부터 어떤 표준 상품으로 인식할지"를
 * 등록/삭제하는 것뿐이고, 이미 만들어진 과거 주문에는 소급 적용하지
 * 않는다(Excel 재업로드/수동 신규 등록 등 "새로 들어오는" 주문부터 적용).
 */
function CreateAliasDialog({ products, defaultAliasName }: { products: Product[]; defaultAliasName?: string }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await createProductAliasAction({ ok: false, error: null }, formData);
      if (!result.ok) {
        toast.error(result.error ?? "별칭 등록 중 오류가 발생했습니다.");
        return;
      }
      toast.success("별칭을 등록했습니다. 다음 번 이 상품명이 들어오면 자동으로 연결됩니다.");
      formRef.current?.reset();
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant={defaultAliasName ? "outline" : "default"} className="gap-1.5">
          <Plus className="size-4" />
          {defaultAliasName ? "표준 상품에 연결" : "별칭 등록"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>상품 별칭 등록</DialogTitle>
          <DialogDescription>
            원본 상품명은 그대로 두고, 다음부터 이 표준 상품으로 인식하도록 연결만 합니다. 이미 등록된 과거
            주문에는 영향이 없습니다.
          </DialogDescription>
        </DialogHeader>
        <form ref={formRef} onSubmit={handleSubmit} className="grid gap-4">
          <div className="space-y-2">
            <Label htmlFor="aliasName">원본 상품명(Excel/입력 그대로)</Label>
            <Input id="aliasName" name="aliasName" defaultValue={defaultAliasName} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="productId">연결할 표준 상품</Label>
            <Select name="productId" required>
              <SelectTrigger id="productId" className="w-full">
                <SelectValue placeholder="표준 상품을 선택하세요" />
              </SelectTrigger>
              <SelectContent>
                {products.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {products.length === 0 ? (
              <p className="text-xs text-muted-foreground">먼저 위 &quot;상품 등록&quot;에서 표준 상품을 만들어주세요.</p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending || products.length === 0}>
              {isPending ? "등록하는 중..." : "등록"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AliasDeleteButton({ aliasId }: { aliasId: string }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteProductAliasAction(aliasId);
      if (!result.ok) {
        toast.error(result.error ?? "삭제 중 오류가 발생했습니다.");
        return;
      }
      toast.success("별칭을 삭제했습니다.");
      setOpen(false);
    });
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={setOpen}
      isPending={isPending}
      onConfirm={handleDelete}
      title="별칭을 삭제하시겠습니까?"
      target="이 별칭"
      description="삭제해도 이미 연결된 과거 주문의 표준상품 연결은 그대로 유지됩니다. 다음부터 이 상품명이 들어오면 더 이상 자동 연결되지 않습니다."
      trigger={
        <Button variant="outline" size="sm" className="gap-1.5 text-destructive hover:text-destructive">
          <Trash2 className="size-4" />
          삭제
        </Button>
      }
    />
  );
}

export function ProductAliasManagementCard({
  products,
  aliases,
  unmappedNames,
  isAdmin,
}: {
  products: Product[];
  aliases: ProductAlias[];
  unmappedNames: UnmappedProductName[];
  isAdmin: boolean;
}) {
  const productNameById = new Map(products.map((p) => [p.id, p.name]));
  const aliasedNames = new Set(aliases.map((a) => a.alias_name));

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-text-strong">등록된 별칭</p>
          <CreateAliasDialog products={products} />
        </div>
        {aliases.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            아직 등록된 별칭이 없습니다. 예: &quot;봄날세트&quot;와 &quot;런치세트A&quot;가 실제로는 같은 상품이면, 표준 상품 하나를
            만들고 두 이름 모두 별칭으로 연결해두세요.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {isAdmin ? <TableHead>담당 계정</TableHead> : null}
                <TableHead>원본 상품명(별칭)</TableHead>
                <TableHead>연결된 표준 상품</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {aliases.map((alias) => (
                <TableRow key={alias.id}>
                  {isAdmin ? (
                    <TableCell>
                      <Badge variant="secondary">{alias.owner_username}</Badge>
                    </TableCell>
                  ) : null}
                  <TableCell className="font-medium">{alias.alias_name}</TableCell>
                  <TableCell>{productNameById.get(alias.product_id) ?? "(삭제된 상품)"}</TableCell>
                  <TableCell>
                    <div className="flex justify-end">
                      <AliasDeleteButton aliasId={alias.id} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {!isAdmin ? (
        <div className="space-y-3 border-t border-border pt-4">
          <p className="text-sm font-medium text-text-strong">아직 표준 상품에 연결되지 않은 최근 주문 상품명</p>
          <p className="text-xs text-muted-foreground">
            최근 300건 주문 기준입니다. 여기서 연결해도 이미 들어온 이 주문들은 바뀌지 않고, 다음부터 이 이름이
            들어올 때만 자동으로 연결됩니다.
          </p>
          {unmappedNames.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">모두 연결되어 있거나 최근 주문이 없습니다.</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {unmappedNames
                .filter((entry) => !aliasedNames.has(entry.product_name))
                .map((entry) => (
                  <li key={entry.product_name} className="flex items-center justify-between gap-2 px-3 py-2">
                    <span className="text-sm">
                      {entry.product_name} <span className="text-xs text-muted-foreground">({entry.count}건)</span>
                    </span>
                    <CreateAliasDialog products={products} defaultAliasName={entry.product_name} />
                  </li>
                ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
