-- Rolling back drops queued remaps; affected events keep their earlier mapping.
DROP TABLE IF EXISTS sourcemap_remap_requests;
