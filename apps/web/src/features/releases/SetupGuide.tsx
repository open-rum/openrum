import { useState } from "react";
import { UploadTokensSection } from "@/features/settings/UploadTokensSection";
import { QuickStart } from "./QuickStart";

/**
 * What a Project with no release yet needs to do, in order. The token and the build snippet are
 * the real controls rather than links to them, so the first visit is the whole setup.
 */
export function SetupGuide({ projectId }: { projectId: string }) {
  return (
    <section className="setup-guide" aria-labelledby="setup-guide-title">
      <header>
        <h2 id="setup-guide-title">第一次使用：三步让 Source Map 生效</h2>
        <p>构建时由插件自动登记版本并上传文件；这里不需要手动操作。</p>
      </header>
      <ol>
        <li>
          <h3>创建上传令牌</h3>
          <p>令牌只用于上传，保存到 CI 的密钥设置里，环境变量名是 OPENRUM_UPLOAD_TOKEN。</p>
          <UploadTokensSection projectId={projectId} />
        </li>
        <li>
          <h3>配置构建插件</h3>
          <p>把插件加进构建配置，并使用隐藏的 Source Map。</p>
          <QuickStart projectId={projectId} />
        </li>
        <li>
          <h3>构建并发布</h3>
          <p>
            构建结束后，这个版本和它的 Source Map 会出现在本页。版本号和 dist 必须与 SDK 的 init()
            一致，否则堆栈对不上。
          </p>
        </li>
      </ol>
    </section>
  );
}

/**
 * The same setup, once versions exist: out of the way, but one click from the token list and the
 * snippet, and open when a link points straight at the tokens.
 */
export function AccessDetails({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(() => window.location.hash === "#upload-tokens");
  return (
    <details
      className="releases-access"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>接入与上传令牌</summary>
      <div className="releases-access__body">
        <UploadTokensSection projectId={projectId} />
        <QuickStart projectId={projectId} />
      </div>
    </details>
  );
}
