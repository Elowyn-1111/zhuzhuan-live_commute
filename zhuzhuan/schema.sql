PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE, phone TEXT UNIQUE, password_hash TEXT NOT NULL, display_name TEXT NOT NULL DEFAULT '住住安用户', role TEXT NOT NULL DEFAULT 'user', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, suspended_at TEXT);
CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS stations (id TEXT PRIMARY KEY, name TEXT NOT NULL, line TEXT NOT NULL, lines_json TEXT NOT NULL DEFAULT '[]', minutes INTEGER NOT NULL DEFAULT 0, transfers INTEGER NOT NULL DEFAULT 0, lng REAL, lat REAL, source TEXT NOT NULL DEFAULT 'demo');
CREATE TABLE IF NOT EXISTS communities (id TEXT PRIMARY KEY, name TEXT NOT NULL, area REAL, layout TEXT, price INTEGER, station_id TEXT, walk_minutes INTEGER NOT NULL DEFAULT 30, cycle_minutes INTEGER NOT NULL DEFAULT 15, review_score REAL NOT NULL DEFAULT 0, summary TEXT NOT NULL DEFAULT '', size INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'visible', lng REAL, lat REAL, source TEXT NOT NULL DEFAULT 'demo');
CREATE TABLE IF NOT EXISTS community_pois (id TEXT PRIMARY KEY, community_id TEXT NOT NULL, category TEXT NOT NULL, name TEXT NOT NULL, distance_m INTEGER, lng REAL, lat REAL, source TEXT NOT NULL DEFAULT 'amap');
CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, city TEXT NOT NULL DEFAULT '上海', user_id TEXT REFERENCES users(id) ON DELETE SET NULL, region TEXT NOT NULL, line TEXT NOT NULL, layout TEXT NOT NULL, rent INTEGER NOT NULL CHECK (rent >= 0), title TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', contact TEXT NOT NULL, image_key TEXT, status TEXT NOT NULL DEFAULT 'visible', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS favorites (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, item_type TEXT NOT NULL, item_id TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (user_id, item_type, item_id));
CREATE TABLE IF NOT EXISTS community_reviews (id TEXT PRIMARY KEY, community_id TEXT NOT NULL, user_id TEXT REFERENCES users(id) ON DELETE SET NULL, rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5), body TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'user', status TEXT NOT NULL DEFAULT 'visible', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, reporter_id TEXT REFERENCES users(id) ON DELETE SET NULL, target_type TEXT NOT NULL, target_id TEXT NOT NULL, reason TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS feedback (id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id) ON DELETE SET NULL, body TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS admin_actions (id TEXT PRIMARY KEY, admin_id TEXT REFERENCES users(id) ON DELETE SET NULL, action TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS contact_views (id TEXT PRIMARY KEY, note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE, viewer_id TEXT REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS api_rate_limits (key TEXT NOT NULL, bucket INTEGER NOT NULL, hits INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (key, bucket));
CREATE INDEX IF NOT EXISTS idx_notes_status_created ON notes(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_communities_station ON communities(station_id);
CREATE INDEX IF NOT EXISTS idx_pois_community_category ON community_pois(community_id, category);
CREATE INDEX IF NOT EXISTS idx_contact_views_note ON contact_views(note_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rate_limits_bucket ON api_rate_limits(bucket);

CREATE TABLE IF NOT EXISTS media_objects (key TEXT PRIMARY KEY, owner_id TEXT NOT NULL, size INTEGER NOT NULL CHECK(size > 0), state TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_media_owner ON media_objects(owner_id);
CREATE TABLE IF NOT EXISTS media_storage (id INTEGER PRIMARY KEY CHECK(id = 1), bytes INTEGER NOT NULL DEFAULT 0 CHECK(bytes >= 0));
INSERT OR IGNORE INTO media_storage(id, bytes) VALUES (1, 0);
CREATE TRIGGER IF NOT EXISTS media_reserve AFTER INSERT ON media_objects BEGIN UPDATE media_storage SET bytes = bytes + NEW.size WHERE id = 1; END;
CREATE TRIGGER IF NOT EXISTS media_release AFTER DELETE ON media_objects BEGIN UPDATE media_storage SET bytes = bytes - OLD.size WHERE id = 1; END;
CREATE TABLE IF NOT EXISTS service_usage (scope TEXT NOT NULL, period TEXT NOT NULL, hits INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(scope, period));
