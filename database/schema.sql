-- =====================================================================
--  Business Expense Tracker - MySQL schema
--  Target: MySQL 8.0+ (tested on 8.4 LTS)
--  Idempotent: safe to run multiple times (CREATE ... IF NOT EXISTS).
-- =====================================================================

CREATE DATABASE IF NOT EXISTS expense_tracker
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE expense_tracker;

-- ---------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id             INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  username       VARCHAR(50)   NOT NULL,
  display_name   VARCHAR(100)  NOT NULL,
  email          VARCHAR(255)  NULL,
  password_hash  VARCHAR(255)  NOT NULL,              -- bcrypt hash, never plaintext
  role           ENUM('user','manager') NOT NULL DEFAULT 'user',
  avatar_path    VARCHAR(255)  NULL,                  -- relative path inside /storage/avatars
  created_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_username (username),
  UNIQUE KEY uq_users_email (email),
  CONSTRAINT chk_users_username CHECK (username REGEXP '^[A-Za-z0-9_.-]{3,50}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Expenses  (Feature 1)
--   username      -> filled from the authenticated session, never the form
--   submitted_at  -> filled by MySQL at insert time
--   status        -> always 'not-approved' on insert
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS expenses (
  id            INT UNSIGNED   NOT NULL AUTO_INCREMENT,
  username      VARCHAR(50)    NOT NULL,
  expense_date  DATE           NOT NULL,
  category      ENUM('Travel','Food & Drink','Accommodation','Other') NOT NULL,
  label         VARCHAR(120)   NOT NULL,
  amount        DECIMAL(10,2)  NOT NULL,              -- GBP
  description   TEXT           NULL,                  -- Markdown source (rendered + sanitised on display)
  receipt_path  VARCHAR(255)   NULL,                  -- relative path inside /storage/receipts
  submitted_at  DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status        ENUM('not-approved','approved','declined') NOT NULL DEFAULT 'not-approved',
  PRIMARY KEY (id),
  KEY idx_expenses_user_date (username, expense_date),
  KEY idx_expenses_user_submitted (username, submitted_at),
  KEY idx_expenses_user_category (username, category),
  CONSTRAINT fk_expenses_user FOREIGN KEY (username)
    REFERENCES users (username) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT chk_expenses_amount CHECK (amount > 0),
  CONSTRAINT chk_expenses_label CHECK (CHAR_LENGTH(TRIM(label)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Account activity log (powers the "Recent activity" panel)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS activity_log (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  username    VARCHAR(50)     NOT NULL,
  action      VARCHAR(40)     NOT NULL,
  details     VARCHAR(255)    NULL,
  ip_address  VARCHAR(45)     NULL,
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_activity_user_time (username, created_at),
  CONSTRAINT fk_activity_user FOREIGN KEY (username)
    REFERENCES users (username) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Server-side sessions (used by express-mysql-session)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  session_id  VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  expires     INT UNSIGNED NOT NULL,
  data        MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
  PRIMARY KEY (session_id)
) ENGINE=InnoDB;
