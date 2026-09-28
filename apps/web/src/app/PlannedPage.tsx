import type { Icon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { ConsolePage } from "@/components/layout/ConsolePage";
import { Button } from "@/components/ui/button";

type PlannedPageProps = {
  description: string;
  icon: Icon;
  title: string;
};

export function PlannedPage({ description, icon: Icon, title }: PlannedPageProps) {
  return (
    <ConsolePage width="narrow">
      <section className="planned-view">
        <span className="planned-view__icon">
          <Icon size={28} />
        </span>
        <h1>{title}</h1>
        <p>{description}</p>
        <Button variant="outline" asChild>
          <Link to="/">返回仪表盘</Link>
        </Button>
      </section>
    </ConsolePage>
  );
}
