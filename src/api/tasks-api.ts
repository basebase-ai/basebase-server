import { TaskAPI, TaskExecutionContext } from "../types/tasks";
import { getProjectTasksCollection } from "../database/collections";

// Task API implementation
export class ProjectTaskAPI implements TaskAPI {
  constructor(
    private projectName: string,
    private context: TaskExecutionContext
  ) {}

  async do(taskName: string, data?: Record<string, any>): Promise<any> {
    // First try to find in current project tasks
    const projectTasksCollection = getProjectTasksCollection(this.projectName);
    let cloudTask = await projectTasksCollection.findOne({
      _id: taskName,
    });

    // If not found, try public tasks
    if (!cloudTask) {
      const publicTasksCollection = getProjectTasksCollection("public");
      cloudTask = await publicTasksCollection.findOne({
        _id: taskName,
      });
    }

    if (!cloudTask) {
      throw new Error(`Task '${taskName}' not found`);
    }

    // Import executeCloudTask to avoid circular dependency
    const { executeCloudTask } = await import("../tasks/execution");

    // Execute the task
    return await executeCloudTask(
      cloudTask.implementationCode,
      data || {},
      this.context,
      cloudTask.requiredServices
    );
  }
}
