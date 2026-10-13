// Cloudflare Pages Function: repassa /api/* para o servidor (Render).
// Assim site e API ficam no MESMO endereço (estoquevendaspro.com.br) e o cookie de
// login continua seguro (httpOnly, Secure, SameSite=Lax), sem abrir CORS.
//
// Variáveis no painel do Cloudflare Pages (Settings → Variables, tipo "Secret"):
//   BACKEND_URL          ex.: https://estoque-pro-api.onrender.com
//   PROXY_SHARED_SECRET  o mesmo valor configurado no Render
export async function onRequest({ request, env }) {
  const backend = (env.BACKEND_URL || "").replace(/\/+$/, "");
  if (!backend.startsWith("https://") || !env.PROXY_SHARED_SECRET) {
    return new Response(JSON.stringify({ detail: "Servidor não configurado" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  }

  const url = new URL(request.url);
  const target = backend + url.pathname + url.search;

  const headers = new Headers(request.headers);
  // IP real do visitante, sobrescrevendo qualquer valor que o navegador tenha mandado
  // (impede falsificar IP para burlar o limite de tentativas de login).
  headers.set("x-forwarded-for", request.headers.get("cf-connecting-ip") || "");
  headers.set("x-forwarded-proto", "https");
  headers.set("x-forwarded-host", url.host);
  headers.set("x-proxy-secret", env.PROXY_SHARED_SECRET);
  headers.delete("host");

  const init = {
    method: request.method,
    headers,
    redirect: "manual",
  };
  if (!["GET", "HEAD"].includes(request.method)) init.body = request.body;

  const resp = await fetch(target, init);
  const out = new Response(resp.body, resp);
  out.headers.set("x-content-type-options", "nosniff");
  out.headers.set("cache-control", out.headers.get("cache-control") || "no-store");
  return out;
}
