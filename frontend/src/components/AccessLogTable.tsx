import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import { apiGet } from "@/lib/api";
import type { AccessLog } from "@/lib/types";
import { formatDateTime } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const EVENT_LABELS: Record<AccessLog["event"], string> = {
  LOGIN_OK: "Entrou",
  LOGIN_FALHOU: "Senha incorreta",
  LOGIN_BLOQUEADO: "Acesso bloqueado",
  LOGOUT: "Saiu",
  CADASTRO: "Conta criada",
  RESET_SOLICITADO: "Pediu nova senha",
  RESET_CONCLUIDO: "Senha redefinida",
};

const EVENT_CLASSES: Record<AccessLog["event"], string> = {
  LOGIN_OK: "bg-emerald-100 text-emerald-800 border-emerald-200",
  LOGIN_FALHOU: "bg-red-100 text-red-800 border-red-200",
  LOGIN_BLOQUEADO: "bg-amber-100 text-amber-900 border-amber-200",
  LOGOUT: "bg-slate-100 text-slate-700 border-slate-200",
  CADASTRO: "bg-sky-100 text-sky-800 border-sky-200",
  RESET_SOLICITADO: "bg-amber-100 text-amber-900 border-amber-200",
  RESET_CONCLUIDO: "bg-teal-100 text-teal-800 border-teal-200",
};

/** Short device summary so the admin recognises the machine without reading a UA string. */
function deviceOf(userAgent: string): string {
  if (!userAgent) return "—";
  const mobile = /iPhone|Android|iPad|Mobile/i.test(userAgent) ? "Celular" : "Computador";
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /OPR\//.test(userAgent)
      ? "Opera"
      : /Chrome\//.test(userAgent)
        ? "Chrome"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : /Firefox\//.test(userAgent)
            ? "Firefox"
            : "Navegador";
  return `${mobile} · ${browser}`;
}

export default function AccessLogTable() {
  const { data, isError, isLoading } = useQuery({
    queryKey: ["access-logs"],
    queryFn: () => apiGet<AccessLog[]>("/users/access-logs"),
    refetchOnWindowFocus: false,
  });
  const logs = isError ? [] : (data ?? []);

  return (
    <Card className="mt-6 border-slate-200/90 shadow-xs">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base font-bold tracking-tight">
          <History className="size-4 text-teal-600" />
          Registro de acesso
          <span className="ml-1 text-xs font-medium text-slate-500">
            (últimos {logs.length} eventos)
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table data-testid="access-logs-table">
          <TableHeader>
            <TableRow>
              <TableHead>Quando</TableHead>
              <TableHead>Usuário</TableHead>
              <TableHead>Evento</TableHead>
              <TableHead>Dispositivo</TableHead>
              <TableHead>IP</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logs.map((log) => (
              <TableRow key={log.id} data-testid={`access-log-row-${log.id}`}>
                <TableCell className="whitespace-nowrap font-mono text-xs tabular-nums text-slate-600">
                  {formatDateTime(log.created_at)}
                </TableCell>
                <TableCell>
                  <p className="font-semibold text-slate-900">{log.user_name}</p>
                  <p className="text-xs text-slate-500">{log.email}</p>
                </TableCell>
                <TableCell>
                  <span
                    className={`inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium ${EVENT_CLASSES[log.event]}`}
                    data-testid={`access-log-event-${log.id}`}
                  >
                    {EVENT_LABELS[log.event]}
                  </span>
                </TableCell>
                <TableCell className="text-slate-600">{deviceOf(log.user_agent)}</TableCell>
                <TableCell className="font-mono text-xs tabular-nums text-slate-500">
                  {log.ip || "—"}
                </TableCell>
              </TableRow>
            ))}
            {logs.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-sm text-slate-500">
                  {isLoading ? "Carregando…" : "Nenhum acesso registrado ainda."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
