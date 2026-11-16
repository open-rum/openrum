import { CheckIcon, TagsIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { IssueDetailResponse, IssueFilters } from "@/lib/api/issues";
import { tagValueLabel, type TagFilterKey } from "./tagLabels";
type Facet = IssueDetailResponse["facets"]["releases"][number];

const segmentColors = [
  "var(--ds-chart-1)",
  "var(--ds-chart-2)",
  "var(--ds-chart-3)",
  "var(--ds-chart-4)",
];

type TagProps = {
  facets: IssueDetailResponse["facets"];
  total: number;
  filters: IssueFilters;
  onFilter: (key: TagFilterKey, value: string | undefined) => void;
};

type Tag = [title: string, values: Facet[], filterKey: TagFilterKey | null];

const PREVIEW_TAGS = 3;

function issueTags(facets: IssueDetailResponse["facets"]): Tag[] {
  const tags: Tag[] = [
    ["浏览器", facets.browsers, "browser"],
    ["版本", facets.releases, "release"],
    ["设备", facets.deviceTypes, "deviceType"],
    ["国家 / 地区", facets.countries, "country"],
    ["环境", facets.environments, null],
  ];
  return tags.filter(([, values]) => values.length);
}

/**
 * Tag preview beside the trend, after Sentry's: the first few tags, each a stacked bar of its
 * top values that opens every value on click, and a button opening all tags in a Sheet.
 */
export function TagPreview(props: TagProps) {
  const tags = issueTags(props.facets);
  return (
    <div className="issue-tag-preview">
      {tags.length ? (
        <TagList tags={tags.slice(0, PREVIEW_TAGS)} {...props} />
      ) : (
        <p className="issue-tag-preview__empty">暂无标签数据</p>
      )}
      <Sheet>
        <SheetTrigger asChild>
          <Button variant="ghost" size="sm" className="issue-tag-preview__all">
            <TagsIcon data-icon="inline-start" />
            {tags.length > PREVIEW_TAGS ? `全部 ${tags.length} 个标签` : "查看全部标签"}
          </Button>
        </SheetTrigger>
        <SheetContent className="issue-tags-sheet">
          <SheetHeader>
            <SheetTitle>问题标签</SheetTitle>
            <SheetDescription>当前时间与筛选范围内，这个问题所有事件的标签分布。</SheetDescription>
          </SheetHeader>
          <TagSummary {...props} />
        </SheetContent>
      </Sheet>
    </div>
  );
}

function TagList({ tags, total, filters, onFilter }: TagProps & { tags: Tag[] }) {
  return (
    <ul>
      {tags.map(([title, values, key]) => (
        <li key={title}>
          <TagRow
            title={title}
            values={values}
            filterKey={key}
            total={total}
            active={key ? filters[key] : undefined}
            onFilter={onFilter}
          />
        </li>
      ))}
    </ul>
  );
}

export function TagSummary(props: TagProps) {
  const tags = issueTags(props.facets);
  return (
    <section className="issue-tags" aria-labelledby="issue-tags-title">
      <h2 id="issue-tags-title" className="sr-only">
        标签分布
      </h2>
      {tags.length ? (
        <TagList tags={tags} {...props} />
      ) : (
        <p className="issue-empty-copy">当前范围没有标签数据。</p>
      )}
    </section>
  );
}

function TagRow({
  title,
  values,
  filterKey,
  total,
  active,
  onFilter,
}: {
  title: string;
  values: Facet[];
  filterKey: TagFilterKey | null;
  total: number;
  active?: string;
  onFilter: (key: TagFilterKey, value: string | undefined) => void;
}) {
  const sum = Math.max(
    total,
    values.reduce((acc, item) => acc + item.events, 0),
    1,
  );
  const top = values[0];
  const segments = values.slice(0, segmentColors.length);
  const label = (value: string) => tagValueLabel(filterKey, value);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="issue-tag"
          data-active={active ? true : undefined}
          aria-label={`${title}：${label(top.value)} ${share(top.events, sum)}`}
        >
          <span className="issue-tag__head">
            <span className="issue-tag__key">{title}</span>
            <span className="issue-tag__top">
              {active ? <CheckIcon aria-hidden="true" /> : null}
              {label(top.value)}
            </span>
            <span className="issue-tag__share">{share(top.events, sum)}</span>
          </span>
          <span className="issue-tag__bar" aria-hidden="true">
            {segments.map((item, index) => (
              <i
                key={item.value}
                style={{
                  width: `${(item.events / sum) * 100}%`,
                  background: segmentColors[index],
                }}
              />
            ))}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="issue-tag-popover">
        <p className="issue-tag-popover__title">
          {title}
          {filterKey ? <span>选择一项只看这部分事件</span> : <span>环境由顶部切换</span>}
        </p>
        <ul aria-label={`${title}取值`}>
          {values.map((item, index) => {
            const selected = active === item.value;
            const content = (
              <>
                <i
                  aria-hidden="true"
                  style={{ background: segmentColors[index] ?? "var(--ds-border-strong)" }}
                />
                <span className="issue-tag-popover__value">
                  {selected ? <CheckIcon aria-hidden="true" /> : null}
                  {label(item.value)}
                </span>
                <span className="issue-tag-popover__count">
                  {item.events.toLocaleString()}
                  <small>{share(item.events, sum)}</small>
                </span>
              </>
            );
            return (
              <li key={item.value}>
                {filterKey && item.value ? (
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => onFilter(filterKey, selected ? undefined : item.value)}
                  >
                    {content}
                  </button>
                ) : (
                  <div>{content}</div>
                )}
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function share(part: number, total: number) {
  return `${Math.round((part / total) * 100)}%`;
}
