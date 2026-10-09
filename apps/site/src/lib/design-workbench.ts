const root = document.documentElement;
const colorCanvas = document.createElement("canvas");
colorCanvas.width = colorCanvas.height = 1;
const colorContext = colorCanvas.getContext("2d", { willReadFrequently: true });
const announce = (message: string) => {
  const status = document.querySelector("[data-design-status]");
  if (status) status.textContent = message;
};
const hex = (value: string) => {
  if (!colorContext) return value;
  colorContext.clearRect(0, 0, 1, 1);
  colorContext.fillStyle = value;
  colorContext.fillRect(0, 0, 1, 1);
  return (
    "#" +
    [...colorContext.getImageData(0, 0, 1, 1).data]
      .slice(0, 3)
      .map((channel) => channel.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase()
  );
};
const state = () => ({
  theme: root.classList.contains("dark") ? "dark" : "light",
});
const previewUrl = (path: string, embedded = false) => {
  const url = new URL(path, location.origin);
  const current = state();
  url.searchParams.set("theme", current.theme);
  if (embedded) url.searchParams.set("embed", "1");
  return url.pathname + url.search;
};
const sync = () => {
  const current = state();
  document.querySelectorAll<HTMLSelectElement>("[data-design-mode]").forEach((select) => {
    select.value = current.theme;
  });
  const styles = getComputedStyle(root);
  document.querySelectorAll<HTMLElement>("[data-token-value]").forEach((label) => {
    const value = styles.getPropertyValue(label.dataset.tokenValue!).trim();
    label.textContent = label.dataset.tokenFormat === "color" ? hex(value) : value;
    label.title = value;
  });
  document.querySelectorAll<HTMLAnchorElement>("[data-preview-link]").forEach((link) => {
    link.href = previewUrl(link.dataset.previewLink!);
  });
  document.querySelectorAll<HTMLIFrameElement>("[data-preview-frame]").forEach((frame) => {
    const next = previewUrl(frame.dataset.previewFrame!, true);
    if (frame.getAttribute("src") !== next) frame.src = next;
  });
};
const save = () => {
  const current = state();
  try {
    localStorage.setItem("openrum-theme", current.theme);
  } catch {}
  const url = new URL(location.href);
  url.searchParams.set("theme", current.theme);
  history.replaceState(null, "", url);
  sync();
};
document.querySelectorAll<HTMLSelectElement>("[data-design-mode]").forEach((select) => {
  select.addEventListener("change", () => {
    const dark = select.value === "dark";
    root.classList.toggle("dark", dark);
    root.dataset.theme = dark ? "dark" : "light";
    root.style.colorScheme = dark ? "dark" : "light";
    save();
  });
});
// The palette menu announces changes so token readouts show the new palette's values.
document.addEventListener("openrum:palettechange", () => sync());
document.querySelectorAll<HTMLButtonElement>("[data-copy-token]").forEach((button) => {
  button.addEventListener("click", async () => {
    const value = `var(${button.dataset.copyToken})`;
    try {
      await navigator.clipboard.writeText(value);
      announce(`已复制 ${value}`);
    } catch {
      announce(`请复制：${value}`);
    }
  });
});
document.querySelectorAll<HTMLButtonElement>("[data-download-logo]").forEach((button) => {
  button.addEventListener("click", () => {
    const original = document.querySelector<SVGSVGElement>("[data-brand-download] svg");
    if (!original) return;
    const svg = original.cloneNode(true) as SVGSVGElement;
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    svg.setAttribute("width", "512");
    svg.setAttribute("height", "512");
    svg.setAttribute("color", getComputedStyle(original).color);
    // The body colour is baked in through `color`; the eyes are mask cut-outs, so the
    // file needs no other resolved variable.
    svg.removeAttribute("style");
    svg.removeAttribute("aria-hidden");
    svg.removeAttribute("focusable");
    const url = URL.createObjectURL(
      new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `openrum-signal-scout-${root.dataset.palette || "amber"}-${state().theme}.svg`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    announce("已下载信号小怪 SVG");
  });
});
const resizeFrame = (host: HTMLElement) => {
  const width = Number(
    document.querySelector<HTMLSelectElement>("[data-preview-width]")?.value || 1280,
  );
  const scale = Math.min(1, host.clientWidth / width);
  const frame = host.querySelector("iframe");
  if (!frame || !scale) return;
  frame.style.width = `${width}px`;
  frame.style.height = `${host.clientHeight / scale}px`;
  frame.style.transform = `scale(${scale})`;
  frame.style.left = `${Math.max(0, (host.clientWidth - width) / 2)}px`;
};
const frameHosts = [...document.querySelectorAll<HTMLElement>("[data-frame-host]")];
const observer = new ResizeObserver((entries) =>
  entries.forEach((entry) => resizeFrame(entry.target as HTMLElement)),
);
frameHosts.forEach((host) => observer.observe(host));
document
  .querySelector("[data-preview-width]")
  ?.addEventListener("change", () => frameHosts.forEach(resizeFrame));
sync();
document.addEventListener("astro:before-swap", () => observer.disconnect(), { once: true });
