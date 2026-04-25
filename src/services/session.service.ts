// services/session.service.ts
import type { Pool } from 'pg';

export async function getActiveSurveySession(db: Pool, phone: string) {
  const result = await db.query(
    `SELECT * FROM survey_sessions
     WHERE customer_phone = $1
     AND status = 'active'
     ORDER BY created_at DESC
     LIMIT 1`,
    [phone]
  );

  console.log(`\n\nChecked active session for phone ${phone}. Found: ${result.rows.length > 0}`);
  console.log("LOOKUP PHONE:", phone);
  console.log("SESSION RESULT:", result.rows);
  return result.rows[0];
}

export async function updateSessionProgress(db: Pool, sessionId: string, nextIndex: number) {
  const result = await db.query(
    `UPDATE survey_sessions
     SET current_question = $1, updated_at = NOW()
     WHERE id = $2`,
    [nextIndex, sessionId]
  );
  console.log(`\n\nSession ${sessionId} moved to question index ${nextIndex}.`);
  return result;
}


export async function completeSession(db: Pool, sessionId: string) {
  const result = await db.query(
    `UPDATE survey_sessions
     SET status = 'completed', updated_at = NOW()
     WHERE id = $1`,
    [sessionId]
  );
  console.log(`\n\nSession ${sessionId} marked as completed.`);
  return result;
}
