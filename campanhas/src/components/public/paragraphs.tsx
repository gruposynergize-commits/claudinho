/**
 * Renderiza texto simples em parágrafos. Nunca interpreta HTML (conteúdo
 * digitado no painel é exibido como texto — sem risco de XSS).
 */
export function Paragraphs({ text, className }: { text: string | null | undefined; className?: string }) {
  const parts = (text ?? "")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  return (
    <div className={className}>
      {parts.map((p, i) => (
        <p key={i} className="whitespace-pre-line">
          {p}
        </p>
      ))}
    </div>
  );
}
