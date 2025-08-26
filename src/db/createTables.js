import { connect } from '.';

async function createTable() {
    const db = await connect();
    await db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            token VARCHAR(70) NOT NULL,
            name VARCHAR(70) NOT NULL,
            about TEXT NULL,
            icon VARCHAR(255) NOT NULL,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sessionId INTEGER,
            groupId VARCHAR(70),
            message TEXT,
            pathImage TEXT,
            imageOriginalName TEXT,
            attempt INTEGER DEFAULT 0,
            wasSent INTEGER DEFAULT 0,
            sentId VARCHAR(255) DEFAULT NULL,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            sentAt DATETIME DEFAULT NULL,
            FOREIGN KEY (sessionId) REFERENCES sessions(id)
        );
        CREATE TABLE IF NOT EXISTS delivereds (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            messageId INTEGER,
            count INTEGER DEFAULT 1,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (messageId) REFERENCES messages(id)
        );
        CREATE TRIGGER IF NOT EXISTS update_sessions_updatedAt
        AFTER UPDATE ON sessions
        FOR EACH ROW
        BEGIN
            UPDATE sessions
            SET updatedAt = CURRENT_TIMESTAMP
            WHERE id = OLD.id;
        END;
        CREATE TRIGGER IF NOT EXISTS update_delivereds_updatedAt
        AFTER UPDATE ON delivereds
        FOR EACH ROW
        BEGIN
            UPDATE delivereds
            SET updatedAt = CURRENT_TIMESTAMP
            WHERE id = OLD.id;
        END;
    `);
    await db.close();
    return { status: "success", msg: "Banco de dados criado com sucesso!" };
}

export default createTable;

