import { getProjectTasksCollection } from "../database/collections";
import { CloudTask } from "../types/tasks";

// Initialize default cloud tasks (public shared tasks)
export async function initializeDefaultCloudTasks(): Promise<void> {
  console.log("Initializing default cloud tasks...");
  const tasksCollection = getProjectTasksCollection("public");

  // Default tasks to initialize
  const defaultTasks: CloudTask[] = [];

  // getPage task - Fetch web page content
  const getPageTask: CloudTask = {
    _id: "getPage",
    description: "Fetch web page content using Puppeteer",
    implementationCode: `const axios = require('axios');

module.exports = async (params, context) => {
  const { console, data, tasks } = context;
  const { url } = params;
  
  if (!url) {
    throw new Error("URL parameter is required");
  }
  
  console.log(\`Fetching page: \${url}\`);
  
  try {
    const response = await axios.get(url);
    const content = response.data;
    
    return {
      url: url,
      content: content,
      timestamp: new Date().toISOString(),
      success: true
    };
  } catch (error) {
    console.error("Error fetching page:", error);
    throw new Error(\`Failed to fetch page: \${error.message}\`);
  }
};`,
    requiredServices: ["axios"],
    createdAt: new Date(),
    updatedAt: new Date(),
    enabled: true,
  };

  defaultTasks.push(getPageTask);

  // sendSms task - Send SMS using Twilio
  const sendSmsTask: CloudTask = {
    _id: "sendSms",
    description: "Send SMS message using Twilio",
    implementationCode: `const twilio = require('twilio');

module.exports = async (params, context, axios, twilioClient, getTwilioPhoneNumber) => {
  const { console, data, tasks } = context;
  const { to, message } = params;
  
  if (!to || !message) {
    throw new Error("Both 'to' and 'message' parameters are required");
  }
  
  console.log(\`Sending SMS to: \${to}\`);
  
  // Check if Twilio is configured
  if (!twilioClient) {
    throw new Error("Twilio client not available. Check your TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN environment variables.");
  }
  
  try {
    // Always use the configured Twilio phone number
    const fromNumber = getTwilioPhoneNumber();
    if (!fromNumber) {
      throw new Error("TWILIO_PHONE_NUMBER environment variable not configured");
    }
    
    console.log(\`Sending SMS from: \${fromNumber} to: \${to}\`);
    
    // Send the SMS using Twilio
    const result = await twilioClient.messages.create({
      body: message,
      from: fromNumber,
      to: to
    });
    
    console.log(\`SMS sent successfully. SID: \${result.sid}\`);
    
    return {
      success: true,
      to: to,
      from: fromNumber,
      message: message,
      status: result.status,
      sid: result.sid,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error("Error sending SMS:", error);
    throw new Error(\`Failed to send SMS: \${error.message}\`);
  }
};`,
    requiredServices: ["twilio"],
    createdAt: new Date(),
    updatedAt: new Date(),
    enabled: true,
  };

  defaultTasks.push(sendSmsTask);

  // sendEmail task - Send email using Postmark
  const sendEmailTask: CloudTask = {
    _id: "sendEmail",
    description: "Send email message using Postmark",
    implementationCode: `const postmark = require('postmark');

module.exports = async (params, context, axios, twilio, getTwilioPhoneNumber, postmarkClient, getPostmarkFromEmail, getPostmarkFromName) => {
  const { console, data, tasks, db, doc, getDoc, collection, getDocs, addDoc, setDoc } = context;
  const { to, subject, htmlBody, textBody } = params;
  
  if (!to || !subject || (!htmlBody && !textBody)) {
    throw new Error("'to', 'subject', and either 'htmlBody' or 'textBody' parameters are required");
  }
  
  console.log(\`Sending email to: \${to}\`);
  
  // Check if Postmark is configured
  if (!postmarkClient) {
    throw new Error("Postmark client not available. Check your POSTMARK_API_KEY environment variable.");
  }
  
  try {
    // Get the configured sender email
    const fromEmail = getPostmarkFromEmail();
    if (!fromEmail) {
      throw new Error("POSTMARK_FROM_EMAIL environment variable not configured");
    }
    
    // Get optional sender name
    const fromName = getPostmarkFromName();
    const fromAddress = fromName ? \`\${fromName} <\${fromEmail}>\` : fromEmail;
    
    console.log(\`Sending email from: \${fromAddress} to: \${to}\`);
    
    // Prepare email data
    const emailData = {
      From: fromAddress,
      To: to,
      Subject: subject,
      HtmlBody: htmlBody || undefined,
      TextBody: textBody || undefined,
    };
    
    // Send the email using Postmark
    const result = await postmarkClient.sendEmail(emailData);
    
    console.log(\`Email sent successfully. MessageID: \${result.MessageID}\`);
    
    // Example: Log email activity using Firebase-style SDK syntax
    try {
      const emailRef = await addDoc(collection(db, 'email_logs'), {
        to: to,
        from: fromAddress,
        subject: subject,
        messageId: result.MessageID,
        timestamp: new Date().toISOString(),
        status: 'sent'
      });
      console.log('Email activity logged with ID:', emailRef.id);
    } catch (logError) {
      console.warn('Failed to log email activity:', logError.message);
    }
    
    return {
      success: true,
      to: to,
      from: fromAddress,
      subject: subject,
      messageId: result.MessageID,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error("Error sending email:", error);
    throw new Error(\`Failed to send email: \${error.message}\`);
  }
};`,
    requiredServices: ["postmark"],
    createdAt: new Date(),
    updatedAt: new Date(),
    enabled: true,
  };

  defaultTasks.push(sendEmailTask);

  // Add a new example task that demonstrates SDK usage
  const exampleSDKTask: CloudTask = {
    _id: "exampleSDK",
    description: "Example task demonstrating Firebase-style SDK usage",
    implementationCode: `module.exports = async (params, context) => {
  const { console, data, tasks, db, doc, getDoc, collection, getDocs, addDoc, setDoc, updateDoc, deleteDoc } = context;
  const { action = 'demo' } = params;
  
  console.log('Running SDK example task with action:', action);
  
  try {
    if (action === 'create') {
      // Create a new document using Firebase-style syntax
      const userRef = await addDoc(collection(db, 'users'), {
        name: 'John Doe',
        email: 'john@example.com',
        createdAt: new Date().toISOString(),
        active: true
      });
      
      console.log('Created user with ID:', userRef.id);
      return { success: true, action: 'create', userId: userRef.id };
      
    } else if (action === 'read') {
      // Read documents using Firebase-style syntax
      const usersSnapshot = await getDocs(collection(db, 'users'));
      const users = [];
      
      usersSnapshot.forEach((doc) => {
        users.push({
          id: doc.id,
          ...doc.data()
        });
      });
      
      console.log(\`Found \${users.length} users\`);
      return { success: true, action: 'read', users, count: users.length };
      
    } else if (action === 'update' && params.userId) {
      // Update a document using Firebase-style syntax
      const userRef = doc(db, \`users/\${params.userId}\`);
      await updateDoc(userRef, {
        lastUpdated: new Date().toISOString(),
        updatedBy: 'system'
      });
      
      // Read the updated document
      const userSnap = await getDoc(userRef);
      if (userSnap.exists) {
        console.log('Updated user:', userSnap.data());
        return { success: true, action: 'update', user: userSnap.data() };
      } else {
        throw new Error('User not found');
      }
      
    } else {
      // Demo: Show both old and new syntax side by side
      console.log('=== SDK Demo ===');
      
      // Old syntax (still supported)
      console.log('Old syntax: Using data.collection()');
      const oldCollection = data.collection('demo_items');
      const oldResult = await oldCollection.getDocs({ limit: 3 });
      console.log('Old syntax result count:', oldResult.length);
      
      // New Firebase-style syntax
      console.log('New syntax: Using Firebase-style functions');
      const newSnapshot = await getDocs(collection(db, 'demo_items'));
      console.log('New syntax result count:', newSnapshot.size);
      
      return {
        success: true,
        action: 'demo',
        message: 'Both syntaxes work! Check logs for details.',
        oldCount: oldResult.length,
        newCount: newSnapshot.size
      };
    }
  } catch (error) {
    console.error('SDK example error:', error);
    throw new Error(\`SDK example failed: \${error.message}\`);
  }
};`,
    requiredServices: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    enabled: true,
  };

  defaultTasks.push(exampleSDKTask);

  // Insert or update each default task
  for (const task of defaultTasks) {
    try {
      const existingTask = await tasksCollection.findOne({ _id: task._id });

      if (existingTask) {
        // Update the existing task but preserve user modifications
        await tasksCollection.updateOne(
          { _id: task._id },
          {
            $set: {
              description: task.description,
              implementationCode: task.implementationCode,
              requiredServices: task.requiredServices,
              updatedAt: new Date(),
            },
          }
        );
        console.log(`✅ Updated default task: ${task._id}`);
      } else {
        // Insert new task
        await tasksCollection.insertOne(task);
        console.log(`✅ Created default task: ${task._id}`);
      }
    } catch (error) {
      console.error(`❌ Failed to initialize task ${task._id}:`, error);
    }
  }

  console.log(`Initialized ${defaultTasks.length} default cloud tasks`);
}
