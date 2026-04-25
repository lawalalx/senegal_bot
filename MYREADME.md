docker run -d --name mastra-postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=senegaldb -p 5432:5432 ankane/pgvector


npx tsx src/db-init.ts                                                           


pnpm webhook
