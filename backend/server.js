const path = require("path");
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

require("dotenv").config({ path: path.join(__dirname, ".env") });

const {
    pool,
    initializeDatabase,
    closeDatabase,
    DB_FILE
} = require("./db");

const app = express();
const PORT = Number(process.env.PORT) || 5000;
const SESSION_DAYS = Math.min(
    Math.max(Number(process.env.SESSION_DAYS) || 7, 1),
    30
);

app.disable("x-powered-by");
app.use(cors());
app.use(express.json({ limit: "100kb" }));
app.use((req, res, next) => {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
        req.body = {};
    }

    next();
});

const asyncHandler = (handler) => (req, res, next) =>
    Promise.resolve(handler(req, res, next)).catch(next);

function httpError(status, message) {
    return Object.assign(new Error(message), { status });
}

function describeError(error) {
    if (!error) {
        return "Unknown error";
    }

    if (error.message) {
        return error.message;
    }

    if (Array.isArray(error.errors) && error.errors.length > 0) {
        return error.errors
            .map((item) => item.message || item.code)
            .filter(Boolean)
            .join("; ");
    }

    return error.code || String(error);
}

function normalizeEmail(value) {
    return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isValidEmail(value) {
    return (
        value.length <= 255 &&
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
    );
}

function isValidDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return false;
    }

    const parsed = new Date(`${value}T00:00:00Z`);

    return (
        !Number.isNaN(parsed.getTime()) &&
        parsed.toISOString().slice(0, 10) === value
    );
}

function parsePositiveId(value) {
    const id = Number(value);

    return Number.isInteger(id) && id > 0 ? id : null;
}

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString("hex");
    const hash = crypto.scryptSync(password, salt, 64).toString("hex");

    return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, storedHash) {
    if (typeof storedHash !== "string") {
        return false;
    }

    const parts = storedHash.split("$");

    if (parts.length !== 3 || parts[0] !== "scrypt") {
        return false;
    }

    try {
        const expected = Buffer.from(parts[2], "hex");
        const actual = crypto.scryptSync(password, parts[1], 64);

        return (
            expected.length === actual.length &&
            crypto.timingSafeEqual(expected, actual)
        );
    } catch (error) {
        return false;
    }
}

function hashToken(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
}

async function createSession(userId) {
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);

    await pool.query(
        `INSERT INTO hsm_sessions (user_id, token_hash, expires_at)
         VALUES (?, ?, ?)`,
        [userId, hashToken(token), expiresAt]
    );

    return { token, expiresAt: expiresAt.toISOString() };
}

function mapUser(row) {
    return {
        id: Number(row.id),
        name: row.name,
        email: row.email,
        createdAt: row.created_at
    };
}

function mapBudget(row) {
    return {
        id: Number(row.id),
        totalMoney: Number(row.total_money),
        daysRemaining: Number(row.days_remaining),
        foodBudget: Number(row.food_budget),
        travelBudget: Number(row.travel_budget),
        otherBudget: Number(row.other_budget),
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

function mapExpense(row) {
    return {
        id: Number(row.id),
        name: row.name,
        amount: Number(row.amount),
        category: row.category,
        date: row.expense_date,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

function mapChecklistItem(row) {
    return {
        id: Number(row.id),
        name: row.name,
        completed: Boolean(Number(row.completed)),
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

function parseBudget(body) {
    const totalMoney = Number(body.totalMoney ?? body.total_money);
    const daysRemaining = Number(body.daysRemaining ?? body.days_remaining);
    const foodBudget = Number(body.foodBudget ?? body.food_budget);
    const travelBudget = Number(body.travelBudget ?? body.travel_budget);
    const otherBudget = Number(body.otherBudget ?? body.other_budget);

    const isValid =
        Number.isFinite(totalMoney) &&
        totalMoney >= 0 &&
        Number.isInteger(daysRemaining) &&
        daysRemaining >= 1 &&
        Number.isFinite(foodBudget) &&
        foodBudget >= 0 &&
        Number.isFinite(travelBudget) &&
        travelBudget >= 0 &&
        Number.isFinite(otherBudget) &&
        otherBudget >= 0;

    if (!isValid) {
        throw httpError(
            400,
            "Please provide a valid total, days remaining, and category budgets."
        );
    }

    return { totalMoney, daysRemaining, foodBudget, travelBudget, otherBudget };
}

const authenticate = asyncHandler(async (req, res, next) => {
    const header = req.get("authorization") || "";
    const match = /^Bearer\s+(.+)$/i.exec(header);

    if (!match) {
        throw httpError(401, "Authentication required.");
    }

    const tokenHash = hashToken(match[1].trim());
    const [rows] = await pool.query(
        `SELECT u.id, u.name, u.email, u.created_at,
                s.id AS session_id
         FROM hsm_sessions s
         INNER JOIN hsm_users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > CURRENT_TIMESTAMP
         LIMIT 1`,
        [tokenHash]
    );

    if (rows.length === 0) {
        throw httpError(401, "Invalid or expired session.");
    }

    req.user = mapUser(rows[0]);
    req.sessionId = Number(rows[0].session_id);

    await pool
        .query(
            "UPDATE hsm_sessions SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?",
            [req.sessionId]
        )
        .catch(() => {});

    next();
});

app.get("/", (req, res) => {
    res.json({
        success: true,
        message: "Hostel Survival Manager API is running."
    });
});

app.get(
    "/api/health",
    asyncHandler(async (req, res) => {
        let database = false;

        try {
            await pool.query("SELECT 1");
            database = true;
        } catch (error) {
            database = false;
        }

        res.json({
            status: database ? "ok" : "degraded",
            database: database ? "connected" : "unavailable",
            uptime: Math.round(process.uptime()),
            timestamp: new Date().toISOString()
        });
    })
);

app.get(
    "/api/currency/:from/:to",
    asyncHandler(async (req, res) => {
        const baseCurrency = String(req.params.from).trim().toUpperCase();
        const targetCurrency = String(req.params.to).trim().toUpperCase();

        if (
            !/^[A-Z]{3}$/.test(baseCurrency) ||
            !/^[A-Z]{3}$/.test(targetCurrency)
        ) {
            throw httpError(400, "Currency codes must be three letters.");
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        try {
            const response = await fetch(
                `https://api.frankfurter.dev/v2/rate/${baseCurrency}/${targetCurrency}`,
                {
                    signal: controller.signal,
                    headers: { accept: "application/json" }
                }
            );

            if (!response.ok) {
                throw httpError(
                    response.status === 404 ? 404 : 502,
                    response.status === 404
                        ? "Unsupported currency pair."
                        : "Unable to get currency rate."
                );
            }

            const data = await response.json();

            if (typeof data.rate !== "number") {
                throw httpError(502, "Invalid response from currency service.");
            }

            res.json({
                base: data.base || baseCurrency,
                quote: data.quote || targetCurrency,
                rate: data.rate,
                date: data.date || null
            });
        } catch (error) {
            if (error.name === "AbortError") {
                throw httpError(504, "Currency service timed out.");
            }

            throw error;
        } finally {
            clearTimeout(timeout);
        }
    })
);

app.post(
    "/api/auth/signup",
    asyncHandler(async (req, res) => {
        const name =
            typeof req.body.name === "string" ? req.body.name.trim() : "";
        const email = normalizeEmail(req.body.email);
        const password =
            typeof req.body.password === "string" ? req.body.password : "";

        if (name.length < 2 || name.length > 100) {
            throw httpError(400, "Name must be between 2 and 100 characters.");
        }

        if (!isValidEmail(email)) {
            throw httpError(400, "Please provide a valid email address.");
        }

        if (password.length < 6 || password.length > 128) {
            throw httpError(
                400,
                "Password must be between 6 and 128 characters."
            );
        }

        const [existing] = await pool.query(
            "SELECT id FROM hsm_users WHERE email = ? LIMIT 1",
            [email]
        );

        if (existing.length > 0) {
            throw httpError(409, "An account with this email already exists.");
        }

        let result;

        try {
            [result] = await pool.query(
                `INSERT INTO hsm_users (name, email, password_hash)
                 VALUES (?, ?, ?)`,
                [name, email, hashPassword(password)]
            );
        } catch (error) {
            if (
                error.code === "ER_DUP_ENTRY" ||
                /UNIQUE constraint failed/i.test(error.message || "")
            ) {
                throw httpError(
                    409,
                    "An account with this email already exists."
                );
            }

            throw error;
        }

        const user = {
            id: Number(result.insertId),
            name,
            email,
            createdAt: new Date().toISOString()
        };
        const session = await createSession(user.id);

        res.status(201).json({
            token: session.token,
            expiresAt: session.expiresAt,
            user
        });
    })
);

app.post(
    "/api/auth/login",
    asyncHandler(async (req, res) => {
        const email = normalizeEmail(req.body.email);
        const password =
            typeof req.body.password === "string" ? req.body.password : "";

        if (!isValidEmail(email) || password.length === 0) {
            throw httpError(400, "Please enter your email and password.");
        }

        const [rows] = await pool.query(
            `SELECT id, name, email, password_hash, created_at
             FROM hsm_users
             WHERE email = ?
             LIMIT 1`,
            [email]
        );

        if (
            rows.length === 0 ||
            !verifyPassword(password, rows[0].password_hash)
        ) {
            throw httpError(401, "Incorrect email or password.");
        }

        const session = await createSession(rows[0].id);

        res.json({
            token: session.token,
            expiresAt: session.expiresAt,
            user: mapUser(rows[0])
        });
    })
);

app.get(
    "/api/auth/me",
    authenticate,
    asyncHandler(async (req, res) => {
        res.json({ user: req.user });
    })
);

app.post(
    "/api/auth/logout",
    authenticate,
    asyncHandler(async (req, res) => {
        await pool.query("DELETE FROM hsm_sessions WHERE id = ?", [
            req.sessionId
        ]);

        res.status(204).end();
    })
);

async function getBudget(userId) {
    const [rows] = await pool.query(
        "SELECT * FROM hsm_budgets WHERE user_id = ? LIMIT 1",
        [userId]
    );

    return rows.length > 0 ? mapBudget(rows[0]) : null;
}

async function saveBudget(userId, budget) {
    await pool.query(
        `INSERT INTO hsm_budgets
            (user_id, total_money, days_remaining, food_budget,
             travel_budget, other_budget)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
            total_money = excluded.total_money,
            days_remaining = excluded.days_remaining,
            food_budget = excluded.food_budget,
            travel_budget = excluded.travel_budget,
            other_budget = excluded.other_budget,
            updated_at = CURRENT_TIMESTAMP`,
        [
            userId,
            budget.totalMoney,
            budget.daysRemaining,
            budget.foodBudget,
            budget.travelBudget,
            budget.otherBudget
        ]
    );

    return getBudget(userId);
}

app.get(
    "/api/budget",
    authenticate,
    asyncHandler(async (req, res) => {
        res.json(await getBudget(req.user.id));
    })
);

app.put(
    "/api/budget",
    authenticate,
    asyncHandler(async (req, res) => {
        const budget = parseBudget(req.body);

        res.json(await saveBudget(req.user.id, budget));
    })
);

app.get(
    "/api/budgets",
    authenticate,
    asyncHandler(async (req, res) => {
        const budget = await getBudget(req.user.id);

        res.json(budget ? [budget] : []);
    })
);

app.post(
    "/api/budgets",
    authenticate,
    asyncHandler(async (req, res) => {
        const budget = parseBudget(req.body);

        res.status(201).json(await saveBudget(req.user.id, budget));
    })
);

app.get(
    "/api/expenses",
    authenticate,
    asyncHandler(async (req, res) => {
        const [rows] = await pool.query(
            `SELECT * FROM hsm_expenses
             WHERE user_id = ?
             ORDER BY expense_date DESC, id DESC`,
            [req.user.id]
        );

        res.json(rows.map(mapExpense));
    })
);

app.post(
    "/api/expenses",
    authenticate,
    asyncHandler(async (req, res) => {
        const name =
            typeof (req.body.name ?? req.body.title) === "string"
                ? (req.body.name ?? req.body.title).trim()
                : "";
        const amount = Number(req.body.amount);
        const category =
            typeof req.body.category === "string" && req.body.category.trim()
                ? req.body.category.trim()
                : "Other";
        const date =
            req.body.date ??
            req.body.expense_date ??
            new Date().toISOString().slice(0, 10);

        if (name.length < 1 || name.length > 150) {
            throw httpError(400, "Expense name is required.");
        }

        if (
            req.body.amount === undefined ||
            req.body.amount === null ||
            req.body.amount === "" ||
            !Number.isFinite(amount) ||
            amount <= 0
        ) {
            throw httpError(400, "Amount must be a positive number.");
        }

        if (category.length > 60) {
            throw httpError(400, "Category must be 60 characters or fewer.");
        }

        if (!isValidDate(date)) {
            throw httpError(400, "Date must use the YYYY-MM-DD format.");
        }

        const [result] = await pool.query(
            `INSERT INTO hsm_expenses
                (user_id, name, amount, category, expense_date)
             VALUES (?, ?, ?, ?, ?)`,
            [req.user.id, name, amount, category, date]
        );

        const [rows] = await pool.query(
            "SELECT * FROM hsm_expenses WHERE id = ? AND user_id = ? LIMIT 1",
            [result.insertId, req.user.id]
        );

        res.status(201).json(mapExpense(rows[0]));
    })
);

app.delete(
    "/api/expenses/:id",
    authenticate,
    asyncHandler(async (req, res) => {
        const id = parsePositiveId(req.params.id);

        if (!id) {
            throw httpError(400, "Invalid expense ID.");
        }

        const [result] = await pool.query(
            "DELETE FROM hsm_expenses WHERE id = ? AND user_id = ?",
            [id, req.user.id]
        );

        if (result.affectedRows === 0) {
            throw httpError(404, "Expense not found.");
        }

        res.json({ message: "Expense deleted." });
    })
);

app.get(
    "/api/checklist",
    authenticate,
    asyncHandler(async (req, res) => {
        const [rows] = await pool.query(
            `SELECT * FROM hsm_checklist_items
             WHERE user_id = ?
             ORDER BY created_at DESC, id DESC`,
            [req.user.id]
        );

        res.json(rows.map(mapChecklistItem));
    })
);

app.post(
    "/api/checklist",
    authenticate,
    asyncHandler(async (req, res) => {
        const name =
            typeof (req.body.name ?? req.body.item_name) === "string"
                ? (req.body.name ?? req.body.item_name).trim()
                : "";

        if (name.length < 1 || name.length > 150) {
            throw httpError(400, "Checklist item name is required.");
        }

        const [duplicate] = await pool.query(
            `SELECT id FROM hsm_checklist_items
             WHERE user_id = ? AND LOWER(name) = LOWER(?)
             LIMIT 1`,
            [req.user.id, name]
        );

        if (duplicate.length > 0) {
            throw httpError(409, "This item is already on your checklist.");
        }

        const [result] = await pool.query(
            "INSERT INTO hsm_checklist_items (user_id, name) VALUES (?, ?)",
            [req.user.id, name]
        );

        const [rows] = await pool.query(
            `SELECT * FROM hsm_checklist_items
             WHERE id = ? AND user_id = ?
             LIMIT 1`,
            [result.insertId, req.user.id]
        );

        res.status(201).json(mapChecklistItem(rows[0]));
    })
);

app.patch(
    "/api/checklist/:id",
    authenticate,
    asyncHandler(async (req, res) => {
        const id = parsePositiveId(req.params.id);
        const completed = req.body.completed ?? req.body.is_completed;

        if (!id) {
            throw httpError(400, "Invalid checklist item ID.");
        }

        if (typeof completed !== "boolean") {
            throw httpError(400, "completed must be true or false.");
        }

        const [result] = await pool.query(
            `UPDATE hsm_checklist_items
             SET completed = ?, updated_at = CURRENT_TIMESTAMP
             WHERE id = ? AND user_id = ?`,
            [completed ? 1 : 0, id, req.user.id]
        );

        if (result.affectedRows === 0) {
            throw httpError(404, "Checklist item not found.");
        }

        const [rows] = await pool.query(
            `SELECT * FROM hsm_checklist_items
             WHERE id = ? AND user_id = ?
             LIMIT 1`,
            [id, req.user.id]
        );

        res.json(mapChecklistItem(rows[0]));
    })
);

app.delete(
    "/api/checklist/completed",
    authenticate,
    asyncHandler(async (req, res) => {
        const [result] = await pool.query(
            `DELETE FROM hsm_checklist_items
             WHERE user_id = ? AND completed = 1`,
            [req.user.id]
        );

        res.json({
            message: "Completed checklist items cleared.",
            deleted: result.affectedRows
        });
    })
);

app.delete(
    "/api/checklist/:id",
    authenticate,
    asyncHandler(async (req, res) => {
        const id = parsePositiveId(req.params.id);

        if (!id) {
            throw httpError(400, "Invalid checklist item ID.");
        }

        const [result] = await pool.query(
            `DELETE FROM hsm_checklist_items
             WHERE id = ? AND user_id = ?`,
            [id, req.user.id]
        );

        if (result.affectedRows === 0) {
            throw httpError(404, "Checklist item not found.");
        }

        res.json({ message: "Checklist item deleted." });
    })
);

app.use((req, res) => {
    res.status(404).json({ message: "API route not found." });
});

app.use((error, req, res, next) => {
    if (res.headersSent) {
        return next(error);
    }

    let status = error.status || 500;
    let message = error.message || "Internal server error.";

    if (error.type === "entity.parse.failed") {
        status = 400;
        message = "Invalid JSON body.";
    } else if (
        !error.status &&
        [
            "SQLITE_CANTOPEN",
            "SQLITE_READONLY",
            "SQLITE_BUSY",
            "SQLITE_FULL",
            "SQLITE_IOERR",
            "SQLITE_CORRUPT"
        ].includes(error.code)
    ) {
        status = 503;
        message =
            "Database unavailable. Check the SQLite file in backend/data.";
    } else if (!error.status && status >= 500) {
        message = "Internal server error.";
    }

    if (status >= 500) {
        console.error(error);
    }

    res.status(status).json({ message });
});

let server;

async function start() {
    let databaseReady = false;

    try {
        await initializeDatabase();
        databaseReady = true;
        console.log(`SQLite connected and tables are ready in "${DB_FILE}".`);
    } catch (error) {
        console.error(
            "WARNING: Could not initialize SQLite:",
            describeError(error)
        );
        console.error(
            "Check that the backend/data folder is writable. Database routes will return 503 until it is available."
        );
    }

    server = app.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);

        if (!databaseReady) {
            console.log("Running in degraded mode (database unavailable).");
        }
    });
}

async function shutdown(signal) {
    console.log(`${signal} received. Shutting down...`);

    if (!server) {
        process.exit(0);
    }

    server.close(async () => {
        try {
            await closeDatabase();
        } catch (error) {
            console.error("Failed to close the SQLite database:", error.message);
        }

        process.exit(0);
    });

    setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

module.exports = app;

start();
