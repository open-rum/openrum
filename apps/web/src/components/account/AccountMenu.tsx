import { Link } from "@tanstack/react-router";
import { ChevronsUpDown, LogOut, Monitor, Moon, Settings, Sun, UserRound } from "lucide-react";
import { densities, palettes } from "@openrum/design-tokens/catalog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
import { useTheme, type Theme } from "@/components/theme/ThemeProvider";

type AccountMenuProps = {
  displayName: string;
  email: string;
  signingOut: boolean;
  onSignOut: () => void;
  /** Instance administrators reach system settings from here. */
  showInstanceSettings?: boolean;
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

export function AccountMenu({
  displayName,
  email,
  signingOut,
  onSignOut,
  showInstanceSettings = false,
}: AccountMenuProps) {
  const { theme, setTheme, palette, setPalette, density, setDensity } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="account-menu__trigger" aria-label="打开账户菜单">
          <Avatar className="account-menu__avatar" size="sm">
            <AvatarFallback>{initials(displayName)}</AvatarFallback>
          </Avatar>
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
                ["system", Monitor, "跟随系统"],
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
                onClick={() => setTheme(value as Theme)}
              >
                <Icon aria-hidden="true" />
              </button>
            ))}
          </div>
        </div>
        {palettes.length > 1 ? (
          <div className="account-menu__appearance" role="group" aria-label="配色">
            <span>配色</span>
            <div className="account-menu__palette-dots">
              {palettes.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="account-menu__palette-dot"
                  data-palette-dot={item.id}
                  aria-label={item.label}
                  aria-pressed={palette === item.id}
                  title={item.label}
                  onClick={() => setPalette(item.id)}
                />
              ))}
            </div>
          </div>
        ) : null}
        <div className="account-menu__appearance" role="group" aria-label="布局密度">
          <span>布局</span>
          <div className="account-menu__theme-options">
            {densities.map((item) => (
              <button
                key={item.id}
                type="button"
                className="account-menu__theme-button account-menu__density-button"
                data-active={density === item.id}
                aria-pressed={density === item.id}
                title={item.description}
                onClick={() => setDensity(item.id)}
              >
                {item.label}
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
