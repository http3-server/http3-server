#!/usr/bin/env node
// @ts-check

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureIntegrationClient } from "./integration-client.js";
import { runIntegrationSuite } from "./integration-suite.js";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const testFile = join(projectRoot, "packages", "server", "test", "integration.test.js");
const python = ensureIntegrationClient();

runIntegrationSuite({ cwd: projectRoot, testFile, python });
