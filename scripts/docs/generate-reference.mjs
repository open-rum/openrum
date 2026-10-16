import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  groups as configurationGroups,
  variables as configurationVariables,
} from "./configuration-catalog.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const outputDirectory = join(root, "apps/site/src/content/docs/docs/reference");
const chineseOutputDirectory = join(root, "apps/site/src/content/docs/zh/docs/reference");
const check = process.argv.includes("--check");

await mkdir(outputDirectory, { recursive: true });
await mkdir(chineseOutputDirectory, { recursive: true });

const configSource = await readFile(join(root, "internal/config/config.go"), "utf8");
const systemSource = await readFile(join(root, "internal/config/system.go"), "utf8");

// ---- Configuration ------------------------------------------------------------------
// Names, per-service requirements and listen defaults come from the Go source; the catalog adds
// the explanation. Any disagreement between the two fails generation instead of shipping a page
// that lists a removed variable or omits a new one.
const serviceKeys = {
  ServiceAPI: "api",
  ServiceIngest: "ingest",
  ServiceConsumer: "consumer",
  ServiceWorker: "worker",
};
const serviceBlock = (name) => {
  const match = configSource.match(
    new RegExp(`var ${name} = map\\[Service\\][^{]+\\{([\\s\\S]*?)\\n\\}`),
  );
  if (!match)
    throw new Error(
      `internal/config/config.go no longer defines ${name}; update the configuration generator.`,
    );
  return match[1];
};
const requiredByService = Object.fromEntries(
  [...serviceBlock("serviceRequirements").matchAll(/(Service\w+):\s*\{([^}]*)\}/g)].map((match) => [
    serviceKeys[match[1]],
    [...match[2].matchAll(/"([A-Z0-9_]+)"/g)].map((name) => name[1]),
  ]),
);
const listenDefaults = Object.fromEntries(
  [...serviceBlock("serviceDefaults").matchAll(/(Service\w+):\s*"([^"]+)"/g)].map((match) => [
    serviceKeys[match[1]],
    match[2],
  ]),
);
if (
  !configSource.includes('[]string{"APP_ENV", "PUBLIC_BASE_URL"}') ||
  !configSource.includes('"_HTTP_ADDR"')
) {
  throw new Error(
    "internal/config/config.go changed how common requirements or listen addresses are read; update the configuration generator.",
  );
}
const sourceNames = new Set([
  ...[...(configSource + systemSource).matchAll(/values\("([A-Z][A-Z0-9_]+)"\)/g)].map(
    (match) => match[1],
  ),
  // Variables read through a table or a loop instead of a direct values("...") call.
  ...[...(configSource + systemSource).matchAll(/"(OPENRUM_[A-Z0-9_]+)"/g)].map(
    (match) => match[1],
  ),
  ...Object.keys(listenDefaults).map((service) => `${service.toUpperCase()}_HTTP_ADDR`),
]);
const catalogNames = new Set(configurationVariables.map((entry) => entry.name));
const unlisted = [...sourceNames].filter((name) => !catalogNames.has(name)).sort();
const stale = [...catalogNames].filter((name) => !sourceNames.has(name)).sort();
if (unlisted.length || stale.length) {
  throw new Error(
    `scripts/docs/configuration-catalog.mjs is out of date. Add: ${unlisted.join(", ") || "none"}. Remove: ${stale.join(", ") || "none"}.`,
  );
}

const configurationText = {
  en: {
    title: "Configuration reference",
    description:
      "Every environment variable the OpenRUM services read, with its default, whether it is required and what it does.",
    generated: "Generated from `internal/config`; do not edit by hand.",
    intro:
      "These are the environment variables the OpenRUM services read. With the Helm chart you normally set them through [Helm values](/docs/reference/helm-values/) and the runtime Secret instead of by hand. Values containing credentials belong in a Secret, never in a values file you commit.",
    columns: ["Variable", "Required", "Default", "Description"],
    all: "All services",
    no: "No",
    separator: ", ",
  },
  zh: {
    title: "配置参考",
    description: "OpenRUM 各服务读取的全部环境变量，包含默认值、是否必填和用途。",
    generated: "由 `internal/config` 生成，请勿手工编辑。",
    intro:
      "这里是 OpenRUM 各服务读取的环境变量。使用 Helm Chart 时，通常通过 [Helm values](/zh/docs/reference/helm-values/) 和运行时 Secret 来设置，不需要手动写这些变量。带凭据的值应放进 Secret，不要写进会提交的 values 文件。",
    columns: ["变量", "必填", "默认值", "说明"],
    all: "所有服务",
    no: "否",
    separator: "、",
  },
};
const requiredCell = (entry, locale, text) => {
  if (entry.required) return entry.required[locale];
  const services = Object.keys(requiredByService).filter((service) =>
    requiredByService[service].includes(entry.name),
  );
  if (["APP_ENV", "PUBLIC_BASE_URL"].includes(entry.name)) return text.all;
  if (services.length === Object.keys(requiredByService).length) return text.all;
  if (services.length) return services.map((service) => `\`${service}\``).join(text.separator);
  return text.no;
};
const defaultCell = (entry, locale) => {
  if (entry.listenService) return `\`${listenDefaults[entry.listenService]}\``;
  return locale === "zh" && entry.zhDefault ? entry.zhDefault : entry.default;
};
const escapeCell = (value) => value.replaceAll("|", "\\|");

function configurationPage(locale) {
  const text = configurationText[locale];
  const sections = configurationGroups
    .map((group) => {
      const entries = configurationVariables.filter((entry) => entry.group === group.id);
      if (!entries.length) throw new Error(`Configuration group ${group.id} has no variables.`);
      const rows = entries
        .map(
          (entry) =>
            `| \`${entry.name}\` | ${escapeCell(requiredCell(entry, locale, text))} | ${escapeCell(defaultCell(entry, locale))} | ${escapeCell(entry[locale])} |`,
        )
        .join("\n");
      return `## ${group[locale].title}\n\n${group[locale].intro}\n\n| ${text.columns.join(" | ")} |\n| --- | --- | --- | --- |\n${rows}\n`;
    })
    .join("\n");
  return `---
title: ${text.title}
description: ${text.description}
appliesTo: Alpha
---

<!-- GENERATED: scripts/docs/generate-reference.mjs -->

${text.generated}

${text.intro}

${sections}`;
}

const configuration = configurationPage("en");
const chineseConfiguration = configurationPage("zh");

const schema = JSON.parse(
  await readFile(join(root, "packages/protocol/schema/envelope-v1.json"), "utf8"),
);
// ---- Event schema -------------------------------------------------------------------
// The canonical JSON Schema is the only source: every field, type and limit below is read from
// it. Five of the six events are written as `allOf [eventBase, {...}]`, and the second element
// carries the complete property list and required list, so that is what gets rendered.
const eventRefs = schema.properties.events.items.oneOf.map((item) => item.$ref.split("/").at(-1));
const resolveRef = (node) => {
  let current = node;
  while (current?.$ref) current = schema.$defs[current.$ref.split("/").at(-1)];
  return current;
};
const refName = (node) => node?.$ref?.split("/").at(-1);
const flatten = (definition) => (definition.allOf ? definition.allOf.at(-1) : definition);
const eventTypes = eventRefs.map((name) => {
  const object = flatten(schema.$defs[name]);
  return { name, type: object.properties.type.const, object };
});
const commonEventFields = ["event_id", "type", "timestamp", "sample_rate"];

const schemaText = {
  en: {
    title: "Event schema",
    description:
      "The OpenRUM Envelope V1 schema, expanded to every field, type and limit of the data a Browser SDK sends.",
    generated: "Generated from `packages/protocol/schema/envelope-v1.json`; do not edit by hand.",
    intro: (version, required, min, max) =>
      `Schema version \`${version}\`. A Browser SDK sends one **Envelope** per request. An Envelope requires ${required}, and carries between ${min} and ${max} Events.`,
    columns: ["Field", "Type", "Required", "Limits"],
    yes: "Yes",
    no: "No",
    envelope: "Envelope",
    envelopeNote: "The request body.",
    sdk: "`sdk`",
    sdkNote: "Which SDK produced the Envelope.",
    context: "`context`",
    contextNote: "What applies to every Event in the Envelope.",
    contextOf: (name) => `\`context.${name}\``,
    events: "Events",
    eventsNote: (count) =>
      `\`events\` holds ${count} kinds of Event, told apart by \`type\`. Every Event carries the common fields below, and each kind adds its own.`,
    common: "Common fields",
    eventColumns: ["`type`", "What it records", "Fields it adds (required in bold)"],
    kinds: {
      page_view: "A page view or a route change",
      error: "A captured error, with its stack and the actions that led to it",
      web_vital: "A Core Web Vitals measurement",
      api: "A request the browser made",
      custom: "A project-defined business Event with attributes and measurements",
      log: "A structured diagnostic log line",
    },
    list: ", ",
    stop: ".",
    limitSeparator: "; ",
    nested: (name) => `\`${name}\` fields`,
    itemOf: (name) => `\`${name}\` item fields`,
    footer:
      "The canonical JSON Schema is the authority for bounds and formats. Generated Go validation is verified by `pnpm run protocol:check`.",
    arrayOf: (item) => `array of ${item}`,
    eventWord: "Event",
    eachKind: "each is one of the Event kinds below",
    always: (value) => `always \`${value}\``,
    oneOf: (values) => `one of ${values}`,
    chars: (min, max) =>
      min !== undefined && max !== undefined
        ? `${min}–${max} characters`
        : max !== undefined
          ? `up to ${max} characters`
          : `at least ${min} characters`,
    items: (min, max) =>
      min !== undefined && max !== undefined
        ? `${min}–${max} items`
        : max !== undefined
          ? `up to ${max} items`
          : `at least ${min} items`,
    entries: (max) => `up to ${max} entries`,
    keys: (limit) => `keys ${limit}`,
    values: (limit) => `values ${limit}`,
    each: (limit) => `each item ${limit}`,
    pattern: (value) => `matches \`${value}\``,
    listed: "fields listed below",
    itemsListed: "each item's fields are listed below",
    numbers: "numbers",
    belowOrEqual: (value) => `≤ ${value}`,
    atLeast: (value) => `≥ ${value}`,
    above: (value) => `> ${value}`,
    range: (min, max) => `${min}–${max}`,
  },
  zh: {
    title: "Event Schema",
    description:
      "OpenRUM Envelope V1 Schema 的完整展开：Browser SDK 发送的数据中每个字段、类型和限制。",
    generated: "本页根据 `packages/protocol/schema/envelope-v1.json` 生成，请勿手工修改。",
    intro: (version, required, min, max) =>
      `Schema 版本 \`${version}\`。Browser SDK 每次请求发送一个 **Envelope**。Envelope 必须包含 ${required}，并携带 ${min}–${max} 个 Event。`,
    columns: ["字段", "类型", "必填", "限制"],
    yes: "是",
    no: "否",
    envelope: "Envelope",
    envelopeNote: "请求体。",
    sdk: "`sdk`",
    sdkNote: "是哪个 SDK 生成了这个 Envelope。",
    context: "`context`",
    contextNote: "对 Envelope 里每个 Event 都适用的信息。",
    contextOf: (name) => `\`context.${name}\``,
    events: "Event",
    eventsNote: (count) =>
      `\`events\` 里有 ${count} 种 Event，用 \`type\` 区分。每个 Event 都带有下面的公共字段，每种再各自增加字段。`,
    common: "公共字段",
    eventColumns: ["`type`", "记录什么", "增加的字段（必填的加粗）"],
    kinds: {
      page_view: "一次页面访问或路由切换",
      error: "捕获到的错误，包括堆栈和导致它的操作",
      web_vital: "一项 Core Web Vitals 指标",
      api: "浏览器发出的一次请求",
      custom: "项目自定义的业务 Event，带属性和度量",
      log: "一条结构化的诊断日志",
    },
    list: "、",
    stop: "。",
    limitSeparator: "；",
    nested: (name) => `\`${name}\` 的字段`,
    itemOf: (name) => `\`${name}\` 每一项的字段`,
    footer:
      "边界和格式以权威 JSON Schema 为准；`pnpm run protocol:check` 会验证生成的 Go 校验代码。",
    arrayOf: (item) => `${item} 数组`,
    eventWord: "Event",
    eachKind: "每一项是下面某一种 Event",
    always: (value) => `固定为 \`${value}\``,
    oneOf: (values) => `取值：${values}`,
    chars: (min, max) =>
      min !== undefined && max !== undefined
        ? `${min}–${max} 个字符`
        : max !== undefined
          ? `最多 ${max} 个字符`
          : `至少 ${min} 个字符`,
    items: (min, max) =>
      min !== undefined && max !== undefined
        ? `${min}–${max} 项`
        : max !== undefined
          ? `最多 ${max} 项`
          : `至少 ${min} 项`,
    entries: (max) => `最多 ${max} 项`,
    keys: (limit) => `键 ${limit}`,
    values: (limit) => `值 ${limit}`,
    each: (limit) => `每一项 ${limit}`,
    pattern: (value) => `匹配 \`${value}\``,
    listed: "字段见下方",
    itemsListed: "每一项的字段见下方",
    numbers: "数字",
    belowOrEqual: (value) => `≤ ${value}`,
    atLeast: (value) => `≥ ${value}`,
    above: (value) => `> ${value}`,
    range: (min, max) => `${min}–${max}`,
  },
};

function describeSchemaNode(node, t) {
  const target = resolveRef(node);
  const named = refName(node);
  if (target.const !== undefined) return { type: "string", limits: [t.always(target.const)] };
  if (target.enum) {
    return {
      type: "string",
      limits: [t.oneOf(target.enum.map((value) => `\`${value}\``).join(t.list))],
    };
  }
  if (target.type === "array" && target.items.oneOf) {
    // `events`: each item is one of the Event kinds described below.
    return {
      type: t.arrayOf(t.eventWord),
      limits: [t.items(target.minItems, target.maxItems), t.eachKind],
    };
  }
  if (target.type === "array") {
    const item = describeSchemaNode(target.items, t);
    const limits = [];
    if (target.minItems !== undefined || target.maxItems !== undefined)
      limits.push(t.items(target.minItems, target.maxItems));
    if (item.limits.length === 1 && item.limits[0] === t.listed) limits.push(t.itemsListed);
    else if (item.limits.length) limits.push(t.each(item.limits.join(", ")));
    return { type: t.arrayOf(item.type), limits };
  }
  if (target.type === "object" && target.properties) {
    return { type: "object", limits: [t.listed] };
  }
  if (target.type === "object") {
    const limits = [t.entries(target.maxProperties)];
    const key = describeSchemaNode(target.propertyNames, t);
    const value = describeSchemaNode(target.additionalProperties, t);
    limits.push(t.keys(key.limits.join(", ")));
    limits.push(value.type === "number" ? t.values(t.numbers) : t.values(value.limits.join(", ")));
    return { type: `\`map<string, ${value.type}>\``, limits };
  }
  const limits = [];
  let type = target.type;
  if (target.format) type = target.format;
  if (target.type === "string") {
    if (target.minLength !== undefined || target.maxLength !== undefined)
      limits.push(t.chars(target.minLength, target.maxLength));
    if (target.pattern) limits.push(t.pattern(target.pattern.replaceAll("|", "\\|")));
  }
  if (target.type === "number" || target.type === "integer") {
    if (target.minimum !== undefined && target.maximum !== undefined)
      limits.push(t.range(target.minimum, target.maximum));
    else if (target.maximum !== undefined) limits.push(t.belowOrEqual(target.maximum));
    else if (target.minimum !== undefined) limits.push(t.atLeast(target.minimum));
    if (target.exclusiveMinimum !== undefined) {
      limits.push(
        target.maximum !== undefined
          ? `${t.above(target.exclusiveMinimum)}, ${t.belowOrEqual(target.maximum)}`
          : t.above(target.exclusiveMinimum),
      );
      if (target.maximum !== undefined)
        limits.splice(limits.indexOf(t.belowOrEqual(target.maximum)), 1);
    }
  }
  return { type, limits };
}

function fieldTable(object, t, skip = []) {
  const rows = Object.entries(object.properties)
    .filter(([name]) => !skip.includes(name))
    .map(([name, node]) => {
      const { type, limits } = describeSchemaNode(node, t);
      const required = (object.required ?? []).includes(name) ? t.yes : t.no;
      return `| \`${name}\` | ${type} | ${required} | ${limits.join(t.limitSeparator) || "—"} |`;
    });
  const [field, type, required, limits] = t.columns;
  return `| ${field} | ${type} | ${required} | ${limits} |\n| --- | --- | --- | --- |\n${rows.join("\n")}`;
}

// Objects that deserve their own table: a property that is a named object, or an array of them.
function nestedObjects(object) {
  return Object.entries(object.properties).flatMap(([name, node]) => {
    const direct = resolveRef(node);
    if (direct?.type === "object" && direct.properties)
      return [{ name, kind: "object", object: direct }];
    const item = direct?.type === "array" ? resolveRef(direct.items) : undefined;
    if (item?.type === "object" && item.properties) return [{ name, kind: "item", object: item }];
    return [];
  });
}

function eventSchemaPage(locale) {
  const t = schemaText[locale];
  const required = schema.required.map((value) => `\`${value}\``).join(t.list);
  const context = resolveRef(schema.properties.context);
  const sections = [];
  sections.push(`## ${t.envelope}\n\n${t.envelopeNote}\n\n${fieldTable(schema, t)}`);
  sections.push(
    `## ${t.sdk}\n\n${t.sdkNote}\n\n${fieldTable(resolveRef(schema.properties.sdk), t)}`,
  );
  const contextParts = [`## ${t.context}\n\n${t.contextNote}\n\n${fieldTable(context, t)}`];
  for (const nested of nestedObjects(context)) {
    contextParts.push(`### ${t.contextOf(nested.name)}\n\n${fieldTable(nested.object, t)}`);
  }
  sections.push(contextParts.join("\n\n"));

  const overview = eventTypes
    .map(({ type, object }) => {
      const added = Object.keys(object.properties)
        .filter((name) => !commonEventFields.includes(name))
        .map((name) => ((object.required ?? []).includes(name) ? `**\`${name}\`**` : `\`${name}\``))
        .join(", ");
      return `| \`${type}\` | ${t.kinds[type]} | ${added || "—"} |`;
    })
    .join("\n");
  const eventBase = schema.$defs.eventBase;
  const commonObject = {
    required: eventBase.required,
    properties: {
      ...eventBase.properties,
      // `type` is a free string in the base, but each Event narrows it to its own kind.
      type: { enum: eventTypes.map((event) => event.type) },
    },
  };
  const eventParts = [
    `## ${t.events}\n\n${t.eventsNote(eventTypes.length)}\n\n| ${t.eventColumns.join(" | ")} |\n| --- | --- | --- |\n${overview}`,
    `### ${t.common}\n\n${fieldTable(commonObject, t)}`,
  ];
  for (const { type, object } of eventTypes) {
    const part = [
      `### \`${type}\`\n\n${t.kinds[type]}${t.stop}\n\n${fieldTable(object, t, commonEventFields)}`,
    ];
    for (const nested of nestedObjects(object)) {
      const heading = nested.kind === "item" ? t.itemOf(nested.name) : t.nested(nested.name);
      part.push(`#### ${heading}\n\n${fieldTable(nested.object, t)}`);
    }
    eventParts.push(part.join("\n\n"));
  }
  sections.push(eventParts.join("\n\n"));

  return `---
title: ${t.title}
description: ${t.description}
appliesTo: schema ${schema.properties.schema_version.const}
---

<!-- GENERATED: scripts/docs/generate-reference.mjs -->

${t.generated}

${t.intro(schema.properties.schema_version.const, required, schema.properties.events.minItems, schema.properties.events.maxItems)}

${sections.join("\n\n")}

${t.footer}
`;
}
const eventSchema = eventSchemaPage("en");
const chineseEventSchema = eventSchemaPage("zh");

const helmSource = await readFile(join(root, "deploy/helm/openrum/values.yaml"), "utf8");
const helmValues = `---
title: Helm values reference
description: Generated source-of-truth values for the OpenRUM Helm chart.
appliesTo: Alpha
---

<!-- GENERATED: scripts/docs/generate-reference.mjs -->

Generated verbatim from \`deploy/helm/openrum/values.yaml\`; do not edit by hand.

Use a separate values file for your environment and keep credentials in the configured existing Kubernetes Secret.

\`\`\`yaml
${helmSource.trimEnd()}
\`\`\`
`;

const chineseHelmValues = `---
title: Helm values 参考
description: OpenRUM Helm Chart 的权威默认值。
appliesTo: Alpha
---

<!-- GENERATED: scripts/docs/generate-reference.mjs -->

本页逐字来源于 \`deploy/helm/openrum/values.yaml\`，请勿手工编辑。

请为环境创建独立 values 文件，并把凭据放进 \`existingSecret\` 指向的 Kubernetes Secret。

\`\`\`yaml
${helmSource.trimEnd()}
\`\`\`
`;

// Browser SDK options. Generated so that adding a field to `ClientOptions` without
// documenting it fails `pnpm docs:check` rather than shipping an undocumented option.
const sdkSource = await readFile(join(root, "packages/browser-sdk/src/client.ts"), "utf8");
const samplingSource = await readFile(join(root, "packages/browser-sdk/src/sampling.ts"), "utf8");
const senderSource = await readFile(
  join(root, "packages/browser-sdk/src/transport/sender.ts"),
  "utf8",
);
const sdkPackage = JSON.parse(
  await readFile(join(root, "packages/browser-sdk/package.json"), "utf8"),
);

const samplingDefaults = Object.fromEntries(
  [...samplingSource.matchAll(/(\w+SampleRate): ([\d.]+),/g)].map((match) => [match[1], match[2]]),
);
const flushDefaultMs = Number(
  senderSource.match(/DEFAULT_FLUSH_INTERVAL_MS = ([\d_]+)/)?.[1].replaceAll("_", ""),
);

// Defaults and notes the type declaration cannot express. Every option must appear
// here; the generator fails otherwise.
const sdkOptionNotes = {
  dsn: [
    "—",
    "Public Project connection string containing the Ingest URL and write-only client key.",
  ],
  environment: ['`"production"`', "Separates Events from staging and production."],
  release: ["unset", "Required for mapped stack frames. Must match the uploaded Release."],
  dist: ["unset", "Distinguishes builds that share one Release."],
  eventSampleRate: [
    `\`${samplingDefaults.eventSampleRate}\``,
    "Page Views, interactions, Custom Events and opted-in Logs.",
  ],
  apiSampleRate: [`\`${samplingDefaults.apiSampleRate}\``, "fetch and XHR timing."],
  errorSampleRate: [`\`${samplingDefaults.errorSampleRate}\``, "Errors and unhandled rejections."],
  captureClicks: ["`true`", "Privacy-safe descriptions of interactive elements."],
  enableLogs: [
    "ignored",
    "Compatibility-only; logger calls and captureConsole are independently explicit.",
  ],
  captureConsole: ["unset", "Opt-in console methods: debug, log, info, warn, error."],
  beforeSendLog: [
    "unset",
    "Transforms a log or returns null to drop it; final privacy scrubbing still applies.",
  ],
  flushIntervalMs: [`\`${flushDefaultMs}\``, "Also flushed on `pagehide` and on reconnect."],
  beaconEndpoint: ["unset", "Pre-authenticated `sendBeacon` URL. Never gets the DSN credential."],
  configEndpoint: ["DSN origin", "Remote sampling from `/api/v1/sdk/config`. `false` disables it."],
  integrations: ["all of the above", "Replaces the default set rather than adding to it."],
};

const sdkOptions = [];
let pendingDescription;
for (const line of sdkSource
  .match(/export interface ClientOptions \{([\s\S]*?)\n\}/)?.[1]
  .split("\n") ?? []) {
  const documented = line.match(/^\s*\/\*\* (.+?) \*\/$/);
  if (documented) {
    pendingDescription = documented[1];
    continue;
  }
  const member = line.match(/^\s*(\w+)(\?)?:\s*(.+);$/);
  pendingDescription = undefined;
  if (!member) continue;
  sdkOptions.push({ name: member[1], required: !member[2], type: member[3] });
}
if (sdkOptions.length === 0) {
  console.error("Could not read ClientOptions from packages/browser-sdk/src/client.ts.");
  process.exitCode = 1;
}
const undocumented = sdkOptions.filter((option) => !sdkOptionNotes[option.name]);
if (undocumented.length > 0) {
  console.error(
    `ClientOptions gained undocumented options: ${undocumented.map((option) => option.name).join(", ")}. Describe them in scripts/docs/generate-reference.mjs.`,
  );
  process.exitCode = 1;
}
const sdkRows = sdkOptions
  .map((option) => {
    const [fallback, note] = sdkOptionNotes[option.name] ?? ["—", ""];
    // Union types carry a pipe, which would otherwise end the table cell.
    const type = option.type.replaceAll("|", "\\|");
    return `| \`${option.name}\` | \`${type}\` | ${option.required ? "required" : fallback} | ${note} |`;
  })
  .join("\n");
const sdkOptionsReference = `---
title: SDK options
description: Generated reference for every @openrum/browser initialization option.
appliesTo: "${sdkPackage.name} ${sdkPackage.version}"
---

<!-- GENERATED: scripts/docs/generate-reference.mjs -->

Generated from \`packages/browser-sdk/src/client.ts\`; do not edit by hand. Pass these to
\`init()\` — see [Browser SDK](/docs/sdk/browser/).

| Option | Type | Default | Notes |
| --- | --- | --- | --- |
${sdkRows}

Sample rates outside 0 to 1 are ignored and the built-in default applies instead, so a typo
cannot silently stop collection. The three rates are decided independently but
deterministically per Session, so a Session is never half-recorded.

\`configEndpoint\` responses are cached, and an invalid one leaves the locally configured
rates in place. Passing \`integrations\` replaces the defaults, so a list without the page
integration turns off automatic Page Views.
`;

await emit("configuration.md", configuration);
await emit("event-schema.md", eventSchema);
await emit("event-schema.md", chineseEventSchema, chineseOutputDirectory);
await emit("helm-values.md", helmValues);
await emit("sdk-options.md", sdkOptionsReference);
await emit("configuration.md", chineseConfiguration, chineseOutputDirectory);
await emit("helm-values.md", chineseHelmValues, chineseOutputDirectory);

async function emit(name, contents, directory = outputDirectory) {
  const target = join(directory, name);
  if (!check) {
    await writeFile(target, contents);
    return;
  }
  const existing = await readFile(target, "utf8").catch(() => "");
  if (existing !== contents) {
    console.error(`Generated reference is out of date: ${name}. Run pnpm docs:generate.`);
    process.exitCode = 1;
  }
}
