import { relations } from 'drizzle-orm';
import { users, accounts, sessions } from './auth';
import { userProfiles, profileViews, userFollows } from './profiles';
import { people, movies, movieCredits, movieOttLinks } from './content';
import { memes, memeLikes, memeViews, memeComments, memeBookmarks } from './memes';
import { tierLists } from './tierlists';
import { reviews, watchedMovies, watchlist, peopleFollows as engagementPeopleFollows } from './engagement';
import { userBadges } from './gamification';

export const userProfilesRelations = relations(userProfiles, ({ one }) => ({
  user: one(users, {
    fields: [userProfiles.userId],
    references: [users.id],
  }),
}));

export const moviesRelations = relations(movies, ({ many }) => ({
  credits: many(movieCredits),
  ottLinks: many(movieOttLinks),
}));

export const movieCreditsRelations = relations(movieCredits, ({ one }) => ({
  movie: one(movies, {
    fields: [movieCredits.movieId],
    references: [movies.id],
  }),
  person: one(people, {
    fields: [movieCredits.personId],
    references: [people.id],
  }),
}));

export const movieOttLinksRelations = relations(movieOttLinks, ({ one }) => ({
  movie: one(movies, {
    fields: [movieOttLinks.movieId],
    references: [movies.id],
  }),
}));

export const memesRelations = relations(memes, ({ one, many }) => ({
  user: one(users, {
    fields: [memes.userId],
    references: [users.id],
  }),
  likes: many(memeLikes),
  views: many(memeViews),
  comments: many(memeComments),
  bookmarks: many(memeBookmarks),
}));

export const memeLikesRelations = relations(memeLikes, ({ one }) => ({
  meme: one(memes, {
    fields: [memeLikes.memeId],
    references: [memes.id],
  }),
  user: one(users, {
    fields: [memeLikes.userId],
    references: [users.id],
  }),
}));

export const memeCommentsRelations = relations(memeComments, ({ one }) => ({
  meme: one(memes, {
    fields: [memeComments.memeId],
    references: [memes.id],
  }),
  user: one(users, {
    fields: [memeComments.userId],
    references: [users.id],
  }),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  accounts: many(accounts),
  sessions: many(sessions),
  profile: one(userProfiles, {
    fields: [users.id],
    references: [userProfiles.userId],
  }),
  reviews: many(reviews),
  watchedMovies: many(watchedMovies),
  watchlist: many(watchlist),
  memes: many(memes),
  tierLists: many(tierLists),
  userBadges: many(userBadges),
  peopleFollows: many(engagementPeopleFollows),
}));

export const peopleRelations = relations(people, ({ many }) => ({
  followers: many(engagementPeopleFollows),
}));

export const peopleFollowsRelations = relations(engagementPeopleFollows, ({ one }) => ({
  user: one(users, {
    fields: [engagementPeopleFollows.userId],
    references: [users.id],
  }),
  person: one(people, {
    fields: [engagementPeopleFollows.personId],
    references: [people.id],
  }),
}));
