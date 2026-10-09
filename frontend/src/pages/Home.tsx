import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  BadgeDollarSign,
  Boxes,
  Receipt,
  TrendingUp,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { apiGet } from "@/lib/api";
import type { DashboardStats } from "@/lib/types";
import { formatShortDate, money } from "@/lib/format";
import AppShell from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface KpiProps {
  label: string;
  value: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: "teal" | "sky" | "amber" | "slate";
  testId: string;
}

const TONES: Record<KpiProps["tone"], string> = {
  teal: "bg-teal-50 text-teal-700",
  sky: "bg-sky-50 text-sky-700",
  amber: "bg-amber-50 text-amber-700",
  slate: "bg-slate-100 text-slate-700",
};

function Kpi({ label, value, hint, icon: Icon, tone, testId }: KpiProps) {
  return (
    <Card className="animate-rise-in border-slate-200/90 shadow-xs transition-shadow duration-150 ease-out hover:shadow-sm">
      <CardContent className="flex items-start justify-between gap-3 p-5">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</p>
          <p
            className="mt-2 truncate font-mono text-2xl font-semibold tabular-nums tracking-tight text-slate-900"
            data-testid={testId}
          >
            {value}
          </p>
          <p className="mt-1 text-xs text-slate-500">{hint}</p>
        </div>
        <span className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${TONES[tone]}`}>
          <Icon className="size-5" />
        </span>
      </CardContent>
    </Card>
  );
}

export default function Home() {
  const { data, isError, isLoading } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: () => apiGet<DashboardStats>("/dashboard/stats"),
    refetchOnWindowFocus: false,
  });

  const stats = isError ? undefined : data;
  const series = (stats?.revenue_series ?? []).map((point) => ({
    ...point,
    label: formatShortDate(point.date),
  }));

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Visão Geral</h1>
          <p className="mt-1 text-sm font-medium text-slate-500">
            Resumo de vendas, faturamento e saúde do estoque
          </p>
        </div>
        {stats && (
          <Badge variant="secondary" className="font-mono text-xs" data-testid="dashboard-product-count">
            {stats.product_count} produtos cadastrados
          </Badge>
        )}
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          label="Vendas Hoje"
          value={stats ? String(stats.today_sales_count) : "—"}
          hint="Pedidos finalizados hoje"
          icon={Receipt}
          tone="sky"
          testId="kpi-today-sales-count"
        />
        <Kpi
          label="Faturamento Hoje"
          value={stats ? money(stats.today_revenue) : "—"}
          hint={stats ? `Lucro estimado ${money(stats.today_profit)}` : "Sem dados"}
          icon={BadgeDollarSign}
          tone="teal"
          testId="kpi-today-revenue"
        />
        <Kpi
          label="Produtos em Alerta"
          value={stats ? String(stats.low_stock_count) : "—"}
          hint={stats ? `${stats.out_of_stock_count} esgotados` : "Sem dados"}
          icon={AlertTriangle}
          tone="amber"
          testId="kpi-low-stock-count"
        />
        <Kpi
          label="Estoque em R$"
          value={stats ? money(stats.inventory_value) : "—"}
          hint="Valor a preço de custo"
          icon={Boxes}
          tone="slate"
          testId="kpi-total-inventory-value"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <Card className="border-slate-200/90 shadow-xs lg:col-span-7">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base font-bold tracking-tight">
              <TrendingUp className="size-4 text-teal-600" />
              Faturamento dos últimos 7 dias
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64" data-testid="chart-revenue-container">
              {series.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
                    <YAxis tickLine={false} axisLine={false} fontSize={12} width={64} />
                    <Tooltip
                      formatter={(value: number) => money(value)}
                      labelFormatter={(label: string) => `Dia ${label}`}
                    />
                    <Line
                      type="monotone"
                      dataKey="revenue"
                      stroke="#0d9488"
                      strokeWidth={2.5}
                      dot={{ r: 3, fill: "#0d9488" }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-slate-500">
                  {isLoading ? "Carregando dados…" : "Nenhum dado de faturamento disponível"}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200/90 shadow-xs lg:col-span-5">
          <CardHeader>
            <CardTitle className="text-base font-bold tracking-tight">
              Produtos mais vendidos (7 dias)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64" data-testid="chart-top-products-container">
              {(stats?.top_products.length ?? 0) > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={stats?.top_products ?? []}
                    layout="vertical"
                    margin={{ top: 4, right: 16, left: 8, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                    <XAxis type="number" tickLine={false} axisLine={false} fontSize={12} />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={110}
                      tickLine={false}
                      axisLine={false}
                      fontSize={11}
                    />
                    <Tooltip
                      formatter={(value: number, name: string) =>
                        name === "revenue" ? money(value) : `${value} un.`
                      }
                    />
                    <Bar dataKey="quantity" fill="#0284c7" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-slate-500">
                  {isLoading ? "Carregando dados…" : "Nenhuma venda registrada nos últimos 7 dias"}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-amber-200 bg-amber-50/40 shadow-xs lg:col-span-12">
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-3 text-base font-bold tracking-tight">
              <span className="flex items-center gap-2">
                <AlertTriangle className="size-4 text-amber-600" />
                Alertas de reposição
              </span>
              <Link
                to="/alertas"
                className="text-xs font-semibold text-teal-700 underline-offset-4 hover:underline"
                data-testid="dashboard-alerts-see-all"
              >
                ver todos
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid="dashboard-alerts-list">
              {(stats?.low_stock_items ?? []).slice(0, 6).map((item) => (
                <li
                  key={item.id}
                  data-testid={`dashboard-alert-item-${item.id}`}
                  className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-white px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">{item.name}</p>
                    <p className="font-mono text-[11px] uppercase tracking-wider text-slate-500">
                      {item.sku}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-md px-2 py-1 font-mono text-xs font-bold ${
                      item.current_stock === 0
                        ? "bg-red-100 text-red-800"
                        : "bg-amber-100 text-amber-900"
                    }`}
                  >
                    {item.current_stock}/{item.min_stock}
                  </span>
                </li>
              ))}
              {(stats?.low_stock_items.length ?? 0) === 0 && (
                <li className="text-sm text-slate-600">
                  {isLoading ? "Carregando…" : "Nenhum produto abaixo do estoque mínimo."}
                </li>
              )}
            </ul>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
