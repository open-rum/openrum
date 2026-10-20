import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImageUpIcon, RefreshCwIcon, UndoIcon } from "lucide-react";
import { UserAvatar } from "@/components/account/UserAvatar";
import { Button } from "@/components/ui/button";
import { avatarStatusQueryKey, getAvatarStatus, setAvatar, uploadAvatar } from "@/lib/api/avatar";
import { avatarUrl, randomBatch } from "@/lib/avatar";
import { AvatarImageError, squareAvatarPng } from "@/lib/avatarImage";
import { HTTPError, sessionQueryOptions, type SessionUser } from "@/lib/auth/session";

/**
 * Choose a profile picture: one of a batch of random generated avatars (shuffle for another
 * batch), or an uploaded image when object storage is configured. A choice is saved as soon
 * as it is made, and the account menu and member lists pick it up from the session.
 */
export function AvatarPicker({ user }: { user: SessionUser }) {
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: avatarStatusQueryKey,
    queryFn: ({ signal }) => getAvatarStatus(signal),
  });
  const [batch, setBatch] = useState(() => randomBatch());
  const [unloaded, setUnloaded] = useState<ReadonlySet<string>>(new Set());
  const [saved, setSaved] = useState<string>();
  const fileInput = useRef<HTMLInputElement>(null);

  const finish = (message: string) => {
    setSaved(message);
    void queryClient.invalidateQueries({ queryKey: sessionQueryOptions().queryKey });
  };
  const choose = useMutation({
    mutationFn: (value: string | null) => setAvatar(value),
    onMutate: () => setSaved(undefined),
    onSuccess: (_, value) => finish(value ? "头像已更新。" : "已恢复为首字母头像。"),
  });
  const upload = useMutation({
    mutationFn: async (file: File) => uploadAvatar(await squareAvatarPng(file)),
    onMutate: () => setSaved(undefined),
    onSuccess: () => finish("头像已更新。"),
  });
  const busy = choose.isPending || upload.isPending;
  const error = choose.error ?? upload.error;
  const uploadAvailable = status.data?.uploadAvailable === true;
  // Half the tiles failing to load almost always means the avatar service cannot be reached.
  const serviceUnreachable = unloaded.size >= batch.length / 2;

  return (
    <div className="grid gap-5 sm:grid-cols-[auto_minmax(0,1fr)]">
      <UserAvatar
        className="size-16 [&_[data-slot=avatar-fallback]]:text-xl"
        userId={user.userId}
        name={user.displayName}
        avatar={user.avatar}
      />
      <div className="min-w-0">
        <h3 id="avatar-title" className="text-sm font-medium text-foreground">
          头像
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">选择一个默认头像，或上传自己的图片。</p>

        <div
          role="group"
          aria-labelledby="avatar-title"
          className="mt-4 grid grid-cols-6 gap-2 sm:max-w-md"
        >
          {batch.map((value, index) => {
            const selected = value === user.avatar;
            return (
              <button
                key={value}
                type="button"
                aria-label={`选择候选头像 ${index + 1}`}
                aria-pressed={selected}
                disabled={busy}
                onClick={() => choose.mutate(value)}
                className="rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60 aria-pressed:ring-2 aria-pressed:ring-primary aria-pressed:ring-offset-2 aria-pressed:ring-offset-card"
              >
                <img
                  src={avatarUrl("", value)}
                  alt=""
                  width={48}
                  height={48}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="aspect-square size-full rounded-full bg-muted"
                  onError={() => setUnloaded((current) => new Set(current).add(value))}
                />
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => {
              setBatch(randomBatch());
              setUnloaded(new Set());
            }}
          >
            <RefreshCwIcon data-icon="inline-start" />
            换一批
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || !uploadAvailable}
            onClick={() => fileInput.current?.click()}
          >
            <ImageUpIcon data-icon="inline-start" />
            {upload.isPending ? "正在上传…" : "上传图片"}
          </Button>
          {user.avatar ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => choose.mutate(null)}
            >
              <UndoIcon data-icon="inline-start" />
              恢复为首字母
            </Button>
          ) : null}
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="sr-only"
            tabIndex={-1}
            aria-label="选择头像图片"
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Clearing the value lets the same file be chosen again after an error.
              event.target.value = "";
              if (file) upload.mutate(file);
            }}
          />
        </div>

        {status.isSuccess && !uploadAvailable ? (
          <p className="mt-2 text-xs text-muted-foreground">
            上传头像需要先配置对象存储。
            {user.instanceRole ? (
              <>
                {" "}
                <a
                  className="underline underline-offset-2"
                  href="/settings/instance/object-storage"
                >
                  去配置对象存储
                </a>
              </>
            ) : (
              "请联系实例管理员。"
            )}
          </p>
        ) : null}
        {serviceUnreachable ? (
          <p className="mt-2 text-xs text-destructive" role="status">
            默认头像没有加载出来，当前网络可能无法访问
            api.dicebear.com。可以稍后点“换一批”重试，或改用首字母
            {uploadAvailable ? "、上传图片" : ""}。
          </p>
        ) : null}
        <p className="mt-2 text-xs text-muted-foreground">
          默认头像由公共服务 DiceBear 生成，显示时浏览器会向 api.dicebear.com
          请求图片。上传的图片只保存在你们自己的对象存储里。
        </p>
        {saved ? (
          <p className="mt-2 text-sm text-(--ds-success)" role="status">
            {saved}
          </p>
        ) : null}
        {error ? (
          <p className="mt-2 text-sm text-destructive" role="alert">
            {avatarErrorMessage(error)}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function avatarErrorMessage(error: Error) {
  if (error instanceof AvatarImageError) return error.message;
  if (error instanceof HTTPError) {
    if (
      error.code === "OBJECT_STORAGE_NOT_CONFIGURED" ||
      error.code === "OBJECT_STORAGE_UNAVAILABLE"
    )
      return "对象存储现在不可用，无法保存图片。";
    if (error.code === "AVATAR_TOO_LARGE") return "图片太大了，请换一张更小的。";
    if (error.code === "AVATAR_INVALID") return "这张图片不能用作头像，请换一张。";
  }
  return `保存头像失败：${error.message}`;
}
