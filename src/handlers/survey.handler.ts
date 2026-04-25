// handlers/survey.handler.ts

import { Pool } from "pg";
import { saveSurveyResponse } from "../services/response.service";
import { completeSession, updateSessionProgress } from "../services/session.service";


type HandleSurveyMessageParams = {
  db: Pool;
  message: any;
  session: any;
  phone: string;

  sendMessage: (to: string, msg: string) => Promise<void>;

  sendQuestion: (
    to: string,
    question: any,
    session: any
  ) => Promise<void>;
};



export async function handleSurveyMessage({
  db,
  message,
  session,
  phone,
  sendMessage,
  sendQuestion,
}: HandleSurveyMessageParams) {

  const answer =
    message?.text?.body ||
    message?.interactive?.button_reply?.title ||
    message?.interactive?.list_reply?.title

  if (!answer) return


  // 🚪 EXIT FLOW
  const exitAnswer = answer.trim().toLowerCase()
  if (['exit', 'quit', 'stop'].includes(exitAnswer)) {
    await completeSession(db, session.id)

    await sendMessage(
      phone,
      "🚪 You have exited the survey. Your responses have been saved."
    )
    return
  }

  const currentIndex = session.current_question
  const questions = session.questions_data
  const currentQuestion = questions[currentIndex]

  console.log(`📝 Answer received for Q${currentIndex + 1}:`, answer)

  // ─── 1. VALIDATION (ONLY FOR BUTTON/LIST) ─────────────────────
  if (
    (currentQuestion.type === 'button' || currentQuestion.type === 'list') &&
    currentQuestion.options?.length
  ) {
    const normalizedAnswer = answer.toLowerCase().trim()

    const validOptions = currentQuestion.options.map((opt: string) =>
      opt.toLowerCase().trim()
    )

    const isValid = validOptions.includes(normalizedAnswer)

    if (!isValid) {
      console.log("❌ Invalid option provided")

      await sendMessage(
        phone,
        "🙂 Please select from the available options above."
      )

      // 🔁 Re-send SAME question (do NOT move forward)
      return sendQuestion(phone, currentQuestion, session)
    }
  }

  // ─── 2. SAVE RESPONSE ─────────────────────────────────────────
  await saveSurveyResponse({
    db,
    session,
    phone,
    responseText: answer,
    responseId: message.id,
  })

  const nextIndex = currentIndex + 1

  // ─── 3. CHECK IF DONE ─────────────────────────────────────────
  if (nextIndex >= questions.length) {
    await completeSession(db, session.id)

    await sendMessage(phone, "🎉 Thanks! Survey completed.")
    return
  }

  // ─── 4. UPDATE SESSION ────────────────────────────────────────
  await updateSessionProgress(db, session.id, nextIndex)

  // ✅ IMPORTANT: keep in sync with DB
  session.current_question = nextIndex

  const nextQuestion = questions[nextIndex]

  // ─── 5. SEND NEXT QUESTION ────────────────────────────────────
  await sendQuestion(phone, nextQuestion, session)
}
