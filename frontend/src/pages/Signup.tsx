import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Building2, CheckCircle2, Mail, Store } from "lucide-react";
import { apiPost } from "@/lib/api";
import type { SignupResponse } from "@/lib/types";
import { errorMessage } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Toaster } from "@/components/ui/sonner";

export default function Signup() {
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState<SignupResponse | null>(null);

  const signup = useMutation({
    mutationFn: () =>
      apiPost<SignupResponse>("/auth/signup", {
        name: name.trim(),
        company_name: company.trim(),
        email: email.trim(),
        password,
      }),
    onSuccess: (data) => setDone(data),
    onError: (err) => setError(errorMessage(err, "Não foi possível concluir o cadastro")),
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    if (name.trim().length < 2) return setError("Informe seu nome completo.");
    if (company.trim().length < 2) return setError("Informe o nome da empresa.");
    if (!email.includes("@")) return setError("Informe um e-mail válido.");
    if (password.length < 8) return setError("A senha precisa ter pelo menos 8 caracteres.");
    if (password !== confirm) return setError("A confirmação não confere com a senha.");
    signup.mutate();
  };

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 px-5 py-10">
        <Card className="w-full max-w-md animate-rise-in border-emerald-200 shadow-sm">
          <CardContent className="p-8 text-center" data-testid="signup-success">
            <CheckCircle2 className="mx-auto size-12 text-emerald-600" />
            <h1 className="mt-4 text-xl font-bold tracking-tight text-slate-900">
              Cadastro recebido
            </h1>
            <p className="mt-2 text-sm text-slate-600">{done.message}</p>
            <p className="mt-4 rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-700">
              Empresa: <strong>{done.company_name}</strong>
            </p>
            <Link
              to="/login"
              className="mt-6 inline-flex rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
              data-testid="signup-go-login"
            >
              Ir para o login
            </Link>
          </CardContent>
        </Card>
        <Toaster richColors />
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
              Estoque &amp; Vendas Pro
            </p>
            <p className="text-xs font-medium text-slate-500">
              Crie a conta da sua empresa — 14 dias de teste
            </p>
          </div>
        </div>

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
      <Toaster richColors />
    </div>
  );
}
