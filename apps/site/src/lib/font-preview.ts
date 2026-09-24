const lab = document.querySelector<HTMLElement>("[data-font-lab]");

if (lab) {
  const root = document.documentElement;
  const latin = lab.querySelector<HTMLSelectElement>("[data-font-select]")!;
  const chinese = lab.querySelector<HTMLSelectElement>("[data-cjk-select]")!;
  const size = lab.querySelector<HTMLInputElement>("[data-font-size]")!;
  const weight = lab.querySelector<HTMLSelectElement>("[data-font-weight]")!;
  const sample = lab.querySelector<HTMLTextAreaElement>("[data-font-sample]")!;
  const status = lab.querySelector<HTMLElement>("[data-font-status]")!;
  const systemChinese = '"PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
  const defaultSample = sample.value;
  let revision = 0;
  let notoCss: Promise<unknown> | undefined;

  const apply = async () => {
    const current = ++revision;
    const selected = latin.selectedOptions[0];
    const family = selected.dataset.family!;
    const useNoto = chinese.value === "noto";
    const cjk = useNoto ? `"Noto Sans SC Variable", ${systemChinese}` : systemChinese;
    root.style.setProperty("--font-product-sans", `"${family}", ${cjk}`);
    lab.style.setProperty("--font-preview-cjk", cjk);
    lab.querySelector<HTMLElement>("[data-font-current]")!.textContent =
      `${selected.textContent!.replace("（当前）", "")} + ${useNoto ? "Noto Sans SC" : "系统黑体"}`;
    lab.querySelectorAll<HTMLButtonElement>("[data-font-choice]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.fontChoice === latin.value));
    });
    const url = new URL(location.href);
    for (const [key, value, defaultValue] of [
      ["font", latin.value, "plex"],
      ["cjk", chinese.value, "system"],
    ]) {
      if (value === defaultValue) url.searchParams.delete(key);
      else url.searchParams.set(key, value);
    }
    history.replaceState(null, "", url);
    status.textContent = "正在载入预览字体…";
    try {
      if (useNoto) {
        notoCss ??= import("@fontsource-variable/noto-sans-sc/wght.css").catch((error) => {
          notoCss = undefined;
          throw error;
        });
        await notoCss;
      }
      if (current !== revision) return;
      const loaded = await document.fonts.load(`400 16px "${family}"`, "OpenRUM 0123456789");
      if (!loaded.length) throw new Error("Font unavailable");
      if (useNoto)
        await document.fonts.load(
          '400 16px "Noto Sans SC Variable"',
          sample.value || defaultSample,
        );
      if (current === revision) status.textContent = "字体已载入 · 仅预览本页";
    } catch {
      if (current === revision)
        status.textContent = "字体载入失败，当前显示系统回退字体，请重新选择重试。";
    }
  };
  const updateSample = () => {
    lab.querySelector<HTMLElement>("[data-font-custom]")!.textContent = sample.value;
    lab.style.setProperty("--font-preview-size", `${size.value}px`);
    lab.style.setProperty("--font-preview-weight", weight.value);
    lab.querySelector<HTMLOutputElement>("[data-font-size-value]")!.value = `${size.value}px`;
  };
  latin.addEventListener("change", () => void apply());
  chinese.addEventListener("change", () => void apply());
  lab.querySelectorAll<HTMLButtonElement>("[data-font-choice]").forEach((button) => {
    button.addEventListener("click", () => {
      latin.value = button.dataset.fontChoice!;
      void apply();
    });
  });
  sample.addEventListener("input", updateSample);
  size.addEventListener("input", updateSample);
  weight.addEventListener("change", updateSample);
  lab.querySelector("[data-font-reset]")!.addEventListener("click", () => {
    latin.value = "plex";
    chinese.value = "system";
    size.value = "24";
    weight.value = "400";
    sample.value = defaultSample;
    updateSample();
    void apply();
  });
  const params = new URLSearchParams(location.search);
  if ([...latin.options].some((option) => option.value === params.get("font")))
    latin.value = params.get("font")!;
  if (params.get("cjk") === "noto") chinese.value = "noto";
  void apply();
}
