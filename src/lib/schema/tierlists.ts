import { pgTable, text, timestamp, uuid, jsonb, boolean } from 'drizzle-orm/pg-core';
import { users } from './auth';

export const tierLists = pgTable('tier_list', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description'),
  tiers: jsonb('tiers').$type<{
    S: string[]; A: string[]; B: string[]; C: string[]; D: string[]; F: string[];
  }>().default({ S: [], A: [], B: [], C: [], D: [], F: [] }),
  isPublic: boolean('isPublic').default(true),
  createdAt: timestamp('createdAt', { mode: 'date' }).defaultNow(),
  updatedAt: timestamp('updatedAt', { mode: 'date' }).defaultNow(),
});

export const tierListLikes = pgTable('tier_list_like', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tierListId: uuid('tierListId').notNull().references(() => tierLists.id, { onDelete: 'cascade' }),
  createdAt: timestamp('createdAt', { mode: 'date' }).defaultNow(),
});

export const tierListComments = pgTable('tier_list_comment', {
  id: uuid('id').primaryKey().defaultRandom(),
  tierListId: uuid('tierListId').notNull().references(() => tierLists.id, { onDelete: 'cascade' }),
  userId: uuid('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  parentId: uuid('parentId'),
  content: text('content').notNull(),
  createdAt: timestamp('createdAt', { mode: 'date' }).defaultNow(),
});
