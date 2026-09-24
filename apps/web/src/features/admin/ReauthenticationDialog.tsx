import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { reauthenticateAdmin } from "@/lib/api/admin";

export function ReauthenticationDialog({
  open,
  onOpenChange,
  onConfirmed,
  title,
  description,
  confirmLabel = "确认并继续",
  confirmVariant = "destructive",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirmed: () => Promise<unknown>;
  title: string;
  description: string;
  confirmLabel?: string;
  confirmVariant?: React.ComponentProps<typeof Button>["variant"];
}) {
  const [password, setPassword] = useState("");
  const confirm = useMutation({
    mutationFn: async () => {
      await reauthenticateAdmin(password);
      return onConfirmed();
    },
    onSuccess: () => {
      setPassword("");
      onOpenChange(false);
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (confirm.isPending) return;
        if (!nextOpen) {
          setPassword("");
          confirm.reset();
        }
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <Field data-invalid={Boolean(confirm.error)}>
          <FieldLabel htmlFor="admin-current-password">当前密码</FieldLabel>
          <Input
            id="admin-current-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-invalid={Boolean(confirm.error)}
            autoFocus
          />
          <FieldDescription>验证有效期最多五分钟，密码不会写入审计日志。</FieldDescription>
        </Field>
        {confirm.error ? (
          <p className="text-sm text-destructive" role="alert">
            {confirm.error.message}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            variant="outline"
            disabled={confirm.isPending}
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button
            variant={confirmVariant}
            disabled={!password || confirm.isPending}
            onClick={() => confirm.mutate()}
          >
            {confirm.isPending ? "验证中…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
