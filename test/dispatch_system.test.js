'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('Task 1: Migration v12 dispatch_logs exists and has required schema', () => {
  const rootMigrationPath = path.resolve(__dirname, '../../sql/migration_v12_dispatch_system.sql');
  const webMigrationPath = path.resolve(__dirname, '../sql/migration_v12_dispatch_system.sql');

  assert.ok(fs.existsSync(rootMigrationPath), 'Root migration v12 must exist');
  assert.ok(fs.existsSync(webMigrationPath), 'Web migration v12 must exist');

  const rootSql = fs.readFileSync(rootMigrationPath, 'utf8');
  const webSql = fs.readFileSync(webMigrationPath, 'utf8');

  assert.equal(rootSql, webSql, 'Root and web migration files must be identical');

  // Verify critical table, column, and constraint definitions
  assert.match(rootSql, /CREATE TABLE IF NOT EXISTS public\.dispatch_logs/i);
  assert.match(rootSql, /sender_discord_id TEXT NOT NULL/i);
  assert.match(rootSql, /sender_name TEXT NOT NULL/i);
  assert.match(rootSql, /sender_role TEXT NOT NULL/i);
  assert.match(rootSql, /category TEXT NOT NULL CHECK \(category IN \('PATROL', 'INVESTIGATION', 'ASSEMBLY', 'ANNOUNCEMENT'\)\)/i);
  assert.match(rootSql, /mention_target TEXT NOT NULL DEFAULT 'none'/i);
  assert.match(rootSql, /original_text TEXT NOT NULL/i);
  assert.match(rootSql, /selected_version TEXT NOT NULL CHECK \(selected_version IN \('original', 'ai'\)\)/i);
  assert.match(rootSql, /final_text TEXT NOT NULL/i);
  assert.match(rootSql, /acknowledged_officers JSONB DEFAULT '\[\]'::jsonb/i);
  assert.match(rootSql, /CREATE INDEX IF NOT EXISTS idx_dispatch_logs_created_at/i);
});
