import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckIcon,
  CopyIcon,
  KeyRoundIcon,
  PlusIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { HoldButton } from "@/components/ui/hold-button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  createUploadToken,
  listUploadTokens,
  revokeUploadToken,
  type UploadToken,
} from "@/lib/api/uploadTokens";

const UPLOAD_TOKENS_ANCHOR = "upload-tokens";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

/**
 * Project-scoped Source Map upload tokens for CI. Members may see the list; Owner/Admin
 * (`canManage` from the API) create and revoke. The secret is shown exactly once.
 */
export function UploadTokensSection({ projectId }: { projectId: string }) {
  const client = useQueryClient();
  const queryKey = ["upload-tokens", projectId];
  const tokens = useQuery({
    queryKey,
    queryFn: ({ signal }) => listUploadTokens(projectId, signal),
    enabled: projectId.length > 0,
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const revoke = useMutation({
    mutationFn: (token: UploadToken) => revokeUploadToken(projectId, token.id),
    onSuccess: (_, token) => {
      toast.success(`已吊销上传令牌「${token.name}」`);
      void client.invalidateQueries({ queryKey });
    },
  });

  // The section loads asynchronously, so the browser's own #upload-tokens jump misses it.
  const loaded = Boolean(tokens.data);
  useEffect(() => {
    if (!loaded || window.location.hash !== `#${UPLOAD_TOKENS_ANCHOR}`) return;
    document.getElementById(UPLOAD_TOKENS_ANCHOR)?.scrollIntoView?.({ block: "start" });
  }, [loaded]);

  const canManage = tokens.data?.canManage ?? false;
  const list = tokens.data?.tokens ?? [];

  return (
    <Card id={UPLOAD_TOKENS_ANCHOR} aria-labelledby="upload-tokens-title">
      <CardHeader>
        <CardTitle id="upload-tokens-title">Source Map 上传令牌</CardTitle>
        <CardDescription>
          供 CI 或 Vite 插件上传 Source Map（环境变量 <code>OPENRUM_UPLOAD_TOKEN</code>
          ）。令牌只对本项目有效，只能登记版本和上传文件，不能删除或读取其他数据。
        </CardDescription>
        <CardAction>
          {canManage ? (
            <Button type="button" onClick={() => setDialogOpen(true)}>
              <PlusIcon />
              新建令牌
            </Button>
          ) : (
            <KeyRoundIcon aria-hidden="true" />
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {tokens.isLoading ? (
          <p className="text-sm text-muted-foreground">正在加载上传令牌…</p>
        ) : tokens.error ? (
          <p className="text-sm text-destructive" role="alert">
            {tokens.error.message}
          </p>
        ) : list.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            还没有上传令牌。{canManage ? "新建一个并保存到 CI 的密钥设置中。" : ""}
          </p>
        ) : (
          <Table aria-label="上传令牌">
            <TableHeader>
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead>前缀</TableHead>
                <TableHead>创建人</TableHead>
                <TableHead>最近使用</TableHead>
                <TableHead>创建时间</TableHead>
                <TableHead>状态</TableHead>
                {canManage ? <TableHead className="text-right">操作</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((token) => {
                const revoked = Boolean(token.revokedAt);
                return (
                  <TableRow key={token.id}>
                    <TableCell className="font-medium">{token.name}</TableCell>
                    <TableCell>
                      <code className="text-xs">{token.tokenPrefix}…</code>
                    </TableCell>
                    <TableCell>{token.createdByName || "—"}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {token.lastUsedAt ? formatDate(token.lastUsedAt) : "尚未使用"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(token.createdAt)}
                    </TableCell>
                    <TableCell>
                      {revoked ? (
                        <Badge variant="outline" title={formatDate(token.revokedAt!)}>
                          已吊销
                        </Badge>
                      ) : (
                        <Badge variant="success">有效</Badge>
                      )}
                    </TableCell>
                    {canManage ? (
                      <TableCell className="text-right">
                        {revoked ? null : (
                          <HoldButton
                            size="sm"
                            doneLabel="已吊销"
                            disabled={revoke.isPending}
                            aria-label={`长按吊销上传令牌 ${token.name}`}
                            onHold={() => revoke.mutate(token)}
                          >
                            长按吊销
                          </HoldButton>
                        )}
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        {revoke.error ? (
          <p className="text-sm text-destructive" role="alert">
            吊销失败：{revoke.error.message}
          </p>
        ) : null}
        {tokens.data && !canManage ? (
          <p className="text-xs text-muted-foreground">
            只有项目 Owner 或 Admin 可以新建和吊销上传令牌。
          </p>
        ) : null}
      </CardContent>
      {canManage ? (
        <CreateUploadTokenDialog
          projectId={projectId}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onCreated={() => void client.invalidateQueries({ queryKey })}
        />
      ) : null}
    </Card>
  );
}

function CreateUploadTokenDialog({
  projectId,
  open,
  onOpenChange,
  onCreated,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [copied, setCopied] = useState(false);
  const create = useMutation({
    mutationFn: (tokenName: string) => createUploadToken(projectId, tokenName),
    onSuccess: (result) => {
      toast.success(`已创建上传令牌「${result.token.name}」`);
      onCreated();
    },
  });
  const secret = create.data?.secret;

  function close(next: boolean) {
    onOpenChange(next);
    if (!next) {
      // Forget the secret as soon as the dialog closes; it is never shown again.
      setName("");
      setCopied(false);
      create.reset();
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        {secret ? (
          <>
            <DialogHeader>
              <DialogTitle>保存上传令牌</DialogTitle>
              <DialogDescription>
                把它保存为 CI 密钥 <code>OPENRUM_UPLOAD_TOKEN</code>。
              </DialogDescription>
            </DialogHeader>
            <Alert variant="warning">
              <TriangleAlertIcon />
              <AlertTitle>明文只显示这一次</AlertTitle>
              <AlertDescription>关闭后无法再次查看；丢失时请吊销并新建。</AlertDescription>
            </Alert>
            <code
              className="block overflow-x-auto rounded-lg border border-border bg-muted/50 px-3 py-2 font-mono text-sm whitespace-nowrap"
              aria-label="上传令牌明文"
            >
              {secret}
            </code>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard.writeText(secret).then(() => setCopied(true));
                }}
              >
                {copied ? <CheckIcon /> : <CopyIcon />}
                {copied ? "已复制" : "复制令牌"}
              </Button>
              <Button type="button" onClick={() => close(false)}>
                我已保存
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              const trimmed = name.trim();
              if (trimmed) create.mutate(trimmed);
            }}
          >
            <DialogHeader>
              <DialogTitle>新建上传令牌</DialogTitle>
              <DialogDescription>用名称说明令牌的用途，例如所在的 CI 流水线。</DialogDescription>
            </DialogHeader>
            <label className="grid gap-2 text-sm font-medium">
              名称
              <Input
                autoFocus
                value={name}
                maxLength={120}
                placeholder="例如：GitHub Actions · web"
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            {create.error ? (
              <p className="text-sm text-destructive" role="alert">
                创建失败：{create.error.message}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => close(false)}>
                <XIcon />
                取消
              </Button>
              <Button type="submit" disabled={!name.trim() || create.isPending}>
                {create.isPending ? "创建中…" : "创建"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
