const {
  getPostmarkClient,
  getPostmarkFromEmail,
  getPostmarkFromName,
} = require("../dist/src/services/postmark.js");

console.log("🧪 Testing Postmark Configuration...\n");

// Test environment variables
console.log("Environment Variables:");
console.log(
  `POSTMARK_API_KEY: ${process.env.POSTMARK_API_KEY ? "✅ Set" : "❌ Not set"}`
);
console.log(
  `POSTMARK_FROM_EMAIL: ${process.env.POSTMARK_FROM_EMAIL || "❌ Not set"}`
);
console.log(
  `POSTMARK_FROM_NAME: ${
    process.env.POSTMARK_FROM_NAME || "(not set - optional)"
  }`
);
console.log();

// Test client initialization
console.log("Client Initialization:");
try {
  const client = getPostmarkClient();
  console.log(
    `Postmark Client: ${
      client ? "✅ Initialized successfully" : "❌ Failed to initialize"
    }`
  );

  const fromEmail = getPostmarkFromEmail();
  console.log(`From Email: ${fromEmail || "❌ Not configured"}`);

  const fromName = getPostmarkFromName();
  console.log(`From Name: ${fromName || "(not configured - optional)"}`);

  if (client && fromEmail) {
    console.log("\n✅ Postmark is properly configured and ready to use!");
    console.log(
      "\nTo test sending an email, you can call the sendEmail task with:"
    );
    console.log(
      JSON.stringify(
        {
          to: "recipient@example.com",
          subject: "Test Email from Cloud Task",
          htmlBody: "<p>This is a test email from your cloud task!</p>",
          textBody: "This is a test email from your cloud task!",
        },
        null,
        2
      )
    );
  } else {
    console.log("\n❌ Postmark configuration incomplete");
    console.log("Make sure to set:");
    console.log("- POSTMARK_API_KEY (your server API key from Postmark)");
    console.log("- POSTMARK_FROM_EMAIL (verified sender email address)");
    console.log("- POSTMARK_FROM_NAME (optional sender name)");
  }
} catch (error) {
  console.log(`❌ Error testing Postmark: ${error.message}`);
}

console.log("\n📧 Postmark test completed.");
