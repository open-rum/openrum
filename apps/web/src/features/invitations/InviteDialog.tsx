import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CheckIcon, CopyIcon, LinkIcon, MailIcon, TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  INVITATION_DAYS,
  createInvitation,
  invitationsQueryKey,
  listInvitations,
  type CreatedInvitation,
  type InvitationRole,
} from "@/lib/api/invitations";
import type { Organization } from "@/lib/api/projects";
import { HTTPError, sessionQueryOptions } from "@/lib/auth/session";
import { roleLabels } from "@/features/settings/roleLabels";

const roles: InvitationRole[] = ["member", "viewer", "admin"];

/**
 * Hands out an invitation link, by copying it or by mailing it. A link only lets its holder
 * ask to join; an administrator still has to approve, which the dialog says up front.
 */
export function InviteDialog({
  organization,
  open,
  onOpenChange,
}: {
  organization: Pick<Organization, "id" | "name">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const session = useQuery({ ...sessionQueryOptions(), enabled: open });
  const invitations = useQuery({
    queryKey: invitationsQueryKey(organization.id),
    queryFn: ({ signal }) => listInvitations(organization.id, signal),
    enabled: open,
  });
  const emailEnabled = invitations.data?.emailEnabled ?? false;
  const [role, setRole] = useState<InvitationRole>("member");
  const [tab, setTab] = useState("link");
  const [email, setEmail] = useState("");
  // The link made for one role is not offered once another role is picked.
  const [generated, setGenerated] = useState<{ role: InvitationRole; made: CreatedInvitation }>();
  const [mailedTo, setMailedTo] = useState<string>();

  const create = useMutation({
    mutationFn: (input: { role: InvitationRole; email?: string }) =>
      createInvitation(organization.id, input),
    onSuccess: (made, input) => {
      setGenerated({ role: input.role, made });
      void queryClient.invalidateQueries({ queryKey: invitationsQueryKey(organization.id) });
    },
  });
  const link = generated?.role === role ? generated.made.link : undefined;
  const failedDelivery =
    generated?.role === role && generated.made.delivery && !generated.made.delivery.success
      ? generated.made.delivery
      : undefined;

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("已复制");
    } catch {
      toast.error("复制失败，请手动选择链接");
    }
  }

  function close(next: boolean) {
    onOpenChange(next);
    if (!next) {
      // Nothing outlives the dialog: the link is shown here and not stored in the page.
      setGenerated(undefined);
      setMailedTo(undefined);
      setEmail("");
      setTab("link");
      create.reset();
    }
  }

  const instanceAdmin = Boolean(session.data?.instanceRole);

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>邀请成员加入「{organization.name}」</DialogTitle>
          <DialogDescription>
            对方通过链接注册或登录后提交加入申请，管理员通过后才会加入组织。链接 {INVITATION_DAYS}{" "}
            天内有效。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 text-sm font-medium">
          <label htmlFor="invite-role">加入后的角色</label>
          <Select
            value={role}
            onValueChange={(value) => {
              setRole(value as InvitationRole);
              setMailedTo(undefined);
            }}
          >
            <SelectTrigger id="invite-role" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {roles.map((item) => (
                <SelectItem key={item} value={item}>
                  {roleLabels[item]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="w-full" aria-label="邀请方式">
            <TabsTrigger value="link">
              <LinkIcon aria-hidden="true" />
              复制链接
            </TabsTrigger>
            <TabsTrigger value="email" disabled={!emailEnabled}>
              <MailIcon aria-hidden="true" />
              发送邮件
            </TabsTrigger>
          </TabsList>
          {!emailEnabled && invitations.isSuccess ? (
            <p className="mt-2 text-xs text-muted-foreground">
              实例还没有配置邮件服务，暂时只能复制链接。
              {instanceAdmin ? (
                <>
                  {" "}
                  <Link to="/settings/instance/email" className="underline underline-offset-2">
                    去配置邮件服务
                  </Link>
                </>
              ) : (
                "需要实例管理员先配置。"
              )}
            </p>
          ) : null}

          <TabsContent value="link" className="mt-4 grid gap-3">
            {link ? (
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={link}
                  aria-label="邀请链接"
                  onFocus={(event) => event.currentTarget.select()}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="复制邀请链接"
                  onClick={() => void copy(link)}
                >
                  <CopyIcon />
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                disabled={create.isPending}
                onClick={() => {
                  create.mutate(
                    { role },
                    {
                      onSuccess: (made) => {
                        // Copying is what the click was for; the field stays as a fallback.
                        void copy(made.link);
                      },
                    },
                  );
                }}
              >
                <LinkIcon aria-hidden="true" />
                {create.isPending ? "正在生成…" : "生成并复制链接"}
              </Button>
            )}
          </TabsContent>

          <TabsContent value="email" className="mt-4 grid gap-3">
            <form
              className="grid gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                const address = email.trim();
                if (!address) return;
                create.mutate(
                  { role, email: address },
                  {
                    onSuccess: (made) => {
                      if (made.delivery?.success) {
                        setMailedTo(address);
                        setEmail("");
                      }
                    },
                  },
                );
              }}
            >
              <label className="grid gap-2 text-sm font-medium">
                收件邮箱
                <Input
                  type="email"
                  required
                  maxLength={320}
                  value={email}
                  placeholder="colleague@company.com"
                  onChange={(event) => {
                    setEmail(event.target.value);
                    setMailedTo(undefined);
                  }}
                />
              </label>
              <Button type="submit" disabled={create.isPending || !email.trim()}>
                <MailIcon aria-hidden="true" />
                {create.isPending ? "正在发送…" : "发送邀请邮件"}
              </Button>
            </form>
            {mailedTo ? (
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground" role="status">
                <CheckIcon className="size-4" aria-hidden="true" />
                已发送到 {mailedTo}
              </p>
            ) : null}
            {failedDelivery && link ? (
              <Alert variant="warning" role="alert">
                <TriangleAlertIcon aria-hidden="true" />
                <AlertDescription className="grid gap-2">
                  <span>
                    邮件没有发出去：{failedDelivery.message}。链接已经生成，可以复制后自己发给对方。
                  </span>
                  <span className="flex gap-2">
                    <Input
                      readOnly
                      value={link}
                      aria-label="邀请链接"
                      onFocus={(event) => event.currentTarget.select()}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label="复制邀请链接"
                      onClick={() => void copy(link)}
                    >
                      <CopyIcon />
                    </Button>
                  </span>
                </AlertDescription>
              </Alert>
            ) : null}
          </TabsContent>
        </Tabs>

        {create.error ? (
          <p className="text-sm text-destructive" role="alert">
            {createErrorMessage(create.error)}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function createErrorMessage(error: Error) {
  const code = error instanceof HTTPError ? error.code : undefined;
  if (code === "INVITATION_LIMIT") return "这个组织的有效邀请已达上限，请先撤销不用的邀请。";
  if (code === "EMAIL_NOT_CONFIGURED") return "实例还没有配置邮件服务，无法发送邮件。";
  return `生成邀请失败：${error.message}`;
}
