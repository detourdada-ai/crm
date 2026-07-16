import Link from "next/link";
import { Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CUSTOMER_STATUS_LABELS } from "@/lib/constants/customer-status";
import type { Customer, CustomerStatus } from "@/types/domain";

export function CustomerListTable({ customers, showOwner = false }: { customers: Customer[]; showOwner?: boolean }) {
  if (customers.length === 0) {
    return <p className="py-12 text-center text-sm text-muted-foreground">검색 결과가 없습니다.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead />
          <TableHead>고객번호</TableHead>
          <TableHead>이름</TableHead>
          <TableHead>전화번호</TableHead>
          <TableHead>주소</TableHead>
          <TableHead>상태</TableHead>
          <TableHead>태그</TableHead>
          {showOwner ? <TableHead>담당자</TableHead> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {customers.map((c) => (
          <TableRow key={c.id}>
            <TableCell>
              {c.is_favorite ? <Star className="size-4 fill-yellow-400 text-yellow-400" /> : null}
            </TableCell>
            <TableCell>
              <Link href={`/customers/${c.id}`} className="font-medium text-primary hover:underline">
                {c.customer_code}
              </Link>
            </TableCell>
            <TableCell>{c.name}</TableCell>
            <TableCell>{c.phone ?? "-"}</TableCell>
            <TableCell className="max-w-xs truncate">{c.address ?? "-"}</TableCell>
            <TableCell>
              <Badge variant={c.status === "active" ? "outline" : "secondary"}>
                {CUSTOMER_STATUS_LABELS[c.status as CustomerStatus] ?? c.status}
              </Badge>
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1">
                {c.tags.map((tag) => (
                  <Badge key={tag} variant="secondary">
                    {tag}
                  </Badge>
                ))}
              </div>
            </TableCell>
            {showOwner ? <TableCell className="text-muted-foreground">{c.owner_username}</TableCell> : null}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
