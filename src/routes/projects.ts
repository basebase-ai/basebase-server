import { Request, Response, Router } from "express";
import { getDbAndCollection } from "../database/collections";
import { convertToFirestoreFormat } from "../database/conversion";

const router = Router();

// GET /projects - List all projects (unauthenticated)
router.get("/projects", async (req: Request, res: Response) => {
  try {
    console.log("[PROJECTS] GET /projects");

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
