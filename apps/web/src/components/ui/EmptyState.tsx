import type { LucideIcon } from "lucide-react";
import { InboxIcon } from "lucide-react";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./empty";

export function EmptyState({
  title,
  description,
  icon: Icon = InboxIcon,
}: {
  title: string;
  description: string;
  icon?: LucideIcon;
}) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
