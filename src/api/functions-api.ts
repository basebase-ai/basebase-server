import { FunctionAPI, FunctionExecutionContext } from "../types/functions";
import {
  getProjectFunctionsCollection,
  getServerFunctionsCollection,
} from "../database/collections";

// Function API implementation
export class ProjectFunctionAPI implements FunctionAPI {
  constructor(
    private projectName: string,
    private context: FunctionExecutionContext
  ) {}

  async call(functionName: string, data?: Record<string, any>): Promise<any> {
    // First try to find in project functions
    const projectFunctionsCollection = getProjectFunctionsCollection(
      this.projectName
    );
    let serverFunction = await projectFunctionsCollection.findOne({
      _id: functionName,
    });

    // If not found, try global basebase functions
    if (!serverFunction) {
      const globalFunctionsCollection = getServerFunctionsCollection();
      serverFunction = await globalFunctionsCollection.findOne({
        _id: functionName,
      });
    }

    if (!serverFunction) {
      throw new Error(`Function '${functionName}' not found`);
    }

    // Import executeServerFunction to avoid circular dependency
    const { executeServerFunction } = await import("../functions/execution");

    // Execute the function
    return await executeServerFunction(
      serverFunction.implementationCode,
      data || {},
      this.context,
      serverFunction.requiredServices
    );
  }
}
