import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency } from "@/lib/constants/order-status";
import type { TopProduct } from "@/lib/services/dashboard.service";

export function TopProductsTable({ products }: { products: TopProduct[] }) {
  if (products.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">주문 데이터가 없습니다.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10">#</TableHead>
          <TableHead>상품명</TableHead>
          <TableHead className="text-right">판매수량</TableHead>
          <TableHead className="text-right">매출액</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {products.map((product, index) => (
          <TableRow key={product.productName}>
            <TableCell className="text-muted-foreground">{index + 1}</TableCell>
            <TableCell className="max-w-[220px] truncate font-medium">{product.productName}</TableCell>
            <TableCell className="text-right">{product.totalQuantity}개</TableCell>
            <TableCell className="text-right">{formatCurrency(product.totalAmount)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
