import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { Lock, Mail } from "lucide-react";
import { toast } from "sonner";
import { apiPost } from "@/lib/api";
import type { SessionUser } from "@/lib/types";
import { errorMessage } from "@/lib/format";
import { beginSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { BRAND_NAME } from "@/lib/brand";

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const login = useMutation({
    mutationFn: () =>
      apiPost<SessionUser>("/auth/login", { email: email.trim(), password }),
    onSuccess: (user) => {
      beginSession();
      const firstName = user?.name?.trim().split(" ").at(0);
      toast.success(firstName ? `Bem-vindo, ${firstName}!` : "Bem-vindo!");
      // the SaaS owner has no shop workspace — straight to the platform area
      navigate(user.role === "PLATFORM_OWNER" ? "/plataforma" : "/", { replace: true });
    },
    onError: (err) => {
      const message = errorMessage(err, "Não foi possível entrar. Tente novamente.");
      setError(message);
    },
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    if (!email.trim() || !password) {
      setError("Informe e-mail e senha.");
      return;
    }
    login.mutate();
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-100 px-5 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-7 flex items-center gap-3">
          <img
            src="https://static.prod-images.emergentagent.com/jobs/0650c3ab-c154-4e41-8d2f-4708ce09b71c/images/4b748034e25d61b318fe673c52bfc0f6958ce520707210eee529bb4bcccfc178.jpeg"
            alt="Balcão de loja com painel de vendas e estoque organizado"
            className="size-14 shrink-0 rounded-xl border border-slate-200 object-cover shadow-sm"
            data-testid="login-brand-image"
          />
          <div className="leading-tight">
            <p className="text-lg font-bold tracking-tight text-slate-900">
              {BRAND_NAME}
            </p>
            <p className="text-xs font-medium text-slate-500">Acesso restrito à equipe autorizada</p>
          </div>
        </div>

        <Card className="animate-rise-in overflow-hidden border-slate-200 shadow-sm">
          <img
            src="https://static.prod-images.emergentagent.com/jobs/0650c3ab-c154-4e41-8d2f-4708ce09b71c/images/4b748034e25d61b318fe673c52bfc0f6958ce520707210eee529bb4bcccfc178.jpeg"
            alt="Ilustração de controle de estoque e vendas de balcão"
            className="h-40 w-full border-b border-slate-200 object-cover"
            data-testid="login-hero-image"
          />
          <CardContent className="p-6">
            <h1 className="text-xl font-bold tracking-tight text-slate-900">Entrar</h1>
            <p className="mt-1 text-sm text-slate-500">
              Use as credenciais liberadas pelo administrador.
            </p>

            <form onSubmit={submit} className="mt-6 space-y-4" data-testid="login-form">
              <div className="space-y-1.5">
                <Label htmlFor="login-email">E-mail</Label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    id="login-email"
                    type="email"
                    autoComplete="username"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="voce@suaempresa.com"
                    className="pl-9"
                    data-testid="login-email-input"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="login-password">Senha</Label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    id="login-password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="••••••••"
                    className="pl-9"
                    data-testid="login-password-input"
                  />
                </div>
              </div>

              {error && (
                <p
                  className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700"
                  data-testid="login-error-message"
                >
                  {error}
                </p>
              )}

              <Button
                type="submit"
                className="w-full active:scale-[0.98]"
                disabled={login.isPending}
                data-testid="login-submit-button"
              >
                {login.isPending ? "Entrando…" : "Entrar"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="mt-5 space-y-2 text-center text-sm">
          <p>
            <Link
              to="/esqueci-senha"
              className="font-semibold text-teal-700 hover:underline"
              data-testid="login-forgot-password-link"
            >
              Esqueci minha senha
            </Link>
          </p>
          <p className="text-slate-500">
            Primeira vez aqui?{" "}
            <Link
              to="/cadastro"
              className="font-semibold text-teal-700 hover:underline"
              data-testid="login-signup-link"
            >
              Cadastrar minha empresa
            </Link>
          </p>
          <p className="mt-3 text-center text-xs text-slate-400" data-testid="login-legal-links">
            <Link to="/termos" className="hover:underline">Termos de Uso</Link>
            {" · "}
            <Link to="/privacidade" className="hover:underline">Política de Privacidade</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
