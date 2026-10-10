import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BellOff, PackagePlus } from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPut } from "@/lib/api";
import type { AlertSettings, Product } from "@/lib/types";
import { errorMessage, money, stockStatus } from "@/lib/format";
import { useCurrentUser } from "@/lib/useCurrentUser";
import AppShell from "@/components/AppShell";
import MovementDialog from "@/components/MovementDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";

export default function Alerts() {
  const [restockId, setRestockId] = useState<string | null>(null);
  const { isAdmin } = useCurrentUser();
  const queryClient = useQueryClient();

  const { data: settings } = useQuery({
    queryKey: ["alert-settings"],
    queryFn: () => apiGet<AlertSettings>("/settings/alerts"),
    refetchOnWindowFocus: false,
  });
  const alertsOn = settings?.low_stock_enabled ?? true;

  const toggleAlerts = useMutation({
    mutationFn: (enabled: boolean) =>
      apiPut<AlertSettings>("/settings/alerts", { low_stock_enabled: enabled }),
    onSuccess: (result) => {
      queryClient.setQueryData(["alert-settings"], result);
      // o contador do menu e o painel inicial usam os mesmos números
      void queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      toast.success(result.low_stock_enabled ? "Alertas de estoque ligados" : "Alertas de estoque desligados");
    },
    onError: (error) => toast.error(errorMessage(error, "Não foi possível mudar os alertas")),
  });

  const { data, isError } = useQuery({
    queryKey: ["products"],
    queryFn: () => apiGet<Product[]>("/products"),
    refetchOnWindowFocus: false,
  });
  const products = isError ? [] : (data ?? []);
  const alerts = alertsOn
    ? products
        .filter((product) => product.current_stock <= product.min_stock)
        .sort((a, b) => a.current_stock - b.current_stock)
    : [];

  return (
    <AppShell>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Alertas de Reposição</h1>
          <p className="mt-1 text-sm font-medium text-slate-500">
            Produtos no limite ou abaixo do estoque mínimo definido
          </p>
        </div>
        {isAdmin && (
          <label
            className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm shadow-xs"
            data-testid="alerts-toggle"
          >
            <Checkbox
              checked={alertsOn}
              disabled={toggleAlerts.isPending}
              onCheckedChange={(checked) => toggleAlerts.mutate(checked === true)}
              aria-label="Ligar ou desligar os alertas de estoque"
              data-testid="alerts-toggle-checkbox"
            />
            <span>
              <span className="block font-semibold text-slate-900">
                {alertsOn ? "Alertas ligados" : "Alertas desligados"}
              </span>
              <span className="block text-xs text-slate-500">
                Avisar quando o estoque chegar ao mínimo ou acabar
              </span>
            </span>
          </label>
        )}
      </div>

      {!alertsOn && (
        <Card className="mb-4 border-slate-200 bg-slate-50 shadow-xs" data-testid="alerts-off-notice">
          <CardContent className="flex items-center gap-3 p-5 text-sm text-slate-600">
            <BellOff className="size-5 shrink-0 text-slate-400" />
            {isAdmin
              ? "Os alertas de estoque estão desligados. Marque a caixa acima para voltar a receber os avisos."
              : "Os alertas de estoque foram desligados pelo administrador da loja."}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid="alerts-list">
        {alerts.map((product) => {
          const status = stockStatus(product);
          return (
            <Card
              key={product.id}
              data-testid={`alert-card-${product.id}`}
              className={`shadow-xs transition-shadow duration-150 ease-out hover:shadow-sm ${
                status === "ESGOTADO"
                  ? "border-red-200 bg-red-50/60 animate-pulse-alert"
                  : "border-amber-200 bg-amber-50/60"
              }`}
            >
              <CardContent className="space-y-3 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-slate-900">{product.name}</p>
                    <p className="mt-1 font-mono text-[11px] uppercase tracking-wider text-slate-500">
                      {product.sku} · {product.category}
                    </p>
                  </div>
                  <AlertTriangle
                    className={`size-5 shrink-0 ${
                      status === "ESGOTADO" ? "text-red-600" : "text-amber-600"
                    }`}
                  />
                </div>
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <p className="font-mono text-2xl font-bold tabular-nums text-slate-900">
                      {product.current_stock}
                      <span className="ml-1 text-sm font-normal text-slate-500">
                        / mín {product.min_stock}
                      </span>
                    </p>
                    <p className="text-xs text-slate-500">Custo {money(product.cost_price)}</p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => setRestockId(product.id)}
                    data-testid={`alert-restock-btn-${product.id}`}
                    className="active:scale-[0.98]"
                  >
                    <PackagePlus className="size-4" />
                    Repor
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
        {alertsOn && alerts.length === 0 && (
          <Card className="col-span-full border-emerald-200 bg-emerald-50/50 shadow-xs">
            <CardContent className="p-8 text-center text-sm font-medium text-emerald-800">
              Nenhum produto abaixo do estoque mínimo. Tudo em ordem.
            </CardContent>
          </Card>
        )}
      </div>

      <MovementDialog
        mode="ENTRADA"
        open={restockId !== null}
        onOpenChange={(open) => !open && setRestockId(null)}
        products={products}
        presetProductId={restockId ?? undefined}
      />
    </AppShell>
  );
}
