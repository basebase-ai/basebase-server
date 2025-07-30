import { Request, Response, Router } from "express";
import { getDbAndCollection } from "../database/collections";
import { convertToFirestoreFormat } from "../database/conversion";
import { createGitHubService } from "../services/github";
import { createRailwayService } from "../services/railway";
import { authenticateToken } from "../../auth";

// Define types for the new endpoints
interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    projectName: string;
  };
}

interface CreateProjectRequest {
  projectId: string; // URL and GitHub safe ID
  name: string; // Display name
  description: string; // Project description
  categories: string[]; // Project categories
}

interface CreateRepoRequest {
  projectId: string; // URL and GitHub safe ID
}

interface CreateServiceRequest {
  projectId: string; // Project ID
}

interface CreateInfrastructureRequest {
  projectId: string; // URL and GitHub safe ID
  name: string; // Display name
  description: string; // Project description
  categories: string[]; // Project categories
}

const router = Router();

/**
 * Create project document in database only
 * POST /v1/create-project
 */
router.post(
  "/v1/create-project",
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { projectId, name, description, categories }: CreateProjectRequest =
        req.body;

      console.log(`[PROJECT] Creating project document: ${projectId}`);

      // Validate input
      if (!projectId || !name || !description || !categories) {
        return res.status(400).json({
          error:
            "Missing required fields: projectId, name, description, categories",
        });
      }

      // Validate projectId format (URL safe)
      if (!/^[a-z0-9-]+$/.test(projectId)) {
        return res.status(400).json({
          error:
            "Project ID must contain only lowercase letters, numbers, and hyphens",
        });
      }

      // Check if project already exists
      const { collection } = getDbAndCollection("basebase", "projects");
      const existingProject = await collection.findOne({
        _id: projectId,
      } as any);

      if (existingProject) {
        return res.status(409).json({
          error: `Project with ID '${projectId}' already exists`,
        });
      }

      // Create new project document
      const newProject = {
        _id: projectId,
        name,
        description,
        categories,
        ownerId: req.user!.userId,
        apiKey: `bbs_${Math.random().toString(36).substring(2, 15)}`,
        createdAt: new Date(),
        updatedAt: new Date(),
        // Infrastructure URLs (will be populated later)
        githubUrl: `https://github.com/basebase-ai/${projectId}`,
        productionUrl: `https://${projectId}.basebase.ai/`,
      };

      await collection.insertOne(newProject as any);

      console.log(`[PROJECT] ✅ Created project document: ${projectId}`);

      res.status(201).json({
        success: true,
        project: {
          id: projectId,
          name,
          description,
          categories,
          githubUrl: newProject.githubUrl,
          productionUrl: newProject.productionUrl,
          apiKey: newProject.apiKey,
        },
      });
    } catch (error) {
      console.error("[PROJECT] Error creating project:", error);
      res.status(500).json({
        error: "Failed to create project",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
);

/**
 * Create GitHub repository and update config
 * POST /v1/create-repo
 */
router.post(
  "/v1/create-repo",
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { projectId }: CreateRepoRequest = req.body;

      console.log(`[REPO] Creating repository for project: ${projectId}`);

      // Validate input
      if (!projectId) {
        return res.status(400).json({
          error: "Missing required field: projectId",
        });
      }

      // Get project data from database
      const { collection } = getDbAndCollection("basebase", "projects");
      const project = await collection.findOne({ _id: projectId } as any);

      if (!project) {
        return res.status(404).json({
          error: `Project with ID '${projectId}' not found. Create it first using /v1/create-project`,
        });
      }

      const { name, description, categories } = project;

      // Initialize GitHub service with environment token
      const githubService = createGitHubService();

      // Step 1: Fork the repository
      console.log(`[REPO] Forking nextjs-starter to ${projectId}`);
      const repo = await githubService.forkRepository({
        templateRepo: "nextjs-starter",
        newRepoName: projectId,
        description,
      });

      // Step 2: Update config.ts
      console.log(`[REPO] Updating config.ts for ${projectId}`);
      await githubService.updateProjectConfig({
        repoName: projectId,
        projectConfig: {
          projectId,
          name,
          description,
          githubUrl: `https://github.com/basebase-ai/${projectId}`,
          productionUrl: `https://${projectId}.basebase.ai/`,
          categories,
        },
      });

      console.log(
        `[REPO] ✅ Repository created and configured: ${repo.htmlUrl}`
      );

      res.status(201).json({
        success: true,
        repository: {
          name: repo.name,
          fullName: repo.fullName,
          url: repo.htmlUrl,
          cloneUrl: repo.cloneUrl,
          defaultBranch: repo.defaultBranch,
        },
      });
    } catch (error) {
      console.error("[REPO] Error creating repository:", error);
      res.status(500).json({
        error: "Failed to create repository",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
);

/**
 * Create Railway service and deploy
 * POST /v1/create-service
 */
router.post(
  "/v1/create-service",
  authenticateToken,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { projectId }: CreateServiceRequest = req.body;

      console.log(
        `[SERVICE] Creating Railway service for project: ${projectId}`
      );

      // Validate input
      if (!projectId) {
        return res.status(400).json({
          error: "Missing required field: projectId",
        });
      }

      // Get project data from database
      const { collection } = getDbAndCollection("basebase", "projects");
      const project = await collection.findOne({ _id: projectId } as any);

      if (!project) {
        return res.status(404).json({
          error: `Project with ID '${projectId}' not found. Create it first using /v1/create-project`,
        });
      }

      const { name, description } = project;

      // Initialize Railway service
      const railwayService = createRailwayService();

      // Use existing Railway project "Basebase Core"
      const existingProjectId = "73e34391-e6de-4970-8f25-afb3d56e1846";

      // Create service from GitHub repo in existing project
      console.log(
        `[SERVICE] Creating service from GitHub repo in existing project`
      );
      const service = await railwayService.createServiceFromGitHub({
        projectId: existingProjectId,
        name: projectId,
        source: {
          repo: `basebase-ai/${projectId}`,
        },
      });

      // Step 3: Get environment ID for the project
      console.log(`[SERVICE] Getting environment ID for project`);
      const environmentId = await railwayService.getDefaultEnvironment(
        existingProjectId
      );

      // Step 4: Trigger initial deployment
      console.log(`[SERVICE] Triggering initial deployment`);
      const deployment = await railwayService.triggerDeployment(
        service.id,
        environmentId
      );

      // Step 5: Set up custom domain
      console.log(`[SERVICE] Setting up custom domain`);
      const domain = await railwayService.createCustomDomain(
        service.id,
        `${projectId}.basebase.ai`,
        environmentId
      );

      console.log(`[SERVICE] ✅ Railway service created and deployed`);

      res.status(201).json({
        success: true,
        service: {
          id: service.id,
          name: service.name,
          projectId: existingProjectId,
          environmentId,
          deploymentId: deployment.deploymentId,
          domain: domain.domain,
          deploymentUrl: `https://${domain.domain}/`,
        },
      });
    } catch (error) {
      console.error("[SERVICE] Error creating Railway service:", error);
      res.status(500).json({
        error: "Failed to create Railway service",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
);

// GET /v1/projects - List all projects (unauthenticated)
router.get("/v1/projects", async (req: Request, res: Response) => {
  try {
    console.log("[PROJECTS] GET /v1/projects");

    // Get projects collection from basebase database
    const { collection } = getDbAndCollection("basebase", "projects");

    // Fetch all projects
    const projects = await collection.find({}).toArray();

    // Convert to Firestore format for consistency
    const formattedProjects = projects.map((project) =>
      convertToFirestoreFormat(project)
    );

    console.log(`[PROJECTS] Found ${formattedProjects.length} projects`);

    res.json({
      projects: formattedProjects,
      count: formattedProjects.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[PROJECTS] Error fetching projects:", error);
    res.status(500).json({
      error: "Failed to fetch projects",
      message: (error as Error).message,
    });
  }
});

export default router;
