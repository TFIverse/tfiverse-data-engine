import { pgTable, text, timestamp, uuid, integer, jsonb, boolean, unique } from 'drizzle-orm/pg-core';
import { users } from './auth';

export const memes = pgTable('memes', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description'),
  imageUrl: text('image_url').notNull(),
  tags: jsonb('tags').$type<string[]>().default([]),
  heroTags: jsonb('hero_tags').$type<string[]>().default([]),
  movieTags: jsonb('movie_tags').$type<string[]>().default([]),
  likes: integer('likes').default(0),
  views: integer('views').default(0),
  shares: integer('shares').default(0),
  downloads: integer('downloads').default(0),
  status: text('status').default('pending').notNull(),
  isFeatured: boolean('is_featured').default(false),
  featuredAt: timestamp('featured_at'),
  allowComments: boolean('allow_comments').default(true),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const memeViews = pgTable('meme_views', {
  id: uuid('id').primaryKey().defaultRandom(),
  memeId: uuid('meme_id').notNull().references(() => memes.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  ipAddress: text('ip_address'),
}, (table) => ({
  userMemeViewIdx: unique('user_meme_view_unique').on(table.userId, table.memeId),
}));

export const memeLikes = pgTable('meme_likes', {
  id: uuid('id').primaryKey().defaultRandom(),
  memeId: uuid('meme_id').notNull().references(() => memes.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  userMemeLikeIdx: unique('user_meme_like_unique').on(table.userId, table.memeId),
}));

export const memeDownloads = pgTable('meme_downloads', {
  id: uuid('id').primaryKey().defaultRandom(),
  memeId: uuid('meme_id').notNull().references(() => memes.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const memeComments = pgTable('meme_comments', {
  id: uuid('id').primaryKey().defaultRandom(),
  memeId: uuid('meme_id').notNull().references(() => memes.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  comment: text('comment').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const memeBookmarks = pgTable('meme_bookmarks', {
  id: uuid('id').primaryKey().defaultRandom(),
  memeId: uuid('meme_id').notNull().references(() => memes.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow(),
});

export const memeReports = pgTable('meme_reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  memeId: uuid('meme_id').notNull().references(() => memes.id, { onDelete: 'cascade' }),
  reportedBy: uuid('reported_by').notNull().references(() => users.id, { onDelete: 'cascade' }),
  reason: text('reason').notNull(),
  details: text('details'),
  status: text('status').default('pending'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const memeShares = pgTable('meme_shares', {
  id: uuid('id').primaryKey().defaultRandom(),
  memeId: uuid('meme_id').notNull().references(() => memes.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  platform: text('platform'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
