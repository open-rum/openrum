import { useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { Clock3Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { logout, safeReturnTo, sessionQueryOptions } from "@/lib/auth/session";
import { AuthFrame } from "./AuthFrame";

export function AwaitingAccessPage() {
  const search = useSearch({ from: "/awaiting-access" });
  const session = useQuery({ ...sessionQueryOptions(), refetchInterval: 15_000 });
  const signOut = useMutation({
    mutationFn: logout,
    onSuccess: () => window.location.replace("/login"),
  });

  useEffect(() => {
    if (session.data?.accessStatus === "approved")
      window.location.replace(safeReturnTo(search.returnTo));
  }, [session.data?.accessStatus, search.returnTo]);

  return (
    <AuthFrame>
      <div className="space-y-5 text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-xl bg-muted text-foreground">
          <Clock3Icon aria-hidden="true" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">等待组织授权</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            账号已创建。请将邮箱 {session.data?.email ?? ""}{" "}
            告知组织管理员，由管理员添加成员后即可进入控制台。
          </p>
        </div>
        {session.error ? (
          <p className="text-sm text-destructive" role="alert">
            无法检查授权状态，请刷新页面。
          </p>
        ) : null}
        <div className="flex justify-center gap-3">
          <Button
            variant="outline"
            onClick={() => void session.refetch()}
            disabled={session.isFetching}
          >
            检查状态
          </Button>
          <Button variant="outline" onClick={() => signOut.mutate()} disabled={signOut.isPending}>
            退出登录
          </Button>
        </div>
      </div>
    </AuthFrame>
  );
}
