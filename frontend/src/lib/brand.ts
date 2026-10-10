// Nome e contato da marca num lugar só — para trocar o nome, mude aqui
// (e o <title> em index.html, e EMAIL_FROM_NAME nos Secrets do Emergent).
export const BRAND_NAME = "Estoque Pro";

// Suporte pelo WhatsApp: DDI + DDD + número, só dígitos.
export const WHATSAPP_NUMBER = "5519991629460";
export const WHATSAPP_DISPLAY = "(19) 99162-9460";

export function whatsappLink(message: string): string {
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}
