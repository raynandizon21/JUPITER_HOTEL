-- =====================================================================
--  Jupiter Hotel PMS — database schema
--  MySQL 8.0.16+  (safe to run more than once: CREATE ... IF NOT EXISTS,
--  seed rows use INSERT IGNORE)
--
--  Run:  mysql -u root -p < database/schema.sql
--        or phpMyAdmin → Import → choose this file
-- =====================================================================

CREATE DATABASE IF NOT EXISTS `Jupiter_hotel`
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_general_ci;

USE `Jupiter_hotel`;

-- ---------------------------------------------------------------------
-- NOTE: an older, empty `booking` table (with HOTEL_FEE / ADDT_FEE as
-- VARCHAR, TOTAL_AMOUNT, PAYMENT_STATUS…) already exists in some setups.
-- CREATE TABLE IF NOT EXISTS will NOT replace it. If that old table is
-- still empty, drop it first by un-commenting the next line:
-- DROP TABLE IF EXISTS `booking`;
-- ---------------------------------------------------------------------


-- 1) Staff accounts (who booked / edited) ------------------------------
CREATE TABLE IF NOT EXISTS `users` (
  `IDNo`        INT          NOT NULL AUTO_INCREMENT,
  `USERNAME`    VARCHAR(50)  NOT NULL,
  `FULL_NAME`   VARCHAR(100) NOT NULL,
  `PASSWORD`    VARCHAR(255) NOT NULL COMMENT 'bcrypt hash',
  `ROLE`        ENUM('admin','staff') NOT NULL DEFAULT 'staff',
  `ACTIVE`      TINYINT(1)   NOT NULL DEFAULT 1,
  `CREATED_DT`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`IDNo`),
  UNIQUE KEY `uq_users_username` (`USERNAME`)
) ENGINE=InnoDB;


-- 2) Room types + casino rates (Room Rates page) -----------------------
--    Weekday = Sunday–Thursday · Weekend = Friday–Saturday (holidays use weekend rate)
--    Single/Double = 1–2 guests · Triple = 3 guests
CREATE TABLE IF NOT EXISTS `room_types` (
  `IDNo`                        INT           NOT NULL AUTO_INCREMENT,
  `ROOM_CODE`                   VARCHAR(50)   NOT NULL COMMENT 'e.g. guest_room',
  `ROOM_NAME`                   VARCHAR(100)  NOT NULL COMMENT 'e.g. GUEST ROOM',
  `WEEKDAY_RATE_SINGLE_DOUBLE`  DECIMAL(12,2) NOT NULL,
  `WEEKDAY_RATE_TRIPLE`         DECIMAL(12,2) NOT NULL,
  `WEEKEND_RATE_SINGLE_DOUBLE`  DECIMAL(12,2) NOT NULL,
  `WEEKEND_RATE_TRIPLE`         DECIMAL(12,2) NOT NULL,
  `SORT_ORDER`                  INT           NOT NULL DEFAULT 0,
  `ACTIVE`                      TINYINT(1)    NOT NULL DEFAULT 1,
  `EDITED_DT`                   DATETIME      NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`IDNo`),
  UNIQUE KEY `uq_room_code` (`ROOM_CODE`)
) ENGINE=InnoDB;


-- 3) Voucher / add-on prices (Room Rates page) -------------------------
CREATE TABLE IF NOT EXISTS `addon_rates` (
  `IDNo`        INT           NOT NULL AUTO_INCREMENT,
  `ADDON_CODE`  ENUM('breakfast','dinner','extraBed') NOT NULL,
  `ADDON_NAME`  VARCHAR(100)  NOT NULL,
  `PRICE`       DECIMAL(12,2) NOT NULL,
  `EDITED_DT`   DATETIME      NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`IDNo`),
  UNIQUE KEY `uq_addon_code` (`ADDON_CODE`)
) ENGINE=InnoDB;


-- 3b) Agents — file maintenance list (Agents page). A new name typed in the
--     booking form is added here automatically when the booking is saved.
CREATE TABLE IF NOT EXISTS `agents` (
  `IDNo`        INT          NOT NULL AUTO_INCREMENT,
  `AGENT_NAME`  VARCHAR(100) NOT NULL,
  `ACTIVE`      TINYINT(1)   NOT NULL DEFAULT 1 COMMENT '0 = hidden from suggestions',
  `CREATED_DT`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `CREATED_BY`  INT          NOT NULL,
  `EDITED_DT`   DATETIME     NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`IDNo`),
  UNIQUE KEY `uq_agents_name` (`AGENT_NAME`),
  CONSTRAINT `fk_agents_user` FOREIGN KEY (`CREATED_BY`) REFERENCES `users` (`IDNo`)
) ENGINE=InnoDB;


-- 4) Bookings (Guest Ledger, Calendar, Daily Settlement, Dashboard) ----
--    Guest total  = ROOM_AMOUNT + SUM(booking_charges.AMOUNT)
--    Guest paid   = SUM(booking_payments.AMOUNT)
--    Status (Paid / Partial / Unpaid) is computed in Node, not stored.
CREATE TABLE IF NOT EXISTS `booking` (
  `IDNo`           INT           NOT NULL AUTO_INCREMENT,
  `APP_ID`         VARCHAR(50)   NOT NULL COMMENT 'the app''s own booking id (key for saving)',
  `CONFIRM_NUM`    VARCHAR(50)   NULL COMMENT 'hotel confirmation number, typed in by staff (unique)',
  `ACCT_NUM`       VARCHAR(50)   NULL COMMENT 'optional account no.',
  `GUEST_NAME`     VARCHAR(150)  NOT NULL,
  `AGENT_ID`       INT           NULL COMMENT 'agents.IDNo',
  `ROOM_TYPE_ID`   INT           NOT NULL,
  `OCCUPANCY`      ENUM('singleDouble','triple') NOT NULL DEFAULT 'singleDouble',
  `HOLIDAY_DATES`  JSON          NULL COMMENT 'nights charged at holiday (weekend) rate, e.g. ["2026-11-19"]',
  `COMP_DATES`     JSON          NULL COMMENT 'complimentary (free) nights, charged 0',
  `CHECK_IN`       DATE          NOT NULL,
  `CHECK_OUT`      DATE          NOT NULL,
  `NIGHTS`         INT           AS (DATEDIFF(`CHECK_OUT`, `CHECK_IN`)) STORED,
  `REF_MONTH`      CHAR(7)       AS (CONCAT(YEAR(`CHECK_IN`), '-', LPAD(MONTH(`CHECK_IN`), 2, '0'))) STORED COMMENT 'settlement month',
  `ROOM_AMOUNT`    DECIMAL(12,2) NOT NULL COMMENT 'room charge for the whole stay',
  `CURRENCY`       ENUM('PHP','KRW') NOT NULL DEFAULT 'PHP',
  `REMARKS`        VARCHAR(500)  NULL,
  `IS_JUPITER_GUEST` TINYINT(1)  NOT NULL DEFAULT 1,
  `ACTIVE`         TINYINT(1)    NOT NULL DEFAULT 1 COMMENT '0 = cancelled / deleted',
  `BOOKING_DATE`   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `BOOKED_BY`      INT           NOT NULL,
  `EDITED_DT`      DATETIME      NULL ON UPDATE CURRENT_TIMESTAMP,
  `EDITED_BY`      INT           NULL,
  PRIMARY KEY (`IDNo`),
  UNIQUE KEY `uq_booking_app_id` (`APP_ID`),
  UNIQUE KEY `uq_booking_confirm` (`CONFIRM_NUM`),
  KEY `idx_booking_checkin` (`CHECK_IN`),
  KEY `idx_booking_refmonth` (`REF_MONTH`),
  KEY `idx_booking_room` (`ROOM_TYPE_ID`),
  CONSTRAINT `chk_booking_dates`  CHECK (`CHECK_OUT` > `CHECK_IN`),
  CONSTRAINT `chk_booking_amount` CHECK (`ROOM_AMOUNT` >= 0),
  CONSTRAINT `fk_booking_room`      FOREIGN KEY (`ROOM_TYPE_ID`) REFERENCES `room_types` (`IDNo`),
  CONSTRAINT `fk_booking_booked_by` FOREIGN KEY (`BOOKED_BY`)    REFERENCES `users` (`IDNo`),
  CONSTRAINT `fk_booking_edited_by` FOREIGN KEY (`EDITED_BY`)    REFERENCES `users` (`IDNo`)
) ENGINE=InnoDB;


-- 5) Extra charges on a guest's bill (Billing → Charges) ---------------
CREATE TABLE IF NOT EXISTS `booking_charges` (
  `IDNo`         INT           NOT NULL AUTO_INCREMENT,
  `BOOKING_ID`   INT           NOT NULL,
  `CHARGE_DATE`  DATE          NOT NULL,
  `CATEGORY`     ENUM('buffet','extraBed','other') NOT NULL DEFAULT 'other',
  `DESCRIPTION`  VARCHAR(200)  NOT NULL,
  `QTY`          INT           NOT NULL DEFAULT 1,
  `UNIT_PRICE`   DECIMAL(12,2) NOT NULL,
  `IS_FREE`      TINYINT(1)    NOT NULL DEFAULT 0 COMMENT '1 = complimentary, charged 0',
  `AMOUNT`       DECIMAL(12,2) AS (`QTY` * `UNIT_PRICE`) STORED,
  `CREATED_DT`   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `CREATED_BY`   INT           NOT NULL,
  PRIMARY KEY (`IDNo`),
  KEY `idx_charges_booking` (`BOOKING_ID`),
  CONSTRAINT `chk_charges_qty`   CHECK (`QTY` > 0),
  CONSTRAINT `chk_charges_price` CHECK (`UNIT_PRICE` >= 0),
  CONSTRAINT `fk_charges_booking` FOREIGN KEY (`BOOKING_ID`) REFERENCES `booking` (`IDNo`) ON DELETE CASCADE,
  CONSTRAINT `fk_charges_user`    FOREIGN KEY (`CREATED_BY`) REFERENCES `users` (`IDNo`)
) ENGINE=InnoDB;


-- 6) Guest payments (Billing → Payments from guest) --------------------
CREATE TABLE IF NOT EXISTS `booking_payments` (
  `IDNo`         INT           NOT NULL AUTO_INCREMENT,
  `BOOKING_ID`   INT           NOT NULL,
  `PAY_DATE`     DATE          NOT NULL,
  `AMOUNT`       DECIMAL(12,2) NOT NULL,
  `METHOD`       ENUM('Cash','Bank Transfer','GCash','Credit Card','Junket Account') NOT NULL DEFAULT 'Cash',
  `REFERENCE`    VARCHAR(100)  NULL COMMENT 'OR no. / bank ref',
  `CREATED_DT`   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `CREATED_BY`   INT           NOT NULL,
  PRIMARY KEY (`IDNo`),
  KEY `idx_payments_booking` (`BOOKING_ID`),
  KEY `idx_payments_date` (`PAY_DATE`),
  CONSTRAINT `chk_payments_amount` CHECK (`AMOUNT` > 0),
  CONSTRAINT `fk_payments_booking` FOREIGN KEY (`BOOKING_ID`) REFERENCES `booking` (`IDNo`) ON DELETE CASCADE,
  CONSTRAINT `fk_payments_user`    FOREIGN KEY (`CREATED_BY`) REFERENCES `users` (`IDNo`)
) ENGINE=InnoDB;


-- 7) Payments from Jupiter to the hotel, per settlement month ----------
CREATE TABLE IF NOT EXISTS `hotel_payments` (
  `IDNo`          INT           NOT NULL AUTO_INCREMENT,
  `SETTLE_MONTH`  CHAR(7)       NOT NULL COMMENT 'e.g. 2026-11',
  `PAY_DATE`      DATE          NOT NULL,
  `AMOUNT`        DECIMAL(12,2) NOT NULL,
  `METHOD`        ENUM('Cash','Bank Transfer','GCash','Credit Card') NOT NULL DEFAULT 'Bank Transfer',
  `REFERENCE`     VARCHAR(100)  NULL,
  `OIC`           VARCHAR(100)  NULL COMMENT 'who handled the payment',
  `REMARKS`       VARCHAR(500)  NULL,
  `CREATED_DT`    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `CREATED_BY`    INT           NOT NULL,
  PRIMARY KEY (`IDNo`),
  KEY `idx_hotel_payments_month` (`SETTLE_MONTH`),
  CONSTRAINT `chk_hotel_payments_amount` CHECK (`AMOUNT` > 0),
  CONSTRAINT `fk_hotel_payments_user` FOREIGN KEY (`CREATED_BY`) REFERENCES `users` (`IDNo`)
) ENGINE=InnoDB;


-- 8) Voucher-only purchases (no room booking) — for the record ---------
--    Shown in the Guest Ledger and Daily Settlement; not part of the hotel settlement totals.
CREATE TABLE IF NOT EXISTS `voucher_sales` (
  `IDNo`        INT          NOT NULL AUTO_INCREMENT,
  `APP_ID`      VARCHAR(50)  NOT NULL COMMENT 'the app''s own id (key for saving)',
  `SALE_DATE`   DATE         NOT NULL,
  `REF_MONTH`   CHAR(7)      AS (CONCAT(YEAR(`SALE_DATE`), '-', LPAD(MONTH(`SALE_DATE`), 2, '0'))) STORED,
  `GUEST_NAME`  VARCHAR(150) NOT NULL,
  `AGENT_ID`    INT          NULL COMMENT 'agents.IDNo',
  `REMARKS`     VARCHAR(500) NULL,
  `ACTIVE`      TINYINT(1)   NOT NULL DEFAULT 1 COMMENT '0 = deleted',
  `CREATED_DT`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `CREATED_BY`  INT          NOT NULL,
  `EDITED_DT`   DATETIME     NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`IDNo`),
  UNIQUE KEY `uq_voucher_sales_app_id` (`APP_ID`),
  KEY `idx_voucher_sales_month` (`REF_MONTH`),
  CONSTRAINT `fk_voucher_sales_user` FOREIGN KEY (`CREATED_BY`) REFERENCES `users` (`IDNo`)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `voucher_sale_items` (
  `IDNo`        INT           NOT NULL AUTO_INCREMENT,
  `SALE_ID`     INT           NOT NULL,
  `CATEGORY`    ENUM('breakfast','dinner','other') NOT NULL DEFAULT 'other',
  `DESCRIPTION` VARCHAR(200)  NOT NULL,
  `QTY`         INT           NOT NULL DEFAULT 1,
  `UNIT_PRICE`  DECIMAL(12,2) NOT NULL,
  `IS_FREE`     TINYINT(1)    NOT NULL DEFAULT 0 COMMENT '1 = complimentary, charged 0',
  `AMOUNT`      DECIMAL(12,2) AS (`QTY` * `UNIT_PRICE`) STORED,
  PRIMARY KEY (`IDNo`),
  KEY `idx_voucher_items_sale` (`SALE_ID`),
  CONSTRAINT `chk_voucher_items_qty` CHECK (`QTY` > 0),
  CONSTRAINT `fk_voucher_items_sale` FOREIGN KEY (`SALE_ID`) REFERENCES `voucher_sales` (`IDNo`) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS `voucher_sale_payments` (
  `IDNo`       INT           NOT NULL AUTO_INCREMENT,
  `SALE_ID`    INT           NOT NULL,
  `PAY_DATE`   DATE          NOT NULL,
  `AMOUNT`     DECIMAL(12,2) NOT NULL,
  `METHOD`     ENUM('Cash','Bank Transfer','GCash','Credit Card','Junket Account') NOT NULL DEFAULT 'Cash',
  `REFERENCE`  VARCHAR(100)  NULL,
  PRIMARY KEY (`IDNo`),
  KEY `idx_voucher_payments_sale` (`SALE_ID`),
  CONSTRAINT `chk_voucher_payments_amount` CHECK (`AMOUNT` > 0),
  CONSTRAINT `fk_voucher_payments_sale` FOREIGN KEY (`SALE_ID`) REFERENCES `voucher_sales` (`IDNo`) ON DELETE CASCADE
) ENGINE=InnoDB;


-- =====================================================================
--  Seed data (only inserted if missing)
-- =====================================================================

-- System user so BOOKED_BY / CREATED_BY have something to point to before login exists.
-- PASSWORD '!' is not a valid bcrypt hash, so this account cannot log in.
INSERT IGNORE INTO `users` (`IDNo`, `USERNAME`, `FULL_NAME`, `PASSWORD`, `ROLE`)
VALUES (1, 'system', 'System', '!', 'admin');

-- Current casino rates (same as the app's Room Rates page)
INSERT IGNORE INTO `room_types`
  (`ROOM_CODE`, `ROOM_NAME`, `WEEKDAY_RATE_SINGLE_DOUBLE`, `WEEKDAY_RATE_TRIPLE`, `WEEKEND_RATE_SINGLE_DOUBLE`, `WEEKEND_RATE_TRIPLE`, `SORT_ORDER`)
VALUES
  ('guest_room',                'GUEST ROOM',                      6050,  7700,  6600,  8250,  1),
  ('guest_room_king',           'GUEST ROOM KING BED',             6050,  7700,  6600,  8250,  2),
  ('guest_room_twin',           'GUEST ROOM TWIN BED',             6050,  7700,  6600,  8250,  3),
  ('guest_room_pool_view',      'GUEST ROOM POOL VIEW',            7590,  9240,  8250,  9900,  4),
  ('guest_room_king_pool_view', 'GUEST ROOM KING POOL VIEW',       7590,  9240,  8250,  9900,  5),
  ('guest_room_twin_pool_view', 'GUEST ROOM TWIN POOL VIEW',       7590,  9240,  8250,  9900,  6),
  ('executive_room',            'EXECUTIVE ROOM',                 10340, 11990, 11000, 12650,  7),
  ('executive_room_balcony',    'EXECUTIVE ROOM WITH BALCONY',    12155, 13805, 13365, 15015,  8),
  ('one_bedroom_suite',         'ONE BEDROOM SUITE',              14575, 16225, 15235, 16885,  9),
  ('one_bedroom_suite_balcony', 'ONE BEDROOM SUITE WITH BALCONY', 17490, 19140, 18150, 19800, 10),
  ('governor_suite',            'GOVERNOR SUITE',                 29590, 31240, 30250, 31900, 11);

INSERT IGNORE INTO `addon_rates` (`ADDON_CODE`, `ADDON_NAME`, `PRICE`)
VALUES
  ('breakfast', 'Breakfast voucher', 725),
  ('dinner',    'Dinner voucher',    1680),
  ('extraBed',  'Extra bed (per night)', 1650);
