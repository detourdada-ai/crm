"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Pencil } from "lucide-react";
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
import {
  createProductAction,
  updateProductAction,
  toggleProductActiveAction,
  deleteProductAction,
} from "@/actions/products";
import type { Product } from "@/types/domain";

function CreateProductDialog({ isAdmin, accountUsernames }: { isAdmin: boolean; accountUsernames: string[] }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await createProductAction({ ok: false, error: null }, formData);
      if (!result.ok) {
        toast.error(result.error ?? "상품 등록 중 오류가 발생했습니다.");
        return;
      }
      toast.success("상품을 등록했습니다.");
      formRef.current?.reset();
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="size-4" />
          상품 등록
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>상품 등록</DialogTitle>
          <DialogDescription>수동 주문 등록 화면에서 이 상품을 바로 선택할 수 있습니다.</DialogDescription>
        </DialogHeader>
        <form ref={formRef} onSubmit={handleSubmit} className="grid gap-4">
          {isAdmin ? (
            <div className="space-y-2">
              <Label htmlFor="ownerUsername">담당 계정</Label>
              <Select name="ownerUsername" required>
                <SelectTrigger id="ownerUsername" className="w-full">
                  <SelectValue placeholder="이 상품이 속할 계정을 선택하세요" />
                </SelectTrigger>
                <SelectContent>
                  {accountUsernames.map((username) => (
                    <SelectItem key={username} value={username}>
                      {username}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="name">상품명</Label>
            <Input id="name" name="name" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="unitPrice">단가</Label>
            <Input id="unitPrice" name="unitPrice" type="number" min={0} defaultValue={0} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "등록하는 중..." : "등록"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditProductDialog({ product }: { product: Product }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await updateProductAction(product.id, { ok: false, error: null }, formData);
      if (!result.ok) {
        toast.error(result.error ?? "상품 수정 중 오류가 발생했습니다.");
        return;
      }
      toast.success("상품을 수정했습니다.");
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Pencil className="size-4" />
          수정
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>상품 수정</DialogTitle>
          <DialogDescription>
            가격을 바꿔도 이미 등록된 과거 주문의 상품명/단가는 그대로 유지됩니다 — 이 화면의 값은 앞으로 새로
            선택할 때만 적용됩니다.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-4">
          <div className="space-y-2">
            <Label htmlFor={`name-${product.id}`}>상품명</Label>
            <Input id={`name-${product.id}`} name="name" defaultValue={product.name} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`unitPrice-${product.id}`}>단가</Label>
            <Input
              id={`unitPrice-${product.id}`}
              name="unitPrice"
              type="number"
              min={0}
              defaultValue={product.unit_price}
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "저장하는 중..." : "저장"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ProductActiveToggle({ productId, isActive }: { productId: string; isActive: boolean }) {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const result = await toggleProductActiveAction(productId, !isActive);
      if (!result.ok) toast.error(result.error ?? "처리 중 오류가 발생했습니다.");
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Badge variant={isActive ? "outline" : "secondary"}>{isActive ? "사용" : "미사용"}</Badge>
      <Button variant="outline" size="sm" disabled={isPending} onClick={handleClick}>
        {isActive ? "미사용으로" : "사용으로"}
      </Button>
    </div>
  );
}

function ProductDeleteButton({ productId }: { productId: string }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteProductAction(productId);
      if (!result.ok) {
        toast.error(result.error ?? "삭제 중 오류가 발생했습니다.");
        return;
      }
      toast.success("상품을 삭제했습니다.");
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 text-destructive hover:text-destructive">
          <Trash2 className="size-4" />
          삭제
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>상품을 삭제하시겠습니까?</DialogTitle>
          <DialogDescription>
            이미 주문에서 사용된 상품은 삭제할 수 없습니다(사용 중지를 이용해주세요). 사용 이력이 없는 상품만
            완전히 삭제됩니다.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
            취소
          </Button>
          <Button variant="destructive" onClick={handleDelete} disabled={isPending}>
            {isPending ? "삭제하는 중..." : "삭제"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ProductManagementCard({
  products,
  isAdmin,
  accountUsernames,
}: {
  products: Product[];
  isAdmin: boolean;
  accountUsernames: string[];
}) {
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <CreateProductDialog isAdmin={isAdmin} accountUsernames={accountUsernames} />
      </div>
      {products.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          등록된 상품이 없습니다. 상품을 등록하면 수동 주문 등록 화면에서 바로 선택할 수 있습니다.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              {isAdmin ? <TableHead>담당 계정</TableHead> : null}
              <TableHead>상품명</TableHead>
              <TableHead className="text-right">단가</TableHead>
              <TableHead>상태</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.map((product) => (
              <TableRow key={product.id}>
                {isAdmin ? (
                  <TableCell>
                    <Badge variant="secondary">{product.owner_username}</Badge>
                  </TableCell>
                ) : null}
                <TableCell className="font-medium">{product.name}</TableCell>
                <TableCell className="text-right">{product.unit_price.toLocaleString("ko-KR")}원</TableCell>
                <TableCell>
                  <ProductActiveToggle productId={product.id} isActive={product.is_active} />
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-2">
                    <EditProductDialog product={product} />
                    <ProductDeleteButton productId={product.id} />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
