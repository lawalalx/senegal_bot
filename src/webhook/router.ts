// webhook/router.ts
import { Pool } from 'pg';
import { handleChatMessage } from "../handlers/chat.handler";
import { handleSurveyMessage } from "../handlers/survey.handler";
import { getActiveSurveySession } from "../services/session.service";


import { Mastra } from '@mastra/core';
import { normalizePhone } from '../utils/format_phone';
import { sendSurveyQuestion } from '../utils/survey.sender';

type RouteIncomingMessageParams = {
  db: Pool;
  mastra: Mastra;
  message: any;

  phone: string;

  sendMessage: (to: string, msg: string) => Promise<void>;

  sendQuestion: (
    to: string,
    question: any,
    session?: any
  ) => Promise<void>;
};


export async function routeIncomingMessage({
  db,
  mastra,
  message,
  phone,
  sendMessage,
  sendQuestion,
}: RouteIncomingMessageParams) {

  console.log('Checking session for:', phone);
  const session = await getActiveSurveySession(db, normalizePhone(phone));

  // If in survey → ALWAYS go to survey handler
  if (session) {
    return handleSurveyMessage({
      db,
      message,
      session,
      phone,
      sendMessage,
      sendQuestion: async (to, question, session) => {
        await sendSurveyQuestion({
          to,
          session,
          question,
        })
      },
    });
  }

  //  Otherwise → chat
  if (message.text) {
    return handleChatMessage({
      mastra,
      phone,
      text: message.text.body,
      sendMessage
    });
  }
}
