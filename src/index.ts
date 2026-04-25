import "dotenv/config";

import express, { Application, Request, Response } from 'express';
import { MastraServer } from '@mastra/express';
import { mastra } from './mastra';
import { sendWhatsAppMessage } from './whatsapp-client';

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




// WhatsApp Webhook: Handle incoming messages
app.post('/webhook', async (req: Request, res: Response) => {
  const body = req.body;

  try {
    if (body.object) {
      const message = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];


      console.log(
        `\n\This is the message body: ${body.object}\n\n`
      )
      if (message) {
        const from = message.from;

        console.log(`Received message from ${from}:`, message);

        const msgText = message.text?.body || '';
        const interactiveResponse =
          message.interactive?.button_reply ||
          message.interactive?.list_reply ||
          null;

        console.log(
          `Received message from ${from}: ${
            msgText || interactiveResponse?.title || 'non-text message'
          }`
        );

        //  Handle survey response (button/list replies)
        if (interactiveResponse) {
          console.log(
            `Survey Response from ${from}: ${interactiveResponse.id} - ${interactiveResponse.title}`
          );

          try {
            const storage = mastra.getStorage() as any;

            if (!storage.db) {
              throw new Error('DB not initialized');
            }

            const fullId = interactiveResponse.id;
            const parts = fullId.split('_');

            const surveyId = parts.slice(0, 3).join('_');
            const sessionTimestamp = parts[3];
            const sessionId = `${surveyId}_${sessionTimestamp}`;
            const questionKey = parts[4]; // "q6"


            // convert q6 → index 5 (q1 → 0, q2 → 1, etc.)
            const questionIndex = parseInt(questionKey.replace('q', ''), 10) - 1;
            const questionId = `${surveyId}_${sessionTimestamp}_${questionKey}`;

            // ─── Fetch session ───
            const session = await storage.db.oneOrNone(
              `SELECT questions_data FROM survey_sessions WHERE id = $1`,
              [sessionId]
            );

            console.log('Fetched session:', session);

            let questionText = null;

            if (session?.questions_data && Array.isArray(session.questions_data)) {
              const question = session.questions_data[questionIndex];

              questionText =
                question?.text ||
                question?.question ||   // fallback (your actual data uses this)
                question?.title ||
                null;
            }

            const id = `resp_${Date.now()}_${Math.random().toString(36).substring(7)}`;

            await storage.db.none(
              `INSERT INTO survey_responses (
                id,
                survey_id,
                session_id,
                customer_phone,
                question_text,
                question_id,
                response_text,
                response_id,
                created_at
              )
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
              [
                id,
                surveyId,
                sessionId,
                from,
                questionText,
                questionId,
                interactiveResponse.title,
                fullId,
                new Date().toISOString(),
              ]
            );

            console.log('🧠 Question text:', questionText);
            console.log('✅ Stored in DB');

          } catch (err) {
            console.error('❌ DB INSERT FAILED:', err);
          }


          await sendWhatsAppMessage({
            to: from,
            message: `Thank you for your feedback: "${interactiveResponse.title}". We appreciate your time!`,
          });
        }
        
        // 🟢 Handle normal text messages via agent
        else if (msgText) {
          try {
            const agent = mastra.getAgent('engagementAgent'); // ensure name matches mastra config

            const response = await agent.generate(
              [{ role: 'user', content: msgText }],
              {
                memory: {
                  thread: `thread_${from}`,
                  resource: from,
                },
              }
            );
            const reply =
              response?.text?.trim() ||
              "Sorry, I couldn't process that. Please try again.";

            await sendWhatsAppMessage({
              to: from,
              message: reply,
            });
          } catch (error) {
            console.error('Error in agent engagement:', error);

            await sendWhatsAppMessage({
              to: from,
              message:
                "Sorry, something went wrong while processing your message.",
            });
          }
        }
      }

      return res.sendStatus(200);
    }

    return res.sendStatus(404);
  } catch (error) {
    console.error('Webhook processing error:', error);
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
