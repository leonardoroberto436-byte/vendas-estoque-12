import { whatsappLink } from "@/lib/brand";

interface Props {
  message?: string;
}

/** Botão flutuante de suporte pelo WhatsApp (canto inferior direito). */
export default function WhatsAppButton({ message = "Olá! Preciso de ajuda com o sistema." }: Props) {
  return (
    <a
      href={whatsappLink(message)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Falar com o suporte pelo WhatsApp"
      title="Suporte pelo WhatsApp"
      className="group fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-[#25D366] p-3.5 text-white shadow-lg shadow-black/15 transition-transform duration-150 hover:scale-105 active:scale-95 print:hidden"
      data-testid="whatsapp-support-btn"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" className="size-6 fill-current">
        <path d="M17.47 14.38c-.3-.15-1.75-.86-2.02-.96-.27-.1-.47-.15-.67.15-.2.3-.77.96-.94 1.16-.17.2-.35.22-.64.07-.3-.15-1.25-.46-2.38-1.47-.88-.79-1.47-1.76-1.65-2.06-.17-.3-.02-.46.13-.6.13-.14.3-.35.45-.52.15-.18.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.6-.92-2.2-.24-.58-.49-.5-.67-.5h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48 0 1.46 1.07 2.88 1.22 3.08.15.2 2.1 3.2 5.08 4.49.71.3 1.27.49 1.7.63.72.23 1.37.2 1.88.12.57-.09 1.75-.72 2-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35M12.05 21.5h-.01a9.4 9.4 0 0 1-4.8-1.31l-.34-.2-3.57.93.95-3.48-.22-.36a9.4 9.4 0 0 1-1.45-5.02c0-5.2 4.24-9.44 9.45-9.44 2.52 0 4.9.99 6.68 2.77a9.4 9.4 0 0 1 2.76 6.68c0 5.21-4.24 9.44-9.45 9.44m8.04-17.48A11.3 11.3 0 0 0 12.05.7C5.78.7.68 5.8.68 12.06c0 2 .52 3.96 1.52 5.68L.58 23.3l5.7-1.5a11.3 11.3 0 0 0 5.76 1.47h.01c6.26 0 11.36-5.1 11.37-11.36 0-3.04-1.18-5.89-3.33-8.04" />
      </svg>
      <span className="hidden pr-1 text-sm font-semibold sm:group-hover:inline">Suporte</span>
    </a>
  );
}
