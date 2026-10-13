// Medição do Estoque Pro (Google Analytics 4 + Pixel da Meta).
// LGPD: nada é carregado antes de o visitante aceitar o aviso de cookies.
// IDs vazios = aquela ferramenta não é carregada.
(function () {
  var GA_ID = "G-WGV41RG2TZ";
  var PIXEL_ID = "2618722768581980";
  var KEY = "ep_cookies"; // "sim" | "nao"
  if (!GA_ID && !PIXEL_ID) return;

  function getChoice() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function setChoice(v) {
    try { localStorage.setItem(KEY, v); } catch (e) { /* sem armazenamento: vale só nesta página */ }
  }

  function loadGA() {
    if (!GA_ID || window.gtag) return;
    var s = document.createElement("script");
    s.async = true;
    s.src = "https://www.googletagmanager.com/gtag/js?id=" + GA_ID;
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag("js", new Date());
    window.gtag("config", GA_ID, { anonymize_ip: true });
  }

  function loadPixel() {
    if (!PIXEL_ID || window.fbq) return;
    var n = (window.fbq = function () {
      n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
    });
    if (!window._fbq) window._fbq = n;
    n.push = n; n.loaded = true; n.version = "2.0"; n.queue = [];
    var s = document.createElement("script");
    s.async = true;
    s.src = "https://connect.facebook.net/en_US/fbevents.js";
    document.head.appendChild(s);
    window.fbq("init", PIXEL_ID);
    window.fbq("track", "PageView");
  }

  function start() {
    loadGA();
    loadPixel();
    // Cliques em "Testar grátis" e WhatsApp viram eventos (mede o que traz cadastro).
    document.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest("a");
      if (!a) return;
      var h = a.getAttribute("href") || "";
      if (h.indexOf("/cadastro") === 0) {
        if (window.gtag) window.gtag("event", "clique_teste_gratis", { pagina: location.pathname });
        if (window.fbq) window.fbq("track", "Lead");
      } else if (h.indexOf("wa.me") > -1) {
        if (window.gtag) window.gtag("event", "clique_whatsapp", { pagina: location.pathname });
        if (window.fbq) window.fbq("track", "Contact");
      }
    });
  }

  function banner() {
    var box = document.createElement("div");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "Aviso de cookies");
    box.style.cssText =
      "position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483000;max-width:640px;margin:0 auto;" +
      "background:#0f172a;color:#e2e8f0;border-radius:14px;padding:14px 16px;font:14px/1.45 system-ui,sans-serif;" +
      "box-shadow:0 10px 30px rgba(0,0,0,.35);display:flex;flex-wrap:wrap;gap:10px;align-items:center";
    var p = document.createElement("p");
    p.style.cssText = "margin:0;flex:1 1 260px";
    p.textContent = "Usamos cookies de medição (Google e Meta) para saber quais anúncios e páginas funcionam. Você aceita?";
    var link = document.createElement("a");
    link.href = "/privacidade";
    link.textContent = " Saiba mais";
    link.style.cssText = "color:#5eead4";
    p.appendChild(link);
    function btn(label, primary, value) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.style.cssText =
        "border:0;border-radius:10px;padding:9px 14px;font-weight:700;cursor:pointer;" +
        (primary ? "background:#14b8a6;color:#042f2e" : "background:transparent;color:#cbd5e1;border:1px solid #475569");
      b.onclick = function () {
        setChoice(value);
        box.remove();
        if (value === "sim") start();
      };
      return b;
    }
    box.appendChild(p);
    box.appendChild(btn("Recusar", false, "nao"));
    box.appendChild(btn("Aceitar", true, "sim"));
    document.body.appendChild(box);
  }

  var choice = getChoice();
  if (choice === "sim") start();
  else if (choice !== "nao") {
    if (document.body) banner();
    else document.addEventListener("DOMContentLoaded", banner);
  }
})();
