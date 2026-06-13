import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as trackingSchema from '../lib/schema/tracking';
import * as contentSchema from '../lib/schema/content';
import * as authSchema from '../lib/schema/auth';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

export const db = drizzle(pool, {
  schema: { ...trackingSchema, ...contentSchema, ...authSchema }
});
