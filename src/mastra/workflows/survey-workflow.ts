import "dotenv/config";

import { createStep, createWorkflow } from '@mastra/core/workflows'
import { z } from 'zod'
import { sendWhatsAppSurvey, sendWhatsAppMessage, sendWhatsAppTemplate, sendWhatsAppList } from '../../whatsapp-client'
import { surveyTemplates } from '../../surveyTemplates'

// ─── Step 1: Generate survey content using the Survey Agent ──────────────────

const generateSurveyContent = createStep({
  id: 'generate-survey-content',
  description: 'Generate one or more survey questions from a topic using the Survey Agent',
  inputSchema: z.object({ 
    topic: z.string(),
    surveyId: z.string().optional()
  }),
  outputSchema: z.object({
    questions: z.array(z.object({
      question: z.string(),
      options: z.array(z.string()),
      type: z.enum(['button', 'list', 'text']).optional(),
      text: z.string().optional(),
      sectionTitle: z.string().optional(),
      placeholder: z.string().optional(),
    })),
  }),
  execute: async ({ inputData, mastra }) => {
    // If surveyId matches a demo template, use it
    const demo = surveyTemplates.find(s => s.id === inputData.surveyId)
    if (demo) {
      return {
        questions: demo.questions.map(q => ({
          question: q.text,
          options: q.options || [],
          type: q.type,
          text: q.text,
          sectionTitle: q.sectionTitle,
          placeholder: q.placeholder,
        })),
      }
    }

    const agent = mastra?.getAgent('surveyAgent')
    if (!agent) throw new Error('Survey agent not found')

    // Try multi-question format first
    const response = await agent.generate(
      [{ role: 'user', content: `Generate a detailed multi-question survey about: ${inputData.topic}` }],
      
      {
        structuredOutput: {
          schema: z.object({
            questions: z.array(z.object({
              question: z.string(),
              options: z.array(z.string()),
            })).optional(),
            question: z.string().optional(),
            options: z.array(z.string()).optional(),
          }),
        },
        memory: {
          thread: `survey_thread_${Date.now()}`,
          resource: `survey_${inputData.surveyId || 'default'}`,
        },
      }
    )

    if (!response.object) throw new Error('Failed to generate survey content')

    // Normalize: handle both single-question and multi-question responses
    const obj = response.object
    if (obj.questions && obj.questions.length > 0) {
      return { questions: obj.questions }
    } else if (obj.question && obj.options) {
      return { questions: [{ question: obj.question, options: obj.options }] }
    }

    throw new Error('Invalid survey content structure from agent')
  },
})

// ─── Step 2: Send all survey questions sequentially via WhatsApp ─────────────

const sendSurveyQuestions = createStep({
  id: 'send-survey-questions',
  description: 'Send each survey question as a separate interactive WhatsApp message',
  inputSchema: z.object({
    to: z.string(),
    surveyId: z.string(),
    questions: z.array(z.object({
      question: z.string(),
      options: z.array(z.string()),
      type: z.enum(['button', 'list', 'text']).optional(),
      text: z.string().optional(),
      sectionTitle: z.string().optional(),
      placeholder: z.string().optional(),
    })),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    questionsSent: z.number(),
    surveySessionId: z.string(),
  }),
  execute: async ({ inputData, mastra }) => {
    const { to, surveyId, questions } = inputData
    const surveySessionId = `${surveyId}_${Date.now()}`
    let questionsSent = 0

    // Store survey session in Postgres for response tracking
    const storage = mastra?.getStorage()
    if (storage) {
      try {
        const workflowsStore = await storage.getStore('workflows')
        if (workflowsStore) {
          // Use the underlying db client for custom tables
          const pgStore = storage as any
          if (pgStore.db) {
            await pgStore.db.none(
              `INSERT INTO survey_sessions (id, survey_id, customer_phone, total_questions, questions_data, responses_data, status, created_at, updated_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
              [
                surveySessionId,
                surveyId,
                to,
                questions.length,
                JSON.stringify(questions),
                JSON.stringify([]),
                'in_progress',
                new Date().toISOString(),
                new Date().toISOString(),
              ]
            )
          }
        }
      } catch (err) {
        // Table might not exist yet — we'll handle this gracefully
        console.warn('Could not store survey session (table may not exist):', err)
      }
    }


    for (let i = 0; i < questions.length; i++) {
      const q = questions[i]
      const headerText = i === 0 ? `📊 FBNBank Survey (${questions.length} questions)` : undefined
      const footerText = `Question ${i + 1} of ${questions.length}`
      let sent = false

      // Dynamic UI selection
      if (q.type === 'button' && q.options && q.options.length <= 3) {
        sent = await sendWhatsAppSurvey({
          to,
          surveyId: `${surveySessionId}_q${i + 1}`,
          question: q.text || q.question,
          options: q.options,
          headerText,
          footerText,
        })
      } else if (q.type === 'list' && q.options && q.options.length > 0) {
        sent = await sendWhatsAppList({
          to,
          headerText,
          bodyText: q.text || q.question,
          footerText,
          buttonText: 'Select',
          sections: [
            {
              title: q.sectionTitle || 'Options',
              rows: q.options.map((opt, idx) => ({
                id: `${surveySessionId}_q${i + 1}_opt${idx + 1}`,
                title: opt,
              })),
            },
          ],
        })
      } else if (q.type === 'text') {
        // For open-ended, just send a text message
        // continue; // Skip sending a message for text type, as we will capture the response in the next step
        sent = await sendWhatsAppMessage({
          to,
          message: `${q.text || q.question}\n(Reply with your answer)`,
        })
      }

      if (sent) questionsSent++

      // Small delay between messages to avoid rate limiting
      if (i < questions.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1500))
      }
    }

    return {
      success: questionsSent === questions.length,
      questionsSent,
      surveySessionId,
    }
  },
})

// ─── Workflow: Generate → Send ───────────────────────────────────────────────
export const surveyWorkflow = createWorkflow({
  id: 'survey-workflow',
  inputSchema: z.object({
    to: z.string(),
    surveyId: z.string(),
    topic: z.string(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    questionsSent: z.number(),
    surveySessionId: z.string(),
  }),
} as const)
  .map(async ({ inputData }) => inputData)
  .then(generateSurveyContent)
  .map(async ({ inputData, getInitData }): Promise<{
    to: string;
    surveyId: string;
    questions: Array<{
      question: string;
      options: string[];
      type?: 'button' | 'list' | 'text';
      text?: string;
      sectionTitle?: string;
      placeholder?: string;
    }>;
  }> => {
    const initData = getInitData<typeof surveyWorkflow>()
    return {
      to: initData.to,
      surveyId: initData.surveyId,
      questions: inputData.questions,
    }
  })
  .then(sendSurveyQuestions)

surveyWorkflow.commit()
