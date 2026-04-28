

import "dotenv/config";

import express, { Application, Request, Response } from 'express';
import { MastraServer } from '@mastra/express';
import { mastra } from './mastra';
import { sendWhatsAppMessage, sendWhatsAppSurvey } from './whatsapp-client';

// WhatsApp Webhook: Handle incoming messages
import { routeIncomingMessage } from './webhook/router';


const app: Application = express();

app.use(express.json());

// NOTE: Survey endpoints are handled by Mastra API router
// /api/crm/send-survey
// /api/crm/bulk-send-survey

console.log('DB URL from Express Server', process.env.DATABASE_URL);

// WhatsApp Webhook: Verification
app.get('/webhook', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      console.log('WEBHOOK_VERIFIED');
      return res.status(200).send(challenge);
    } else {
      return res.sendStatus(403);
    }
  }
  return res.sendStatus(400);
});



import { lastOutboundType, setLastOutbound } from './utils/outboundTracker';

import fs from 'fs/promises';
import path from 'path';
import { z } from 'zod';
import swaggerUi from 'swagger-ui-express';

app.post('/webhook', async (req: Request, res: Response) => {
  const body = req.body;

  try {
    if (!body.object) {
      return res.sendStatus(404);
    }

    // Handle message status events (delivery/read) if present
    const statuses = body?.entry?.[0]?.changes?.[0]?.value?.statuses;
    if (statuses && Array.isArray(statuses) && statuses.length > 0) {
      console.log('📣 Received message statuses:', JSON.stringify(statuses, null, 2));
      // Could update DB with delivery/read receipts here
      return res.sendStatus(200);
    }

    const message = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    // Try to extract the contact/profile name from the Meta webhook payload
    const contacts = body?.entry?.[0]?.changes?.[0]?.value?.contacts;
    const contactName = Array.isArray(contacts) && contacts.length > 0
      ? (contacts[0]?.profile?.name || contacts[0]?.name || contacts[0]?.pushname || null)
      : null;

    if (!message) {
      return res.sendStatus(200);
    }

    const from = message.from;

    console.log(`📩 Incoming message from ${from}`);
    console.log(JSON.stringify(message, null, 2));

    //  Get DB + mastra
    const storage = mastra.getStorage() as any;
    const db = storage?.db;

    if (!db) {
      throw new Error('DB not initialized');
    }

    //  Call your router (THIS is the key line)
    await routeIncomingMessage({
      db,
      mastra,
      message,
      phone: from,
      contactName,
      lastOutboundType,

      sendMessage: async (to: string, msg: string) => {
        // mark last outbound as chat
        setLastOutbound(String(to), 'chat');
        await sendWhatsAppMessage({ to, message: msg });
      },

      sendQuestion: async (to: string, question: any, session: any) => {
        // mark last outbound as survey question
        setLastOutbound(String(to), 'survey_question');

        // Handle text-only question
        if (!question.options || question.options.length === 0) {
          await sendWhatsAppMessage({
            to,
            message: question.question || question.text || "Please provide your response:",
          });
          return;
        }

        // Handle interactive (buttons)
        await sendWhatsAppSurvey({
          to,
          surveyId: session.survey_id,
          question: question.question,
          options: question.options,
        });
      },
    });

    return res.sendStatus(200);
  } catch (error) {
    console.error('❌ Webhook processing error:', error);
    return res.sendStatus(500);
  }
});

// Serve Swagger UI at /docs
const swaggerDocument = {
  openapi: '3.0.0',
  info: {
    title: 'Senegal Survey API',
    version: '1.0.0',
    description: 'API docs for webhook and admin survey endpoints',
  },
  servers: [{ url: 'http://localhost:3000' }],
  components: {
    schemas: {
      SurveyQuestion: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          text: { type: 'string' },
          options: { type: 'array', items: { type: 'string' } },
          type: { type: 'string', enum: ['button','list','text'] },
        },
        required: ['id','text','type']
      },
      SurveyTemplate: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          questions: { type: 'array', items: { $ref: '#/components/schemas/SurveyQuestion' } }
        },
        required: ['id','name','questions']
      }
    }
  },
  paths: {
  '/webhook': {
    post: {
      summary: 'Receive WhatsApp webhook events',
      description: `
      Handles incoming events from the WhatsApp Business API, including:
      - User messages (text, button clicks)
      - Delivery and read status updates

      This endpoint acts as the entry point for all real-time customer interactions. 
      Incoming messages are parsed and routed to the appropriate AI agent (engagement or survey flow).

      Important:
      - Must respond with HTTP 200 quickly to avoid retries from Meta
      - Payload structure follows WhatsApp Cloud API format
      `,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { type: 'object' }
          }
        }
      },
      responses: {
        '200': { description: 'Event received and processed successfully' },
        '500': { description: 'Webhook processing failed' }
      }
    }
  },

  '/admin/survey': {
    post: {
      summary: 'Create and store a manual survey template',
      description: `
      Creates a reusable survey template and stores it locally as a JSON file.

      These templates are used in "manual" mode when sending surveys, allowing predefined
      question flows instead of AI-generated ones.

      Use cases:
      - Regulatory-compliant surveys
      - Fixed questionnaires (e.g., NPS, onboarding feedback)

      The template must follow the SurveyTemplate schema.
      `,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/SurveyTemplate' }
          }
        }
      },
      responses: {
        '201': { description: 'Survey template created successfully' },
        '400': { description: 'Validation failed (invalid structure)' }
      }
    }
  },

  '/admin/survey/{surveyId}/participants': {
    get: {
      summary: 'Get survey participants',
      description: `
      Returns a list of unique customer phone numbers who have participated in a given survey.

      Data is retrieved from stored survey responses in the database.
      Useful for:
      - Analytics
      - Retargeting campaigns
      - Follow-up engagement
      `,
      parameters: [
        {
          name: 'surveyId',
          in: 'path',
          required: true,
          schema: { type: 'string' }
        }
        ,
        {
          name: 'status',
          in: 'query',
          required: false,
          description: "Filter sessions by status. One of: active, completed, abandoned",
          schema: { type: 'string', enum: ['active','completed','abandoned'] }
        }
      ],
      responses: {
        '200': {
          description: 'Sessions with participant phone lists',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  surveyId: { type: 'string' },
                  sessions: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        sessionId: { type: 'string' },
                        phones: { type: 'array', items: { type: 'string' } }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  },

  '/admin/survey/{surveyId}/file': {
    delete: {
      summary: 'Delete survey template file',
      description: `
      Deletes a locally stored survey template JSON file from the data directory.

      This does NOT delete survey responses stored in the database.
      Only removes the template definition used for manual survey mode.
      `,
      parameters: [
        {
          name: 'surveyId',
          in: 'path',
          required: true,
          schema: { type: 'string' }
        }
      ],
      responses: {
        '200': { description: 'Survey template file deleted successfully' },
        '404': { description: 'Survey file not found' }
      }
    }
  },

  '/admin/survey/{surveyId}': {
    delete: {
      summary: 'Delete survey بالكامل (data + sessions)',
      description: `
      Deletes all data associated with a survey, including:
      - Survey responses
      - Survey sessions (progress tracking)
      - Associated template file (if it exists)

      This is a destructive operation and should be used with caution.
      Typically used for:
      - Data cleanup
      - Retesting environments
      `,
      parameters: [
        {
          name: 'surveyId',
          in: 'path',
          required: true,
          schema: { type: 'string' }
        }
      ],
      responses: {
        '200': { description: 'Survey data deleted successfully' },
        '500': { description: 'Failed to delete survey data' }
      }
    }
  },

  '/api/crm/send-survey': {
    post: {
      summary: 'Send a survey to a single customer',
      description: `
      Triggers a Mastra workflow to send a survey via WhatsApp.

      Supports multiple modes:
      - ai: AI-generated questions dynamically created at runtime
      - manual: Uses predefined survey templates
      - meta: Uses approved WhatsApp message templates

      The workflow manages:
      - Question sequencing
      - User responses
      - Session tracking

      This endpoint is typically called by CRM systems.
      `,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                to: { type: 'string', description: 'Customer phone number (E.164 format)' },
                surveyId: { type: 'string' },
                topic: { type: 'string' },
                mode: { type: 'string', enum: ['ai', 'manual', 'meta'] },
                context: { type: 'string', description: 'Optional AI context for personalization' }
              },
              required: ['to', 'surveyId', 'topic', 'mode']
            }
          }
        }
      },
      responses: {
        '200': { description: 'Survey workflow successfully started' },
        '400': { description: 'Invalid request payload' },
        '500': { description: 'Failed to start workflow' }
      }
    }
  },
  '/api/crm/bulk-send-survey': {
    post: {
    summary: 'Send surveys to multiple customers',
    description: `
    Triggers survey workflows for multiple customers in a single request.

    Each phone number in the \`customers\` array represents a unique recipient. 
    A separate workflow execution is started per recipient, enabling parallel processing 
    and consistent delivery at scale.

    Top-level fields (\`surveyId\`, \`topic\`, \`mode\`, \`context\`) are applied globally 
    to all recipients.

    Typical use cases:
    - Customer satisfaction campaigns
    - Product feedback collection
    - Large-scale outreach and engagement

    Note:
    - Phone numbers must be in E.164 format (without '+')
    - Personalization is applied uniformly unless extended in future versions
    `,
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              surveyId: { 
                type: 'string',
                description: 'Unique identifier for the survey'
              },
              topic: { 
                type: 'string',
                description: 'Survey topic used for AI generation or categorization'
              },
              mode: { 
                type: 'string', 
                enum: ['ai', 'manual', 'meta'],
                description: 'Survey mode: AI-generated, manual template, or Meta template'
              },
              context: { 
                type: 'string',
                description: 'Optional context to guide AI or campaign messaging'
              },
              customers: {
                type: 'array',
                description: 'List of recipient phone numbers (E.164 format without +, e.g., 2348123456789)',
                items: {
                  type: 'string',
                  example: '2348123456789'
                }
              }
            },
            required: ['customers']
          },
          examples: {
            bulk_send_example: {
              summary: 'Bulk survey request',
              value: {
                surveyId: 'customer-sat-001',
                topic: 'Customer Satisfaction',
                mode: 'ai',
                context: 'Premium users campaign',
                customers: ['2348123456789', '2348012345678']
              }
            }
          }
        }
      }
    },
    responses: {
      '200': { description: 'Bulk survey workflows triggered successfully' },
      '400': { description: 'Invalid request payload or missing required fields' },
      '500': { description: 'Failed to process bulk survey request' }
    }
  }
  },

  '/api/crm/create-meta-flow': {
    post: {
      summary: 'Create and publish Meta (WhatsApp) flow',
      description: `
        Creates and publishes a WhatsApp interactive flow using Meta APIs.

        Used for structured, pre-approved conversational flows outside the 24-hour messaging window.

        Typically required for:
        - Compliance messaging
        - Proactive outreach
      `,
      responses: {
        '200': { description: 'Meta flow created and published' },
        '500': { description: 'Flow creation failed' }
      }
    }
  },

  '/api/crm/survey-responses': {
    get: {
      summary: 'Retrieve survey responses',
      description: `
      Fetches stored survey responses from the database.

      Supports filtering by surveyId (optional).
      Used for:
      - Analytics dashboards
      - Reporting
      - Data export
      `,
      responses: {
        '200': { description: 'Survey responses retrieved successfully' }
      }
    }
  },

  '/api/crm/meta-survey-responses': {
    get: {
      summary: 'Meta survey responses (placeholder)',
      description: `
      Placeholder endpoint for retrieving responses from Meta-hosted survey flows.

      Currently returns stub data and can be extended for full Meta integration.
      `,
      responses: {
        '200': { description: 'Stub response returned' }
      }
    }
  }
}
}




// Cast handlers to `any` to avoid type incompatibilities between
// `swagger-ui-express` and this project's Express types.
app.use('/docs', (swaggerUi.serve as any), (swaggerUi.setup(swaggerDocument) as any));


// ---------------- Admin endpoints ----------------
// GET participants for a survey
// Returns an array of objects { sessionId, phones: [customer_phone, ...] }
// Each survey can have multiple sessions (re-sends); we group responses by session_id
app.get('/admin/survey/:surveyId/participants', async (req: Request, res: Response) => {
  const surveyId = req.params.surveyId;
  const status = (req.query?.status as string) || undefined;
  try {
    const storage = mastra.getStorage() as any;
    const db = storage?.db;
    if (!db) return res.status(500).json({ error: 'DB not initialized' });
    // Validate status if provided
    const allowed = ['active','completed','abandoned'];
    if (status && !allowed.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Allowed: ${allowed.join(',')}` });
    }

    // Group by session_id and collect distinct phones for each session
    let rows: any[] = [];
    if (status) {
      rows = await db.any(
        `SELECT r.session_id, array_agg(DISTINCT r.customer_phone) AS phones
         FROM survey_responses r
         JOIN survey_sessions s ON r.session_id = s.id
         WHERE r.survey_id = $1 AND s.status = $2
         GROUP BY r.session_id
         ORDER BY MAX(r.created_at) DESC`,
        [surveyId, status]
      );
    } else {
      rows = await db.any(
        `SELECT r.session_id, array_agg(DISTINCT r.customer_phone) AS phones
         FROM survey_responses r
         JOIN survey_sessions s ON r.session_id = s.id
         WHERE r.survey_id = $1
         GROUP BY r.session_id
         ORDER BY MAX(r.created_at) DESC`,
        [surveyId]
      );
    }

    const sessions = Array.isArray(rows)
      ? rows.map((r: any) => ({ sessionId: r.session_id, phones: r.phones || [] }))
      : [];

    return res.json({ surveyId, sessions });
  } catch (e) {
    console.error('Failed to fetch participants', e);
    return res.status(500).json({ error: 'failed' });
  }
});



// POST create/save a manual survey JSON into data/<surveyId>.json
const SurveyQuestionSchema = z.object({
  id: z.string(),
  text: z.string(),
  options: z.array(z.string()).optional(),
  type: z.enum(['button', 'list', 'text']),
  sectionTitle: z.string().optional(),
  placeholder: z.string().optional(),
});

const SurveyTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  questions: z.array(SurveyQuestionSchema),
});

app.post('/admin/survey', async (req: Request, res: Response) => {
  try {
    const body = req.body;
    const parse = SurveyTemplateSchema.safeParse(body);
    if (!parse.success) {
      return res.status(400).json({ error: 'validation_failed', details: parse.error.format() });
    }

    const tpl = parse.data;
    const outDir = path.join(process.cwd(), 'data');
    try { await fs.mkdir(outDir, { recursive: true }); } catch (e) {}
    const filePath = path.join(outDir, `${tpl.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(tpl, null, 2), 'utf-8');

    return res.status(201).json({ success: true, file: `data/${tpl.id}.json` });
  } catch (e) {
    console.error('Failed to create survey template', e);
    return res.status(500).json({ error: 'failed' });
  }
});



// DELETE manual survey file from data/<surveyId>.json
app.delete('/admin/survey/:surveyId/file', async (req: Request, res: Response) => {
  const surveyId = req.params.surveyId;
  try {
    const filePath = path.join(process.cwd(), 'data', `${surveyId}.json`);
    try {
      await fs.unlink(filePath);
      return res.json({ success: true, file: `data/${surveyId}.json`, deleted: true });
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return res.status(404).json({ error: 'not_found', message: 'file not found' });
      }
      throw err;
    }
  } catch (e) {
    console.error('Failed to delete survey file', e);
    return res.status(500).json({ error: 'failed' });
  }
});

// DELETE survey data from DB (responses + sessions) and remove manual file if present
app.delete('/admin/survey/:surveyId', async (req: Request, res: Response) => {
  const surveyId = req.params.surveyId;
  try {
    const storage = mastra.getStorage() as any;
    const db = storage?.db;
    if (!db) return res.status(500).json({ error: 'DB not initialized' });

    // Delete responses and sessions for this survey
    try {
      await db.query('BEGIN');
      await db.query('DELETE FROM survey_responses WHERE survey_id = $1', [surveyId]);
      await db.query('DELETE FROM survey_sessions WHERE survey_id = $1', [surveyId]);
      await db.query('COMMIT');
    } catch (e) {
      try { await db.query('ROLLBACK'); } catch (_) {}
      throw e;
    }

    // Also attempt to remove a manual file if present
    const filePath = path.join(process.cwd(), 'data', `${surveyId}.json`);
    let fileDeleted = false;
    try {
      await fs.unlink(filePath);
      fileDeleted = true;
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err;
    }

    return res.json({ success: true, surveyId, fileDeleted });
  } catch (e) {
    console.error('Failed to delete survey data', e);
    return res.status(500).json({ error: 'failed' });
  }
});



async function startServer() {
  try {
    const server = new MastraServer({ app: app as any, mastra });
    await server.init();

    const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Error starting server:', error);
    process.exit(1);
  }
}

startServer();
