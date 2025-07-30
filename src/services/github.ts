import { Octokit } from "@octokit/rest";
import fs from "fs/promises";
import path from "path";

export interface GitHubConfig {
  token: string;
  owner: string; // Organization that owns the repos (e.g., "basebase-ai")
}

export interface ForkRepositoryInput {
  templateRepo: string; // e.g., "nextjs-starter"
  newRepoName: string; // e.g., "my-project"
  description?: string;
}

export interface UpdateConfigInput {
  repoName: string;
  projectConfig: {
    projectId: string;
    name: string;
    description: string;
    githubUrl: string;
    productionUrl: string;
    categories: string[];
  };
}

export interface GitHubRepository {
  name: string;
  fullName: string;
  htmlUrl: string;
  cloneUrl: string;
  sshUrl: string;
  defaultBranch: string;
}

export class GitHubService {
  private octokit: Octokit;
  private config: GitHubConfig;

  constructor(config: GitHubConfig) {
    this.config = config;
    this.octokit = new Octokit({
      auth: config.token,
    });
  }

  /**
   * Fork a template repository to create a new project repository
   */
  async forkRepository(input: ForkRepositoryInput): Promise<GitHubRepository> {
    try {
      console.log(
        `[GitHub] Starting fork process: ${this.config.owner}/${input.templateRepo} -> ${this.config.owner}/${input.newRepoName}`
      );

      // Check if target repository already exists
      console.log(
        `[GitHub] Checking if ${input.newRepoName} already exists...`
      );
      try {
        const existingRepo = await this.octokit.rest.repos.get({
          owner: this.config.owner,
          repo: input.newRepoName,
        });
        console.log(
          `[GitHub] Repository ${input.newRepoName} already exists, returning existing repo`
        );
        return {
          name: existingRepo.data.name,
          fullName: existingRepo.data.full_name,
          htmlUrl: existingRepo.data.html_url,
          cloneUrl: existingRepo.data.clone_url,
          sshUrl: existingRepo.data.ssh_url,
          defaultBranch: existingRepo.data.default_branch,
        };
      } catch (error: any) {
        if (error.status !== 404) {
          throw error; // Re-throw if it's not a "not found" error
        }
        console.log(
          `[GitHub] Repository ${input.newRepoName} does not exist, proceeding with fork...`
        );
      }

      // Step 1: Create a fork with the new name directly
      console.log(`[GitHub] Creating fork with parameters:`, {
        owner: this.config.owner,
        repo: input.templateRepo,
        organization: this.config.owner,
        name: input.newRepoName,
        description: input.description,
      });

      const forkResponse = await this.octokit.rest.repos.createFork({
        owner: this.config.owner,
        repo: input.templateRepo,
        organization: this.config.owner, // Fork into the same organization
        name: input.newRepoName, // GitHub API DOES support name parameter
        description: input.description,
      });

      const forkedRepo = forkResponse.data;
      console.log(`[GitHub] Fork API response:`, {
        name: forkedRepo.name,
        full_name: forkedRepo.full_name,
        status: forkResponse.status,
      });

      // Step 2: Wait for the fork to be available
      console.log(`[GitHub] Waiting for forked repository to be ready...`);
      await this.waitForRepository(forkedRepo.name, 20000); // Increased timeout to 20 seconds

      console.log(
        `[GitHub] Fork completed successfully: ${forkedRepo.html_url}`
      );

      return {
        name: forkedRepo.name,
        fullName: forkedRepo.full_name,
        htmlUrl: forkedRepo.html_url,
        cloneUrl: forkedRepo.clone_url,
        sshUrl: forkedRepo.ssh_url,
        defaultBranch: forkedRepo.default_branch,
      };
    } catch (error) {
      console.error(`[GitHub] Error during fork process:`, {
        message: error instanceof Error ? error.message : error,
        status: (error as any).status,
        response: (error as any).response?.data,
      });
      if (error instanceof Error) {
        throw new Error(`Failed to fork repository: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Update the config.ts file in a repository with project-specific settings
   */
  async updateProjectConfig(input: UpdateConfigInput): Promise<void> {
    try {
      console.log(`[GitHub] Updating config and README for ${input.repoName}`);

      // Update config.ts file
      await this.updateConfigFile(input);

      // Update README.md file
      await this.updateReadmeFile(input);

      console.log(
        `[GitHub] Successfully updated config.ts and README.md for ${input.repoName}`
      );
    } catch (error) {
      console.error(`[GitHub] Error updating project files:`, error);
      if (error instanceof Error) {
        throw new Error(`Failed to update project files: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Update the config.ts file with project-specific values
   */
  private async updateConfigFile(input: UpdateConfigInput): Promise<void> {
    // Get the current config.ts file
    const configResponse = await this.octokit.rest.repos.getContent({
      owner: this.config.owner,
      repo: input.repoName,
      path: "config.ts",
    });

    if (
      Array.isArray(configResponse.data) ||
      configResponse.data.type !== "file"
    ) {
      throw new Error("config.ts is not a file or not found");
    }

    // Generate the new config content
    const newContent = this.generateConfigContent(input.projectConfig);

    // Update the file
    await this.octokit.rest.repos.createOrUpdateFileContents({
      owner: this.config.owner,
      repo: input.repoName,
      path: "config.ts",
      message: `Configure project: ${input.projectConfig.name}`,
      content: Buffer.from(newContent).toString("base64"),
      sha: configResponse.data.sha,
      branch: "master", // Using master branch as default
    });

    console.log(
      `[GitHub] Successfully updated config.ts for ${input.repoName}`
    );
  }

  /**
   * Update the README.md file with project-specific information
   */
  private async updateReadmeFile(input: UpdateConfigInput): Promise<void> {
    try {
      // Get the current README.md file
      const readmeResponse = await this.octokit.rest.repos.getContent({
        owner: this.config.owner,
        repo: input.repoName,
        path: "README.md",
      });

      if (
        Array.isArray(readmeResponse.data) ||
        readmeResponse.data.type !== "file"
      ) {
        throw new Error("README.md is not a file or not found");
      }

      // Generate the new README content
      const newContent = this.generateReadmeContent(input.projectConfig);

      // Update the file
      await this.octokit.rest.repos.createOrUpdateFileContents({
        owner: this.config.owner,
        repo: input.repoName,
        path: "README.md",
        message: `Update README for project: ${input.projectConfig.name}`,
        content: Buffer.from(newContent).toString("base64"),
        sha: readmeResponse.data.sha,
        branch: "master", // Using master branch as default
      });

      console.log(
        `[GitHub] Successfully updated README.md for ${input.repoName}`
      );
    } catch (error) {
      console.error(`[GitHub] Error updating README:`, error);
      // Don't throw here - README update failure shouldn't fail the whole operation
      console.log(
        `[GitHub] Continuing without README update for ${input.repoName}`
      );
    }
  }

  /**
   * Generate the config.ts file content with project-specific values
   */
  private generateConfigContent(config: {
    projectId: string;
    name: string;
    description: string;
    githubUrl: string;
    productionUrl: string;
    categories: string[];
  }): string {
    return `// Auto-generated project configuration
export const appConfig = {
  projectId: ${JSON.stringify(config.projectId)},
  name: ${JSON.stringify(config.name)},
  description: ${JSON.stringify(config.description)},
  githubUrl: ${JSON.stringify(config.githubUrl)},
  productionUrl: ${JSON.stringify(config.productionUrl)},
  categories: ${JSON.stringify(config.categories)},
  
  // Generated metadata
  generatedAt: ${JSON.stringify(new Date().toISOString())},
  version: "1.0.0",
};

export default appConfig;
`;
  }

  /**
   * Generate the README.md file content with project-specific information
   */
  private generateReadmeContent(config: {
    name: string;
    description: string;
    githubUrl: string;
    productionUrl: string;
    categories: string[];
  }): string {
    const categoriesList = config.categories
      .map((cat) => `- ${cat}`)
      .join("\n");

    return `# ${config.name}

${config.description}

## 🌐 Links

- **Production**: [${config.productionUrl}](${config.productionUrl})
- **GitHub**: [${config.githubUrl}](${config.githubUrl})

## 📋 Categories

${categoriesList}

## 🚀 Getting Started

This project was created using the BaseBase platform. It's a Next.js application with the following features:

- **Framework**: Next.js with TypeScript
- **Styling**: Tailwind CSS
- **Deployment**: Railway
- **Domain**: Custom subdomain on basebase.ai

## 🛠️ Development

\`\`\`bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build

# Start production server
npm start
\`\`\`

## 📝 Configuration

Project configuration is stored in \`config.ts\` and includes:

- Project name and description
- GitHub repository URL
- Production URL
- Project categories
- Generated metadata

## 🔧 Customization

1. Update the \`config.ts\` file to modify project metadata
2. Customize the UI components in the \`components/\` directory
3. Add new pages in the \`pages/\` directory
4. Modify styling in the \`styles/\` directory

## 📦 Deployment

This project is automatically deployed to Railway and accessible at the production URL. Any changes pushed to the main branch will trigger a new deployment.

---

*Generated by BaseBase on ${new Date().toISOString()}*
`;
  }

  /**
   * Wait for a repository to be ready after creation/forking
   */
  private async waitForRepository(
    repoName: string,
    timeoutMs: number = 10000
  ): Promise<void> {
    const startTime = Date.now();
    const checkInterval = 1000; // Check every second
    let attemptCount = 0;

    console.log(
      `[GitHub] Waiting for repository ${this.config.owner}/${repoName} to be ready (timeout: ${timeoutMs}ms)`
    );

    while (Date.now() - startTime < timeoutMs) {
      attemptCount++;
      const elapsedTime = Date.now() - startTime;

      try {
        console.log(
          `[GitHub] Attempt ${attemptCount}: Checking if ${repoName} exists... (${elapsedTime}ms elapsed)`
        );

        const repoResponse = await this.octokit.rest.repos.get({
          owner: this.config.owner,
          repo: repoName,
        });

        console.log(
          `[GitHub] ✅ Repository ${repoName} is ready! (${elapsedTime}ms total wait time)`
        );
        console.log(`[GitHub] Repository details:`, {
          name: repoResponse.data.name,
          full_name: repoResponse.data.full_name,
          private: repoResponse.data.private,
          fork: repoResponse.data.fork,
        });

        // If we get here, the repo exists and is ready
        return;
      } catch (error: any) {
        console.log(
          `[GitHub] Attempt ${attemptCount}: Repository check result:`,
          {
            status: error.status,
            message: error.message,
            elapsed: elapsedTime,
          }
        );

        // If error is 404, repo might still be creating
        if (error.status !== 404) {
          console.error(
            `[GitHub] ❌ Unexpected error while waiting for repository:`,
            error
          );
          throw error; // Some other error occurred
        }

        console.log(
          `[GitHub] Repository not ready yet, waiting ${checkInterval}ms before next attempt...`
        );
        // Wait and try again
        await new Promise((resolve) => setTimeout(resolve, checkInterval));
      }
    }

    const totalElapsed = Date.now() - startTime;
    console.error(
      `[GitHub] ❌ Timeout: Repository ${repoName} was not ready within ${timeoutMs}ms (${attemptCount} attempts, ${totalElapsed}ms elapsed)`
    );
    throw new Error(
      `Repository ${repoName} was not ready within ${timeoutMs}ms (${attemptCount} attempts)`
    );
  }

  /**
   * Get repository information
   */
  async getRepository(repoName: string): Promise<GitHubRepository> {
    try {
      const response = await this.octokit.rest.repos.get({
        owner: this.config.owner,
        repo: repoName,
      });

      const repo = response.data;
      return {
        name: repo.name,
        fullName: repo.full_name,
        htmlUrl: repo.html_url,
        cloneUrl: repo.clone_url,
        sshUrl: repo.ssh_url,
        defaultBranch: repo.default_branch,
      };
    } catch (error) {
      console.error(`[GitHub] Error getting repository:`, error);
      if (error instanceof Error) {
        throw new Error(`Failed to get repository: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Delete a repository (for cleanup on errors)
   */
  async deleteRepository(repoName: string): Promise<void> {
    try {
      console.log(`[GitHub] Deleting repository ${repoName}`);
      await this.octokit.rest.repos.delete({
        owner: this.config.owner,
        repo: repoName,
      });
      console.log(`[GitHub] Successfully deleted repository ${repoName}`);
    } catch (error) {
      console.error(`[GitHub] Error deleting repository:`, error);
      // Don't throw here - this is cleanup, we don't want to fail the main operation
    }
  }

  /**
   * Check if a repository name is available
   */
  async isRepositoryNameAvailable(repoName: string): Promise<boolean> {
    try {
      await this.octokit.rest.repos.get({
        owner: this.config.owner,
        repo: repoName,
      });
      // If we get here, repo exists
      return false;
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "status" in error &&
        error.status === 404
      ) {
        // Repo doesn't exist, name is available
        return true;
      }
      // Some other error
      throw error;
    }
  }
}

/**
 * Create a GitHub service instance with environment configuration or custom config
 */
export function createGitHubService(customConfig?: {
  token?: string;
  owner?: string;
}): GitHubService {
  const token = customConfig?.token || process.env.GITHUB_TOKEN;
  const owner =
    customConfig?.owner || process.env.GITHUB_OWNER || "basebase-ai";

  if (!token) {
    throw new Error(
      "GITHUB_TOKEN environment variable is required or token must be provided"
    );
  }

  return new GitHubService({
    token,
    owner,
  });
}
