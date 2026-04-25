import "dotenv/config";

import { Mastra } from '@mastra/core/mastra';
import { registerApiRoute } from '@mastra/core/server';
import { PinoLogger } from '@mastra/loggers';
import { PostgresStore } from '@mastra/pg';
import { surveyWorkflow } from './workflows/survey-workflow';
import { surveyAgent } from './agents/survey-agent';
import { engagementAgent } from './agents/engagement-agent';
import { sendWhatsAppMessageTool } from './tools/send-whatsapp-message-tool';
import { sendWhatsAppSurveyTool } from './tools/send-whatsapp-survey-tool';
import { sendWhatsAppTemplateTool } from './tools/send-whatsapp-template-tool';
import {
  sendWhatsAppMessage,
  sendWhatsAppTemplate,
  markAsRead,
} from '../whatsapp-client';



console.log('DB URL from Mastra Server', process.env.DATABASE_URL);

// ─── PostgreSQL Storage ──────────────────────────────────────────────────────

const pgStorage = new PostgresStore({
  id: 'main-pg-storage',
  connectionString: process.env.DATABASE_URL!,
});

// ─── Mastra Instance ─────────────────────────────────────────────────────────

export const mastra = new Mastra({
  workflows: { surveyWorkflow },
  agents: { surveyAgent, engagementAgent },
  tools: { sendWhatsAppMessageTool, sendWhatsAppSurveyTool, sendWhatsAppTemplateTool },
  storage: pgStorage,
  logger: new PinoLogger({
    name: 'FBNBank-WhatsApp-Agent',
    level: 'info',
  }),
  server: {
    apiRoutes: [

      // ═══════════════════════════════════════════════════════════════════════
      // CRM API: Send survey to a single customer
      // ═══════════════════════════════════════════════════════════════════════

      registerApiRoute('api/crm/send-survey', {
        method: 'POST',
        openapi: {
          summary: 'Send a WhatsApp Survey',
          description: 'Generates and sends a multi-question survey to a single customer via WhatsApp. The Survey Agent creates questions from the topic, and each question is sent as an interactive button message.',
          tags: ['CRM'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['to', 'surveyId', 'topic'],
                  properties: {
                    to: { type: 'string', description: 'Customer WhatsApp number (e.g. 2348163649273)' },
                    surveyId: { type: 'string', description: 'Unique survey identifier from CRM' },
                    topic: { type: 'string', description: 'Topic for AI survey generation (e.g. "Account opening experience")' },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: 'Survey dispatched successfully' },
            400: { description: 'Missing required fields' },
            500: { description: 'Workflow execution failed' },
          },
        },
        handler: async (c) => {
          const body = await c.req.json().catch(() => null);
          if (!body || !body.to || !body.surveyId || !body.topic) {
            return c.json({ error: 'Missing required fields: to, surveyId, topic' }, 400);
          }

          try {
            const m = c.get('mastra');
            const workflow = m.getWorkflow('surveyWorkflow');
            const run = await workflow.createRun();
            const result = await run.start({
              inputData: {
                to: body.to,
                surveyId: body.surveyId,
                topic: body.topic,
              }
            });
            return c.json({ success: true, result });
          } catch (error) {
            console.error('Error executing survey workflow:', error);
            return c.json({ error: 'Failed to execute survey workflow', details: (error as Error).message }, 500);
          }
        },
      }),

      // ═══════════════════════════════════════════════════════════════════════
      // CRM API: Bulk send survey to multiple customers
      // ═══════════════════════════════════════════════════════════════════════

      registerApiRoute('api/crm/bulk-send-survey', {
        method: 'POST',
        openapi: {
          summary: 'Bulk Send WhatsApp Survey',
          description: 'Sends the same AI-generated survey to a list of customers concurrently.',
          tags: ['CRM'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['customers', 'surveyId', 'topic'],
                  properties: {
                    customers: {
                      type: 'array',
                      items: { type: 'object', properties: { to: { type: 'string' } } },
                    },
                    surveyId: { type: 'string' },
                    topic: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: 'Bulk survey dispatch complete' },
            400: { description: 'Invalid payload' },
          },
        },
        handler: async (c) => {
          const body = await c.req.json().catch(() => null);
          if (!body || !body.customers || !Array.isArray(body.customers) || !body.surveyId || !body.topic) {
            return c.json({ error: 'Invalid payload. Need customers array, surveyId, and topic.' }, 400);
          }

          const m = c.get('mastra');
          const workflow = m.getWorkflow('surveyWorkflow');

          const promises = body.customers.map(async (customer: { to: string }) => {
            try {
              const run = await workflow.createRun();
              const result = await run.start({
                inputData: {
                  to: customer.to,
                  surveyId: body.surveyId,
                  topic: body.topic,
                }
              });
              return { to: customer.to, success: true, result };
            } catch (error) {
              console.error(`Error sending to ${customer.to}:`, error);
              return { to: customer.to, success: false, error: (error as Error).message };
            }
          });

          const results = await Promise.all(promises);
          return c.json({ results });
        },
      }),

      // ═══════════════════════════════════════════════════════════════════════
      // CRM API: Send a pre-approved template message
      // ═══════════════════════════════════════════════════════════════════════

      registerApiRoute('api/crm/send-template', {
        method: 'POST',
        openapi: {
          summary: 'Send a WhatsApp Template Message',
          description: 'Sends a pre-approved WhatsApp template message to a customer. Use this for proactive outreach outside the 24-hour window.',
          tags: ['CRM'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['to', 'templateName', 'languageCode'],
                  properties: {
                    to: { type: 'string' },
                    templateName: { type: 'string' },
                    languageCode: { type: 'string' },
                    components: { type: 'array', items: { type: 'object' } },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: 'Template sent successfully' },
            400: { description: 'Missing required fields' },
          },
        },
        handler: async (c) => {
          const body = await c.req.json().catch(() => null);
          if (!body || !body.to || !body.templateName || !body.languageCode) {
            return c.json({ error: 'Missing required fields: to, templateName, languageCode' }, 400);
          }

          try {
            const success = await sendWhatsAppTemplate({
              to: body.to,
              templateName: body.templateName,
              languageCode: body.languageCode,
              components: body.components,
            });
            return c.json({ success });
          } catch (error) {
            return c.json({ error: (error as Error).message }, 500);
          }
        },
      }),

      // ═══════════════════════════════════════════════════════════════════════
      // CRM API: Get survey responses
      // ═══════════════════════════════════════════════════════════════════════

      registerApiRoute('api/crm/survey-responses', {
        method: 'GET',
        openapi: {
          summary: 'Get Survey Responses',
          description: 'Retrieves all survey responses stored in the database. Optionally filter by surveyId.',
          tags: ['CRM'],
          responses: {
            200: { description: 'Survey responses retrieved' },
          },
        },
        handler: async (c) => {
          const surveyId = c.req.query('surveyId');
          try {
            const store = pgStorage;
            const db = (store as any).db;
            if (!db) {
              return c.json({ error: 'Database not available' }, 500);
            }

            let rows;
            if (surveyId) {
              rows = await db.any(
                'SELECT * FROM survey_responses WHERE survey_id = $1 ORDER BY created_at DESC',
                [surveyId]
              );
            } else {
              rows = await db.any('SELECT * FROM survey_responses ORDER BY created_at DESC');
            }
            return c.json({ responses: rows });
          } catch (error) {
            // Table might not exist yet
            return c.json({ responses: [], note: 'No responses yet or table not initialized' });
          }
        },
      }),

      // ═══════════════════════════════════════════════════════════════════════
      // WhatsApp Webhook: Verification (GET)
      // ═══════════════════════════════════════════════════════════════════════

      registerApiRoute('/webhook', {
        method: 'GET',
        requiresAuth: false,
        handler: async (c) => {
          const mode = c.req.query('hub.mode');
          const token = c.req.query('hub.verify_token');
          const challenge = c.req.query('hub.challenge');

          if (mode && token) {
            if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
              console.log('WEBHOOK_VERIFIED');
              return new Response(challenge, { status: 200 });
            } else {
              return new Response('Forbidden', { status: 403 });
            }
          }
          return new Response('Bad Request', { status: 400 });
        },
      }),

      // ═══════════════════════════════════════════════════════════════════════
      // WhatsApp Webhook: Handle incoming messages (POST)
      // ═══════════════════════════════════════════════════════════════════════

      registerApiRoute('/webhook', {
        method: 'POST',
        requiresAuth: false,
        handler: async (c) => {
          const body = await c.req.json().catch(() => null);

          if (!body || !body.object) {
            return new Response('Not Found', { status: 404 });
          }

          const entry = body.entry?.[0];
          const change = entry?.changes?.[0];
          const value = change?.value;
          const message = value?.messages?.[0];

          if (!message) {
            return new Response('OK', { status: 200 });
          }

          const from = message.from;
          const messageId = message.id;

          // Mark message as read
          await markAsRead(messageId).catch(() => {});

          // ─── Handle interactive button replies (survey responses) ───────

          if (message.interactive) {
            const buttonReply = message.interactive.button_reply;
            if (buttonReply) {
              console.log(`📊 Survey response from ${from}: ${buttonReply.id} → "${buttonReply.title}"`);

              // Store response in Postgres
              try {
                const db = (pgStorage as any).db;
                console.log('DB instance:', db);
                if (db) {
                  await db.none(
                    `INSERT INTO survey_responses (id, survey_id, customer_phone, question_id, response_text, response_id, created_at)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    [
                      `resp_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                      buttonReply.id.split('_q')[0] || buttonReply.id,
                      from,
                      buttonReply.id,
                      buttonReply.title,
                      buttonReply.id,
                      new Date().toISOString(),
                    ]
                  );
                }
              } catch (err) {
                console.error('❌ DB INSERT FAILED:', err);
              }

              // Use engagement agent to craft a contextual response
              try {
                const m = c.get('mastra');
                const agent = m.getAgent('engagementAgent');
                const response = await agent.generate([
                  {
                    role: 'user',
                    content: `The customer just responded to a survey question with: "${buttonReply.title}". Please acknowledge their response appropriately.`,
                  },
                ]);
                await sendWhatsAppMessage({ to: from, message: response.text });
              } catch (err) {
                // Fallback if agent fails
                await sendWhatsAppMessage({
                  to: from,
                  message: `Thank you for your feedback! 🙏 Your response "${buttonReply.title}" has been recorded. We truly value your opinion.`,
                });
              }
            }
            return new Response('OK', { status: 200 });
          }

          // ─── Handle text messages (general engagement) ─────────────────

          if (message.text) {
            const msgText = message.text.body;
            console.log(`💬 Message from ${from}: ${msgText}`);

            try {
              const m = c.get('mastra');
              const agent = m.getAgent('engagementAgent');
              const response = await agent.generate(
                [{ role: 'user', content: msgText }],
                 {
                  memory: {
                    thread: `thread_${from}`,
                    resource: from,
                  },
                }
              );
              await sendWhatsAppMessage({ to: from, message: response.text });
            } catch (error) {
              console.error('Error in agent engagement:', error);
              await sendWhatsAppMessage({
                to: from,
                message: '👋 Thank you for reaching out to FBNBank! We are currently experiencing a brief delay. Please try again shortly or call us at +234 1 905 2326.',
              });
            }
          }

          return new Response('OK', { status: 200 });
        },
      }),
    ],
  },
});
