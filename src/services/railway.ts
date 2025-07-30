import axios, { AxiosResponse } from "axios";

// Railway GraphQL API configuration
const RAILWAY_API_ENDPOINT = "https://backboard.railway.com/graphql/v2";

export interface RailwayConfig {
  apiToken: string;
  teamId?: string; // Optional for team-scoped operations
}

export interface RailwayProject {
  id: string;
  name: string;
  teamId?: string;
}

export interface RailwayServiceInfo {
  id: string;
  name: string;
  projectId: string;
  repoFullName?: string;
  deploymentDomain?: string;
}

export interface CreateRailwayServiceInput {
  projectId: string;
  name: string;
  source: {
    repo: string; // GitHub repo in format "owner/repo"
  };
  environmentId?: string;
}

export interface RailwayDomain {
  id: string;
  domain: string;
  serviceId: string;
  projectId: string;
  environmentId: string;
}

export class RailwayService {
  private config: RailwayConfig;

  constructor(config: RailwayConfig) {
    this.config = config;
  }

  private async makeGraphQLRequest<T>(
    query: string,
    variables?: Record<string, any>
  ): Promise<T> {
    try {
      const requestData = {
        query,
        variables: variables || {},
      };

      console.log(
        `[Railway] Making GraphQL request to ${RAILWAY_API_ENDPOINT}`
      );
      console.log(
        `[Railway] Request data:`,
        JSON.stringify(requestData, null, 2)
      );
      console.log(`[Railway] Headers:`, {
        Authorization: `Bearer ${this.config.apiToken.substring(0, 8)}...`,
        "Content-Type": "application/json",
      });

      const response: AxiosResponse = await axios.post(
        RAILWAY_API_ENDPOINT,
        requestData,
        {
          headers: {
            Authorization: `Bearer ${this.config.apiToken}`,
            "Content-Type": "application/json",
          },
        }
      );

      console.log(`[Railway] Response status:`, response.status);
      console.log(
        `[Railway] Response data:`,
        JSON.stringify(response.data, null, 2)
      );

      if (response.data.errors) {
        console.error(`[Railway] GraphQL errors:`, response.data.errors);
        throw new Error(
          `Railway GraphQL Error: ${JSON.stringify(response.data.errors)}`
        );
      }

      return response.data.data as T;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(`[Railway] Axios error details:`, {
          status: error.response?.status,
          statusText: error.response?.statusText,
          data: error.response?.data,
          headers: error.response?.headers,
        });

        const errorMessage =
          error.response?.data?.message ||
          error.response?.data?.error ||
          JSON.stringify(error.response?.data) ||
          error.message;

        throw new Error(`Railway API Request Failed: ${errorMessage}`);
      }
      console.error(`[Railway] Non-axios error:`, error);
      throw error;
    }
  }

  /**
   * Create a new service within an existing Railway project from a GitHub repository
   */
  async createServiceFromGitHub(
    input: CreateRailwayServiceInput
  ): Promise<RailwayServiceInfo> {
    const query = `
      mutation ServiceCreate($input: ServiceCreateInput!) {
        serviceCreate(input: $input) {
          id
        }
      }
    `;

    const variables = {
      input: input,
    };

    const result = await this.makeGraphQLRequest<{
      serviceCreate: { id: string };
    }>(query, variables);

    // Railway returns just the ID, so we need to construct the service info
    return {
      id: result.serviceCreate.id,
      name: input.name,
      projectId: input.projectId,
    };
  }

  /**
   * Generate a Railway-provided domain for a service
   */
  async generateDomain(serviceId: string): Promise<RailwayDomain> {
    const query = `
      mutation ServiceDomainCreate($input: ServiceDomainCreateInput!) {
        serviceDomainCreate(input: $input) {
          domain {
            id
            domain
            serviceId
          }
        }
      }
    `;

    const variables = {
      input: {
        serviceId,
      },
    };

    const result = await this.makeGraphQLRequest<{
      serviceDomainCreate: { domain: RailwayDomain };
    }>(query, variables);

    return result.serviceDomainCreate.domain;
  }

  /**
   * Create a custom domain for a service (for basebase.ai subdomains)
   */
  async createCustomDomain(
    serviceId: string,
    domain: string,
    environmentId: string
  ): Promise<RailwayDomain> {
    const query = `
      mutation CustomDomainCreate($input: CustomDomainCreateInput!) {
        customDomainCreate(input: $input) {
          id
          domain
          serviceId
          projectId
          environmentId
        }
      }
    `;

    const variables = {
      input: {
        serviceId,
        domain,
        environmentId,
        projectId: "73e34391-e6de-4970-8f25-afb3d56e1846", // Basebase Core project ID
      },
    };

    const result = await this.makeGraphQLRequest<{
      customDomainCreate: { domain: RailwayDomain };
    }>(query, variables);

    return result.customDomainCreate.domain;
  }

  /**
   * Set environment variables for a service
   */
  async setEnvironmentVariables(
    serviceId: string,
    environmentId: string,
    variables: Record<string, string>
  ): Promise<void> {
    const mutations = Object.entries(variables).map(([key, value], index) => {
      return `
        var${index}: variableUpsert(input: {
          serviceId: "${serviceId}"
          environmentId: "${environmentId}"
          name: "${key}"
          value: "${value}"
        }) {
          variable {
            id
            name
          }
        }
      `;
    });

    const query = `
      mutation SetEnvironmentVariables {
        ${mutations.join("\n")}
      }
    `;

    await this.makeGraphQLRequest(query);
  }

  /**
   * Get deployment status for a service
   */
  async getDeploymentStatus(serviceId: string): Promise<{
    status: string;
    url?: string;
  }> {
    const query = `
      query GetServiceDeployments($serviceId: String!) {
        service(id: $serviceId) {
          deployments(first: 1) {
            edges {
              node {
                id
                status
                url
              }
            }
          }
        }
      }
    `;

    const variables = { serviceId };

    const result = await this.makeGraphQLRequest<{
      service: {
        deployments: {
          edges: Array<{
            node: {
              id: string;
              status: string;
              url?: string;
            };
          }>;
        };
      };
    }>(query, variables);

    const latestDeployment = result.service.deployments.edges[0]?.node;
    return {
      status: latestDeployment?.status || "unknown",
      url: latestDeployment?.url,
    };
  }

  /**
   * Get the default environment for a project
   */
  async getDefaultEnvironment(projectId: string): Promise<string> {
    const query = `
      query GetProject($id: String!) {
        project(id: $id) {
          id
          environments {
            edges {
              node {
                id
                name
              }
            }
          }
        }
      }
    `;

    const result = await this.makeGraphQLRequest<{
      project: {
        id: string;
        environments: {
          edges: Array<{
            node: {
              id: string;
              name: string;
            };
          }>;
        };
      };
    }>(query, { id: projectId });

    const environments = result.project.environments.edges;
    if (environments.length === 0) {
      throw new Error(`No environments found for project ${projectId}`);
    }

    // Return the first environment (usually "Production")
    return environments[0].node.id;
  }

  /**
   * Trigger a deployment for a service
   */
  async triggerDeployment(
    serviceId: string,
    environmentId: string,
    commitSha?: string
  ): Promise<{ deploymentId: string }> {
    const query = `
      mutation ServiceInstanceDeployV2(
        $serviceId: String!
        $environmentId: String!
        $commitSha: String
      ) {
        serviceInstanceDeployV2(
          serviceId: $serviceId
          environmentId: $environmentId
          commitSha: $commitSha
        )
      }
    `;

    const variables = {
      serviceId,
      environmentId,
      commitSha: commitSha || null,
    };

    const result = await this.makeGraphQLRequest<{
      serviceInstanceDeployV2: string;
    }>(query, variables);

    return { deploymentId: result.serviceInstanceDeployV2 };
  }
}

/**
 * Create a Railway service instance with environment configuration
 */
export function createRailwayService(): RailwayService {
  const apiToken = process.env.RAILWAY_API_TOKEN;
  const teamId = process.env.RAILWAY_TEAM_ID; // Optional

  if (!apiToken) {
    throw new Error("RAILWAY_API_TOKEN environment variable is required");
  }

  return new RailwayService({
    apiToken,
    teamId,
  });
}
