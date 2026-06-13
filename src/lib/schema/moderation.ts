import { sql } from 'drizzle-orm';
import { pgTable, varchar, text, timestamp, jsonb, serial, index, uuid } from 'drizzle-orm/pg-core';
import { users } from './auth';

export const suggestions = pgTable('suggestions', {
    id: serial('id').primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    entityType: varchar('entity_type', { length: 50 }).notNull(), // 'people', 'movie'
    entityId: varchar('entity_id', { length: 100 }).notNull(),
    suggestionData: jsonb('suggestion_data').notNull(), // The updated fields as JSON
    reason: text('reason'), // User's explanation for the change
    status: varchar('status', { length: 20 }).default('pending').notNull(), // 'pending', 'approved', 'rejected'
    adminComment: text('admin_comment'),
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    reviewedAt: timestamp('reviewed_at'),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp('updated_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => ({
    statusIdx: index('idx_suggestions_status').on(table.status),
    entityIdx: index('idx_suggestions_entity').on(table.entityType, table.entityId),
    userIdIdx: index('idx_suggestions_user').on(table.userId),
}));

export const reports = pgTable('reports', {
    id: serial('id').primaryKey(),
    reporterId: uuid('reporter_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    entityType: varchar('entity_type', { length: 50 }).notNull(), // 'meme', 'tier_list'
    entityId: varchar('entity_id', { length: 100 }).notNull(),
    reason: text('reason').notNull(),
    status: varchar('status', { length: 20 }).default('pending').notNull(), // 'pending', 'resolved', 'dismissed'
    adminComment: text('admin_comment'),
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    reviewedAt: timestamp('reviewed_at'),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp('updated_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => ({
    statusIdx: index('idx_reports_status').on(table.status),
    entityIdx: index('idx_reports_entity').on(table.entityType, table.entityId),
}));
