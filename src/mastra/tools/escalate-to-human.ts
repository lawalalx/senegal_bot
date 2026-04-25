import { createTool } from '@mastra/core/tools'
import { z } from 'zod'

export const escalateTool = createTool({
  id: 'escalate-to-human',
  description: 'Escalate conversation to a human agent',
  
  inputSchema: z.object({
    message: z.string(),
    category: z.enum(['complaint', 'enquiry']),
  }),

  outputSchema: z.object({
    success: z.boolean(),
  }),

  suspendSchema: z.object({
    question: z.string(),
  }),

  resumeSchema: z.object({
    confirmed: z.boolean(),
  }),

  execute: async (input, context) => {
    const { resumeData, suspend } = context?.agent ?? {}

    // STEP 1: Ask for confirmation
    if (!resumeData?.confirmed) {
      return suspend?.({
        question: "Would you like me to escalate this to a human agent?",
      })
    }

    // STEP 2: If confirmed → save and create a ticket
    if (resumeData.confirmed) {
      await db.escalation.create({
        data: {
          message: input.message,
          category: input.category,
          status: 'pending',
        },
      })

      return { success: true }
    }

    return { success: false }
  },
})
