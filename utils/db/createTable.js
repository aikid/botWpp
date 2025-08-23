import { connect } from './index.js';

export async function createTable() {
    const db = await connect();
    await db.exec(`
        CREATE TABLE IF NOT EXISTS filas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sessionId TEXT,
            groupId TEXT,
            message TEXT,
            path_image TEXT,
            image_original_name TEXT,
            attempt INTEGER DEFAULT 0,
            wasSent INTEGER DEFAULT 0,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            sentAt DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);
    await db.close();

    return { status: "success", msg: "Banco de dados criado com sucesso!" };
}
