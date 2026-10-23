const path = require("path");
const mysql = require("mysql2/promise");

require("dotenv").config({ path: path.join(__dirname, ".env") });

const DB_NAME = process.env.DB_NAME || "hostel_survival";

if (!/^[A-Za-z0-9_]+$/.test(DB_NAME)) {
    throw new Error("DB_NAME may only contain letters, numbers, and underscores.");
}

const connectionOptions = {
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || ""
};

const pool = mysql.createPool({
    ...connectionOptions,
    database: DB_NAME,
    charset: "utf8mb4",
    connectTimeout: 5000,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    dateStrings: true
});

const tableStatements = [
    `CREATE TABLE IF NOT EXISTS hsm_users (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(255) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_hsm_users_email (email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    `CREATE TABLE IF NOT EXISTS hsm_sessions (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id BIGINT UNSIGNED NOT NULL,
        token_hash CHAR(64) NOT NULL,
        expires_at DATETIME NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_used_at DATETIME NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_hsm_sessions_token (token_hash),
        KEY idx_hsm_sessions_user (user_id),
        CONSTRAINT fk_hsm_sessions_user FOREIGN KEY (user_id)
            REFERENCES hsm_users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    `CREATE TABLE IF NOT EXISTS hsm_budgets (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id BIGINT UNSIGNED NOT NULL,
        total_money DECIMAL(12, 2) NOT NULL DEFAULT 0,
        days_remaining INT UNSIGNED NOT NULL DEFAULT 1,
        food_budget DECIMAL(12, 2) NOT NULL DEFAULT 0,
        travel_budget DECIMAL(12, 2) NOT NULL DEFAULT 0,
        other_budget DECIMAL(12, 2) NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_hsm_budgets_user (user_id),
        CONSTRAINT fk_hsm_budgets_user FOREIGN KEY (user_id)
            REFERENCES hsm_users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    `CREATE TABLE IF NOT EXISTS hsm_expenses (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id BIGINT UNSIGNED NOT NULL,
        name VARCHAR(150) NOT NULL,
        amount DECIMAL(12, 2) NOT NULL,
        category VARCHAR(60) NOT NULL DEFAULT 'Other',
        expense_date DATE NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_hsm_expenses_user_date (user_id, expense_date),
        CONSTRAINT fk_hsm_expenses_user FOREIGN KEY (user_id)
            REFERENCES hsm_users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    `CREATE TABLE IF NOT EXISTS hsm_checklist_items (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id BIGINT UNSIGNED NOT NULL,
        name VARCHAR(150) NOT NULL,
        completed TINYINT(1) NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_hsm_checklist_user (user_id),
        CONSTRAINT fk_hsm_checklist_user FOREIGN KEY (user_id)
            REFERENCES hsm_users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
];

async function ensureDatabaseExists() {
    let databaseExists = false;

    try {
        const testConnection = await mysql.createConnection({
            ...connectionOptions,
            database: DB_NAME
        });

        await testConnection.end();
        databaseExists = true;
    } catch (error) {
        if (error.code !== "ER_BAD_DB_ERROR") {
            throw error;
        }
    }

    if (databaseExists) {
        return;
    }

    const bootstrap = await mysql.createConnection(connectionOptions);

    try {
        await bootstrap.query(
            `CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
        );
    } finally {
        await bootstrap.end();
    }
}

async function initializeDatabase() {
    await ensureDatabaseExists();

    for (const statement of tableStatements) {
        await pool.query(statement);
    }

    await pool.query("DELETE FROM hsm_sessions WHERE expires_at <= NOW()");
}

async function closeDatabase() {
    await pool.end();
}

module.exports = {
    pool,
    initializeDatabase,
    closeDatabase,
    DB_NAME
};
