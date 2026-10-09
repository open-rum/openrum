import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2Icon,
  EllipsisIcon,
  LoaderCircleIcon,
  PencilIcon,
  SendIcon,
  Trash2Icon,
  XCircleIcon,
} from "lucide-react";
import { AsyncError } from "@/components/ui/AsyncState";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  deleteChannel,
  getChannels,
  testChannel,
  updateChannel,
  type ChannelTestResult,
  type NotificationChannel,
} from "@/lib/api/alerts";
import { listOrganizations } from "@/lib/api/projects";
import { deliveryErrorText } from "@/features/alerts/alertRules";
import { SettingsShell } from "./SettingsShell";
import { ChannelDialog, type ChannelDialogState } from "./channels/ChannelDialog";
import { ChannelKindIcon } from "./channels/ChannelKindIcon";
import { channelKind, channelKinds } from "./channels/channelKinds";

export function ChannelsPage() {
  const queryClient = useQueryClient();
  const organizationsQuery = useQuery({ queryKey: ["organizations"], queryFn: listOrganizations });
  const organizations = useMemo(
    () => organizationsQuery.data?.organizations ?? [],
    [organizationsQuery.data],
  );
  const [selectedOrganization, setSelectedOrganization] = useState("");
  const organizationId = selectedOrganization || organizations[0]?.id || "";
  const channelsKey = ["channels", organizationId] as const;
  const channels = useQuery({
    queryKey: channelsKey,
    queryFn: ({ signal }) => getChannels(organizationId, signal),
    enabled: Boolean(organizationId),
  });
  const canManage = channels.data?.canManage ?? false;
  const refresh = () => queryClient.invalidateQueries({ queryKey: channelsKey });

  const [dialog, setDialog] = useState<ChannelDialogState | null>(null);
  const [removing, setRemoving] = useState<NotificationChannel | null>(null);
  const [tests, setTests] = useState<Record<string, ChannelTestResult | "pending">>({});
  const [notice, setNotice] = useState("");

  const toggle = useMutation({
    mutationFn: (channel: NotificationChannel) =>
      updateChannel(organizationId, channel.id, { enabled: !channel.enabled }),
    onSuccess: () => void refresh(),
  });
  const remove = useMutation({
    mutationFn: (channel: NotificationChannel) => deleteChannel(organizationId, channel.id),
    onSuccess: (_, channel) => {
      setRemoving(null);
      setNotice(`已删除渠道「${channel.name}」。`);
      void refresh();
    },
  });
  async function runTest(channel: NotificationChannel) {
    setTests((current) => ({ ...current, [channel.id]: "pending" }));
    try {
      const result = await testChannel(organizationId, channel.id);
      setTests((current) => ({ ...current, [channel.id]: result }));
    } catch {
      setTests((current) => ({
        ...current,
        [channel.id]: { delivered: false, errorCode: "delivery_failed" },
      }));
    }
  }

  const failure = channels.error ?? toggle.error ?? remove.error;
  return (
    <SettingsShell
      title="通知渠道"
      description="告警通过这些渠道送达。渠道属于组织，组织内各项目的告警规则都可以选用。"
      width="wide"
      actions={
        organizations.length > 1 ? (
          <Select value={organizationId} onValueChange={setSelectedOrganization}>
            <SelectTrigger className="w-56" aria-label="组织">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {organizations.map((organization) => (
                <SelectItem key={organization.id} value={organization.id}>
                  {organization.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null
      }
    >
      <div className="flex flex-col gap-8">
        {failure ? (
          <AsyncError
            error={failure}
            title="渠道操作失败"
            remediation="现有渠道未改变，请稍后重试。"
            onRetry={() => void refresh()}
          />
        ) : null}
        {notice ? (
          <p role="status" className="text-sm text-muted-foreground">
            {notice}
          </p>
        ) : null}

        <section aria-labelledby="channel-kinds-title" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="channel-kinds-title" className="text-base font-semibold">
              添加渠道
            </h2>
            {!canManage && channels.data ? (
              <p className="text-sm text-muted-foreground">
                只有组织的 Owner 和 Admin 可以添加或修改渠道。
              </p>
            ) : null}
          </div>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {channelKinds.map((kind) => {
              const soon = kind.status === "soon";
              const disabled = soon || !canManage;
              return (
                <li key={kind.id}>
                  <button
                    type="button"
                    disabled={disabled}
                    title={soon ? `${kind.name}渠道即将支持` : undefined}
                    onClick={() => setDialog({ mode: "create", kind })}
                    className="channel-kind-card flex w-full items-center gap-3 rounded-2xl border bg-card p-4 text-left"
                  >
                    <ChannelKindIcon kind={kind.id} />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex items-center gap-2 text-sm font-medium">
                        {kind.name}
                        {soon ? <Badge variant="secondary">即将支持</Badge> : null}
                      </span>
                      <span className="text-xs text-muted-foreground">{kind.description}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-labelledby="channels-title" className="flex flex-col gap-3">
          <h2 id="channels-title" className="text-base font-semibold">
            已配置的渠道
          </h2>
          {channels.isPending && organizationId ? (
            <Skeleton className="h-32" />
          ) : channels.data?.channels.length ? (
            <div className="overflow-hidden rounded-2xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>渠道</TableHead>
                    <TableHead>启用</TableHead>
                    <TableHead>使用中</TableHead>
                    <TableHead>测试发送</TableHead>
                    <TableHead className="w-12">
                      <span className="sr-only">操作</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {channels.data.channels.map((channel) => {
                    const kind = channelKind(channel.kind);
                    const test = tests[channel.id];
                    return (
                      <TableRow key={channel.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <ChannelKindIcon kind={channel.kind} />
                            <div className="flex min-w-0 flex-col">
                              <span className="truncate font-medium">{channel.name}</span>
                              <span className="text-xs text-muted-foreground">
                                {kind?.name ?? channel.kind}
                              </span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={channel.enabled}
                            disabled={!canManage || toggle.isPending}
                            onCheckedChange={() => toggle.mutate(channel)}
                            aria-label={`${channel.enabled ? "停用" : "启用"}渠道 ${channel.name}`}
                          />
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {channel.ruleCount ? `${channel.ruleCount} 条规则` : "未被使用"}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={
                                !canManage || test === "pending" || kind?.status !== "available"
                              }
                              onClick={() => void runTest(channel)}
                            >
                              {test === "pending" ? (
                                <LoaderCircleIcon
                                  className="animate-spin"
                                  data-icon="inline-start"
                                />
                              ) : (
                                <SendIcon data-icon="inline-start" />
                              )}
                              发送
                            </Button>
                            {test && test !== "pending" ? (
                              <span
                                role="status"
                                className="inline-flex items-center gap-1 text-xs text-muted-foreground"
                              >
                                {test.delivered ? (
                                  <CheckCircle2Icon className="size-3.5 text-[var(--ds-success)]" />
                                ) : (
                                  <XCircleIcon className="size-3.5 text-[var(--ds-danger)]" />
                                )}
                                {test.delivered ? "已送达" : deliveryErrorText(test.errorCode)}
                              </span>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell>
                          {canManage ? (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label={`${channel.name} 的操作`}
                                >
                                  <EllipsisIcon />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  disabled={kind?.status !== "available"}
                                  onSelect={() =>
                                    kind && setDialog({ mode: "edit", kind, channel })
                                  }
                                >
                                  <PencilIcon />
                                  编辑
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  variant="destructive"
                                  onSelect={() => setRemoving(channel)}
                                >
                                  <Trash2Icon />
                                  删除
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <Empty className="border border-dashed">
              <EmptyHeader>
                <EmptyTitle>还没有通知渠道</EmptyTitle>
                <EmptyDescription>
                  在上方选择一种渠道开始配置，比如把告警推送到飞书群。
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </section>
      </div>

      {dialog ? (
        <ChannelDialog
          key={dialog.mode === "edit" ? dialog.channel.id : dialog.kind.id}
          organizationId={organizationId}
          state={dialog}
          onClose={() => setDialog(null)}
          onSaved={(message) => {
            setDialog(null);
            setNotice(message);
            void refresh();
          }}
        />
      ) : null}

      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除渠道「{removing?.name}」？</AlertDialogTitle>
            <AlertDialogDescription>
              {removing?.ruleCount
                ? `有 ${removing.ruleCount} 条告警规则在使用它，删除后这些规则不再通知到这里，其他渠道不受影响。`
                : "删除后无法恢复，它的送达记录也会一并删除。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={remove.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (removing) remove.mutate(removing);
              }}
            >
              删除渠道
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsShell>
  );
}
