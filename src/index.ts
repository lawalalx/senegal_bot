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



app.post('/webhook', async (req: Request, res: Response) => {
  const body = req.body;

  try {
    if (!body.object) {
      return res.sendStatus(404);
    }

    const message = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

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

    // ✅ Call your router (THIS is the key line)
    await routeIncomingMessage({
      db,
      mastra,
      message,
      phone: from,

      sendMessage: async (to: string, msg: string) => {
        await sendWhatsAppMessage({ to, message: msg });
      },

      sendQuestion: async (to: string, question: any, session: any) => {
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
