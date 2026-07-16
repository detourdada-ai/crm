import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Customer } from "@/types/domain";

export function CustomerListTable({ customers }: { customers: Customer[] }) {
  if (customers.length === 0) {
    return <p className="py-12 text-center text-sm text-muted-foreground">검색 결과가 없습니다.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>고객번호</TableHead>
          <TableHead>이름</TableHead>
          <TableHead>전화번호</TableHead>
          <TableHead>주소</TableHead>
          <TableHead>태그</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {customers.map((c) => (
          <TableRow key={c.id}>
            <TableCell>
              <Link href={`/customers/${c.id}`} className="font-medium text-primary hover:underline">
                {c.customer_code}
              </Link>
            </TableCell>
            <TableCell>{c.name}</TableCell>
            <TableCell>{c.phone ?? "-"}</TableCell>
            <TableCell className="max-w-xs truncate">{c.address ?? "-"}</TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1">
                {c.tags.map((tag) => (
                  <Badge key={tag} variant="secondary">
                    {tag}
                  </Badge>
                ))}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
