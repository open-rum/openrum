import { FieldDescription, FieldLegend, FieldSet } from "@/components/ui/field";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { SDKPlatform } from "@/lib/api/projects";
import { projectPlatforms } from "./projectPlatforms";

export function ProjectPlatformSelector({
  value,
  onValueChange,
  disabled,
}: {
  value: SDKPlatform;
  onValueChange: (value: SDKPlatform) => void;
  disabled?: boolean;
}) {
  return (
    <FieldSet>
      <FieldLegend>开发平台</FieldLegend>
      <FieldDescription>
        用于生成对应框架的首次接入步骤和项目图标，之后可在项目设置中修改。
      </FieldDescription>
      <ToggleGroup
        type="single"
        value={value}
        disabled={disabled}
        aria-label="选择开发平台"
        className="grid w-full grid-cols-2 gap-2 sm:grid-cols-4"
        onValueChange={(next) => {
          if (next) onValueChange(next as SDKPlatform);
        }}
      >
        {projectPlatforms.map(({ value: option, label, icon: Icon }) => (
          <ToggleGroupItem
            key={option}
            value={option}
            variant="outline"
            className="h-16 w-full justify-start gap-3 px-4 data-[state=on]:border-primary data-[state=on]:bg-primary/10 data-[state=on]:text-foreground"
          >
            <Icon className="size-5" aria-hidden="true" />
            <span>{label}</span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </FieldSet>
  );
}
