import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Store } from "lucide-react";
import { apiGet } from "@/lib/api";
import type { LegalInfo } from "@/lib/types";

// Texto-base dos documentos legais. Os dados de quem presta o serviço (nome,
// CNPJ/CPF, e-mail, cidade) vêm de /api/legal, configurados no servidor.
// Importante: é um modelo — deve ser revisado por um advogado antes de valer.

function useLegal() {
  const { data } = useQuery({
    queryKey: ["legal-info"],
    queryFn: () => apiGet<LegalInfo>("/legal"),
    staleTime: 60 * 60 * 1000,
  });
  const product = data?.product_name ?? "Estoque & Vendas Pro";
  const company = data?.company_name ?? product;
  const who = data?.document ? `${company}, inscrita sob o nº ${data.document}` : company;
  const contact = data?.contact_email
    ? `pelo e-mail ${data.contact_email}`
    : "pelo e-mail de contato informado no site";
  const forum = data?.city ? `da comarca de ${data.city}` : "do domicílio do prestador";
  const version = data?.version ?? "";
  return { product, company, who, contact, forum, version };
}

function LegalPage({
  title,
  version,
  children,
}: {
  title: string;
  version: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-slate-100 px-5 py-10">
      <article className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-10">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Store className="size-5" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
            {version && <p className="text-xs text-slate-500">Versão de {version.split("-").reverse().join("/")}</p>}
          </div>
        </div>
        <div className="space-y-5 text-sm leading-relaxed text-slate-700 [&_h2]:mt-8 [&_h2]:text-base [&_h2]:font-bold [&_h2]:text-slate-900 [&_li]:ml-5 [&_li]:list-disc">
          {children}
        </div>
        <p className="mt-10 text-sm">
          <Link to="/cadastro" className="font-semibold text-teal-700 hover:underline">
            Voltar ao cadastro
          </Link>
          {" · "}
          <Link to="/login" className="font-semibold text-teal-700 hover:underline">
            Entrar
          </Link>
        </p>
      </article>
    </div>
  );
}

export function TermsPage() {
  const l = useLegal();
  return (
    <LegalPage title="Termos de Uso" version={l.version}>
      <p>
        Estes Termos regulam o uso do {l.product}, sistema on-line de controle de estoque, vendas
        no balcão (PDV), devoluções e relatórios, oferecido por {l.who} ("nós"). Ao criar uma
        conta, a empresa cliente ("você") declara que leu e concorda com estes Termos e com a
        Política de Privacidade.
      </p>

      <h2>1. Cadastro e conta</h2>
      <ul>
        <li>O cadastro deve ser feito por pessoa com poderes para representar a empresa, com dados verdadeiros e atualizados.</li>
        <li>Você é responsável pelas senhas e pelos usuários que criar (administradores e vendedores) e por tudo o que for feito com eles.</li>
        <li>Podemos recusar ou cancelar cadastros com dados falsos ou usados de forma abusiva.</li>
      </ul>

      <h2>2. Teste grátis, planos e pagamento</h2>
      <ul>
        <li>Após a liberação da conta há um período de teste grátis. Ao final dele, para continuar usando, é preciso assinar um plano.</li>
        <li>Os planos, seus preços e limites (número de usuários, produtos e recursos) ficam descritos na página "Minha assinatura" e podem ser alterados mediante aviso prévio.</li>
        <li>A cobrança é mensal e recorrente, processada pelo Mercado Pago no cartão cadastrado. Cupons promocionais valem nas condições anunciadas.</li>
        <li>Se um pagamento for recusado, a conta fica com pagamento pendente. Sem regularização em até 5 dias, o acesso é suspenso; os dados continuam guardados e o acesso volta assim que o pagamento é aprovado.</li>
        <li>Trocar para um plano maior vale na hora; para um plano menor, a partir da cobrança seguinte. Ao atingir um limite do plano, só é bloqueado o cadastro de itens novos — nada é apagado.</li>
      </ul>

      <h2>3. Cancelamento</h2>
      <ul>
        <li>Você pode cancelar a assinatura a qualquer momento em "Minha assinatura". O acesso continua até o fim do período já pago e não há cobrança de multa.</li>
        <li>Não há reembolso proporcional de períodos já pagos, salvo quando a lei exigir.</li>
        <li>Antes de sair, você pode baixar uma planilha com todos os dados da sua loja em "Minha Empresa".</li>
      </ul>

      <h2>4. Uso permitido</h2>
      <ul>
        <li>O sistema deve ser usado apenas para a gestão do seu próprio negócio, de acordo com a lei.</li>
        <li>É proibido tentar acessar dados de outras empresas, burlar limites ou a segurança do sistema, revender o acesso ou usá-lo para fins ilegais.</li>
        <li>O cupom e o relatório gerados pelo sistema não substituem a nota fiscal: a emissão de documentos fiscais e o cumprimento de obrigações tributárias são responsabilidade sua.</li>
      </ul>

      <h2>5. Dados da sua loja</h2>
      <ul>
        <li>Os dados que você cadastra (produtos, vendas, clientes, usuários) são seus. Em relação a eles, você é o controlador e nós somos o operador, nos termos da LGPD (Lei 13.709/2018), tratando-os apenas para prestar o serviço.</li>
        <li>Fazemos backups automáticos diários, mas recomendamos que você também guarde periodicamente uma cópia dos seus dados.</li>
        <li>Após o encerramento da conta, os dados podem ser mantidos pelo prazo necessário para cumprir obrigações legais e depois são excluídos.</li>
      </ul>

      <h2>6. Disponibilidade e responsabilidade</h2>
      <ul>
        <li>Trabalhamos para manter o sistema disponível e seguro, mas podem ocorrer interrupções por manutenção, falhas de terceiros (hospedagem, internet, meios de pagamento) ou casos fortuitos.</li>
        <li>Nossa responsabilidade, se houver, fica limitada ao valor pago pela assinatura nos 12 meses anteriores ao fato, exceto nos casos em que a lei não permite essa limitação.</li>
        <li>Não respondemos por lucros cessantes nem por decisões de negócio tomadas com base nos relatórios do sistema.</li>
      </ul>

      <h2>7. Propriedade intelectual</h2>
      <p>
        O sistema, sua marca, código e layout pertencem a nós. A assinatura concede apenas o direito
        de uso enquanto estiver ativa, sem transferência de propriedade.
      </p>

      <h2>8. Alterações destes Termos</h2>
      <p>
        Podemos atualizar estes Termos. Mudanças relevantes serão avisadas por e-mail ou dentro do
        sistema com antecedência. Continuar usando após a vigência significa concordar com a nova
        versão.
      </p>

      <h2>9. Contato e foro</h2>
      <p>
        Dúvidas e solicitações: fale com a gente {l.contact}. Fica eleito o foro {l.forum} para resolver questões
        relacionadas a estes Termos, ressalvados os direitos previstos no Código de Defesa do
        Consumidor quando aplicável.
      </p>
    </LegalPage>
  );
}

export function PrivacyPage() {
  const l = useLegal();
  return (
    <LegalPage title="Política de Privacidade" version={l.version}>
      <p>
        Esta Política explica como o {l.product}, oferecido por {l.who}, trata dados pessoais, de
        acordo com a Lei Geral de Proteção de Dados (LGPD — Lei 13.709/2018).
      </p>

      <h2>1. Quem é responsável por quê</h2>
      <ul>
        <li><strong>Dados da conta</strong> (de quem contrata e dos usuários da loja): somos o controlador.</li>
        <li><strong>Dados que a loja cadastra no sistema</strong> (vendas, produtos e eventuais dados de clientes dela): a loja é a controladora e nós somos o operador, tratando esses dados só para prestar o serviço e conforme as instruções da loja.</li>
      </ul>

      <h2>2. Dados que coletamos</h2>
      <ul>
        <li>Cadastro: nome, e-mail, nome da empresa e senha (guardada de forma criptografada — nem nós conseguimos vê-la).</li>
        <li>Dados da empresa que você informar: nome fantasia, CNPJ, telefone, endereço e logo.</li>
        <li>Registros de acesso: data, hora, endereço IP e navegador de cada login, guardados por segurança e por exigência do Marco Civil da Internet.</li>
        <li>Assinatura: plano, valores e situação dos pagamentos. Os dados do cartão são informados diretamente ao Mercado Pago — nós não recebemos nem guardamos o número do cartão.</li>
      </ul>

      <h2>3. Para que usamos</h2>
      <ul>
        <li>Prestar o serviço, manter sua conta funcionando e dar suporte (execução de contrato).</li>
        <li>Cobrar a assinatura e enviar avisos sobre vencimento, pagamento e teste grátis (execução de contrato).</li>
        <li>Proteger o sistema contra fraudes e acessos indevidos e cumprir obrigações legais (legítimo interesse e obrigação legal).</li>
      </ul>
      <p>Não vendemos dados pessoais e não os usamos para publicidade de terceiros.</p>

      <h2>4. Com quem compartilhamos</h2>
      <ul>
        <li>Mercado Pago, para processar os pagamentos da assinatura.</li>
        <li>Fornecedores de hospedagem, banco de dados, envio de e-mails e armazenamento de backups, que só tratam os dados para manter o serviço funcionando.</li>
        <li>Autoridades públicas, quando exigido por lei ou ordem judicial.</li>
      </ul>
      <p>
        Alguns desses fornecedores podem armazenar dados fora do Brasil, sempre com medidas de
        segurança adequadas, conforme a LGPD.
      </p>

      <h2>5. Por quanto tempo guardamos</h2>
      <ul>
        <li>Enquanto a conta estiver ativa.</li>
        <li>Registros de acesso: pelo menos 6 meses, como exige o Marco Civil da Internet.</li>
        <li>Após o encerramento da conta, apenas o necessário para cumprir obrigações legais ou exercer direitos; o restante é excluído.</li>
      </ul>

      <h2>6. Segurança</h2>
      <p>
        Usamos conexão criptografada (HTTPS), senhas criptografadas, separação total entre os dados
        de cada empresa, controle de permissões por usuário, limite de tentativas de login e
        backups diários. Nenhum sistema é 100% invulnerável; se ocorrer um incidente relevante,
        avisaremos os afetados e a ANPD conforme a lei.
      </p>

      <h2>7. Seus direitos</h2>
      <p>
        Você pode pedir a qualquer momento: confirmação e acesso aos seus dados, correção, exclusão,
        portabilidade, informação sobre compartilhamento e revogação de consentimento, nos termos do
        art. 18 da LGPD. A loja também pode baixar sozinha todos os seus dados em "Minha Empresa".
      </p>

      <h2>8. Cookies</h2>
      <p>
        Usamos apenas o cookie necessário para manter você conectado ao sistema. Não usamos cookies
        de publicidade nem de rastreamento.
      </p>

      <h2>9. Contato</h2>
      <p>
        Para exercer seus direitos ou tirar dúvidas sobre privacidade, fale com a gente{" "}
        {l.contact}. Esta Política pode ser atualizada; a versão vigente fica sempre nesta página.
      </p>
    </LegalPage>
  );
}
