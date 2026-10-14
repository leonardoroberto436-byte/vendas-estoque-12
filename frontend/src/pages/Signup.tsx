import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { Building2, CheckCircle2, Flame, Mail, Store } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import type { SignupResponse } from "@/lib/types";
import { errorMessage } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { BRAND_NAME } from "@/lib/brand";

export default function Signup() {
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<SignupResponse | null>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // Oferta Fundador: preço e vagas vêm do servidor (mesma regra que cobra).
  const { data: pub } = useQuery({
    queryKey: ["public-plans"],
    queryFn: () =>
      apiGet<{
        trial_days: number;
        plans: { id: string; label: string; price: number }[];
        founder_coupon: string;
        founder_discount: number;
        founder_slots_left: number;
      }>("/public/plans"),
    staleTime: 5 * 60 * 1000,
  });
  const inicial = pub?.plans.find((p) => p.id === "INICIAL") ?? pub?.plans[0];
  const founderPrice =
    inicial && pub ? (inicial.price * (1 - pub.founder_discount)).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "";
  const showFounder = !!pub && pub.founder_slots_left > 0 && !!inicial;

  const signup = useMutation({
    mutationFn: () =>
      apiPost<SignupResponse>("/auth/signup", {
        name: name.trim(),
        company_name: company.trim(),
        email: email.trim(),
        whatsapp: whatsapp.replace(/\D/g, ""),
        password,
        accept_terms: accepted,
      }),
    onSuccess: async (data) => {
      // a conta já nasce liberada e logada: vai direto para o sistema
      setDone(data);
      // guarda o cupom para já aparecer preenchido na tela de assinatura
      if (showFounder && pub) {
        try {
          localStorage.setItem("ep_cupom", pub.founder_coupon);
        } catch {
          /* sem armazenamento: o cupom pode ser digitado na assinatura */
        }
      }
      // GA4: conta o cadastro de teste como conversão (sem dados pessoais)
      (window as unknown as { gtag?: (...a: unknown[]) => void }).gtag?.("event", "sign_up", { method: "teste_gratis" });
      // Pixel da Meta: conta o cadastro (sem dados pessoais)
      (window as unknown as { fbq?: (...a: unknown[]) => void }).fbq?.("track", "CompleteRegistration");
      await queryClient.invalidateQueries({ queryKey: ["auth-me"] });
      navigate("/", { replace: true });
    },
    onError: (err) => setError(errorMessage(err, "Não foi possível concluir o cadastro")),
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    if (name.trim().length < 2) return setError("Informe seu nome completo.");
    if (company.trim().length < 2) return setError("Informe o nome da empresa.");
    if (!email.includes("@")) return setError("Informe um e-mail válido.");
    const waDigits = whatsapp.replace(/\D/g, "");
    if (waDigits && (waDigits.length < 10 || waDigits.length > 13))
      return setError("WhatsApp inválido. Use DDD + número, ex.: (19) 99999-9999.");
    if (password.length < 10) return setError("A senha precisa ter pelo menos 10 caracteres, com letras e números.");
    if (password !== confirm) return setError("A confirmação não confere com a senha.");
    if (!accepted) return setError("Para criar a conta, aceite os Termos de Uso e a Política de Privacidade.");
    signup.mutate();
  };

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 px-5 py-10">
        <Card className="w-full max-w-md animate-rise-in border-emerald-200 shadow-sm">
          <CardContent className="p-8 text-center" data-testid="signup-success">
            <CheckCircle2 className="mx-auto size-12 text-emerald-600" />
            <h1 className="mt-4 text-xl font-bold tracking-tight text-slate-900">
              Conta criada
            </h1>
            <p className="mt-2 text-sm text-slate-600">{done.message}</p>
            <p className="mt-4 rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-700">
              Empresa: <strong>{done.company_name}</strong>
            </p>
            <Link
              to="/"
              className="mt-6 inline-flex rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
              data-testid="signup-go-login"
            >
              Entrar no sistema
            </Link>
          </CardContent>
        </Card>
        </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-100 px-5 py-10">
      <div className="w-full max-w-md">
        <div className="mb-7 flex items-center gap-3">
          <span className="flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <Store className="size-6" />
          </span>
          <div className="leading-tight">
            <p className="text-lg font-bold tracking-tight text-slate-900">
              {BRAND_NAME}
            </p>
            <p className="text-xs font-medium text-slate-500">
              Crie a conta da sua empresa — 7 dias de teste grátis
            </p>
          </div>
        </div>

        {showFounder && (
          <div
            className="mb-4 flex gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
            data-testid="signup-founder-offer"
          >
            <Flame className="mt-0.5 size-5 shrink-0 text-amber-600" />
            <div>
              <p className="font-bold">
                Oferta Fundador: {founderPrice}/mês para sempre no plano {inicial!.label}
              </p>
              <p className="mt-0.5">
                Metade do preço, só para as 10 primeiras lojas. Restam{" "}
                <strong>{pub!.founder_slots_left}</strong> vaga(s). Teste 7 dias grátis, sem cartão. O cupom{" "}
                <strong>{pub!.founder_coupon}</strong> já fica guardado para quando você assinar.
              </p>
            </div>
          </div>
        )}

        <Card className="animate-rise-in border-slate-200 shadow-sm">
          <CardContent className="p-6">
            <h1 className="text-xl font-bold tracking-tight text-slate-900">Criar conta</h1>
            <p className="mt-1 text-sm text-slate-500">
              Cada empresa tem seu próprio espaço de trabalho, isolado das demais.
            </p>

            <form onSubmit={submit} className="mt-6 space-y-4" data-testid="signup-form">
              <div className="space-y-1.5">
                <Label htmlFor="su-name">Seu nome</Label>
                <Input
                  id="su-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  data-testid="signup-name-input"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="su-company">Nome da empresa</Label>
                <div className="relative">
                  <Building2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    id="su-company"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    placeholder="Ex.: Mercado Central"
                    className="pl-9"
                    data-testid="signup-company-input"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="su-email">E-mail</Label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    id="su-email"
                    type="email"
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-9"
                    data-testid="signup-email-input"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="su-whatsapp">
                  WhatsApp <span className="font-normal text-slate-400">(opcional)</span>
                </Label>
                <Input
                  id="su-whatsapp"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={whatsapp}
                  onChange={(e) => setWhatsapp(e.target.value)}
                  placeholder="(19) 99999-9999"
                  maxLength={20}
                  data-testid="signup-whatsapp-input"
                />
                <p className="text-xs text-slate-500">Para a gente te ajudar a começar. Não enviamos propaganda.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="su-password">Senha</Label>
                  <Input
                    id="su-password"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    data-testid="signup-password-input"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="su-confirm">Confirmar</Label>
                  <Input
                    id="su-confirm"
                    type="password"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    data-testid="signup-confirm-input"
                  />
                </div>
              </div>

              <label className="flex items-start gap-2.5 text-sm text-slate-600" data-testid="signup-terms">
                <Checkbox
                  checked={accepted}
                  onCheckedChange={(checked) => setAccepted(checked === true)}
                  className="mt-0.5"
                  aria-label="Aceito os Termos de Uso e a Política de Privacidade"
                  data-testid="signup-terms-checkbox"
                />
                <span>
                  Li e aceito os{" "}
                  <Link to="/termos" target="_blank" className="font-semibold text-teal-700 hover:underline">
                    Termos de Uso
                  </Link>{" "}
                  e a{" "}
                  <Link to="/privacidade" target="_blank" className="font-semibold text-teal-700 hover:underline">
                    Política de Privacidade
                  </Link>
                  .
                </span>
              </label>

              {error && (
                <p
                  className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700"
                  data-testid="signup-error-message"
                >
                  {error}
                </p>
              )}

              <Button
                type="submit"
                className="w-full active:scale-[0.98]"
                disabled={signup.isPending}
                data-testid="signup-submit-button"
              >
                {signup.isPending ? "Enviando…" : "Criar conta da empresa"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="mt-5 text-center text-sm text-slate-500">
          Já tem conta?{" "}
          <Link to="/login" className="font-semibold text-teal-700 hover:underline" data-testid="signup-login-link">
            Entrar
          </Link>
        </p>
      </div>
    </div>
  );
}
