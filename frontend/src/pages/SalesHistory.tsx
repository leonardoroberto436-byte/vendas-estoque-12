import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Eye } from "lucide-react";
import { apiGet } from "@/lib/api";
import type { Sale } from "@/lib/types";
import { PAYMENT_LABELS, formatDateTime, money } from "@/lib/format";
import AppShell from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function SalesHistory() {
  const [selected, setSelected] = useState<Sale | null>(null);

  const { data, isError } = useQuery({
    queryKey: ["sales"],
    queryFn: () => apiGet<Sale[]>("/sales"),
    refetchOnWindowFocus: false,
  });
  const sales = isError ? [] : (data ?? []);

  const revenue = sales.reduce((sum, sale) => sum + sale.total, 0);
  const profit = sales.reduce((sum, sale) => sum + sale.profit, 0);

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Histórico de Vendas</h1>
          <p className="mt-1 text-sm font-medium text-slate-500">
            Todas as vendas registradas, com itens e lucro por pedido
          </p>
        </div>
        <div className="flex gap-2">
          <Badge variant="secondary" className="font-mono text-xs" data-testid="sales-history-total-revenue">
            Faturamento {money(revenue)}
          </Badge>
          <Badge variant="outline" className="font-mono text-xs" data-testid="sales-history-total-profit">
            Lucro {money(profit)}
          </Badge>
        </div>
      </div>

      <Card className="border-slate-200/90 shadow-xs">
        <CardContent className="p-0">
          <Table data-testid="sales-history-table">
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead className="text-right">Itens</TableHead>
                <TableHead>Pagamento</TableHead>
                <TableHead className="text-right">Desconto</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Lucro</TableHead>
                <TableHead className="text-right">Detalhe</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sales.map((sale) => (
                <TableRow key={sale.id} data-testid={`sales-history-row-${sale.id}`}>
                  <TableCell className="whitespace-nowrap font-mono text-xs tabular-nums text-slate-600">
                    {formatDateTime(sale.created_at)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {sale.items.reduce((sum, item) => sum + item.quantity, 0)}
                  </TableCell>
                  <TableCell className="text-slate-600">
                    {PAYMENT_LABELS[sale.payment_method]}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums text-slate-500">
                    {sale.discount > 0 ? `- ${money(sale.discount)}` : "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono font-semibold tabular-nums">
                    {money(sale.total)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums text-emerald-700">
                    {money(sale.profit)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="icon-sm"
                      variant="outline"
                      aria-label="Ver detalhe da venda"
                      data-testid={`sales-history-view-detail-btn-${sale.id}`}
                      onClick={() => setSelected(sale)}
                    >
                      <Eye className="size-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {sales.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-sm text-slate-500">
                    Nenhuma venda registrada ainda.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent data-testid="sales-detail-modal">
          <DialogHeader>
            <DialogTitle>Detalhe da venda</DialogTitle>
            <DialogDescription>
              {selected ? formatDateTime(selected.created_at) : ""}
            </DialogDescription>
          </DialogHeader>
          {selected && (
            <div className="space-y-2 text-sm">
              {selected.items.map((item) => (
                <div key={item.product_id} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-slate-700">
                    {item.quantity}× {item.product_name}{" "}
                    <span className="font-mono text-xs text-slate-400">({item.sku})</span>
                  </span>
                  <span className="font-mono tabular-nums">{money(item.line_total)}</span>
                </div>
              ))}
              <div className="space-y-1 border-t border-border pt-2 font-mono text-sm tabular-nums">
                <div className="flex justify-between">
                  <span className="font-sans text-slate-600">Subtotal</span>
                  <span>{money(selected.subtotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-sans text-slate-600">Desconto</span>
                  <span>- {money(selected.discount)}</span>
                </div>
                <div className="flex justify-between font-semibold">
                  <span className="font-sans">Total</span>
                  <span data-testid="sales-detail-total">{money(selected.total)}</span>
                </div>
                <div className="flex justify-between text-emerald-700">
                  <span className="font-sans">Lucro</span>
                  <span>{money(selected.profit)}</span>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
