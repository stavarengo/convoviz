const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./js/tests",
  timeout: 30000,
  use: {
    browserName: "chromium",
  },
});
