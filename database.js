            /**
session => Long, groupId =>Long, message => Text, pathImage => vatchar, originalNameImage => vatchar, attempt => int, wasSent => boolean, createdAt => datetime, sentAt => dateTime


             */

import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

// Utilitário para __dirname em ESModules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, 'fila.db');

async function connect() {
    const db = await open({
        filename: dbPath,
        driver: sqlite3.Database
    });
    return db;
}

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
    try {
        return {status: "success", "msg": "Banco de dados criado com sucesso!"}
    } catch (err) {
        return {status: "fail", "error": err.message}
    }
}

export async function messageList() {
    const db = await connect();
    const rows = await db.all('SELECT * FROM filas');
    await db.close();
    return rows;
}

export async function path_image_in_use(path) {
    const db = await connect();
    const rows = await db.all('SELECT * FROM filas WHERE path_image = ? and (wasSent = 1 OR (wasSent = 0 AND attempt < 10))', [path]);
    await db.close();
    return rows;
}

export async function addMessage(message, path_image, image_original_name, pattern) {
    const db = await connect();
    await db.run(
        'INSERT INTO filas (message, path_image, image_original_name, pattern) VALUES (?, ?, ?, ?)',
        [message, path_image, image_original_name, pattern]
    );
    await db.close();
}


export async function clearFilaTable(id) {
    const db = await connect();
    await db.run('DELETE FROM filas WHERE id = ?', [id]);
    await db.close();
}