/** Node-only loader for the canonical data files. The browser build injects the same JSON. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createDataset } from "./dataset.js";

const dataDir = fileURLToPath(new URL("../../data/", import.meta.url));
const read = (f: string) => JSON.parse(readFileSync(dataDir + f, "utf8"));
export const loadConfig = () => read("cabin.config.json");
export const loadPolicy = () => read("policy.demo.json");
export const loadSnapshot = () => read("availability/v1.json");
export const loadDataset = () => createDataset(loadConfig(), loadPolicy());
