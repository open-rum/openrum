import { highlightSnippet, type SnippetToken } from "./highlightSnippet";

const colors: Record<NonNullable<SnippetToken["kind"]>, string> = {
  keyword: "primary",
  string: "success",
  function: "info",
  property: "base-content",
  tag: "primary",
  comment: "base-content",
};

export function SnippetCode({ value, command = false }: { value: string; command?: boolean }) {
  if (command) return <code>{value}</code>;
  return (
    <code>
      {highlightSnippet(value).map((token, index) =>
        token.kind ? (
          <span
            key={index}
            data-syntax={token.kind}
            style={{
              color:
                token.kind === "comment"
                  ? "var(--ds-muted-foreground)"
                  : `color-mix(in oklab, var(--color-${colors[token.kind]}) 55%, var(--color-base-content))`,
            }}
          >
            {token.text}
          </span>
        ) : (
          token.text
        ),
      )}
    </code>
  );
}
