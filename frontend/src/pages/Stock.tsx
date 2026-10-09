import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, Plus, SlidersHorizontal } from "lucide-react";
import { apiGet } from "@/lib/api";
import type { Product, StockMovement } from "@/lib/types";
import { MOVEMENT_LABELS, formatDateTime } from "@/lib/format";
import AppShell from "@/components/AppShell";
import MovementDialog from "@/components/MovementDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function Stock() {
  const [entryOpen, setEntryOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);

  const { data: productData, isError: productError } = useQuery({
    queryKey: ["products"],
    queryFn: () => apiGet<Product[]>("/products"),
    refetchOnWindowFocus: false,
  });
  const { data: movementData, isError: movementError } = useQuery({
    queryKey: ["movements"],
    queryFn: () => apiGet<StockMovement[]>("/stock/movements"),
    refetchOnWindowFocus: false,
  });

  const products = productError ? [] : (productData ?? []);
  const movements = movementError ? [] : (movementData ?? []);

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">
            Movimentações de Estoque
          </h1>
          <p className="mt-1 text-sm font-medium text-slate-500">
            Entradas, ajustes e baixas automáticas por venda — histórico completo
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setEntryOpen(true)} data-testid="btn-open-stock-in-modal" className="active:scale-[0.98]">
            <Plus className="size-4" />
            Entrada de Estoque
          </Button>
          <Button
            variant="outline"
            onClick={() => setAdjustOpen(true)}
            data-testid="btn-open-stock-adjustment-modal"
          >
            <SlidersHorizontal className="size-4" />
            Ajuste Manual
          </Button>
        </div>
      </div>

      <Card className="border-slate-200/90 shadow-xs">
        <CardContent className="p-0">
          <Table data-testid="stock-movements-table">
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Produto</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead className="text-right">Variação</TableHead>
                <TableHead className="text-right">Estoque após</TableHead>
                <TableHead>Motivo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {movements.map((movement) => (
                <TableRow key={movement.id} data-testid={`stock-movement-row-${movement.id}`}>
                  <TableCell className="whitespace-nowrap font-mono text-xs tabular-nums text-slate-600">
                    {formatDateTime(movement.created_at)}
                  </TableCell>
                  <TableCell>
                    <p className="font-semibold text-slate-900">{movement.product_name}</p>
                    <p className="font-mono text-[11px] uppercase tracking-wider text-slate-500">
                      {movement.sku}
                    </p>
                  </TableCell>
                  <TableCell className="text-slate-600">{MOVEMENT_LABELS[movement.type]}</TableCell>
                  <TableCell className="text-right">
                    <span
                      className={`inline-flex items-center gap-1 font-mono font-semibold tabular-nums ${
                        movement.delta > 0 ? "text-emerald-700" : "text-red-600"
                      }`}
                    >
                      {movement.delta > 0 ? (
                        <ArrowUpRight className="size-3.5" />
                      ) : (
                        <ArrowDownRight className="size-3.5" />
                      )}
                      {movement.delta > 0 ? "+" : ""}
                      {movement.delta}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {movement.stock_after}
                  </TableCell>
                  <TableCell className="max-w-[260px] truncate text-slate-500">
                    {movement.reason || "—"}
                  </TableCell>
                </TableRow>
              ))}
              {movements.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-sm text-slate-500">
                    Nenhuma movimentação registrada ainda.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <MovementDialog mode="ENTRADA" open={entryOpen} onOpenChange={setEntryOpen} products={products} />
      <MovementDialog mode="AJUSTE" open={adjustOpen} onOpenChange={setAdjustOpen} products={products} />
    </AppShell>
  );
}
