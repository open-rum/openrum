import { defineCollection, z } from "astro:content";
import { docsLoader, i18nLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    // `appliesTo` carries the Release a page describes. It lives in frontmatter
    // rather than in the prose so a gate can assert every page declares one.
    schema: docsSchema({ extend: z.object({ appliesTo: z.string().optional() }) }),
  }),
  i18n: defineCollection({ loader: i18nLoader() }),
};
