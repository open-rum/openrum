#!/usr/bin/env node
import { main } from "./main.ts";
import { processContext } from "./runtime.ts";

process.exitCode = await main(process.argv.slice(2), processContext());
