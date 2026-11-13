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


-- 4) Bookings (Guest Ledger, Calendar, Daily Settlement, Dashboard) ----
--    Guest total  = ROOM_AMOUNT + SUM(booking_charges.AMOUNT)
--    Guest paid   = SUM(booking_payments.AMOUNT)
--    Status (Paid / Partial / Unpaid) is computed in Node, not stored.
CREATE TABLE IF NOT EXISTS `booking` (
  `IDNo`           INT           NOT NULL AUTO_INCREMENT,
  `CONFIRM_NUM`    VARCHAR(50)   NOT NULL,
  `ACCT_NUM`       VARCHAR(50)   NULL COMMENT 'optional account no.',
  `GUEST_NAME`     VARCHAR(150)  NOT NULL,
  `ROOM_TYPE_ID`   INT           NOT NULL,
  `OCCUPANCY`      ENUM('singleDouble','triple') NOT NULL DEFAULT 'singleDouble',
  `HOLIDAY_DATES`  JSON          NULL COMMENT 'nights charged at holiday (weekend) rate, e.g. ["2026-11-19"]',
  `CHECK_IN`       DATE          NOT NULL,
  `CHECK_OUT`      DATE          NOT NULL,
  `NIGHTS`         INT           AS (DATEDIFF(`CHECK_OUT`, `CHECK_IN`)) STORED,
  `REF_MONTH`      CHAR(7)       AS (CONCAT(YEAR(`CHECK_IN`), '-', LPAD(MONTH(`CHECK_IN`), 2, '0'))) STORED COMMENT 'settlement month',
  `ROOM_AMOUNT`    DECIMAL(12,2) NOT NULL COMMENT 'room charge for the whole stay',
  `REMARKS`        VARCHAR(500)  NULL,
  `ACTIVE`         TINYINT(1)    NOT NULL DEFAULT 1 COMMENT '0 = cancelled / deleted',
  `BOOKING_DATE`   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `BOOKED_BY`      INT           NOT NULL,
  `EDITED_DT`      DATETIME      NULL ON UPDATE CURRENT_TIMESTAMP,
  `EDITED_BY`      INT           NULL,
  PRIMARY KEY (`IDNo`),
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
  ('guest_room',                'GUEST ROOM',                      6050,  7700,  6600,  8250, 1),
  ('guest_room_pool_view',      'GUEST ROOM POOL VIEW',            7590,  9240,  8250,  9900, 2),
  ('executive_room',            'EXECUTIVE ROOM',                 10340, 11990, 11000, 12650, 3),
  ('executive_room_balcony',    'EXECUTIVE ROOM WITH BALCONY',    12155, 13805, 13365, 15015, 4),
  ('one_bedroom_suite',         'ONE BEDROOM SUITE',              14575, 16225, 15235, 16885, 5),
  ('one_bedroom_suite_balcony', 'ONE BEDROOM SUITE WITH BALCONY', 17490, 19140, 18150, 19800, 6),
  ('governor_suite',            'GOVERNOR SUITE',                 29590, 31240, 30250, 31900, 7);

INSERT IGNORE INTO `addon_rates` (`ADDON_CODE`, `ADDON_NAME`, `PRICE`)
VALUES
  ('breakfast', 'Breakfast voucher', 725),
  ('dinner',    'Dinner voucher',    1680),
  ('extraBed',  'Extra bed (per night)', 1650);
