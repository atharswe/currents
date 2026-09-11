-- Full-text search over articles.
--
-- This is an external-content FTS5 table: it stores only the inverted index and reads the
-- original values back from `articles` via `content_rowid`. That keeps article text on disk
-- exactly once, at the cost of needing triggers to mirror every write.
CREATE VIRTUAL TABLE `articles_fts` USING fts5(
  title,
  summary,
  content,
  author,
  content='articles',
  content_rowid='id',
  tokenize='porter unicode61 remove_diacritics 2'
);
--> statement-breakpoint
CREATE TRIGGER `articles_fts_insert` AFTER INSERT ON `articles` BEGIN
  INSERT INTO `articles_fts`(rowid, title, summary, content, author)
  VALUES (new.id, new.title, new.summary, new.content, new.author);
END;
--> statement-breakpoint
-- FTS5 external-content tables cannot update in place. Deleting requires replaying the *old*
-- column values so the index can find and remove the existing terms; the 'delete' command is
-- how FTS5 spells that.
CREATE TRIGGER `articles_fts_delete` AFTER DELETE ON `articles` BEGIN
  INSERT INTO `articles_fts`(`articles_fts`, rowid, title, summary, content, author)
  VALUES ('delete', old.id, old.title, old.summary, old.content, old.author);
END;
--> statement-breakpoint
CREATE TRIGGER `articles_fts_update` AFTER UPDATE ON `articles` BEGIN
  INSERT INTO `articles_fts`(`articles_fts`, rowid, title, summary, content, author)
  VALUES ('delete', old.id, old.title, old.summary, old.content, old.author);
  INSERT INTO `articles_fts`(rowid, title, summary, content, author)
  VALUES (new.id, new.title, new.summary, new.content, new.author);
END;
