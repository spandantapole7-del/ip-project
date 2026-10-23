const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

require("dotenv").config({ path: path.join(__dirname, ".env") });

const DB_FILE = path.resolve(
    __dirname,
    process.env.DB_FILE || path.join("data", "hostel.db")
);

fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

const database = new DatabaseSync(DB_FILE);

database.exec("PRAGMA journal_mode = WAL");
database.exec("PRAGMA foreign_keys = ON");
database.exec("PRAGMA busy_timeout = 5000");

const tableStatements = [
    `CREATE TABLE IF NOT EXISTS hsm_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL COLLATE NOCASE UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,

    `CREATE TABLE IF NOT EXISTS hsm_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_used_at TEXT,
        FOREIGN KEY (user_id) REFERENCES hsm_users (id)
            ON DELETE CASCADE
    )`,

    `CREATE TABLE IF NOT EXISTS hsm_budgets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL UNIQUE,
        total_money REAL NOT NULL DEFAULT 0,
        days_remaining INTEGER NOT NULL DEFAULT 1,
        food_budget REAL NOT NULL DEFAULT 0,
        travel_budget REAL NOT NULL DEFAULT 0,
        other_budget REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES hsm_users (id)
            ON DELETE CASCADE
    )`,

    `CREATE TABLE IF NOT EXISTS hsm_expenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        amount REAL NOT NULL,
        category TEXT NOT NULL DEFAULT 'Other',
        expense_date TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES hsm_users (id)
            ON DELETE CASCADE
    )`,

    `CREATE TABLE IF NOT EXISTS hsm_checklist_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        completed INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES hsm_users (id)
            ON DELETE CASCADE
    )`,

    `CREATE INDEX IF NOT EXISTS idx_hsm_sessions_user
        ON hsm_sessions (user_id)`,

    `CREATE INDEX IF NOT EXISTS idx_hsm_expenses_user_date
        ON hsm_expenses (user_id, expense_date)`,

    `CREATE INDEX IF NOT EXISTS idx_hsm_checklist_user
        ON hsm_checklist_items (user_id)`
];

function toSqliteDateTime(date) {
    return date.toISOString().slice(0, 19).replace("T", " ");
}

function normalizeParams(params) {
    return params.map((value) => {
        if (value instanceof Date) {
            return toSqliteDateTime(value);
        }

        if (typeof value === "boolean") {
            return value ? 1 : 0;
        }

        if (value === undefined) {
            return null;
        }

        return value;
    });
}

function isReadQuery(sql) {
    return /^\s*(SELECT|PRAGMA|WITH)\b/i.test(sql);
}

const pool = {
    async query(sql, params = []) {
        const statement = database.prepare(sql);
        const values = normalizeParams(params);

        if (isReadQuery(sql)) {
            return [statement.all(...values), []];
        }

        const result = statement.run(...values);
        const affectedRows = Number(result.changes);

        return [
            {
                insertId: Number(result.lastInsertRowid),
                affectedRows,
                changes: affectedRows
            },
            []
        ];
    },

    async end() {
        database.close();
    }
};

async function initializeDatabase() {
    for (const statement of tableStatements) {
        database.exec(statement);
    }

    database.prepare(
        "DELETE FROM hsm_sessions WHERE expires_at <= ?"
    ).run(toSqliteDateTime(new Date()));
}

async function closeDatabase() {
    await pool.end();
}

module.exports = {
    pool,
    initializeDatabase,
    closeDatabase,
    DB_FILE
};
