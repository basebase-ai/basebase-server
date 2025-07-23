import { getCloudTasksCollection } from "../database/collections";
import { CloudTask } from "../types/tasks";

// Initialize default cloud tasks (global basebase tasks)
export async function initializeDefaultCloudTasks(): Promise<void> {
  console.log("Initializing default cloud tasks...");
  const tasksCollection = getCloudTasksCollection();

  // Default tasks to initialize
  const defaultTasks: CloudTask[] = [];

  // getPage task - Fetch web page content
  const getPageTask: CloudTask = {
    _id: "getPage",
    description: "Fetch web page content using Puppeteer",
    implementationCode: `async (params, context) => {
      const { console, data, tasks } = context;
      const { url } = params;
      
      if (!url) {
        throw new Error("URL parameter is required");
      }
      
      console.log(\`Fetching page: \${url}\`);
      
      // This is a simplified implementation
      // In a real scenario, you would use Puppeteer or similar
      try {
        const response = await fetch(url);
        const content = await response.text();
        
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
    }`,
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
    implementationCode: `async (params, context) => {
      const { console, data, tasks } = context;
      const { to, message } = params;
      
      if (!to || !message) {
        throw new Error("Both 'to' and 'message' parameters are required");
      }
      
      console.log(\`Sending SMS to: \${to}\`);
      
      // This would use the Twilio service
      // For now, we'll just simulate the response
      try {
        return {
          to: to,
          message: message,
          status: "sent",
          timestamp: new Date().toISOString(),
          messageId: "sim_" + Math.random().toString(36).substring(7)
        };
      } catch (error) {
        console.error("Error sending SMS:", error);
        throw new Error(\`Failed to send SMS: \${error.message}\`);
      }
    }`,
    requiredServices: ["twilio"],
    createdAt: new Date(),
    updatedAt: new Date(),
    enabled: true,
  };

  defaultTasks.push(sendSmsTask);

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
