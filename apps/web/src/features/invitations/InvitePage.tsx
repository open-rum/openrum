import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { CircleAlertIcon, CircleCheckIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { AuthField, AuthFrame } from "@/features/auth/AuthFrame";
import { roleLabels } from "@/features/settings/roleLabels";
import {
  getInvitationPreview,
  invitationLoginHref,
  joinWithInvitation,
  registerWithInvitation,
  type InvitationPreview,
} from "@/lib/api/invitations";
import { passwordPattern, passwordRuleHint } from "@/lib/auth/password";
import { HTTPError, logout, sessionQueryOptions } from "@/lib/auth/session";

/**
 * Where an invitation link lands. Someone with no account registers here, someone with one
 * signs in and comes back; either way the result is a request to join, which an
 * administrator still has to approve.
 */
export function InvitePage() {
  const { token } = useParams({ from: "/invite/$token" });
  const preview = useQuery({
    queryKey: ["invitation", token],
    queryFn: ({ signal }) => getInvitationPreview(token, signal),
    retry: false,
  });
  const session = useQuery(sessionQueryOptions());
  const signedOut = session.error instanceof HTTPError && session.error.status === 401;

  if (preview.isLoading || (session.isLoading && !session.data)) {
    return (
      <AuthFrame>
        <p className="text-center text-sm text-muted-foreground" role="status">
          正在读取邀请…
        </p>
      </AuthFrame>
    );
  }
  if (preview.error || !preview.data) {
    const missing = preview.error instanceof HTTPError && preview.error.status === 404;
    return (
      <Notice
        tone="warning"
        title={missing ? "这个邀请链接无效" : "无法读取邀请"}
        text={missing ? "链接可能被截断或复制错了。请让管理员重新发一个。" : "请稍后刷新页面重试。"}
      />
    );
  }
  const invitation = preview.data;
  if (invitation.state !== "valid") {
    return (
      <Notice
        tone="warning"
        title={invitation.state === "expired" ? "这个邀请已过期" : "这个邀请已被撤销"}
        text={`请联系「${invitation.organizationName}」的管理员，重新发一个邀请。`}
      />
    );
  }
  if (session.data?.accessStatus === "pending") {
    return (
      <Notice
        tone="default"
        title="你的账号正在等待管理员通过"
        text="在已有的申请通过之前，暂时不能再申请加入其他组织。"
        action={
          <Button asChild variant="outline">
            <Link to="/awaiting-access" search={{ returnTo: undefined }}>
              查看申请状态
            </Link>
          </Button>
        }
      />
    );
  }
  if (signedOut) return <RegisterForm token={token} invitation={invitation} />;
  return (
    <JoinPanel
      token={token}
      invitation={invitation}
      account={session.data ? `${session.data.displayName}（${session.data.email}）` : ""}
    />
  );
}

function Heading({ invitation }: { invitation: InvitationPreview }) {
  return (
    <div className="auth-heading">
      <h1>加入「{invitation.organizationName}」</h1>
      <p>
        {invitation.inviterName ? `${invitation.inviterName} 邀请你` : "你被邀请"}以{" "}
        {roleLabels[invitation.role]} 身份加入。提交申请后，需要管理员通过才会生效。
      </p>
    </div>
  );
}

function RegisterForm({ token, invitation }: { token: string; invitation: InvitationPreview }) {
  const register = useMutation({
    mutationFn: (input: { email: string; displayName: string; password: string }) =>
      registerWithInvitation(token, input),
    // A full load, so the new session is read from scratch and the waiting page takes over.
    onSuccess: () => window.location.replace("/awaiting-access"),
  });
  const code = register.error instanceof HTTPError ? register.error.code : undefined;
  return (
    <AuthFrame>
      <Heading invitation={invitation} />
      <form
        aria-label="注册并申请加入"
        aria-busy={register.isPending}
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          register.mutate({
            displayName: String(form.get("displayName") ?? ""),
            email: String(form.get("email") ?? ""),
            password: String(form.get("password") ?? ""),
          });
        }}
      >
        <FieldGroup>
          <AuthField
            name="displayName"
            label="姓名"
            placeholder="同事看到的名字"
            required
            maxLength={120}
            autoComplete="name"
            autoFocus
          />
          <AuthField
            name="email"
            label="邮箱"
            type="email"
            placeholder="you@company.com"
            required
            maxLength={320}
            autoComplete="email"
            aria-invalid={code === "EMAIL_TAKEN" || undefined}
          />
          <AuthField
            name="password"
            label="密码"
            type="password"
            required
            pattern={passwordPattern}
            title={passwordRuleHint}
            maxLength={1024}
            autoComplete="new-password"
            hint={passwordRuleHint}
          />
          {register.error ? (
            <Alert variant="destructive" role="alert">
              <CircleAlertIcon aria-hidden="true" />
              <AlertDescription>
                {registerErrorMessage(register.error)}
                {code === "EMAIL_TAKEN" ? (
                  <>
                    {" "}
                    <a className="underline underline-offset-2" href={invitationLoginHref(token)}>
                      去登录
                    </a>
                  </>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}
          <Button
            type="submit"
            size="lg"
            className="mt-1 h-11 w-full"
            disabled={register.isPending}
          >
            {register.isPending ? "正在提交…" : "注册并申请加入"}
          </Button>
        </FieldGroup>
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        已有账号？{" "}
        <a
          className="text-foreground underline underline-offset-2"
          href={invitationLoginHref(token)}
        >
          登录后申请
        </a>
      </p>
    </AuthFrame>
  );
}

function JoinPanel({
  token,
  invitation,
  account,
}: {
  token: string;
  invitation: InvitationPreview;
  account: string;
}) {
  const queryClient = useQueryClient();
  const join = useMutation({ mutationFn: () => joinWithInvitation(token) });
  const signOut = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      queryClient.clear();
      window.location.replace(window.location.pathname);
    },
  });
  if (join.data) {
    const member = join.data.outcome === "already_member";
    return (
      <Notice
        tone="success"
        title={member ? "你已经是这个组织的成员" : "申请已提交，等待管理员通过"}
        text={
          member
            ? `你已经在「${join.data.organizationName}」里了，不需要再申请。`
            : `管理员通过后，「${join.data.organizationName}」会出现在你的控制台里。`
        }
        note={member ? undefined : "通过时不会另行通知，过一会儿再打开控制台看一下。"}
        action={
          <Button asChild variant="outline">
            <Link to="/">进入控制台</Link>
          </Button>
        }
      />
    );
  }
  return (
    <AuthFrame>
      <Heading invitation={invitation} />
      <p className="mb-5 text-center text-sm text-muted-foreground">
        将使用当前账号 {account} 提交申请。
      </p>
      {join.error ? (
        <Alert variant="destructive" className="mb-5" role="alert">
          <CircleAlertIcon aria-hidden="true" />
          <AlertDescription>{joinErrorMessage(join.error)}</AlertDescription>
        </Alert>
      ) : null}
      <Button
        type="button"
        size="lg"
        className="h-11 w-full"
        disabled={join.isPending}
        onClick={() => join.mutate()}
      >
        {join.isPending ? "正在提交…" : "申请加入"}
      </Button>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        不是这个账号？{" "}
        <button
          type="button"
          className="text-foreground underline underline-offset-2"
          disabled={signOut.isPending}
          onClick={() => signOut.mutate()}
        >
          退出登录
        </button>
      </p>
    </AuthFrame>
  );
}

function Notice({
  tone,
  title,
  text,
  note,
  action,
}: {
  tone: "warning" | "success" | "default";
  title: string;
  text: string;
  /** A quieter line under the text, with a check mark. */
  note?: string;
  action?: React.ReactNode;
}) {
  return (
    <AuthFrame>
      <div className="space-y-5 text-center">
        <div className="auth-heading">
          <h1>{title}</h1>
          <p>{text}</p>
        </div>
        {note ? (
          <p className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
            <CircleCheckIcon className="size-4" aria-hidden="true" />
            {note}
          </p>
        ) : null}
        <div className="flex justify-center gap-3">
          {action}
          {tone === "warning" ? (
            <Button asChild variant="outline">
              <Link to="/login" search={{ returnTo: undefined, expired: undefined }}>
                去登录
              </Link>
            </Button>
          ) : null}
        </div>
      </div>
    </AuthFrame>
  );
}

function registerErrorMessage(error: Error) {
  const code = error instanceof HTTPError ? error.code : undefined;
  if (code === "EMAIL_TAKEN") return "这个邮箱已经注册过了，请登录后申请。";
  if (code === "INVITATION_INVALID") return "这个邀请已经失效，请联系管理员重新发一个。";
  if (code === "INVITATION_LIMIT") return "这个组织待处理的申请太多了，请联系管理员。";
  if (code === "RATE_LIMITED") return "这个网络地址注册得太频繁了，请稍后再试。";
  return error.message;
}

function joinErrorMessage(error: Error) {
  const code = error instanceof HTTPError ? error.code : undefined;
  if (code === "INVITATION_INVALID") return "这个邀请已经失效，请联系管理员重新发一个。";
  if (code === "INVITATION_LIMIT") return "这个组织待处理的申请太多了，请联系管理员。";
  return error.message;
}
