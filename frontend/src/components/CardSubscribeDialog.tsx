import { useEffect, useRef, useState } from "react";
import { Loader2, Lock } from "lucide-react";
import { money } from "@/lib/format";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Formulário oficial de cartão do Mercado Pago ("Card Payment Brick").
// O número do cartão é digitado num campo seguro do próprio Mercado Pago e
// nunca passa pelo nosso servidor: recebemos só um token de uso único.
const SDK_URL = "https://sdk.mercadopago.com/js/v2";

interface CardFormData {
  token: string;
  payer?: { email?: string };
}

interface BrickController {
  unmount: () => void;
}

interface MercadoPagoInstance {
  bricks: () => {
    create: (kind: string, containerId: string, settings: unknown) => Promise<BrickController>;
  };
}

declare global {
  interface Window {
    MercadoPago?: new (publicKey: string, options?: { locale?: string }) => MercadoPagoInstance;
  }
}

let sdkPromise: Promise<void> | null = null;

function loadSdk(): Promise<void> {
  if (window.MercadoPago) return Promise.resolve();
  if (!sdkPromise) {
    sdkPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = SDK_URL;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        sdkPromise = null;
        reject(new Error("sdk"));
      };
      document.head.appendChild(script);
    });
  }
  return sdkPromise;
}

const CONTAINER_ID = "mp-card-brick";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  publicKey: string;
  planLabel: string;
  amount: number;
  email: string;
  /** Envia o token ao nosso servidor. Rejeite com a mensagem de erro para mostrar no formulário. */
  onCardToken: (token: string, email: string) => Promise<void>;
  /** Plano B: pagar entrando na conta Mercado Pago (checkout do MP). */
  onUseMercadoPagoAccount: () => void;
}

export default function CardSubscribeDialog({
  open,
  onOpenChange,
  publicKey,
  planLabel,
  amount,
  email,
  onCardToken,
  onUseMercadoPagoAccount,
}: Props) {
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [error, setError] = useState("");
  // callbacks mudam a cada render; o formulário é criado uma vez por abertura
  const submitRef = useRef(onCardToken);
  submitRef.current = onCardToken;

  useEffect(() => {
    if (!open) return;
    let controller: BrickController | null = null;
    let cancelled = false;
    setState("loading");
    setError("");

    loadSdk()
      .then(async () => {
        if (cancelled || !window.MercadoPago) return;
        const mp = new window.MercadoPago(publicKey, { locale: "pt-BR" });
        controller = await mp.bricks().create("cardPayment", CONTAINER_ID, {
          initialization: { amount, payer: { email } },
          customization: {
            paymentMethods: { maxInstallments: 1 },
            visual: { texts: { formSubmit: "Assinar" } },
          },
          callbacks: {
            onReady: () => !cancelled && setState("ready"),
            onSubmit: async (data: CardFormData) => {
              setError("");
              try {
                await submitRef.current(data.token, data.payer?.email || email);
              } catch (err) {
                setError(err instanceof Error ? err.message : "Não foi possível concluir a assinatura.");
                throw err; // o formulário volta a ficar disponível para corrigir
              }
            },
            onError: () => !cancelled && setState((s) => (s === "loading" ? "failed" : s)),
          },
        });
        if (cancelled) controller?.unmount();
      })
      .catch(() => !cancelled && setState("failed"));

    return () => {
      cancelled = true;
      controller?.unmount();
    };
  }, [open, publicKey, amount, email]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg" data-testid="card-subscribe-dialog">
        <DialogHeader>
          <DialogTitle>
            Assinar o plano {planLabel} — {money(amount)}/mês
          </DialogTitle>
          <DialogDescription className="flex items-center gap-1.5">
            <Lock className="size-3.5" />
            Pagamento seguro pelo Mercado Pago. Não precisa ter conta no Mercado Pago.
          </DialogDescription>
        </DialogHeader>

        {state === "loading" && (
          <p className="flex items-center gap-2 py-6 text-sm text-slate-500">
            <Loader2 className="size-4 animate-spin" /> Carregando o formulário do cartão…
          </p>
        )}
        {state === "failed" && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Não foi possível carregar o formulário do cartão. Verifique a internet ou use a opção abaixo.
          </p>
        )}
        {error && (
          <p
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            data-testid="card-subscribe-error"
          >
            {error}
          </p>
        )}

        <div id={CONTAINER_ID} className={state === "failed" ? "hidden" : ""} />

        <p className="text-xs leading-relaxed text-slate-500">
          A cobrança de {money(amount)} é feita agora e se repete todo mês no mesmo cartão. Você pode cancelar
          quando quiser em Minha assinatura.
        </p>
        <button
          type="button"
          onClick={onUseMercadoPagoAccount}
          className="text-left text-sm font-medium text-teal-700 underline-offset-2 hover:underline"
          data-testid="card-subscribe-use-mp-account"
        >
          Prefiro pagar entrando na minha conta Mercado Pago
        </button>
      </DialogContent>
    </Dialog>
  );
}
