import "dotenv/config";
import { Mastra } from "@mastra/core/mastra";
import { registerApiRoute } from "@mastra/core/server";
import { PinoLogger } from "@mastra/loggers";
import { PostgresStore } from "@mastra/pg";

// Workflows & Agents
import { surveyWorkflow } from "./workflows/survey-workflow";
import { surveyAgent } from "./agents/survey-agent";
import { engagementAgent } from "./agents/engagement-agent";

// Tools
import {
  sendWhatsAppMessageTool,
  sendWhatsAppSurveyTool,
  sendWhatsAppTemplateTool,
} from "./tools";

// Meta Flow APIs
import {
  createMetaFlow,
  uploadFlowJson,
  publishFlow,
} from "./metaFlowApi";

// WhatsApp client
import {
  sendWhatsAppMessage,
  markAsRead,
} from "../whatsapp-client";

/* -------------------------------------------------------------------------- */
/*                                CONFIG                                      */
/* -------------------------------------------------------------------------- */

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

const pgStorage = new PostgresStore({
  id: "main-pg-storage",
  connectionString: process.env.DATABASE_URL,
});

/* -------------------------------------------------------------------------- */
/*                                HELPERS                                     */
/* -------------------------------------------------------------------------- */

const getDb = () => (pgStorage as any).db;

/* -------------------------------------------------------------------------- */
/*                              API ROUTES                                    */
/* -------------------------------------------------------------------------- */

const routes = [

  /* -------------------------- SEND SINGLE SURVEY -------------------------- */
  registerApiRoute("api/crm/send-survey", {
    method: "POST",
    handler: async (c) => {
      const body = await c.req.json().catch(() => null);

      if (!body?.to || !body?.surveyId || !body?.topic) {
        return c.json({ error: "Missing required fields" }, 400);
      }

      try {
        const workflow = c.get("mastra").getWorkflow("surveyWorkflow");
        const run = await workflow.createRun();

        const result = await run.start({
          inputData: body,
        });

        return c.json({ success: true, result });
      } catch (error) {
        return c.json(
          { error: "Survey workflow failed", details: (error as Error).message },
          500
        );
      }
    },
  }),

  /* -------------------------- BULK SURVEY SEND ---------------------------- */
  registerApiRoute("api/crm/bulk-send-survey", {
    method: "POST",
    handler: async (c) => {
      const body = await c.req.json().catch(() => null);

      if (!body?.customers || !Array.isArray(body.customers)) {
        return c.json({ error: "Invalid customers array" }, 400);
      }

      const workflow = c.get("mastra").getWorkflow("surveyWorkflow");

      const results = await Promise.all(
        body.customers.map(async (customer: { to: string }) => {
          try {
            const run = await workflow.createRun();

            const result = await run.start({
              inputData: {
                to: customer.to,
                surveyId: body.surveyId,
                topic: body.topic,
              },
            });

            return { to: customer.to, success: true, result };
          } catch (error) {
            return {
              to: customer.to,
              success: false,
              error: (error as Error).message,
            };
          }
        })
      );

      return c.json({ results });
    },
  }),

  /* -------------------------- META FLOW CREATION -------------------------- */
  registerApiRoute("api/crm/create-meta-flow", {
    method: "POST",
    handler: async (c) => {
      const body = await c.req.json().catch(() => null);

      try {
        const flowId = await createMetaFlow(body?.name || "survey_flow");

        await uploadFlowJson(flowId, "./survey.json");
        await publishFlow(flowId);

        return c.json({ success: true, flowId });
      } catch (error) {
        return c.json({ error: (error as Error).message }, 500);
      }
    },
  }),

  /* -------------------------- GET SURVEY RESPONSES ------------------------ */
  registerApiRoute("api/crm/survey-responses", {
    method: "GET",
    handler: async (c) => {
      const surveyId = c.req.query("surveyId");

      try {
        const db = getDb();
        if (!db) throw new Error("DB not available");

        const query = surveyId
          ? {
              text: "SELECT * FROM survey_responses WHERE survey_id=$1 ORDER BY created_at DESC",
              values: [surveyId],
            }
          : {
              text: "SELECT * FROM survey_responses ORDER BY created_at DESC",
              values: [],
            };

        const rows = await db.any(query.text, query.values);
        return c.json({ responses: rows });

      } catch {
        return c.json({ responses: [] });
      }
    },
  }),

  /* -------------------------- META RESPONSES (STUB) ------------------------ */
  registerApiRoute("api/crm/meta-survey-responses", {
    method: "GET",
    handler: async () => {
      return new Response(
        JSON.stringify({
          responses: [],
          note: "Not implemented",
        }),
        { status: 200 }
      );
    },
  }),
];

/* -------------------------------------------------------------------------- */
/*                              MASTRA INSTANCE                               */
/* -------------------------------------------------------------------------- */

export const mastra = new Mastra({
  workflows: { surveyWorkflow },
  agents: { surveyAgent, engagementAgent },
  tools: {
    sendWhatsAppMessageTool,
    sendWhatsAppSurveyTool,
    sendWhatsAppTemplateTool,
  },
  storage: pgStorage,
  logger: new PinoLogger({
    name: "FBNBank-WhatsApp-Agent",
    level: "info",
  }),
  server: {
    apiRoutes: routes,
  },
});
