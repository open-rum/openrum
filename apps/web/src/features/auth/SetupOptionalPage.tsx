import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react";
import { BrandMark } from "@/components/brand/BrandMark";
import { ConsolePageTabs } from "@/components/layout/ConsolePage";
import { ThemeController } from "@/components/theme/ThemeController";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AuthenticationSection } from "@/features/admin/AuthenticationPage";
import { RetentionDefaultPolicySection } from "@/features/admin/DataRetentionPage";
import { EmailServiceSection } from "@/features/admin/EmailServicePage";
import { ObjectStorageSection } from "@/features/admin/ObjectStoragePage";
import {
  adminConfigurationQueryOptions,
  emailStatusQueryOptions,
  objectStorageStatusQueryOptions,
} from "@/lib/api/admin";
import { getAdminAuthentication } from "@/lib/auth/providers";
import { getRegistrationStatus, registrationStatusQueryKey } from "@/lib/auth/registration";

const optionalSetupSteps = [
  {
    id: "storage",
    label: "对象存储",
    description: "用于存放 Source Map 构建产物以还原压缩后的堆栈，所有项目共用。",
  },
  {
    id: "email",
    label: "邮件服务",
    description: "配置 SMTP 服务器后，可使用邮箱邀请成员、注册验证和邮件通知等功能。",
  },
  {
    id: "auth",
    label: "认证与访问",
    description: "配置 Google、GitHub、OIDC 或 LDAP 等外部登录方式，并设置是否开放自助注册。",
  },
  {
    id: "retention",
    label: "数据生命周期",
    description: "按存储预算调整实例默认的原始事件、聚合指标和 Source Map 保留天数。",
  },
] as const;

export type OptionalSetupStep = (typeof optionalSetupSteps)[number]["id"];

function isOptionalSetupStep(value: unknown): value is OptionalSetupStep {
  return optionalSetupSteps.some((step) => step.id === value);
}

export function SetupOptionalPage() {
  const navigate = useNavigate();
  const search = useSearch({ from: "/setup/optional" });
  const activeStep: OptionalSetupStep = search.step ?? "storage";
  const currentIndex = optionalSetupSteps.findIndex((step) => step.id === activeStep);
  const currentStep = optionalSetupSteps[currentIndex] ?? optionalSetupSteps[0];
  const isFirst = currentIndex <= 0;
  const isLast = currentIndex >= optionalSetupSteps.length - 1;

  // Read live status for every optional step so tab badges reflect both deployment
  // environment variables and changes saved during the wizard.
  const storageQuery = useQuery(objectStorageStatusQueryOptions());
  const emailQuery = useQuery(emailStatusQueryOptions());
  const authQuery = useQuery({
    queryKey: ["admin", "authentication"],
    queryFn: ({ signal }) => getAdminAuthentication(signal),
  });
  const registrationQuery = useQuery({
    queryKey: registrationStatusQueryKey,
    queryFn: ({ signal }) => getRegistrationStatus(signal),
    retry: false,
  });
  const configurationQuery = useQuery(adminConfigurationQueryOptions());

  const stepStatus: Record<OptionalSetupStep, { done: boolean; badge?: string }> = {
    storage: storageQuery.data?.configured ? { done: true, badge: "已启用" } : { done: false },
    email: emailQuery.data?.configured ? { done: true, badge: "已启用" } : { done: false },
    auth:
      (authQuery.data?.providers.some((provider) => provider.enabled) ?? false) ||
      Boolean(registrationQuery.data?.open)
        ? { done: true, badge: "已配置" }
        : { done: false },
    retention: configurationQuery.data?.settings.some(
      (item) => item.namespace === "retention" && item.source === "instance",
    )
      ? { done: true, badge: "已调整" }
      : { done: false },
  };

  const goToStep = (step: OptionalSetupStep) => {
    void navigate({
      to: "/setup/optional",
      search: { step },
      replace: true,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const enterConsole = () => {
    void navigate({ to: "/", replace: true });
  };

  return (
    <div className="auth-page">
      <header className="auth-toolbar mx-auto w-full max-w-5xl">
        <div className="auth-brand">
          <BrandMark size="lockup" />
          <span>OpenRUM</span>
        </div>
        <ThemeController />
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 pt-4 pb-12">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <Badge variant="success">实例已初始化</Badge>
            <h1 className="text-2xl font-semibold tracking-tight text-base-content">
              可选系统配置
            </h1>
            <p className="text-sm leading-6 text-base-content/70">
              以下配置均为可选项，不配置也可直接开始监控。您可以按需设置，或随时跳过进入控制台。
            </p>
          </div>
          <Button type="button" variant="outline" onClick={enterConsole}>
            全部跳过，进入控制台
          </Button>
        </header>

        <Tabs
          value={activeStep}
          onValueChange={(value) => {
            if (isOptionalSetupStep(value)) goToStep(value);
          }}
          className="gap-6"
        >
          <ConsolePageTabs>
            <TabsList
              variant="line"
              className="w-full justify-start overflow-x-auto"
              aria-label="可选配置步骤"
            >
              {optionalSetupSteps.map((step, index) => {
                const status = stepStatus[step.id];
                return (
                  <TabsTrigger key={step.id} value={step.id} className="gap-2">
                    <span className="tabular-nums text-base-content/70">{index + 1}.</span>
                    <span>{step.label}</span>
                    {status.badge ? (
                      <Badge variant="success" className="badge-xs">
                        {status.badge}
                      </Badge>
                    ) : null}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </ConsolePageTabs>

          <p className="text-sm text-base-content/70">{currentStep.description}</p>

          <TabsContent value="storage">
            <ObjectStorageSection />
          </TabsContent>
          <TabsContent value="email">
            <EmailServiceSection />
          </TabsContent>
          <TabsContent value="auth">
            <AuthenticationSection />
          </TabsContent>
          <TabsContent value="retention">
            <RetentionDefaultPolicySection />
          </TabsContent>
        </Tabs>

        <footer className="card card-border mt-auto bg-base-100">
          <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
            <div className="flex items-center gap-3">
              {!isFirst ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => goToStep(optionalSetupSteps[currentIndex - 1].id)}
                >
                  <ArrowLeftIcon data-icon="inline-start" aria-hidden="true" />
                  上一步
                </Button>
              ) : null}
              <span className="text-sm text-base-content/70 tabular-nums">
                第 {currentIndex + 1} / {optionalSetupSteps.length} 步
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {!isLast ? (
                <>
                  <Button type="button" variant="ghost" onClick={enterConsole}>
                    全部跳过
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => goToStep(optionalSetupSteps[currentIndex + 1].id)}
                  >
                    {stepStatus[activeStep].done ? "下一步" : "跳过此步"}
                    <ArrowRightIcon data-icon="inline-end" aria-hidden="true" />
                  </Button>
                </>
              ) : (
                <Button type="button" onClick={enterConsole}>
                  完成并进入控制台
                  <ArrowRightIcon data-icon="inline-end" aria-hidden="true" />
                </Button>
              )}
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}
