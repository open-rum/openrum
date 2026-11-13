import {
  Columns3Icon,
  CopyIcon,
  FilterIcon,
  ListFilterIcon,
  MoreHorizontalIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type LogFieldCallbacks = {
  onFilter: (key: string, value: string, exclude?: boolean) => void;
  onColumn: (key: string) => void;
  columns: string[];
};

export function LogFieldActions({
  field,
  value,
  label = field,
  filterable = true,
  onFilter,
  onColumn,
  columns,
}: LogFieldCallbacks & {
  field: string;
  value: string;
  label?: string;
  filterable?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`${label} 操作`}
          title={`${label} 操作`}
          onClick={(event) => event.stopPropagation()}
        >
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="z-[60] w-44"
        onClick={(event) => event.stopPropagation()}
      >
        <DropdownMenuItem disabled={!filterable || !value} onSelect={() => onFilter(field, value)}>
          <FilterIcon />
          按此值筛选
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!filterable || !value}
          onSelect={() => onFilter(field, value, true)}
        >
          <ListFilterIcon />
          排除此值
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!filterable || columns.includes(field)}
          onSelect={() => onColumn(field)}
        >
          <Columns3Icon />
          {columns.includes(field) ? "已添加为列" : "添加为列"}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={async () => {
            try {
              await navigator.clipboard.writeText(value);
              toast.success("已复制");
            } catch {
              toast.error("复制失败，请检查剪贴板权限。");
            }
          }}
        >
          <CopyIcon />
          复制值
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
