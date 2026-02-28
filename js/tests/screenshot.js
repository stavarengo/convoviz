const { chromium } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 500, height: 700 } });
  const harness = "file://" + path.join(__dirname, "harness.html");
  await page.goto(harness);

  const scriptPath = path.join(__dirname, "..", "script.js");
  const raw = fs.readFileSync(scriptPath, "utf-8");
  const code = raw.replace(/^javascript:\s*/, "");
  await page.evaluate(code);
  await page.waitForSelector("#cvz-resume-ui", { timeout: 5000 });

  // Wait a moment for renders
  await page.waitForTimeout(500);

  await page.screenshot({
    path: path.join(__dirname, "..", "..", "tmp", "panel-us001.png"),
    fullPage: true,
  });

  console.log("Screenshot saved to tmp/panel-us001.png");
  await browser.close();
})();
