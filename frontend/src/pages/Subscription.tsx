import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, BadgeCheck, CreditCard, Loader2, Lock, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPost } from "@/lib/api";
import type { BillingInfo, PaidPlan, PlanLimit, SubscribeResponse } from "@/lib/types";
import { PLAN_LABELS, SUBSCRIPTION_LABELS, errorMessage, formatDateTime, money } from "@/lib/format";
import AppShell from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const PAID: PaidPlan[] = ["INICIAL", "PROFISSIONAL", "AVANCADO"];

const BLOCK_TEXT: Record<string, string> = {
  TESTE_ENCERRADO: "Seu teste grátis terminou. Escolha um plano abaixo para voltar a usar o sistema.",
  PAGAMENTO: "O acesso está suspenso por falta de pagamento. Atualize o pagamento para liberar na hora.",
  CANCELADO: "Sua assinatura foi cancelada. Assine um plano para voltar a usar.",
};

const unlimited = (value: number | null, unit: string) =>
  value === null ? `${unit} ilimitados` : `Até ${value.toLocaleString("pt-BR")} ${unit}`;

function features(limit: PlanLimit): string[] {
  return [
    unlimited(limit.users, "usuários"),
    unlimited(limit.products, "produtos"),
    "PDV, estoque, devoluções e cupom (impressão e WhatsApp)",
    limit.full_report ? "Relatório completo (lucro, margem, mais vendidos)" : "Relatório básico (vendas e faturamento)",
    limit.branding ? "Logo da loja no cupom e no relatório" : "Sem logo no cupom",
    limit.history_months === null
      ? "Histórico de relatórios ilimitado"
      : `Histórico de relatórios: ${limit.history_months} meses`,
  ];
}

function UsageBar({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const full = limit !== null && used >= limit;
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span className="font-medium text-slate-700">{label}</span>
        <span className={full ? "font-semibold text-red-600" : "text-slate-500"}>
          {used.toLocaleString("pt-BR")} de {limit === null ? "ilimitado" : limit.toLocaleString("pt-BR")}
        </span>
      </div>
      {limit !== null && (
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
          <div
            className={`h-full rounded-full ${full ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-teal-500"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

export default function Subscription() {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const returning = params.get("retorno") === "mercadopago";
  const [coupon, setCoupon] = useState("");
  const [payerEmail, setPayerEmail] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [changing, setChanging] = useState<PaidPlan | null>(null);

  const { data: info, isLoading, isError, error } = useQuery({
    queryKey: ["billing"],
    queryFn: () => apiGet<BillingInfo>("/billing"),
    refetchOnWindowFocus: true,
    // voltando do Mercado Pago: confere a cada 5 s até a assinatura ser confirmada
    refetchInterval: (query) =>
      returning && query.state.data?.mp_status !== "authorized" ? 5000 : false,
  });

  useEffect(() => {
    if (info?.mp_status === "authorized" && returning) {
      toast.success("Assinatura confirmada! Tudo liberado.");
      setParams({}, { replace: true });
      void queryClient.invalidateQueries({ queryKey: ["auth-me"] });
    }
  }, [info?.mp_status, returning, setParams, queryClient]);

  const subscribe = useMutation({
    mutationFn: (plan: PaidPlan) =>
      apiPost<SubscribeResponse>("/billing/subscribe", {
        plan,
        coupon: coupon.trim(),
        payer_email: payerEmail.trim() || null,
      }),
    onSuccess: (result) => {
      toast.message(result.message);
      window.location.href = result.checkout_url;
    },
    onError: (err) => toast.error(errorMessage(err, "Não foi possível iniciar a assinatura")),
  });

  const changePlan = useMutation({
    mutationFn: (plan: PaidPlan) => apiPost<BillingInfo>("/billing/change-plan", { plan }),
    onSuccess: (result) => {
      setChanging(null);
      queryClient.setQueryData(["billing"], result);
      void queryClient.invalidateQueries({ queryKey: ["auth-me"] });
      toast.success(
        result.plan_next
          ? `Combinado: o plano ${PLAN_LABELS[result.plan_next as PaidPlan]} começa na próxima cobrança`
          : `Plano alterado para ${result.plan_label}`,
      );
    },
    onError: (err) => toast.error(errorMessage(err, "Não foi possível trocar de plano")),
  });

  const cancel = useMutation({
    mutationFn: () => apiPost<BillingInfo>("/billing/cancel"),
    onSuccess: (result) => {
      setCancelOpen(false);
      queryClient.setQueryData(["billing"], result);
      toast.success("Renovação cancelada");
    },
    onError: (err) => toast.error(errorMessage(err, "Não foi possível cancelar")),
  });

  if (isLoading) {
    return (
      <AppShell>
        <p className="text-sm text-slate-500">Carregando assinatura…</p>
      </AppShell>
    );
  }
  if (isError || !info) {
    return (
      <AppShell>
        <p className="text-sm text-red-600">{errorMessage(error, "Não foi possível carregar a assinatura")}</p>
      </AppShell>
    );
  }

  const active = info.mp_status === "authorized" && !info.cancel_at;
  const founder = info.coupon === "FUNDADOR" || coupon.trim().toUpperCase() === "FUNDADOR";
  const priceFor = (plan: PaidPlan) => (founder ? info.prices[plan] * 0.5 : info.prices[plan]);

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Minha assinatura</h1>
        <p className="mt-1 text-sm text-slate-500">
          Plano, pagamento e uso da sua loja. A cobrança é mensal no cartão, pelo Mercado Pago.
        </p>
      </div>

      {info.billing_block && (
        <div
          className="mb-6 flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
          data-testid="billing-block-notice"
        >
          <Lock className="size-5 shrink-0" />
          <span className="font-medium">{BLOCK_TEXT[info.billing_block]}</span>
        </div>
      )}

      {returning && info.mp_status !== "authorized" && (
        <div
          className="mb-6 flex items-center gap-3 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900"
          data-testid="billing-returning"
        >
          <Loader2 className="size-5 shrink-0 animate-spin" />
          Recebemos seu retorno do Mercado Pago. Assim que o pagamento for confirmado (pode levar
          alguns minutos), sua assinatura é ativada sozinha nesta tela.
        </div>
      )}

      {info.payment_failed_at && (
        <div
          className="mb-6 flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
          data-testid="billing-payment-failed"
        >
          <AlertTriangle className="size-5 shrink-0" />
          <span>
            O último pagamento não foi aprovado. O Mercado Pago vai tentar de novo.
            {info.suspend_on && ` Se não for regularizado até ${formatDateTime(info.suspend_on)}, o acesso será suspenso.`}{" "}
            Confira o cartão no Mercado Pago ou assine de novo com outro cartão.
          </span>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="border-slate-200/90 shadow-xs">
          <CardHeader>
            <CardTitle className="text-base font-bold tracking-tight">Situação atual</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-3" data-testid="billing-status">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wider text-slate-500">Plano</dt>
                <dd className="mt-1 font-semibold text-slate-900">{info.plan_label}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wider text-slate-500">Assinatura</dt>
                <dd className="mt-1 font-semibold text-slate-900">{SUBSCRIPTION_LABELS[info.subscription_status]}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wider text-slate-500">Valor</dt>
                <dd className="mt-1 font-semibold text-slate-900">
                  {info.plan === "TESTE" ? "Grátis" : `${money(info.price)}/mês`}
                  {info.coupon && <span className="ml-1 text-xs font-medium text-teal-700">({info.coupon})</span>}
                </dd>
              </div>
              {info.plan === "TESTE" && info.trial_ends_at && (
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wider text-slate-500">Teste termina</dt>
                  <dd className="mt-1 font-semibold text-slate-900">{formatDateTime(info.trial_ends_at)}</dd>
                </div>
              )}
              {info.due_date && info.plan !== "TESTE" && (
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    {info.cancel_at ? "Acesso até" : "Próxima cobrança"}
                  </dt>
                  <dd className="mt-1 font-semibold text-slate-900">
                    {formatDateTime(info.cancel_at ?? info.due_date)}
                  </dd>
                </div>
              )}
              {info.plan_next && (
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wider text-slate-500">Na próxima cobrança</dt>
                  <dd className="mt-1 font-semibold text-slate-900">
                    Plano {PLAN_LABELS[info.plan_next as PaidPlan] ?? info.plan_next}
                  </dd>
                </div>
              )}
            </dl>
            {active && (
              <Button
                variant="ghost"
                className="mt-5 text-red-600 hover:bg-red-50 hover:text-red-700"
                onClick={() => setCancelOpen(true)}
                data-testid="billing-cancel-button"
              >
                Cancelar renovação
              </Button>
            )}
          </CardContent>
        </Card>

        <Card className="border-slate-200/90 shadow-xs">
          <CardHeader>
            <CardTitle className="text-base font-bold tracking-tight">Uso do plano</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4" data-testid="billing-usage">
            <UsageBar label="Usuários" used={info.usage.users.used} limit={info.usage.users.limit} />
            <UsageBar label="Produtos" used={info.usage.products.used} limit={info.usage.products.limit} />
            <p className="text-xs text-slate-500">
              Ao chegar no limite, só o cadastro de itens novos é bloqueado — nada é apagado.
            </p>
          </CardContent>
        </Card>
      </div>

      <h2 className="mb-3 mt-8 text-lg font-bold tracking-tight text-slate-900">
        {active ? "Mudar de plano" : "Escolha seu plano"}
      </h2>

      {!info.billing_enabled ? (
        <Card className="border-slate-200 bg-slate-50 shadow-xs" data-testid="billing-disabled">
          <CardContent className="p-5 text-sm text-slate-600">
            A assinatura on-line ainda não está ativada. Fale com o suporte para escolher seu plano.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3" data-testid="billing-plans">
            {PAID.map((plan) => {
              const current = info.plan === plan && active;
              const highlight = plan === "PROFISSIONAL";
              return (
                <Card
                  key={plan}
                  className={`flex flex-col shadow-xs ${highlight ? "border-teal-400 ring-1 ring-teal-400" : "border-slate-200/90"}`}
                  data-testid={`billing-plan-${plan}`}
                >
                  <CardContent className="flex flex-1 flex-col p-5">
                    <div className="flex items-center justify-between">
                      <p className="text-base font-bold text-slate-900">{PLAN_LABELS[plan]}</p>
                      {highlight && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2 py-0.5 text-[11px] font-semibold text-teal-700">
                          <Sparkles className="size-3" /> Mais escolhido
                        </span>
                      )}
                    </div>
                    <p className="mt-3 font-mono text-3xl font-bold tabular-nums text-slate-900">
                      {money(priceFor(plan))}
                      <span className="ml-1 font-sans text-sm font-normal text-slate-500">/mês</span>
                    </p>
                    {founder && (
                      <p className="text-xs text-slate-400 line-through">{money(info.prices[plan])}</p>
                    )}
                    <ul className="mt-4 flex-1 space-y-1.5 text-sm text-slate-600">
                      {features(info.limits[plan]).map((item) => (
                        <li key={item} className="flex gap-2">
                          <BadgeCheck className="mt-0.5 size-4 shrink-0 text-teal-600" />
                          {item}
                        </li>
                      ))}
                    </ul>
                    {active ? (
                      <Button
                        className="mt-5"
                        variant={current ? "outline" : "default"}
                        disabled={current || changePlan.isPending}
                        onClick={() => setChanging(plan)}
                        data-testid={`billing-change-${plan}`}
                      >
                        {current ? "Seu plano atual" : "Mudar para este plano"}
                      </Button>
                    ) : (
                      <Button
                        className="mt-5"
                        disabled={subscribe.isPending}
                        onClick={() => subscribe.mutate(plan)}
                        data-testid={`billing-subscribe-${plan}`}
                      >
                        <CreditCard className="size-4" />
                        {subscribe.isPending ? "Abrindo Mercado Pago…" : "Assinar"}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {!active && (
            <Card className="mt-4 border-slate-200/90 shadow-xs">
              <CardContent className="grid gap-4 p-5 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="billing-coupon">Cupom (opcional)</Label>
                  <Input
                    id="billing-coupon"
                    value={coupon}
                    onChange={(e) => setCoupon(e.target.value)}
                    placeholder="Ex.: FUNDADOR"
                    data-testid="billing-coupon-input"
                  />
                  <p className="text-xs text-slate-500">
                    {info.founder_slots_left > 0
                      ? `Cupom FUNDADOR: 50% de desconto para sempre — restam ${info.founder_slots_left} vaga(s).`
                      : "As vagas do cupom FUNDADOR já acabaram."}
                  </p>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="billing-payer">E-mail da conta Mercado Pago (opcional)</Label>
                  <Input
                    id="billing-payer"
                    type="email"
                    value={payerEmail}
                    onChange={(e) => setPayerEmail(e.target.value)}
                    placeholder="Se for diferente do seu e-mail de login"
                    data-testid="billing-payer-input"
                  />
                  <p className="text-xs text-slate-500">
                    Use o e-mail com que você entra no Mercado Pago para pagar.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <Dialog open={changing !== null} onOpenChange={(open) => !open && setChanging(null)}>
        <DialogContent className="sm:max-w-md" data-testid="billing-change-dialog">
          <DialogHeader>
            <DialogTitle>Mudar para o plano {changing ? PLAN_LABELS[changing] : ""}</DialogTitle>
            <DialogDescription>
              {changing && info.prices[changing] >= (info.prices[info.plan as PaidPlan] ?? 0)
                ? "O plano novo vale na hora. A próxima cobrança já vem com o valor novo."
                : "O plano menor começa na próxima cobrança. Até lá você continua com o plano atual."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChanging(null)}>
              Voltar
            </Button>
            <Button
              disabled={!changing || changePlan.isPending}
              onClick={() => changing && changePlan.mutate(changing)}
              data-testid="billing-change-confirm"
            >
              {changePlan.isPending ? "Alterando…" : "Confirmar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent className="sm:max-w-md" data-testid="billing-cancel-dialog">
          <DialogHeader>
            <DialogTitle>Cancelar a renovação?</DialogTitle>
            <DialogDescription>
              Não haverá novas cobranças. Você continua usando até{" "}
              {info.due_date ? formatDateTime(info.due_date) : "o fim do período pago"}. Antes de sair,
              você pode baixar todos os seus dados em Minha Empresa.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>
              Manter assinatura
            </Button>
            <Button
              variant="destructive"
              disabled={cancel.isPending}
              onClick={() => cancel.mutate()}
              data-testid="billing-cancel-confirm"
            >
              {cancel.isPending ? "Cancelando…" : "Cancelar renovação"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
