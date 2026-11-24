import type { ReactNode } from "react";
import { ProjectConnectionIllustration } from "@/components/illustrations/ProjectConnectionIllustration";

export function ProjectEmptyState({
  restricted,
  children,
}: {
  restricted: boolean;
  children?: ReactNode;
}) {
  return (
    <section className="card bg-base-100" aria-labelledby="project-empty-title">
      <div className="flex flex-col items-center px-6 py-12 text-center sm:py-16">
        <ProjectConnectionIllustration />
        <h2 id="project-empty-title" className="mt-6 text-xl font-semibold tracking-tight">
          {restricted ? "还没有项目" : "创建你的第一个项目"}
        </h2>
        <p className="mt-2 max-w-sm text-sm leading-6 text-base-content/70">
          {restricted
            ? "当前角色不能创建项目，请联系组织 Owner 或 Admin。"
            : "接入应用，查看访问、性能和错误数据。"}
        </p>
        {children ? <div className="mt-6">{children}</div> : null}
      </div>
    </section>
  );
}
