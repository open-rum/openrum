import { useState } from "react";
import { CopyIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiCaptureHref, HEADER_RETENTION_DAYS } from "@/lib/api/apiCapture";
import type { APISample } from "@/lib/api/apis";
import { bodyView } from "./sampleFormat";

type Direction = "request" | "response";
type ExtraTab = Direction | "attributes";

/**
 * Everything a request carries beyond the basics, split by where it came from: the request
 * (headers and body), the response, and the page's own attributes. Headers and attributes are
 * tables because they are name/value pairs; a body is text and stays a block.
 */
export function SampleExtras({ sample, projectId }: { sample: APISample; projectId: string }) {
  const attributes = Object.entries(sample.attributes ?? {});
  const content: Record<ExtraTab, boolean> = {
    request: hasContent(sample.requestHeaders, sample.requestBody),
    response: hasContent(sample.responseHeaders, sample.responseBody),
    attributes: attributes.length > 0,
  };
  // Opens on the first tab with something in it until the reader picks one; a pick then stays
  // while they move between requests, so comparing two responses does not keep resetting.
  const [picked, setPicked] = useState<ExtraTab>();
  const value =
    picked ??
    (["request", "response", "attributes"] as const).find((tab) => content[tab]) ??
    "request";

  return (
    <section className="api-sample-card" aria-labelledby="sample-extra">
      <h3 id="sample-extra">附加信息</h3>
      <Tabs value={value} onValueChange={(next) => setPicked(next as ExtraTab)}>
        <TabsList variant="line" aria-label="附加信息分区" className="api-sample-tablist">
          <TabsTrigger value="request">请求</TabsTrigger>
          <TabsTrigger value="response">响应</TabsTrigger>
          <TabsTrigger value="attributes">自定义属性</TabsTrigger>
        </TabsList>
        <TabsContent value="request" className="api-sample-tabpanel">
          <Payload
            sample={sample}
            projectId={projectId}
            headers={sample.requestHeaders}
            body={sample.requestBody}
            headersTitle="请求头"
            bodyTitle="请求体"
          />
        </TabsContent>
        <TabsContent value="response" className="api-sample-tabpanel">
          <Payload
            sample={sample}
            projectId={projectId}
            headers={sample.responseHeaders}
            body={sample.responseBody}
            headersTitle="响应头"
            bodyTitle="响应体"
          />
        </TabsContent>
        <TabsContent value="attributes" className="api-sample-tabpanel">
          {attributes.length ? (
            <NameValueTable title="自定义属性" nameLabel="属性" rows={attributes} />
          ) : (
            <p className="api-samples__note">这个请求没有自定义属性。</p>
          )}
        </TabsContent>
      </Tabs>
    </section>
  );
}

function hasContent(headers: Record<string, string> | undefined, body: string | undefined) {
  return Object.keys(headers ?? {}).length > 0 || Boolean(body);
}

/** One direction: its headers as a table, its body as a block, or how to get either. */
function Payload({
  sample,
  projectId,
  headers,
  body,
  headersTitle,
  bodyTitle,
}: {
  sample: APISample;
  projectId: string;
  headers: Record<string, string> | undefined;
  body: string | undefined;
  headersTitle: string;
  bodyTitle: string;
}) {
  const rows = Object.entries(headers ?? {});
  if (!rows.length && !body) {
    return (
      <p className="api-samples__note">
        {headersTitle}和{bodyTitle}默认不采集，只在项目为这个 API 开启后记录新请求，并在{" "}
        {HEADER_RETENTION_DAYS} 天后自动删除。{" "}
        <a
          className="api-sample-link"
          href={apiCaptureHref(projectId, { method: sample.method, url: sample.url })}
        >
          管理头信息采集
        </a>
      </p>
    );
  }
  return (
    <>
      {rows.length ? <NameValueTable title={headersTitle} nameLabel="名称" rows={rows} /> : null}
      <BodyBlock title={bodyTitle} body={body} />
    </>
  );
}

function NameValueTable({
  title,
  nameLabel,
  rows,
}: {
  title: string;
  nameLabel: string;
  rows: Array<[string, string]>;
}) {
  return (
    <div className="api-sample-group">
      <h4>{title}</h4>
      <table className="api-sample-table" aria-label={title}>
        <thead>
          <tr>
            <th scope="col">{nameLabel}</th>
            <th scope="col">值</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, value]) => (
            <tr key={name}>
              <th scope="row">{name}</th>
              <td>
                <code>{value}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BodyBlock({ title, body }: { title: string; body: string | undefined }) {
  if (!body) return null;
  const view = bodyView(body);
  return (
    <div className="api-sample-group">
      <div className="api-sample-group__head">
        <h4>{title}</h4>
        {view.text ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={`复制${title}`}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(body);
                toast.success("已复制");
              } catch {
                toast.error("复制失败，请手动选择文本");
              }
            }}
          >
            <CopyIcon />
          </Button>
        ) : null}
      </div>
      {view.text ? (
        <pre className="api-sample-body" tabIndex={0} aria-label={`${title}内容`}>
          {view.text}
        </pre>
      ) : null}
      {view.notes.map((note) => (
        <p key={note} className="api-samples__note">
          {note}
        </p>
      ))}
    </div>
  );
}
