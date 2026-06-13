import { sql } from 'drizzle-orm';
import { pgTable, varchar, text, timestamp, serial, index, integer, jsonb } from 'drizzle-orm/pg-core';

export const syncLogs = pgTable('sync_logs', {
    id: serial('id').primaryKey(),
    service: varchar('service', { length: 50 }).notNull(), // 'tmdb', 'ott', 'boxoffice'
    status: varchar('status', { length: 20 }).notNull(), // 'running', 'completed', 'failed'
    message: text('message'),
    metadata: jsonb('metadata'), // e.g., { pages_synced: 10, movies_updated: 200 }
    startedAt: timestamp('started_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
    completedAt: timestamp('completed_at'),
}, (table) => ({
    serviceIdx: index('idx_sync_service').on(table.service),
    statusIdx: index('idx_sync_status').on(table.status),
}));
