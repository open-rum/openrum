import { useId } from "react";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SDKPlatform } from "@/lib/api/projects";
import { ProjectPlatformIcon, projectPlatforms } from "./projectPlatforms";

export function ProjectPlatformSelector({
  value,
  onValueChange,
  disabled,
}: {
  value: SDKPlatform;
  onValueChange: (value: SDKPlatform) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>开发平台</FieldLabel>
      <Select
        value={value}
        disabled={disabled}
        onValueChange={(next) => onValueChange(next as SDKPlatform)}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {projectPlatforms.map(({ value: option, label }) => (
            <SelectItem key={option} value={option}>
              <ProjectPlatformIcon platform={option} className="size-4" aria-hidden="true" />
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldDescription>用于生成对应框架的接入步骤和项目图标。</FieldDescription>
    </Field>
  );
}
