ALTER TABLE projects
ADD COLUMN sdk_platform VARCHAR(32) NOT NULL DEFAULT 'javascript'
CHECK (sdk_platform IN ('javascript', 'react', 'vue', 'nextjs', 'nuxt', 'angular', 'svelte'));
