"""Gera as páginas estáticas de SEO do Estoque Pro.

Uso:  python3 tools/gerar_seo.py
Lê frontend/seo-content/*.md e escreve em frontend/public/:
  - <slug>.html (páginas de nicho) e blog/<slug>.html (artigos)
  - blog.html, sitemap.xml, robots.txt
Para publicar um artigo novo: crie o .md em frontend/seo-content/ e rode o script.
"""
import datetime
import html
import json
import re
from pathlib import Path

import markdown

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "frontend" / "seo-content"
OUT = ROOT / "frontend" / "public"
SITE = "https://estoquevendaspro.com.br"
BRAND = "Estoque Pro"
WHATS = "https://wa.me/5519991629460?text=" + "Ol%C3%A1!%20Quero%20saber%20mais%20sobre%20o%20Estoque%20Pro."
HOJE = datetime.date.today().isoformat()

NICHO = {"sistema-para-loja-de-autopecas", "sistema-para-loja-de-cosmeticos", "sistema-para-loja-de-roupas"}


def front(text):
    m = re.match(r"---\n(.*?)\n---\n", text, re.S)
    meta = dict(
        (k.strip(), v.strip()) for k, v in (l.split(":", 1) for l in m.group(1).splitlines() if ":" in l)
    )
    return meta, text[m.end():]


def faq(body):
    m = re.search(r"^## Perguntas frequentes\s*$(.*?)(?=^## |\Z)", body, re.M | re.S)
    if not m:
        return []
    out = []
    for q, a in re.findall(r"^### (.+?)\s*$\n(.*?)(?=^### |\Z)", m.group(1), re.M | re.S):
        a = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", a)
        a = re.sub(r"[*_`]", "", a).strip()
        if a:
            out.append((q.strip(), " ".join(a.split())))
    return out


def url_de(slug):
    return f"/{slug}.html" if slug in NICHO else f"/blog/{slug}.html"


def pagina(meta, corpo_html, perguntas, links):
    slug = meta["slug"]
    url = SITE + url_de(slug)
    t, d = html.escape(meta["title"]), html.escape(meta["description"])
    ld = [{
        "@context": "https://schema.org",
        "@type": "WebPage" if slug in NICHO else "Article",
        "headline": meta["title"],
        "description": meta["description"],
        "url": url,
        "inLanguage": "pt-BR",
        "dateModified": HOJE,
        "publisher": {"@type": "Organization", "name": BRAND, "url": SITE},
        **({} if slug in NICHO else {"author": {"@type": "Organization", "name": BRAND}, "datePublished": HOJE,
                                       "image": SITE + "/og.jpg"}),
    }, {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": BRAND, "item": SITE + "/"},
            *([] if slug in NICHO else [{"@type": "ListItem", "position": 2, "name": "Blog", "item": SITE + "/blog.html"}]),
            {"@type": "ListItem", "position": 2 if slug in NICHO else 3, "name": meta["title"], "item": url},
        ],
    }]
    if perguntas:
        ld.append({"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
            {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in perguntas]})
    relacionados = "".join(
        f'<li><a href="{url_de(m["slug"])}">{html.escape(m["title"])}</a></li>' for m in links if m["slug"] != slug)
    return casca(t, d, url, json.dumps(ld, ensure_ascii=False), f"""
<nav class="trilha"><a href="/">Início</a>{'' if slug in NICHO else ' › <a href="/blog.html">Blog</a>'}</nav>
<article>{corpo_html}</article>
<aside class="cta">
  <h2>Teste o {BRAND} grátis por 7 dias</h2>
  <p>Sem cartão de crédito, pronto em 1 minuto. Funciona no computador, tablet e celular.</p>
  <a class="btn" href="/cadastro">Testar grátis por 7 dias</a>
  <a class="btn sec" href="{WHATS}" rel="noopener">Tirar dúvidas no WhatsApp</a>
</aside>
<section class="rel"><h2>Leia também</h2><ul>{relacionados}
<li><a href="/calculadora-preco-de-venda.html">Calculadora grátis de preço de venda e margem</a></li></ul></section>""")


def casca(t, d, url, ld, miolo, extra_head=""):
    return f"""<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{t}</title>
<meta name="description" content="{d}">
<link rel="canonical" href="{url}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="{BRAND}">
<meta property="og:locale" content="pt_BR">
<meta property="og:title" content="{t}">
<meta property="og:description" content="{d}">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{SITE}/og.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="stylesheet" href="/seo.css">
<script type="application/ld+json">{ld}</script>
<script src="/analytics.js" defer></script>
{extra_head}
</head>
<body>
<header class="topo"><div class="in">
  <a class="logo" href="/"><span>EP</span>{BRAND}</a>
  <nav><a href="/blog.html">Blog</a><a href="/login">Entrar</a><a class="btn peq" href="/cadastro">Testar grátis</a></nav>
</div></header>
<main class="in">{miolo}</main>
<footer class="rodape"><div class="in">
  <p><strong>{BRAND}</strong> — sistema de vendas e estoque para lojas de balcão.</p>
  <p><a href="/sistema-para-loja-de-autopecas.html">Autopeças</a> · <a href="/sistema-para-loja-de-cosmeticos.html">Cosméticos</a> ·
  <a href="/sistema-para-loja-de-roupas.html">Roupas</a> · <a href="/calculadora-preco-de-venda.html">Calculadora de preço</a> ·
  <a href="/blog.html">Blog</a> · <a href="/termos">Termos</a> · <a href="/privacidade">Privacidade</a></p>
</div></footer>
</body>
</html>
"""


def main():
    docs = []
    for f in sorted(SRC.glob("*.md")):
        meta, body = front(f.read_text(encoding="utf-8"))
        docs.append((meta, body))
    metas = [m for m, _ in docs]
    (OUT / "blog").mkdir(exist_ok=True)
    for meta, body in docs:
        corpo = markdown.markdown(body, extensions=["tables", "sane_lists"])
        corpo = corpo.replace("https://estoquevendaspro.com.br/cadastro", "/cadastro")
        destino = OUT / url_de(meta["slug"]).lstrip("/")
        destino.write_text(pagina(meta, corpo, faq(body), metas), encoding="utf-8")

    artigos = [m for m in metas if m["slug"] not in NICHO]
    lista = "".join(
        f'<li><a href="{url_de(m["slug"])}"><strong>{html.escape(m["title"])}</strong>'
        f'<span>{html.escape(m["description"])}</span></a></li>' for m in artigos)
    ld = json.dumps({"@context": "https://schema.org", "@type": "Blog", "name": f"Blog do {BRAND}",
                     "url": SITE + "/blog.html", "inLanguage": "pt-BR"}, ensure_ascii=False)
    (OUT / "blog.html").write_text(casca(
        f"Blog {BRAND}: estoque, vendas e lucro para lojas",
        "Dicas práticas para lojas de balcão: controle de estoque, preço de venda, margem de lucro, estoque mínimo e caixa.",
        SITE + "/blog.html", ld,
        f'<article><h1>Blog do {BRAND}</h1><p>Dicas práticas para quem tem loja de balcão.</p>'
        f'<ul class="lista">{lista}<li><a href="/calculadora-preco-de-venda.html"><strong>Calculadora grátis de preço de venda e margem</strong>'
        f'<span>Descubra o preço certo de cada produto em segundos.</span></a></li></ul></article>'), encoding="utf-8")

    calc_t = "Calculadora de Preço de Venda e Margem de Lucro grátis"
    calc_d = "Calcule o preço de venda certo pelo custo, despesas, impostos e margem desejada. Calculadora de markup grátis para lojas."
    calc_ld = json.dumps([{
        "@context": "https://schema.org", "@type": "WebApplication", "name": calc_t, "url": SITE + "/calculadora-preco-de-venda.html",
        "applicationCategory": "BusinessApplication", "operatingSystem": "Navegador", "inLanguage": "pt-BR",
        "offers": {"@type": "Offer", "price": "0", "priceCurrency": "BRL"}}], ensure_ascii=False)
    (OUT / "calculadora-preco-de-venda.html").write_text(casca(calc_t, calc_d, SITE + "/calculadora-preco-de-venda.html", calc_ld, f"""
<nav class="trilha"><a href="/">Início</a> › <a href="/blog.html">Blog</a></nav>
<article>
<h1>Calculadora de preço de venda e margem de lucro</h1>
<p>Coloque o custo do produto e as porcentagens da sua loja. A calculadora mostra o preço de venda para ter a margem que você quer. Tudo é calculado no seu navegador: nada é enviado.</p>
<form class="calc" onsubmit="return false">
  <label>Custo do produto (R$)<input id="c" inputmode="decimal" placeholder="Ex.: 40,00"></label>
  <label>Despesas da loja (% do faturamento: aluguel, luz, salários…)<input id="d" inputmode="decimal" placeholder="Ex.: 15"></label>
  <label>Impostos e taxas de cartão (%)<input id="i" inputmode="decimal" placeholder="Ex.: 8"></label>
  <label>Lucro que você quer (%)<input id="l" inputmode="decimal" placeholder="Ex.: 20"></label>
  <div class="res" id="r">Preencha os campos para ver o preço.</div>
</form>
<h2>Como a conta é feita</h2>
<p>O preço sai pela fórmula do <strong>markup divisor</strong>: Preço = Custo ÷ (1 − (despesas + impostos + lucro) ÷ 100). Assim, cada porcentagem é tirada do preço final, e não do custo, que é o erro mais comum em loja.</p>
<p>Exemplo: custo de R$ 40, despesas de 15%, impostos e taxas de 8% e lucro de 20%. A soma é 43%. Preço = 40 ÷ 0,57 = R$ 70,18. O markup multiplicador é 70,18 ÷ 40 = 1,75.</p>
<h2>Por que não basta "dobrar o custo"?</h2>
<p>Dobrar o custo dá um markup de 2, mas se despesas, impostos e taxas somam mais de 50% do preço, a loja vende e não lucra. Fazer a conta produto a produto evita esse buraco.</p>
<p>Leia o guia completo: <a href="/blog/como-calcular-preco-de-venda-e-margem-de-lucro.html">como calcular preço de venda e margem de lucro</a>.</p>
</article>
<aside class="cta">
  <h2>Veja a margem de todos os produtos de uma vez</h2>
  <p>No {BRAND} cada produto mostra a margem de lucro e o relatório do mês traz o lucro estimado. Teste grátis por 7 dias, sem cartão.</p>
  <a class="btn" href="/cadastro">Testar grátis por 7 dias</a>
</aside>
<script>
(function(){{
  var n=function(id){{var v=document.getElementById(id).value.replace(/\\./g,'').replace(',','.');return parseFloat(v);}};
  var brl=function(x){{return x.toLocaleString('pt-BR',{{style:'currency',currency:'BRL'}});}};
  function calc(){{
    var c=n('c'),d=n('d')||0,i=n('i')||0,l=n('l')||0,r=document.getElementById('r');
    if(!(c>0)){{r.textContent='Preencha os campos para ver o preço.';return;}}
    var soma=d+i+l;
    if(soma>=100){{r.innerHTML='<span class="aviso">A soma das porcentagens ('+soma.toFixed(1).replace('.',',')+'%) precisa ser menor que 100%.</span>';return;}}
    var p=c/(1-soma/100);
    r.innerHTML='Preço de venda sugerido<br><b>'+brl(p)+'</b><br>Markup multiplicador: '+(p/c).toFixed(2).replace('.',',')+
      '<br>Lucro por unidade: '+brl(p*l/100)+' · Despesas: '+brl(p*d/100)+' · Impostos/taxas: '+brl(p*i/100);
  }}
  ['c','d','i','l'].forEach(function(id){{document.getElementById(id).addEventListener('input',calc);}});
}})();
</script>"""), encoding="utf-8")

    urls = ["/", "/blog.html", "/calculadora-preco-de-venda.html", "/cadastro", "/termos", "/privacidade"]
    urls += [url_de(m["slug"]) for m in metas]
    (OUT / "sitemap.xml").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "".join(f"  <url><loc>{SITE}{u}</loc><lastmod>{HOJE}</lastmod></url>\n" for u in urls)
        + "</urlset>\n", encoding="utf-8")
    bloqueadas = ["/api/", "/vender", "/vendas", "/devolucoes", "/produtos", "/estoque", "/alertas", "/relatorio",
                  "/perfil", "/empresa", "/assinatura", "/admin", "/plataforma", "/redefinir-senha", "/esqueci-senha"]
    (OUT / "robots.txt").write_text(
        "User-agent: *\n" + "".join(f"Disallow: {b}\n" for b in bloqueadas) + f"\nSitemap: {SITE}/sitemap.xml\n",
        encoding="utf-8")
    print(f"{len(docs)} páginas, {len(urls)} URLs no sitemap")


if __name__ == "__main__":
    main()
