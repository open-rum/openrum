import { Building2Icon, ShieldCheckIcon } from "lucide-react";
import { SiGithub } from "@icons-pack/react-simple-icons";
import { GoogleIcon } from "@/components/icons/GoogleIcon";
import type { AuthMethod } from "@/lib/auth/providers";

export function ProviderIcon({ kind }: { kind: AuthMethod["kind"] }) {
  if (kind === "google") return <GoogleIcon className="rounded-[2px] bg-white" />;
  if (kind === "github") return <SiGithub className="size-4" aria-hidden="true" />;
  if (kind === "ldap") return <Building2Icon className="size-4" aria-hidden="true" />;
  return <ShieldCheckIcon className="size-4" aria-hidden="true" />;
}
