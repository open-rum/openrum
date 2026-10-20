import { UserAvatar } from "@/components/account/UserAvatar";

/** A member's picture next to their name, for lists and pickers. */
export function MemberLabel({
  member,
}: {
  member: { userId: string; displayName: string; email: string; avatar?: string };
}) {
  const name = member.displayName || member.email;
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <UserAvatar userId={member.userId} name={name} avatar={member.avatar} size="sm" />
      <span className="truncate">{name}</span>
    </span>
  );
}
