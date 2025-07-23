/**
 * TEST NPM PACKAGES SCRIPT
 *
 * This script demonstrates the new NPM packages available to server functions:
 * - moment, moment-timezone (date manipulation)
 * - puppeteer (browser automation)
 * - rss-parser (RSS feed parsing)
 *
 * Usage: node scripts/test-packages.js
 *
 * Requirements:
 * - BaseBase server running on localhost:8000
 * - Valid JWT token
 */

const readline = require("readline");
const https = require("https");
const http = require("http");

// Create readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Helper function to prompt user
function prompt(question) {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

// Helper function to make HTTP requests
function makeRequest(url, method, data, headers = {}) {
  return new Promise((resolve) => {
    const isHttps = url.startsWith("https://");
    const requestModule = isHttps ? https : http;

    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: method,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": data ? Buffer.byteLength(data) : 0,
        ...headers,
      },
    };

    const req = requestModule.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        try {
          resolve({
            statusCode: res.statusCode,
            data: JSON.parse(body),
          });
        } catch (parseError) {
          resolve({
            statusCode: res.statusCode,
            data: { error: "Invalid JSON response", raw: body },
          });
        }
      });
    });

    req.on("error", (error) => {
      resolve({
        statusCode: 0,
        data: { error: error.message },
      });
    });

    if (data) {
      req.write(data);
    }
    req.end();
  });
}

async function createTestFunction(
  serverUrl,
  jwtToken,
  projectId,
  functionId,
  functionData
) {
  console.log(`\n📝 Creating function: ${functionId}`);

  const response = await makeRequest(
    `${serverUrl}/v1/projects/${projectId}/functions`,
    "POST",
    JSON.stringify(functionData),
    { Authorization: `Bearer ${jwtToken}` }
  );

  if (response.statusCode === 201) {
    console.log(`✅ Function ${functionId} created successfully`);
    return true;
  } else {
    console.log(
      `❌ Failed to create function ${functionId}:`,
      response.data.error
    );
    return false;
  }
}

async function callFunction(
  serverUrl,
  jwtToken,
  projectId,
  functionName,
  data = {}
) {
  console.log(`\n🚀 Calling function: ${functionName}`);

  const response = await makeRequest(
    `${serverUrl}/v1/projects/${projectId}/tasks/${functionName}:do`,
    "POST",
    JSON.stringify({ data }),
    { Authorization: `Bearer ${jwtToken}` }
  );

  console.log(
    `📊 Response (${response.statusCode}):`,
    JSON.stringify(response.data, null, 2)
  );
  return response;
}

async function main() {
  try {
    console.log("📦 BaseBase NPM Packages Test");
    console.log("=============================\n");

    // Get server URL (default to localhost)
    const serverUrl =
      (await prompt("Enter server URL (default: http://localhost:8000): ")) ||
      "http://localhost:8000";

    // Get JWT token
    console.log("🔑 You need a JWT token to create and call functions.");
    console.log('   Run "npm run get-token" to get one.\n');

    const jwtToken = await prompt("Enter JWT token: ");
    if (!jwtToken) {
      console.error("❌ JWT token is required");
      process.exit(1);
    }

    // Get project ID
    const projectId =
      (await prompt(
        "Enter project ID (or leave empty for 'test-project'): "
      )) || "test-project";

    console.log("\n🔧 Creating test functions...");

    // Test function 1: RSS Parser
    const rssFunction = {
      id: "testRssParser",
      description: "Test RSS parsing",
      implementationCode: `
        async (params, context, axios, twilio, getTwilioPhoneNumber, moment, momentTimezone, puppeteer, rssParser) => {
          const { url } = params;
          if (!url) {
            throw new Error('URL parameter is required');
          }
          
          try {
            // Get RSS feed content using getPage function
            const pageResult = await context.functions.call('getPage', { url });
            if (!pageResult.success) {
              throw new Error('Failed to fetch RSS feed: ' + pageResult.error);
            }
            
            // Parse RSS content
            const feed = await rssParser.parseString(pageResult.data);
                        
            return {
              success: true,
              feedTitle: feed.title,
              feedDescription: feed.description,
              totalItems: feed.items.length,
              latestItems: processedItems,
              processedAt: moment().format()
            };
          } catch (error) {
            return {
              success: false,
              error: error.message
            };
          }
        }
      `,
      requiredServices: ["axios", "moment", "rss-parser"],
      enabled: true,
    };

    // Test function 2: Moment/Timezone
    const dateFunction = {
      id: "testDateUtilities",
      description: "Test moment and moment-timezone utilities",
      implementationCode: `
        async (params, context, axios, twilio, getTwilioPhoneNumber, moment, momentTimezone, puppeteer, rssParser) => {
          const { timezone = 'America/New_York' } = params;
          
          const now = moment();
          const nowInTimezone = momentTimezone.tz(timezone);
          
          return {
            success: true,
            utcTime: now.utc().format(),
            localTime: now.format(),
            timezoneTime: nowInTimezone.format(),
            timezone: timezone,
            dayOfWeek: now.format('dddd'),
            relativeTomorrow: moment().add(1, 'day').fromNow(),
            generatedAt: now.valueOf()
          };
        }
      `,
      requiredServices: ["moment", "moment-timezone"],
      enabled: true,
    };

    // Create functions
    await createTestFunction(
      serverUrl,
      jwtToken,
      projectId,
      "testRssParser",
      rssFunction
    );
    await createTestFunction(
      serverUrl,
      jwtToken,
      projectId,
      "testDateUtilities",
      dateFunction
    );

    console.log("\n🧪 Running tests...");

    // Test RSS parser function
    const rssUrl =
      (await prompt(
        "Enter RSS feed URL to test (or press Enter for default): "
      )) || "https://rss.cnn.com/rss/edition.rss";
    await callFunction(serverUrl, jwtToken, projectId, "testRssParser", {
      url: rssUrl,
    });

    // Test date utilities
    const timezone =
      (await prompt("Enter timezone to test (or press Enter for default): ")) ||
      "America/Los_Angeles";
    await callFunction(serverUrl, jwtToken, projectId, "testDateUtilities", {
      timezone,
    });

    console.log("\n✅ Package testing complete!");
    console.log("\n📚 Available packages in server functions:");
    console.log("  - moment: Date manipulation");
    console.log("  - moment-timezone: Timezone-aware dates");
    console.log("  - puppeteer: Browser automation");
    console.log("  - rss-parser: RSS/Atom feed parsing");
  } catch (error) {
    console.error("❌ Error:", error.message);
  } finally {
    rl.close();
  }
}

main();
