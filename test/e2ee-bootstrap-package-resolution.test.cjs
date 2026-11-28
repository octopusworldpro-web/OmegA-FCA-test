"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createE2EEBootstrap } = require("../dist/index.js");

(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omega-signal-resolution-"));
  const previousCwd = process.cwd();
  const previousDataDir = process.env.OMEGA_FCA_DATA_DIR;
  try {
    const packageRoot = path.join(root, "node_modules", "@nirzon-islam", "omega-fca");
    const signalRoot = path.join(packageRoot, "node_modules", "@signalapp", "libsignal-client");
    await fs.mkdir(signalRoot, { recursive: true });
    await fs.writeFile(path.join(packageRoot, "package.json"), JSON.stringify({
      name: "@nirzon-islam/omega-fca", version: "0.2.4-beta.1"
    }));
    await fs.writeFile(path.join(signalRoot, "package.json"), JSON.stringify({
      name: "@signalapp/libsignal-client", version: "0.70.0", main: "index.js"
    }));
    await fs.writeFile(path.join(signalRoot, "index.js"), 'module.exports = { marker: "nested-signal-runtime" };');

    process.chdir(root);
    process.env.OMEGA_FCA_DATA_DIR = path.join(root, "data");
    const bootstrap = await createE2EEBootstrap("123456789", {
      encryptionKey: Buffer.alloc(32, 9),
      localDeviceId: 42
    });
    assert.equal(bootstrap.signal.marker, "nested-signal-runtime");
    console.log("E2EE Signal dependency package-relative resolution test passed");
  } finally {
    process.chdir(previousCwd);
    if (previousDataDir === undefined) delete process.env.OMEGA_FCA_DATA_DIR;
    else process.env.OMEGA_FCA_DATA_DIR = previousDataDir;
    await fs.rm(root, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
