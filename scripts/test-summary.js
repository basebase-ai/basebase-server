#!/usr/bin/env node

const { spawn } = require("child_process");
const path = require("path");

function runTestsWithSummary() {
  console.log("🧪 Running tests with clean summary...\n");

  const jestProcess = spawn("npm", ["run", "build"], {
    cwd: path.dirname(__dirname),
    stdio: "inherit",
  });

  jestProcess.on("close", (buildCode) => {
    if (buildCode !== 0) {
      console.error("❌ Build failed!");
      process.exit(1);
      return;
    }

    console.log("\n📋 Running tests...\n");

    const testProcess = spawn(
      "jest",
      ["--runInBand", "--detectOpenHandles", "--forceExit", "--verbose=false"],
      {
        cwd: path.dirname(__dirname),
        stdio: "pipe",
      }
    );

    let output = "";
    let errorOutput = "";

    testProcess.stdout.on("data", (data) => {
      output += data.toString();
    });

    testProcess.stderr.on("data", (data) => {
      errorOutput += data.toString();
    });

    testProcess.on("close", (code) => {
      const fullOutput = output + errorOutput;
      const lines = fullOutput.split("\n");

      if (code === 0) {
        console.log("✅ All tests passed!\n");
      } else {
        console.log("❌ Some tests failed!\n");

        // Show failed test suites
        console.log("🔍 Failed Test Suites:");
        console.log("======================");

        const failedSuites = [];
        const failedTests = [];

        for (const line of lines) {
          if (line.includes("FAIL ")) {
            const suite = line.replace("FAIL ", "").trim();
            failedSuites.push(suite);
            console.log(`❌ ${suite}`);
          }

          // Capture individual test failures
          if (line.match(/\s+●.*/) && !line.includes("Console")) {
            const testName = line.replace(/\s+●\s*/, "").trim();
            if (testName && testName.length > 0) {
              failedTests.push(testName);
            }
          }
        }

        if (failedTests.length > 0) {
          console.log("\n🎯 Individual Failed Tests:");
          console.log("============================");
          failedTests.slice(0, 10).forEach((test) => {
            console.log(`  • ${test}`);
          });

          if (failedTests.length > 10) {
            console.log(`  ... and ${failedTests.length - 10} more`);
          }
        }
      }

      // Always show the summary
      const summaryStart = lines.findIndex((line) =>
        line.includes("Test Suites:")
      );
      if (summaryStart !== -1) {
        console.log("\n📊 Summary:");
        console.log("===========");
        for (let i = summaryStart; i < lines.length && lines[i].trim(); i++) {
          if (
            lines[i].includes("Test Suites:") ||
            lines[i].includes("Tests:") ||
            lines[i].includes("Time:")
          ) {
            console.log(lines[i]);
          }
        }
      }

      if (code !== 0) {
        console.log("\n💡 Quick Commands:");
        console.log("==================");
        console.log("npm run test:failed    # Re-run only failed tests");
        console.log("npm run test:tasks     # Test user-defined tasks only");
        console.log("npm run test:auth      # Test authentication only");
        console.log("npm run test:api       # Test API endpoints only");
      }

      process.exit(code);
    });
  });
}

if (require.main === module) {
  runTestsWithSummary();
}

module.exports = { runTestsWithSummary };
