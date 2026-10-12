// Google Analytics 4 do Estoque Pro.
// Para ligar: troque o valor vazio abaixo pelo ID da propriedade (ex.: "G-ABC123XYZ").
// Vazio = nada é carregado.
(function () {
  var GA_ID = "G-WGV41RG2TZ";
  if (!GA_ID) return;
  var s = document.createElement("script");
  s.async = true;
  s.src = "https://www.googletagmanager.com/gtag/js?id=" + GA_ID;
  document.head.appendChild(s);
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  window.gtag("js", new Date());
  window.gtag("config", GA_ID, { anonymize_ip: true });
  // Cliques em "Testar grátis" e WhatsApp viram eventos (mede o que traz cadastro).
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a");
    if (!a) return;
    var h = a.getAttribute("href") || "";
    if (h.indexOf("/cadastro") === 0) window.gtag("event", "clique_teste_gratis", { pagina: location.pathname });
    else if (h.indexOf("wa.me") > -1) window.gtag("event", "clique_whatsapp", { pagina: location.pathname });
  });
})();
