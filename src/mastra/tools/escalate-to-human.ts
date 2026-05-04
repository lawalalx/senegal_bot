import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import pool from "../../db";




const generateTicketId = () => {
  return 'TICKET-' + Math.random().toString(36).substring(2, 11).toUpperCase()
}

export const escalateTool = createTool({
  id: 'escalate-to-human',
  description: 'Escalate conversation to a human agent',
  
  inputSchema: z.object({
    message: z.string(),
    category: z.enum(['complaint', 'enquiry', 'request']),
    customerPhone: z.string(),
  }),

  outputSchema: z.object({
    success: z.boolean(),
    ticketId: z.string().optional(),
  }),

  execute: async (input, context) => {

    const ticketId = generateTicketId()
    console.log('\n\nEscalating to human agent with message:', input.message)
    const params = [input.message, input.category, 'pending', ticketId, input.customerPhone]

    // Determine DB client: prefer Mastra storage db when available
    const mastraInstance = (context as any)?.mastra ?? (context as any)?.agent?.mastra ?? undefined;
    const storageDb = mastraInstance ? (mastraInstance.getStorage?.() as any)?.db : undefined;

    // STEP 1: Try Mastra Storage DB first
    if (storageDb && typeof storageDb.any === 'function') {
      try {
        await storageDb.any(
          'INSERT INTO escalations (message, category, ticket_status, ticket_id, customer_phone) VALUES ($1, $2, $3, $4, $5)',
          params
        )
        console.log('Ticket created successfully (via Mastra storage)')
        return { success: true, ticketId }
      } catch (error: any) {
        console.error('Error creating ticket (mastra db):', error)
        // If the table doesn't exist (42P01), we can try to fall back or log a specific message
        if (error.code === '42P01') {
           console.error('CRITICAL: The "escalations" table does not exist in the Mastra database. Please create it.');
        }
        // Don't return false yet, try the fallback pool
      }
    }

    // STEP 2: Fallback to local pg pool
    console.log('Attempting to use fallback local pool...');
    let client;
    try {
      client = await pool.connect()
      await client.query(
        'INSERT INTO escalations (message, category, ticket_status, ticket_id, customer_phone) VALUES ($1, $2, $3, $4, $5)',
        params
      )
      console.log('Ticket created successfully (via local pool)')
      return { success: true, ticketId }
    } catch (error: any) {
      console.error('Error creating ticket (pool):', error)
      if (error.code === '42P01') {
           console.error('CRITICAL: The "escalations" table does not exist in the local database. Please create it.');
      }
      return { success: false }
    } finally {
      if (client) {
        try { client.release() } catch (e) { /* ignore */ }
      }
    }
  },
})
