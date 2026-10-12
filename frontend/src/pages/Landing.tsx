import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Barcode,
  BellRing,
  Check,
  CloudUpload,
  FileBarChart,
  FileSpreadsheet,
  MessageCircle,
  ShieldCheck,
  Smartphone,
  Store,
  Users,
} from "lucide-react";
import { apiGet } from "@/lib/api";
import { BRAND_NAME, WHATSAPP_DISPLAY, whatsappLink } from "@/lib/brand";
import { money } from "@/lib/format";
import WhatsAppButton from "@/components/WhatsAppButton";

interface PublicPlan {
  id: string;
  label: string;
  price: number;
  users: number | null;
  products: number | null;
  history_months: number | null;
  full_report: boolean;
  branding: boolean;
}

interface PublicPlans {
  trial_days: number;
  plans: PublicPlan[];
  founder_coupon: string;
  founder_discount: number;
  founder_slots_left: number;
}

const FEATURES = [
  {
    icon: Barcode,
    title: "Caixa rápido com leitor",
    text: "Passou o leitor de código de barras, o produto entra no carrinho. Também busca por nome ou código do produto.",
  },
  {
    icon: Store,
    title: "Estoque que baixa sozinho",
    text: "Cada venda e devolução atualiza o estoque na hora, com histórico de todas as entradas e saídas.",
  },
  {
    icon: BellRing,
    title: "Alerta de reposição",
    text: "Defina o estoque mínimo e veja na hora o que está acabando — antes de perder a venda.",
  },
  {
    icon: FileBarChart,
    title: "Relatório do mês",
    text: "Faturamento, lucro estimado, mais vendidos e formas de pagamento. Pronto para imprimir.",
  },
  {
    icon: FileSpreadsheet,
    title: "Traga seus produtos da planilha",
    text: "Importe o cadastro do Excel em minutos. Não precisa digitar produto por produto.",
  },
  {
    icon: MessageCircle,
    title: "Recibo no WhatsApp",
    text: "Envie o comprovante da venda direto para o WhatsApp do cliente ou imprima.",
  },
  {
    icon: Users,
    title: "Equipe com permissões",
    text: "Você é o administrador; seus vendedores entram com login próprio e só vendem.",
  },
  {
    icon: ShieldCheck,
    title: "Dados guardados com backup",
    text: "Cópia de segurança automática todo dia. Seus dados são só da sua loja.",
  },
];

const STEPS = [
  { title: "Crie sua conta", text: "Nome, loja, e-mail e senha. Leva um minuto e você já entra no sistema." },
  { title: "Cadastre os produtos", text: "Um por um ou de uma vez pela planilha do Excel." },
  { title: "Comece a vender", text: "Abra o caixa no computador, tablet ou celular e venda." },
];

function limitText(value: number | null, unit: string) {
  return value === null ? `${unit} ilimitados` : `Até ${value.toLocaleString("pt-BR")} ${unit}`;
}

function historyText(months: number | null) {
  if (months === null) return "Histórico completo";
  return months >= 12 ? `Histórico de ${months / 12 === 1 ? "1 ano" : `${months / 12} anos`}` : `Histórico de ${months} meses`;
}

export default function Landing() {
  const { data } = useQuery({
    queryKey: ["public-plans"],
    queryFn: () => apiGet<PublicPlans>("/public/plans"),
    refetchOnWindowFocus: false,
    staleTime: 5 * 60_000,
  });
  const trialDays = data?.trial_days ?? 7;
  const cta = `Testar grátis por ${trialDays} dias`;

  const faq = [
    {
      q: "Preciso instalar alguma coisa?",
      a: "Não. Funciona no navegador do computador, tablet ou celular. É só entrar com seu e-mail e senha.",
    },
    {
      q: "Preciso de cartão para testar?",
      a: `Não. Você cria a conta e usa tudo por ${trialDays} dias sem pagar nada. Avisamos por e-mail antes do teste acabar.`,
    },
    {
      q: "O que acontece quando o teste acaba?",
      a: "Você escolhe um plano e continua de onde parou — nada do que você cadastrou se perde. Se não escolher, o acesso fica pausado até você assinar.",
    },
    {
      q: "Qual leitor de código de barras funciona?",
      a: "Qualquer leitor USB ou Bluetooth comum (desses que se ligam no computador como um teclado). Não precisa configurar nada.",
    },
    {
      q: "Consigo trazer os produtos que já tenho?",
      a: "Sim. Baixe nosso modelo de planilha ou use a sua: o sistema reconhece as colunas, mostra uma prévia e importa.",
    },
    {
      q: "Meus dados ficam seguros?",
      a: "Cada loja só vê os próprios dados, o acesso é por senha e fazemos backup automático todos os dias. Você pode baixar tudo em planilha quando quiser.",
    },
    {
      q: "Posso cancelar quando quiser?",
      a: "Pode. Sem multa e sem fidelidade — você usa até o fim do mês já pago.",
    },
  ];

  return (
    <div className="min-h-screen bg-white text-slate-900">
      {/* topo */}
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5" data-testid="landing-logo">
            <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Store className="size-5" />
            </span>
            <span className="text-base font-bold tracking-tight">{BRAND_NAME}</span>
          </Link>
          <nav className="hidden items-center gap-6 text-sm font-medium text-slate-600 md:flex">
            <a href="#recursos" className="hover:text-slate-900">Recursos</a>
            <a href="#planos" className="hover:text-slate-900">Planos</a>
            <a href="#duvidas" className="hover:text-slate-900">Dúvidas</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link
              to="/login"
              className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              data-testid="landing-login-link"
            >
              Entrar
            </Link>
            <Link
              to="/cadastro"
              className="hidden rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm hover:brightness-110 sm:inline-flex"
            >
              Testar grátis
            </Link>
          </div>
        </div>
      </header>

      {/* hero */}
      <section className="relative overflow-hidden bg-gradient-to-b from-teal-50/70 to-white">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-16 pt-12 sm:px-6 lg:grid-cols-[1fr_1.15fr] lg:pb-24 lg:pt-20">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-teal-200 bg-white px-3 py-1 text-xs font-semibold text-teal-800">
              Para lojas com balcão: autopeças, cosméticos, roupas, utilidades e mais
            </p>
            <h1 className="mt-5 text-4xl font-extrabold leading-[1.08] tracking-tight sm:text-5xl">
              Seu balcão organizado: venda rápido e saiba o que repor.
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-slate-600">
              Caixa com leitor de código de barras, estoque que baixa sozinho, alerta de reposição e
              relatório do mês. Tudo no navegador, sem instalar nada.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link
                to="/cadastro"
                className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-primary px-6 py-3.5 text-base font-bold text-primary-foreground shadow-md shadow-teal-900/10 transition hover:brightness-110 active:scale-[0.98]"
                data-testid="landing-cta-hero"
              >
                {cta}
                <ArrowRight className="size-4" />
              </Link>
              <a
                href={whatsappLink(`Olá! Quero saber mais sobre o ${BRAND_NAME}.`)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-slate-300 bg-white px-5 py-3.5 text-base font-semibold text-slate-800 hover:bg-slate-50"
              >
                <MessageCircle className="size-4 text-[#1da851]" />
                Tirar dúvidas no WhatsApp
              </a>
            </div>
            <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-600">
              {["Sem cartão de crédito", "Pronto em 1 minuto", "Cancele quando quiser"].map((item) => (
                <li key={item} className="flex items-center gap-1.5">
                  <Check className="size-4 text-teal-600" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="relative">
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/15">
              <div className="flex items-center gap-1.5 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
                <span className="size-2.5 rounded-full bg-slate-300" />
                <span className="size-2.5 rounded-full bg-slate-300" />
                <span className="size-2.5 rounded-full bg-slate-300" />
              </div>
              <img
                src="/landing/caixa.jpg"
                alt="Tela do caixa com produtos e carrinho de venda"
                className="block w-full"
                width={2040}
                height={1230}
              />
            </div>
          </div>
        </div>
      </section>

      {/* recursos */}
      <section id="recursos" className="scroll-mt-20 py-16 lg:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
              Tudo o que o dia a dia do balcão precisa
            </h2>
            <p className="mt-3 text-lg text-slate-600">
              Sem planilha bagunçada, sem caderno, sem adivinhar o estoque.
            </p>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <div key={title} className="rounded-2xl border border-slate-200 p-5">
                <span className="flex size-10 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
                  <Icon className="size-5" />
                </span>
                <h3 className="mt-4 font-bold">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* telas */}
      <section className="bg-slate-50 py-16 lg:py-24">
        <div className="mx-auto max-w-6xl space-y-16 px-4 sm:px-6">
          {[
            {
              img: "/landing/painel.jpg",
              alt: "Painel com vendas do dia, faturamento e produtos em alerta",
              title: "Abra o sistema e veja como está a loja",
              text: "Vendas e faturamento do dia, lucro estimado, quanto você tem parado em estoque e o que precisa repor.",
            },
            {
              img: "/landing/produtos.jpg",
              alt: "Catálogo de produtos com preço, margem e situação do estoque",
              title: "Preço, margem e estoque de cada produto",
              text: "Veja a margem de lucro de cada produto e a situação do estoque de um jeito fácil de entender.",
            },
            {
              img: "/landing/alertas.jpg",
              alt: "Lista de produtos abaixo do estoque mínimo",
              title: "A lista de compras pronta",
              text: "Os produtos abaixo do mínimo aparecem separados, com quanto falta para repor.",
            },
          ].map((item, i) => (
            <div key={item.img} className="grid items-center gap-8 lg:grid-cols-2">
              <div className={i % 2 ? "lg:order-2" : ""}>
                <h3 className="text-2xl font-extrabold tracking-tight">{item.title}</h3>
                <p className="mt-3 text-lg leading-relaxed text-slate-600">{item.text}</p>
              </div>
              <img
                src={item.img}
                alt={item.alt}
                loading="lazy"
                className="w-full rounded-xl border border-slate-200 shadow-lg shadow-slate-900/10"
              />
            </div>
          ))}
        </div>
      </section>

      {/* como funciona */}
      <section className="py-16 lg:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Comece hoje, em 3 passos</h2>
          <ol className="mt-10 grid gap-4 md:grid-cols-3">
            {STEPS.map((step, i) => (
              <li key={step.title} className="rounded-2xl border border-slate-200 p-6">
                <span className="font-mono text-sm font-bold text-teal-700">0{i + 1}</span>
                <h3 className="mt-2 text-lg font-bold">{step.title}</h3>
                <p className="mt-1.5 text-slate-600">{step.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* planos */}
      <section id="planos" className="scroll-mt-20 bg-slate-900 py-16 text-white lg:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Planos simples, sem fidelidade</h2>
            <p className="mt-3 text-lg text-slate-300">
              Teste tudo por {trialDays} dias. Depois escolha o plano que cabe na sua loja.
            </p>
          </div>
          {data && data.founder_slots_left > 0 && (
            <p
              className="mt-6 inline-flex rounded-xl border border-amber-300/40 bg-amber-300/10 px-4 py-2.5 text-sm text-amber-100"
              data-testid="landing-founder"
            >
              Oferta de lançamento: cupom <strong className="mx-1 font-mono">{data.founder_coupon}</strong> dá{" "}
              {Math.round(data.founder_discount * 100)}% de desconto para sempre — restam {data.founder_slots_left}{" "}
              vagas.
            </p>
          )}
          <div className="mt-10 grid gap-5 lg:grid-cols-3" data-testid="landing-plans">
            {(data?.plans ?? []).map((plan) => {
              const featured = plan.id === "PROFISSIONAL";
              return (
                <div
                  key={plan.id}
                  className={`flex flex-col rounded-2xl p-6 ${
                    featured ? "bg-white text-slate-900 ring-4 ring-teal-400" : "border border-slate-700 bg-slate-800/60"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-bold">{plan.label}</h3>
                    {featured && (
                      <span className="rounded-full bg-teal-100 px-2.5 py-0.5 text-xs font-bold text-teal-800">
                        Mais escolhido
                      </span>
                    )}
                  </div>
                  <p className="mt-4">
                    <span className="text-4xl font-extrabold tracking-tight">{money(plan.price)}</span>
                    <span className={featured ? "text-slate-500" : "text-slate-400"}> /mês</span>
                  </p>
                  <ul className={`mt-6 flex-1 space-y-2.5 text-sm ${featured ? "text-slate-700" : "text-slate-300"}`}>
                    {[
                      limitText(plan.users, "usuários"),
                      limitText(plan.products, "produtos"),
                      historyText(plan.history_months),
                      plan.full_report ? "Relatório completo" : "Relatório básico",
                      plan.branding ? "Sua logo no recibo e no relatório" : null,
                      "Caixa com leitor de código de barras",
                      "Importação por planilha",
                      "Backup diário",
                    ]
                      .filter((line): line is string => line !== null)
                      .map((line) => (
                        <li key={line} className="flex gap-2">
                          <Check className={`mt-0.5 size-4 shrink-0 ${featured ? "text-teal-600" : "text-teal-400"}`} />
                          {line}
                        </li>
                      ))}
                  </ul>
                  <Link
                    to="/cadastro"
                    className={`mt-7 inline-flex justify-center rounded-xl px-4 py-3 text-sm font-bold transition active:scale-[0.98] ${
                      featured
                        ? "bg-primary text-primary-foreground hover:brightness-110"
                        : "bg-white/10 text-white hover:bg-white/20"
                    }`}
                  >
                    {cta}
                  </Link>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* dúvidas */}
      <section id="duvidas" className="scroll-mt-20 py-16 lg:py-24">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Dúvidas frequentes</h2>
          <div className="mt-8 divide-y divide-slate-200 border-y border-slate-200">
            {faq.map((item) => (
              <details key={item.q} className="group py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">
                  {item.q}
                  <span className="text-xl text-slate-400 transition group-open:rotate-45">+</span>
                </summary>
                <p className="mt-2 leading-relaxed text-slate-600">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* chamada final */}
      <section className="px-4 pb-16 sm:px-6 lg:pb-24">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-5 rounded-3xl bg-teal-700 px-6 py-12 text-center text-white">
          <CloudUpload className="size-8 text-teal-200" />
          <h2 className="max-w-2xl text-3xl font-extrabold tracking-tight">
            Experimente na sua loja hoje mesmo
          </h2>
          <p className="max-w-xl text-teal-100">
            {trialDays} dias grátis, sem cartão. Funciona no computador do balcão e no celular.
          </p>
          <Link
            to="/cadastro"
            className="inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3.5 font-bold text-teal-800 shadow-md transition hover:bg-teal-50 active:scale-[0.98]"
            data-testid="landing-cta-final"
          >
            {cta}
            <ArrowRight className="size-4" />
          </Link>
        </div>
      </section>

      <footer className="border-t border-slate-200 py-8 text-sm text-slate-500">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>
            © {new Date().getFullYear()} {BRAND_NAME}
          </p>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <a
              href={whatsappLink(`Olá! Quero saber mais sobre o ${BRAND_NAME}.`)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 hover:text-slate-800"
            >
              <Smartphone className="size-4" />
              WhatsApp {WHATSAPP_DISPLAY}
            </a>
            <a href="/sistema-para-loja-de-autopecas.html" className="hover:text-slate-800">Autopeças</a>
            <a href="/sistema-para-loja-de-cosmeticos.html" className="hover:text-slate-800">Cosméticos</a>
            <a href="/sistema-para-loja-de-roupas.html" className="hover:text-slate-800">Roupas</a>
            <a href="/calculadora-preco-de-venda.html" className="hover:text-slate-800">Calculadora de preço</a>
            <a href="/blog.html" className="hover:text-slate-800">Blog</a>
            <Link to="/termos" className="hover:text-slate-800">Termos de Uso</Link>
            <Link to="/privacidade" className="hover:text-slate-800">Privacidade</Link>
            <Link to="/login" className="hover:text-slate-800">Entrar</Link>
          </div>
        </div>
      </footer>

      <WhatsAppButton message={`Olá! Quero saber mais sobre o ${BRAND_NAME}.`} />
    </div>
  );
}
