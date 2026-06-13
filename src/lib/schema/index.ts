export * from './auth';
export * from './profiles';
export * from './content';
export * from './engagement';
export * from './memes';
export * from './tierlists';
export * from './gamification';
export * from './misc';
export * from './relations';
export * from './moderation';
export * from './tracking';
export * from './sync';




import { users } from './auth';
import { people, movies, movieCredits, movieOttLinks } from './content';
import { reviews, watchedMovies, watchlist, peopleFollows } from './engagement';
import { tierLists } from './tierlists';
import { memes } from './memes';
import { notifications, rumors } from './misc';

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Person = typeof people.$inferSelect;
export type NewPerson = typeof people.$inferInsert;
export type PeopleFollow = typeof peopleFollows.$inferSelect;
export type NewPeopleFollow = typeof peopleFollows.$inferInsert;
export type Review = typeof reviews.$inferSelect;
export type NewReview = typeof reviews.$inferInsert;
export type WatchedMovie = typeof watchedMovies.$inferSelect;
export type WatchlistItem = typeof watchlist.$inferSelect;
export type TierList = typeof tierLists.$inferSelect;
export type NewTierList = typeof tierLists.$inferInsert;
export type Meme = typeof memes.$inferSelect;
export type NewMeme = typeof memes.$inferInsert;
export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
export type Movie = typeof movies.$inferSelect;
export type NewMovie = typeof movies.$inferInsert;
export type MovieCredit = typeof movieCredits.$inferSelect;
export type NewMovieCredit = typeof movieCredits.$inferInsert;
export type MovieOttLink = typeof movieOttLinks.$inferSelect;
export type NewMovieOttLink = typeof movieOttLinks.$inferInsert;
export type Rumor = typeof rumors.$inferSelect;
export type NewRumor = typeof rumors.$inferInsert;
