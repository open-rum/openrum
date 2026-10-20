import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { avatarUrl, initials } from "@/lib/avatar";

/**
 * A person's picture, or their initials when they have none or it does not load. The image is
 * decorative: the name is always printed beside it. It is requested without a referrer so a
 * generated avatar does not tell the avatar service which instance it is shown on.
 */
export function UserAvatar({
  userId,
  name,
  avatar,
  size,
  className,
}: {
  userId: string;
  name: string;
  avatar?: string | null;
  size?: "default" | "sm" | "lg";
  className?: string;
}) {
  const source = avatarUrl(userId, avatar);
  return (
    <Avatar size={size} className={className}>
      {source ? <AvatarImage src={source} alt="" referrerPolicy="no-referrer" /> : null}
      <AvatarFallback>{initials(name)}</AvatarFallback>
    </Avatar>
  );
}
