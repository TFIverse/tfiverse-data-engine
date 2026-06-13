import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, varchar, integer, jsonb, real, serial, boolean, index, unique } from 'drizzle-orm/pg-core';

export const people = pgTable('people', {
    id: varchar('id', { length: 100 }).primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    slug: varchar('slug', { length: 255 }).notNull().unique(),
    tmdbPersonId: integer('tmdb_person_id'),
    imdbId: varchar('imdb_id', { length: 50 }),
    category: varchar('category', { length: 100 }).notNull(),
    subcategory: varchar('subcategory', { length: 100 }),
    metadata: jsonb('metadata').notNull(),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp('updated_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    slugIdx: index('idx_people_slug').on(table.slug),
    categoryIdx: index('idx_people_category').on(table.category),
    subcategoryIdx: index('idx_people_subcategory').on(table.subcategory),
    tmdbIdx: index('idx_people_tmdb').on(table.tmdbPersonId),
    catSubcatIdx: index('idx_people_cat_subcat').on(table.category, table.subcategory),
  })
);

export const movies = pgTable('movies', {
    id: serial('id').primaryKey(),
    tmdbId: integer('tmdb_id').notNull().unique(),
    imdbId: varchar('imdb_id', { length: 20 }),
    title: varchar('title', { length: 500 }).notNull(),
    originalTitle: varchar('original_title', { length: 500 }),
    slug: varchar('slug', { length: 500 }).notNull().unique(),
    tagline: varchar('tagline', { length: 500 }),
    overview: text('overview'),
    releaseDate: timestamp('release_date', { mode: 'date' }),
    year: integer('year'),
    runtime: integer('runtime'),
    status: varchar('status', { length: 50 }),
    budget: integer('budget'),
    revenue: integer('revenue'),
    voteAverage: real('vote_average'),
    voteCount: integer('vote_count'),
    popularity: real('popularity'),
    posterUrl: varchar('poster_url', { length: 500 }),
    backdropUrl: varchar('backdrop_url', { length: 500 }),
    trailerUrl: varchar('trailer_url', { length: 500 }),
    metadata: jsonb('metadata').notNull(),
    ottUrls: jsonb('ott_urls'),
    ottFetched: boolean('ott_fetched').default(false),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp('updated_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
    lastOttSyncAt: timestamp('last_ott_sync_at'),
  },
  (table) => ({
    tmdbIdIdx: index('idx_movies_tmdb_id').on(table.tmdbId),
    slugIdx: index('idx_movies_slug').on(table.slug),
    yearIdx: index('idx_movies_year').on(table.year),
    releaseIdx: index('idx_movies_release_date').on(table.releaseDate),
  })
);

export const movieCredits = pgTable('movie_credits', {
    id: serial('id').primaryKey(),
    movieId: integer('movie_id').notNull().references(() => movies.id, { onDelete: 'cascade' }),
    personId: varchar('person_id', { length: 100 }).notNull().references(() => people.id, { onDelete: 'cascade' }),
    tmdbPersonId: integer('tmdb_person_id').notNull(),
    roleType: varchar('role_type', { length: 10 }).notNull(),
    character: varchar('character', { length: 500 }),
    orderIndex: integer('order_index'),
    job: varchar('job', { length: 100 }),
    department: varchar('department', { length: 100 }),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    movieIdx: index('idx_credits_movie').on(table.movieId),
    personIdx: index('idx_credits_person').on(table.personId),
    tmdbPersonIdx: index('idx_credits_tmdb_person').on(table.tmdbPersonId),
    roleIdx: index('idx_credits_role').on(table.roleType),
  })
);

export const movieOttLinks = pgTable('movie_ott_links', {
    id: serial('id').primaryKey(),
    movieId: integer('movie_id').notNull().references(() => movies.id, { onDelete: 'cascade' }),
    platform: varchar('platform', { length: 100 }).notNull(),
    url: text('url'),
    type: varchar('type', { length: 50 }).notNull(),
    region: varchar('region', { length: 10 }).default('IN'),
    isAvailable: boolean('is_available').default(true),
    price: real('price'),
    quality: varchar('quality', { length: 20 }),
    createdAt: timestamp('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
    updatedAt: timestamp('updated_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (table) => ({
    movieIdx: index('idx_movie_ott_movie_id').on(table.movieId),
    platformIdx: index('idx_movie_ott_platform').on(table.platform),
    availableIdx: index('idx_movie_ott_available').on(table.isAvailable),
    regionIdx: index('idx_movie_ott_region').on(table.region),
    uniqueMoviePlatformType: unique('unique_movie_platform_type').on(table.movieId, table.platform, table.type),
  })
);
