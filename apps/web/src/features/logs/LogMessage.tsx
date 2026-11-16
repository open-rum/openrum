import { messageParts } from "./logPresentation";

export function LogMessage({ message, query = "" }: { message: string; query?: string }) {
  return message
    ? messageParts(message, query).map((part, index) =>
        part.match ? (
          <mark key={index} className="rounded-selector bg-warning text-warning-content">
            {part.text}
          </mark>
        ) : (
          part.text
        ),
      )
    : "（空正文）";
}
