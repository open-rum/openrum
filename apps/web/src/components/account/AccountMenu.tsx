import { Link } from "@tanstack/react-router";
import { ChevronsUpDown, FolderKanban, LogOut, Monitor, Moon, Settings, Sun } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme, type Theme } from "@/components/theme/ThemeProvider";

type AccountMenuProps = {
  displayName: string;
  email: string;
  signingOut: boolean;
  onSignOut: () => void;
};

function initials(displayName: string) {
  return displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export function AccountMenu({ displayName, email, signingOut, onSignOut }: AccountMenuProps) {
  const { theme, setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="account-menu__trigger" aria-label="打开账户菜单">
          <Avatar className="account-menu__avatar">
            <AvatarFallback>{initials(displayName)}</AvatarFallback>
          </Avatar>
          <span className="account-menu__identity">
            <strong>{displayName}</strong>
            <small title={email}>{email}</small>
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
            <Link to="/projects">
              <FolderKanban />
              项目列表
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to="/settings">
              <Settings />
              设置
            </Link>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>界面外观</DropdownMenuLabel>
        <DropdownMenuGroup>
          <DropdownMenuRadioGroup value={theme} onValueChange={(value) => setTheme(value as Theme)}>
            <DropdownMenuRadioItem value="system">
              <Monitor />
              跟随系统
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="light">
              <Sun />
              亮色模式
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark">
              <Moon />
              暗色模式
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
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
