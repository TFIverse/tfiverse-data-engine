import { pgTable, text, timestamp, uuid, varchar, integer, boolean, unique } from 'drizzle-orm/pg-core';
import { users } from './auth';
import { people } from './content';

export const peopleFollows = pgTable('people_follows', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  personId: varchar('person_id', { length: 100 }).notNull().references(() => people.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  userPersonIdx: unique('user_person_follow_unique').on(table.userId, table.personId),
}));

export const reviews = pgTable('reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  movieSlug: varchar('movie_slug', { length: 255 }).notNull(),
  rating: integer('rating').notNull(),
  reviewText: text('review_text'),
  spoilers: boolean('spoilers').default(false),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const watchedMovies = pgTable('watched_movies', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  movieSlug: varchar('movie_slug', { length: 255 }).notNull(),
  watchedAt: timestamp('watched_at').defaultNow(),
  rating: integer('rating'),
});

export const watchlist = pgTable('watchlist', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  movieSlug: varchar('movie_slug', { length: 255 }).notNull(),
  addedAt: timestamp('added_at').defaultNow(),
});

export const pinnedItems = pgTable('pinned_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  itemType: text('item_type').notNull(),
  itemId: uuid('item_id').notNull(),
  pinnedAt: timestamp('pinned_at').defaultNow(),
});
