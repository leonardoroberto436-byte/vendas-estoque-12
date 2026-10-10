import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileSpreadsheet, Printer } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { apiGet } from "@/lib/api";
import type { MonthlyReport, OrgBranding, ReportMonth } from "@/lib/types";
import { PAYMENT_LABELS, formatDateTime, money } from "@/lib/format";
import { useCurrentUser } from "@/lib/useCurrentUser";
import AppShell from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const keyOf = (month: ReportMonth) => `${month.year}-${String(month.month).padStart(2, "0")}`;

export default function MonthlyReportPage() {
  const [selected, setSelected] = useState("");

  const { user } = useCurrentUser();
  const { data: branding } = useQuery({
    queryKey: ["branding"],
    queryFn: () => apiGet<OrgBranding>("/settings/branding"),
    refetchOnWindowFocus: false,
  });

  const { data: monthData, isError: monthError } = useQuery({
    queryKey: ["report-months"],
    queryFn: () => apiGet<ReportMonth[]>("/reports/months"),
    refetchOnWindowFocus: false,
  });
  const months = monthError ? [] : (monthData ?? []);
  const firstMonth = months.at(0);
  const active = selected || (firstMonth ? keyOf(firstMonth) : "");
  // split/indexado pode devolver undefined ou NaN — só consultamos com ano e mês válidos
  const parts = active ? active.split("-").map(Number) : [];
  const year = Number.isFinite(parts.at(0)) ? parts.at(0) : undefined;
  const month = Number.isFinite(parts.at(1)) ? parts.at(1) : undefined;

  const { data: reportData, isError: reportError } = useQuery({
    queryKey: ["monthly-report", year, month],
    queryFn: () =>
      apiGet<MonthlyReport>(
        year && month ? `/reports/monthly?year=${year}&month=${month}` : "/reports/monthly",
      ),
    enabled: active !== "" || months.length === 0,
    refetchOnWindowFocus: false,
  });
  const report = reportError ? undefined : reportData;

  const chartData = (report?.daily ?? []).map((point) => ({
    ...point,
    label: String(point.day).padStart(2, "0"),
  }));

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Relatório Mensal</h1>
          <p className="mt-1 text-sm font-medium text-slate-500">
            Fechamento do mês com faturamento, lucro e produtos mais vendidos
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={active} onValueChange={(value: string) => setSelected(value)}>
            <SelectTrigger className="w-48" data-testid="report-month-select">
              <SelectValue placeholder="Selecione o mês">
                {(value) => months.find((m) => keyOf(m) === value)?.label ?? "Selecione o mês"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {months.map((item) => (
                <SelectItem key={keyOf(item)} value={keyOf(item)}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <a
            href={
              year && month
                ? `/api/reports/monthly.xlsx?year=${year}&month=${month}`
                : "/api/reports/monthly.xlsx"
            }
            className="inline-flex items-center gap-2 rounded-lg border border-input bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-xs transition-colors duration-150 ease-out hover:bg-slate-50 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2"
            data-testid="report-export-xlsx-btn"
          >
            <FileSpreadsheet className="size-4" />
            Excel
          </a>
          <Button
            onClick={() => window.print()}
            data-testid="report-print-btn"
            className="active:scale-[0.98]"
          >
            <Printer className="size-4" />
            Imprimir
          </Button>
        </div>
      </div>

      <div id="report-sheet" className="space-y-6">
        <div className="hidden print:block">
          {branding?.logo && (
            <img src={branding.logo} alt="" className="mb-2 max-h-16 object-contain" />
          )}
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">
            {branding?.trade_name?.trim() || user?.organization?.name || "Estoque & Vendas Pro"} —
            Fechamento {report?.label ?? ""}
          </h2>
          {(branding?.cnpj?.trim() || branding?.phone?.trim() || branding?.address?.trim()) && (
            <p className="text-xs text-slate-500">
              {[branding?.cnpj && `CNPJ: ${branding.cnpj}`, branding?.address, branding?.phone]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
          <p className="text-xs text-slate-500">
            Emitido em {report ? formatDateTime(report.generated_at) : ""}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[
            { label: "Faturamento", value: report ? money(report.revenue) : "—", testId: "report-kpi-revenue" },
            { label: "Lucro", value: report ? money(report.profit) : "—", testId: "report-kpi-profit" },
            {
              label: "Vendas",
              value: report ? String(report.sales_count) : "—",
              testId: "report-kpi-sales-count",
            },
            {
              label: "Ticket médio",
              value: report ? money(report.average_ticket) : "—",
              testId: "report-kpi-average-ticket",
            },
          ].map((kpi) => (
            <Card key={kpi.testId} className="border-slate-200/90 shadow-xs">
              <CardContent className="p-5">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  {kpi.label}
                </p>
                <p
                  className="mt-2 font-mono text-2xl font-semibold tabular-nums tracking-tight text-slate-900"
                  data-testid={kpi.testId}
                >
                  {kpi.value}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="border-slate-200/90 shadow-xs">
          <CardHeader>
            <CardTitle className="text-base font-bold tracking-tight">Resumo do mês</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
              {[
                { label: "Itens vendidos", value: report ? String(report.items_sold) : "—" },
                { label: "Custo das vendas", value: report ? money(report.cost) : "—" },
                { label: "Descontos", value: report ? money(report.discount_total) : "—" },
                { label: "Margem", value: report ? `${report.margin_percent}%` : "—", testId: "report-margin" },
                {
                  label: "Melhor dia",
                  value: report?.best_day ? `Dia ${report.best_day}` : "—",
                },
                {
                  label: "Faturamento do melhor dia",
                  value: report ? money(report.best_day_revenue) : "—",
                },
              ].map((row) => (
                <div key={row.label}>
                  <dt className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    {row.label}
                  </dt>
                  <dd
                    className="mt-1 font-mono font-semibold tabular-nums text-slate-900"
                    data-testid={row.testId}
                  >
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        <Card className="border-slate-200/90 shadow-xs break-inside-avoid">
          <CardHeader>
            <CardTitle className="text-base font-bold tracking-tight">
              Faturamento por dia
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64" data-testid="report-daily-chart">
              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
                    <YAxis tickLine={false} axisLine={false} fontSize={11} width={64} />
                    <Tooltip
                      formatter={(value: number) => money(value)}
                      labelFormatter={(label: string) => `Dia ${label}`}
                    />
                    <Bar dataKey="revenue" fill="#0d9488" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-slate-500">
                  Nenhuma venda registrada neste mês.
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <Card className="border-slate-200/90 shadow-xs break-inside-avoid lg:col-span-7">
            <CardHeader>
              <CardTitle className="text-base font-bold tracking-tight">
                Produtos mais vendidos
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table data-testid="report-top-products-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Produto</TableHead>
                    <TableHead className="text-right">Qtd.</TableHead>
                    <TableHead className="text-right">Faturamento</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(report?.top_products ?? []).map((item, index) => (
                    <TableRow key={item.product_id} data-testid={`report-top-row-${item.product_id}`}>
                      <TableCell className="font-mono text-slate-400">{index + 1}</TableCell>
                      <TableCell className="font-semibold text-slate-900">{item.name}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {item.quantity}
                      </TableCell>
                      <TableCell className="text-right font-mono font-semibold tabular-nums">
                        {money(item.revenue)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {(report?.top_products.length ?? 0) === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="py-10 text-center text-sm text-slate-500">
                        Nenhum produto vendido neste mês.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="border-slate-200/90 shadow-xs break-inside-avoid lg:col-span-5">
            <CardHeader>
              <CardTitle className="text-base font-bold tracking-tight">
                Formas de pagamento
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3" data-testid="report-payments-list">
              {(report?.payments ?? []).map((row) => (
                <div key={row.payment_method} className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-slate-700">
                      {PAYMENT_LABELS[row.payment_method]}
                      <span className="ml-1.5 text-xs text-slate-400">
                        ({row.sales_count} vendas)
                      </span>
                    </span>
                    <span className="font-mono font-semibold tabular-nums">
                      {money(row.revenue)}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-teal-600 transition-[width] duration-300 ease-out"
                      style={{ width: `${row.share_percent}%` }}
                    />
                  </div>
                </div>
              ))}
              {(report?.payments.length ?? 0) === 0 && (
                <p className="py-6 text-center text-sm text-slate-500">
                  Nenhum pagamento registrado neste mês.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
