// An assistant reply, rendered from the light markdown models write in. No
// HTML is injected: the parser yields blocks and inline runs, and this maps
// them to elements, so a model's (or a read source's) text never reaches the
// page as markup.
import { parseChatMarkdown, type Inline } from "@/lib/chatMarkdown";

function Inlines({ runs }: { runs: Inline[] }) {
  return (
    <>
      {runs.map((r, i) => {
        switch (r.kind) {
          case "bold": return <strong key={i} className="font-semibold">{r.text}</strong>;
          case "italic": return <em key={i}>{r.text}</em>;
          case "code": return <code key={i} className="rounded bg-neutral-200/70 px-1 py-px font-mono text-[0.85em]">{r.text}</code>;
          case "link": return <a key={i} href={r.href} target="_blank" rel="noopener noreferrer" className="text-brand-ink underline underline-offset-2">{r.text}</a>;
          default: return <span key={i}>{r.text}</span>;
        }
      })}
    </>
  );
}

export function ChatMarkdown({ text, className }: { text: string; className?: string }) {
  const blocks = parseChatMarkdown(text);
  return (
    <div className={className}>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "heading":
            return <p key={i} className="mt-2 font-semibold first:mt-0"><Inlines runs={b.inlines} /></p>;
          case "list":
            return b.ordered
              ? <ol key={i} className="my-1 list-decimal space-y-0.5 ps-5">{b.items.map((it, j) => <li key={j}><Inlines runs={it} /></li>)}</ol>
              : <ul key={i} className="my-1 list-disc space-y-0.5 ps-5">{b.items.map((it, j) => <li key={j}><Inlines runs={it} /></li>)}</ul>;
          case "code":
            return <pre key={i} className="my-1 overflow-x-auto rounded-lg bg-neutral-200/60 px-2.5 py-2 font-mono text-[12px] leading-5"><code>{b.text}</code></pre>;
          default:
            return <p key={i} className="whitespace-pre-wrap [&+p]:mt-2"><Inlines runs={b.inlines} /></p>;
        }
      })}
    </div>
  );
}
