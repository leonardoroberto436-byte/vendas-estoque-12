import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Minus, Plus, RotateCcw, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPost } from "@/lib/api";
import type { ReturnableSale, SaleReturn } from "@/lib/types";
import { errorMessage, formatDateTime, money } from "@/lib/format";
import AppShell from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function Returns() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<ReturnableSale | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");
  const [restock, setRestock] = useState(true);

  const { data: returnableData, isError: returnableError } = useQuery({
    queryKey: ["returnable-sales"],
    queryFn: () => apiGet<ReturnableSale[]>("/returns/returnable"),
    refetchOnWindowFocus: false,
  });
  const { data: returnsData } = useQuery({
    queryKey: ["returns"],
    queryFn: () => apiGet<SaleReturn[]>("/returns"),
    refetchOnWindowFocus: false,
  });

  const returnable = returnableError ? [] : (returnableData ?? []);
  const history = returnsData ?? [];

  const refundTotal = useMemo(() => {
    if (!selected) return 0;
    return selected.items.reduce(
      (sum, item) => sum + (quantities[item.product_id] ?? 0) * item.unit_price,
      0,
    );
  }, [selected, quantities]);

  const totalRefunded = history.reduce((sum, item) => sum + item.refund_total, 0);

  const openDialog = (sale: ReturnableSale) => {
    setSelected(sale);
    setQuantities({});
    setReason("");
    setRestock(true);
  };

  const bump = (productId: string, max: number, delta: number) => {
    const current = quantities[productId] ?? 0;
    const next = Math.min(max, Math.max(0, current + delta));
    setQuantities({ ...quantities, [productId]: next });
  };

  const submit = useMutation({
    mutationFn: () =>
      apiPost<SaleReturn>("/returns", {
        sale_id: selected?.sale_id,
        items: Object.entries(quantities)
          .filter(([, qty]) => qty > 0)
          .map(([product_id, quantity]) => ({ product_id, quantity })),
        reason,
        restock,
      }),
    onSuccess: (result) => {
      toast.success(`Devolução registrada: ${money(result.refund_total)}`);
      setSelected(null);
      void queryClient.invalidateQueries({ queryKey: ["returnable-sales"] });
      void queryClient.invalidateQueries({ queryKey: ["returns"] });
      void queryClient.invalidateQueries({ queryKey: ["products"] });
      void queryClient.invalidateQueries({ queryKey: ["sales"] });
      void queryClient.invalidateQueries({ queryKey: ["movements"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
    },
    onError: (error) => toast.error(errorMessage(error, "Não foi possível registrar a devolução")),
  });

  const hasQuantity = Object.values(quantities).some((qty) => qty > 0);

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Devoluções</h1>
          <p className="mt-1 text-sm font-medium text-slate-500">
            Estorne itens de uma venda — o estoque volta e o faturamento líquido é ajustado
          </p>
        </div>
        <span
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm tabular-nums text-slate-700"
          data-testid="returns-total-refunded"
        >
          Total devolvido: {money(totalRefunded)}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <Card className="border-slate-200/90 shadow-xs lg:col-span-7">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base font-bold tracking-tight">
              <Undo2 className="size-4 text-teal-600" />
              Vendas com itens devolvíveis
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table data-testid="returnable-sales-table">
              <TableHeader>
                <TableRow>
                  <TableHead>Cupom</TableHead>
                  <TableHead>Vendedor</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {returnable.map((sale) => (
                  <TableRow key={sale.sale_id} data-testid={`returnable-row-${sale.sale_id}`}>
                    <TableCell>
                      <p className="font-mono text-xs font-semibold text-slate-900">
                        {sale.sale_code || sale.sale_id.slice(0, 8)}
                      </p>
                      <p className="text-xs text-slate-500">{formatDateTime(sale.created_at)}</p>
                    </TableCell>
                    <TableCell className="text-slate-600">{sale.seller_name || "—"}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {money(sale.total)}
                      {sale.already_refunded > 0 && (
                        <span className="block text-xs text-amber-700">
                          -{money(sale.already_refunded)} devolvido
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        data-testid={`returnable-open-btn-${sale.sale_id}`}
                        onClick={() => openDialog(sale)}
                      >
                        <RotateCcw className="size-4" />
                        Devolver
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {returnable.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-10 text-center text-sm text-slate-500">
                      Nenhuma venda com itens pendentes de devolução.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="border-slate-200/90 shadow-xs lg:col-span-5">
          <CardHeader>
            <CardTitle className="text-base font-bold tracking-tight">
              Devoluções registradas
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table data-testid="returns-history-table">
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Itens</TableHead>
                  <TableHead className="text-right">Estorno</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((item) => (
                  <TableRow key={item.id} data-testid={`return-row-${item.id}`}>
                    <TableCell>
                      <p className="font-mono text-xs tabular-nums text-slate-600">
                        {formatDateTime(item.created_at)}
                      </p>
                      <p className="text-xs text-slate-500">
                        {item.operator_name} · {item.restocked ? "repôs estoque" : "sem reposição"}
                      </p>
                    </TableCell>
                    <TableCell className="text-sm text-slate-700">
                      {item.items.map((line) => (
                        <span key={line.product_id} className="block truncate">
                          {line.quantity}× {line.product_name}
                        </span>
                      ))}
                      {item.reason && (
                        <span className="block text-xs italic text-slate-400">{item.reason}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold tabular-nums text-red-600">
                      -{money(item.refund_total)}
                    </TableCell>
                  </TableRow>
                ))}
                {history.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="py-10 text-center text-sm text-slate-500">
                      Nenhuma devolução registrada ainda.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent data-testid="return-modal">
          <DialogHeader>
            <DialogTitle>Registrar devolução</DialogTitle>
            <DialogDescription>
              {selected
                ? `Cupom ${selected.sale_code || selected.sale_id.slice(0, 8)} — escolha a quantidade de cada item.`
                : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {selected?.items.map((item) => {
              const qty = quantities[item.product_id] ?? 0;
              const disabled = item.returnable_quantity === 0;
              return (
                <div
                  key={item.product_id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
                  data-testid={`return-item-${item.product_id}`}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {item.product_name}
                    </p>
                    <p className="font-mono text-xs text-slate-500">
                      vendido {item.sold_quantity} · devolvido {item.returned_quantity} ·
                      disponível {item.returnable_quantity}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      size="icon-xs"
                      variant="outline"
                      aria-label={`Diminuir devolução de ${item.product_name}`}
                      data-testid={`return-qty-dec-${item.product_id}`}
                      disabled={disabled || qty === 0}
                      onClick={() => bump(item.product_id, item.returnable_quantity, -1)}
                    >
                      <Minus className="size-3" />
                    </Button>
                    <span
                      className="w-7 text-center font-mono text-sm font-semibold tabular-nums"
                      data-testid={`return-qty-value-${item.product_id}`}
                    >
                      {qty}
                    </span>
                    <Button
                      size="icon-xs"
                      variant="outline"
                      aria-label={`Aumentar devolução de ${item.product_name}`}
                      data-testid={`return-qty-inc-${item.product_id}`}
                      disabled={disabled || qty >= item.returnable_quantity}
                      onClick={() => bump(item.product_id, item.returnable_quantity, 1)}
                    >
                      <Plus className="size-3" />
                    </Button>
                  </div>
                </div>
              );
            })}

            <div className="space-y-1.5">
              <Label htmlFor="return-reason">Motivo</Label>
              <Input
                id="return-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Ex.: produto com defeito"
                data-testid="return-reason-input"
              />
            </div>

            <label className="flex items-center gap-2 text-sm text-slate-700">
              <Checkbox
                checked={restock}
                onCheckedChange={(checked) => setRestock(checked === true)}
                data-testid="return-restock-checkbox"
              />
              Devolver os itens ao estoque
            </label>

            <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
              <span className="text-sm font-semibold text-slate-700">Valor a estornar</span>
              <span
                className="font-mono text-lg font-bold tabular-nums text-red-600"
                data-testid="return-refund-total"
              >
                {money(refundTotal)}
              </span>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSelected(null)} data-testid="return-cancel-btn">
              Cancelar
            </Button>
            <Button
              onClick={() => submit.mutate()}
              disabled={!hasQuantity || submit.isPending}
              data-testid="return-submit-btn"
            >
              {submit.isPending ? "Registrando…" : "Confirmar devolução"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
