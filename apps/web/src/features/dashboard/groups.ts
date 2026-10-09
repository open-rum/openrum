import { arrayMove } from "@dnd-kit/sortable";
import { MAX_GROUP_TABS, readWidget, type StoredWidget, type WidgetSize } from "./model";

/**
 * One card on the grid: a single module, or a tabbed card made of adjacent modules that
 * share a `groupId`. Modules stay flat in the saved config, so validation, queries, the
 * editor and details all keep working per module.
 */
export type ModuleBlock = { key: string; groupId?: string; records: StoredWidget[] };

const groupOf = (record: StoredWidget) =>
  typeof record.groupId === "string" && record.groupId ? record.groupId : undefined;

export function toBlocks(widgets: StoredWidget[]): ModuleBlock[] {
  const blocks: ModuleBlock[] = [];
  for (const record of widgets) {
    const groupId = groupOf(record);
    const last = blocks[blocks.length - 1];
    if (groupId && last?.groupId === groupId && last.records.length < MAX_GROUP_TABS)
      last.records.push(record);
    else blocks.push({ key: record.id, groupId, records: [record] });
  }
  return blocks;
}

const fromBlocks = (blocks: ModuleBlock[]) => blocks.flatMap((block) => block.records);

export function withoutGroup(record: StoredWidget): StoredWidget {
  const rest = { ...record };
  delete rest.groupId;
  return rest;
}

/**
 * Make groups valid before saving: a lone member loses its groupId, members share the first
 * member's size, and a groupId used by two separate runs keeps only the first run.
 */
export function normalizeGroups(widgets: StoredWidget[]): StoredWidget[] {
  const used = new Set<string>();
  return fromBlocks(
    toBlocks(widgets).map((block) => {
      if (!block.groupId) return block;
      if (block.records.length < 2 || used.has(block.groupId))
        return { ...block, groupId: undefined, records: block.records.map(withoutGroup) };
      used.add(block.groupId);
      const size = block.records[0].size;
      return { ...block, records: block.records.map((record) => ({ ...record, size })) };
    }),
  );
}

/** Charts and tables group; stat cards and modules this deployment cannot read do not. */
export function canGroup(block: ModuleBlock) {
  return block.records.every((record) => {
    const widget = readWidget(record);
    return widget !== undefined && widget.type !== "stat";
  });
}

/** Blocks the given block may merge into without exceeding three tabs. */
export function mergeTargets(widgets: StoredWidget[], key: string) {
  const blocks = toBlocks(widgets);
  const source = blocks.find((block) => block.key === key);
  if (!source || !canGroup(source)) return [];
  return blocks.filter(
    (block) =>
      block.key !== key &&
      canGroup(block) &&
      block.records.length + source.records.length <= MAX_GROUP_TABS,
  );
}

/** Move a block's modules into the target card, after its tabs, at the target's size. */
export function mergeBlocks(widgets: StoredWidget[], sourceKey: string, targetKey: string) {
  const blocks = toBlocks(widgets);
  const source = blocks.find((block) => block.key === sourceKey);
  const target = blocks.find((block) => block.key === targetKey);
  if (!source || !target || source === target) return widgets;
  if (source.records.length + target.records.length > MAX_GROUP_TABS) return widgets;
  const groupId = target.groupId ?? `group-${crypto.randomUUID().slice(0, 8)}`;
  const size = target.records[0].size as WidgetSize;
  const merged: ModuleBlock = {
    key: target.key,
    groupId,
    records: [...target.records, ...source.records].map((record) => ({
      ...record,
      groupId,
      size,
    })),
  };
  return normalizeGroups(
    fromBlocks(
      blocks
        .filter((block) => block !== source)
        .map((block) => (block === target ? merged : block)),
    ),
  );
}

/** Take one tab out of its card and place it right after the card as its own card. */
export function splitFromGroup(widgets: StoredWidget[], id: string) {
  const blocks = toBlocks(widgets);
  const index = blocks.findIndex((block) => block.records.some((record) => record.id === id));
  const block = blocks[index];
  if (!block?.groupId) return widgets;
  const record = block.records.find((item) => item.id === id)!;
  const rest = { ...block, records: block.records.filter((item) => item.id !== id) };
  const next = [...blocks];
  next.splice(index, 1, rest, { key: id, records: [withoutGroup(record)] });
  return normalizeGroups(fromBlocks(next));
}

/** Move a whole card to another card's position. */
export function moveBlock(widgets: StoredWidget[], key: string, toKey: string) {
  const blocks = toBlocks(widgets);
  const from = blocks.findIndex((block) => block.key === key);
  const to = blocks.findIndex((block) => block.key === toKey);
  if (from < 0 || to < 0 || from === to) return widgets;
  return fromBlocks(arrayMove(blocks, from, to));
}

/** Set every module of a card to one size. */
export function resizeBlock(widgets: StoredWidget[], key: string, size: WidgetSize) {
  const ids = new Set(
    toBlocks(widgets)
      .find((block) => block.key === key)
      ?.records.map((r) => r.id),
  );
  return widgets.map((record) => (ids.has(record.id) ? { ...record, size } : record));
}
