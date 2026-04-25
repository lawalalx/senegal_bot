// ─── Database Initialization Script ──────────────────────────────────────────
// Run this once to create the custom survey tables in PostgreSQL.
// Usage: npx tsx src/db-init.ts
//
// Mastra auto-creates its own tables (threads, messages, traces, etc.)
// but we need custom tables for survey tracking.

import pg from 'pg'

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/senegaldb'

async function initDatabase() {
  const pool = new pg.Pool({ connectionString: DATABASE_URL })

  try {
    console.log('🔧 Connecting to PostgreSQL...')
    const client = await pool.connect()

    console.log('📦 Creating survey tables...')

    // Survey sessions — tracks each survey dispatch to a customer
    await client.query(`
      CREATE TABLE IF NOT EXISTS survey_sessions (
        id              TEXT PRIMARY KEY,
        survey_id       TEXT NOT NULL,
        customer_phone  TEXT NOT NULL,
        total_questions INTEGER NOT NULL DEFAULT 1,
        questions_data  JSONB NOT NULL DEFAULT '[]'::jsonb,
        responses_data  JSONB NOT NULL DEFAULT '[]'::jsonb,
        status          TEXT NOT NULL DEFAULT 'in_progress',
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `)

    // Survey responses — individual question-level responses
    await client.query(`
      CREATE TABLE IF NOT EXISTS survey_responses (
        id              TEXT PRIMARY KEY,
        survey_id       TEXT NOT NULL,
        session_id      TEXT NOT NULL,
        customer_phone  TEXT NOT NULL,
        question_text   TEXT,
        question_id     TEXT NOT NULL,
        response_text   TEXT NOT NULL,
        response_id     TEXT,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `)

    // Indexes for fast lookups
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_survey_responses_survey_id ON survey_responses (survey_id);
      CREATE INDEX IF NOT EXISTS idx_survey_responses_phone ON survey_responses (customer_phone);
      CREATE INDEX IF NOT EXISTS idx_survey_sessions_survey_id ON survey_sessions (survey_id);
      CREATE INDEX IF NOT EXISTS idx_survey_sessions_phone ON survey_sessions (customer_phone);
      CREATE INDEX IF NOT EXISTS idx_survey_sessions_status ON survey_sessions (status);
    `)
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_survey_responses_session_id 
      ON survey_responses (session_id);
    `)

    client.release()
    console.log('✅ Database initialized successfully!')
    console.log('   Tables created: survey_sessions, survey_responses')
  } catch (error) {
    console.error('❌ Database initialization failed:', error)
    process.exit(1)
  } finally {
    await pool.end()
  }
}

initDatabase()
