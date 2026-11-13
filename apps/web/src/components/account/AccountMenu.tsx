import { Link } from "@tanstack/react-router";
import { ChevronsUpDown, LogOut, Moon, Settings, Sun, UserRound } from "lucide-react";
import { UserAvatar } from "@/components/account/UserAvatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme } from "@/components/theme/ThemeProvider";

type AccountMenuProps = {
  userId: string;
  displayName: string;
  /** Profile picture reference, see lib/avatar.ts. */
  avatar?: string;
  email: string;
  signingOut: boolean;
  onSignOut: () => void;
  /** Instance administrators reach system settings from here. */
  showInstanceSettings?: boolean;
};

export function AccountMenu({
  userId,
  displayName,
  avatar,
  email,
  signingOut,
  onSignOut,
  showInstanceSettings = false,
}: AccountMenuProps) {
  const { theme, setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="account-menu__trigger" aria-label="打开账户菜单">
          <UserAvatar
            className="account-menu__avatar"
            size="sm"
            userId={userId}
            name={displayName}
            avatar={avatar}
          />
          <span className="account-menu__identity">
            <strong>{displayName}</strong>
          </span>
          <ChevronsUpDown data-icon="inline-end" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="account-menu__content"
        side="top"
        align="start"
        sideOffset={8}
      >
        <DropdownMenuLabel className="account-menu__label">
          <strong>{displayName}</strong>
          <span>{email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem asChild>
            <Link to="/account">
              <UserRound />
              Account
            </Link>
          </DropdownMenuItem>
          {showInstanceSettings ? (
            <DropdownMenuItem asChild>
              <Link to="/settings/instance">
                <Settings />
                系统设置
              </Link>
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <div className="account-menu__appearance" role="group" aria-label="外观">
          <span>外观</span>
          <div className="account-menu__theme-options">
            {(
              [
                ["light", Sun, "亮色模式"],
                ["dark", Moon, "暗色模式"],
              ] as const
            ).map(([value, Icon, label]) => (
              <button
                key={value}
                type="button"
                className="account-menu__theme-button"
                data-active={theme === value}
                aria-label={label}
                aria-pressed={theme === value}
                title={label}
                onClick={() => setTheme(value)}
              >
                <Icon aria-hidden="true" />
              </button>
            ))}
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem variant="destructive" disabled={signingOut} onSelect={onSignOut}>
            <LogOut />
            {signingOut ? "正在退出…" : "退出登录"}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
