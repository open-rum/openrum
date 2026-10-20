import { useMutation, useQuery } from "@tanstack/react-query";
import { CircleAlertIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { completeExternalRegistration, getExternalProfile } from "@/lib/auth/registration";
import { HTTPError } from "@/lib/auth/session";
import { AuthField, AuthFrame } from "./AuthFrame";

/**
 * The last step of signing up through an external provider that gave no address. The address
 * is not verified, only required to be unused.
 */
export function CompleteRegistrationPage() {
  const profile = useQuery({
    queryKey: ["auth", "register", "external"],
    queryFn: ({ signal }) => getExternalProfile(signal),
    retry: false,
  });
  const complete = useMutation({
    mutationFn: completeExternalRegistration,
    // A full load, so the new session is read from scratch.
    onSuccess: ({ returnTo }) => window.location.replace(returnTo),
  });

  if (profile.isLoading) {
    return (
      <AuthFrame>
        <p className="text-center text-sm text-muted-foreground" role="status">
          正在读取注册信息…
        </p>
      </AuthFrame>
    );
  }
  if (profile.error || !profile.data) {
    return (
      <AuthFrame>
        <div className="auth-heading">
          <h1>注册已过期</h1>
          <p>这次外部注册已经失效，请重新开始。</p>
        </div>
        <p className="text-center text-sm">
          <a className="text-foreground underline underline-offset-2" href="/register">
            重新注册
          </a>
        </p>
      </AuthFrame>
    );
  }
  const taken = complete.error instanceof HTTPError && complete.error.code === "EMAIL_TAKEN";
  return (
    <AuthFrame>
      <div className="auth-heading">
        <h1>补充你的邮箱</h1>
        <p>
          {profile.data.providerLabel} 没有提供邮箱。填一个常用的邮箱，用来在 OpenRUM 里识别你。
        </p>
      </div>
      <form
        aria-label="补充邮箱"
        aria-busy={complete.isPending}
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          complete.mutate({
            displayName: String(form.get("displayName") ?? ""),
            email: String(form.get("email") ?? ""),
          });
        }}
      >
        <FieldGroup>
          <AuthField
            name="displayName"
            label="用户名"
            required
            maxLength={120}
            defaultValue={profile.data.displayName}
            autoComplete="name"
          />
          <AuthField
            name="email"
            label="邮箱"
            type="email"
            placeholder="you@company.com"
            required
            maxLength={320}
            autoComplete="email"
            autoFocus
            aria-invalid={taken || undefined}
          />
          {complete.error ? (
            <Alert variant="destructive" role="alert">
              <CircleAlertIcon aria-hidden="true" />
              <AlertDescription>{completeErrorMessage(complete.error)}</AlertDescription>
            </Alert>
          ) : null}
          <Button
            type="submit"
            size="lg"
            className="mt-1 h-11 w-full"
            disabled={complete.isPending}
          >
            {complete.isPending ? "正在提交…" : "完成注册"}
          </Button>
        </FieldGroup>
      </form>
    </AuthFrame>
  );
}

function completeErrorMessage(error: Error) {
  const code = error instanceof HTTPError ? error.code : undefined;
  if (code === "EMAIL_TAKEN") return "这个邮箱已经有人在用了，请换一个。";
  if (code === "REGISTRATION_EXPIRED") return "这次注册已经过期，请重新开始。";
  if (code === "RATE_LIMITED") return "尝试得太频繁了，请稍后再试。";
  return error.message;
}
