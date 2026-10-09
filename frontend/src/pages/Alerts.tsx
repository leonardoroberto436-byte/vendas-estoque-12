import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, PackagePlus } from "lucide-react";
import { apiGet } from "@/lib/api";
import type { Product } from "@/lib/types";
import { money, stockStatus } from "@/lib/format";
import AppShell from "@/components/AppShell";
import MovementDialog from "@/components/MovementDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function Alerts() {
  const [restockId, setRestockId] = useState<string | null>(null);

  const { data, isError } = useQuery({
    queryKey: ["products"],
    queryFn: () => apiGet<Product[]>("/products"),
    refetchOnWindowFocus: false,
  });
  const products = isError ? [] : (data ?? []);
  const alerts = products
    .filter((product) => product.current_stock <= product.min_stock)
    .sort((a, b) => a.current_stock - b.current_stock);

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Alertas de Reposição</h1>
        <p className="mt-1 text-sm font-medium text-slate-500">
          Produtos no limite ou abaixo do estoque mínimo definido
        </p>
      </div>

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
        {alerts.length === 0 && (
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
