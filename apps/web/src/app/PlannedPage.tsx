import type { Icon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

type PlannedPageProps = {
  description: string;
  icon: Icon;
  title: string;
};

export function PlannedPage({ description, icon: Icon, title }: PlannedPageProps) {
  return (
    <section className="planned-view">
      <span className="planned-view__icon">
        <Icon size={28} />
      </span>
      <p className="breadcrumb">
        商城 H5 <span>/</span> {title}
      </p>
      <h1>{title}</h1>
      <p>{description}</p>
      <Button variant="outline" asChild>
        <Link to="/">返回数据大盘</Link>
      </Button>
    </section>
  );
}
