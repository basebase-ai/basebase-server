import { getServerFunctionsCollection } from "../database/collections";
import { ServerFunction } from "../types/functions";

// Helper function to initialize default server functions
export async function initializeDefaultServerFunctions(): Promise<void> {
  try {
    const functionsCollection = getServerFunctionsCollection();

    // Check if functions already exist
    const existingCount = await functionsCollection.countDocuments();
    if (existingCount > 0) {
      console.log("Server functions already initialized");
      return;
    }

    const now = new Date();

    // getPage function
    const getPageFunction: ServerFunction = {
      _id: "getPage",
      description:
        "Retrieves the contents of a webpage located at a URL using HTTP GET request and returns them as a string. Required parameters: 'url' of type string.",
      implementationCode: `
        async (params, context) => {
          if (!params.url || typeof params.url !== 'string') {
            throw new Error('Parameter "url" is required and must be a string');
          }
          
          // Security validation: prevent access to localhost and internal IP ranges
          const url = params.url.toLowerCase();
          if (url.includes('localhost') || url.includes('127.0.0.1') || url.includes('::1')) {
            throw new Error('Access to localhost is not allowed for security reasons');
          }
          
          // Check for internal IP ranges (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
          if (url.includes('192.168.') || url.includes('10.') || url.includes('172.')) {
            throw new Error('Access to internal IP ranges is not allowed for security reasons');
          }
          
          // Basic URL validation
          try {
            new URL(params.url);
          } catch (urlError) {
            throw new Error('Invalid URL format provided');
          }
          
          try {
            const response = await axios.get(params.url, {
              timeout: 10000, // 10 second timeout
              maxRedirects: 5,
              headers: {
                'User-Agent': 'BaseBase-Server/1.0'
              }
            });
            
            return {
              success: true,
              data: response.data,
              status: response.status,
              headers: response.headers,
              url: response.config.url
            };
          } catch (error) {
            // Return HTTP errors as successful responses (they're valid HTTP responses)
            if (error.response) {
              return {
                success: true,
                data: error.response.data,
                status: error.response.status,
                headers: error.response.headers,
                url: error.response.config.url
              };
            } else if (error.request) {
              throw new Error('Network Error: Could not reach the URL');
            } else {
              throw new Error('Request Error: ' + error.message);
            }
          }
        }
      `,
      requiredServices: ["axios"],
      createdAt: now,
      updatedAt: now,
    };

    // sendSms function
    const sendSmsFunction: ServerFunction = {
      _id: "sendSms",
      description:
        "Sends an SMS message to a phone number using Twilio. Required parameters: 'to' (phone number), 'message' (text content).",
      implementationCode: `
        async (params, context) => {
          if (!params.to || typeof params.to !== 'string') {
            throw new Error('Parameter "to" is required and must be a string (phone number)');
          }
          
          if (!params.message || typeof params.message !== 'string') {
            throw new Error('Parameter "message" is required and must be a string');
          }
          
          try {
            // Note: This would require Twilio client to be available in execution context
            // For now, we'll return a mock response
            console.log('SMS would be sent to ' + params.to + ': ' + params.message);
            
            return {
              success: true,
              message: 'SMS sent successfully (mock)',
              to: params.to,
              messageLength: params.message.length,
              timestamp: new Date().toISOString()
            };
          } catch (error) {
            return {
              success: false,
              error: 'SMS Error: ' + error.message
            };
          }
        }
      `,
      requiredServices: ["twilio"],
      createdAt: now,
      updatedAt: now,
    };

    await functionsCollection.insertMany([getPageFunction, sendSmsFunction]);
    console.log("Initialized default server functions: getPage, sendSms");
  } catch (error) {
    console.error("Failed to initialize default server functions:", error);
  }
}
