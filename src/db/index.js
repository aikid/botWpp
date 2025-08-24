import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { dbPath } from '../config'

async function connect() {
    return open({
        filename: dbPath,
        driver: sqlite3.Database
    });
}

async function update(table, id, data) {
    const db = await connect();

    const fields = Object.keys(data);
    const values = Object.values(data);

    if (fields.length === 0) {
        await db.close();
        return { status: "fail", msg: "Nada para atualizar." };
    }

    const setClause = fields.map(field => `${field} = ?`).join(', ');

    await db.run(`UPDATE ${table} SET ${setClause} WHERE id = ?`, [...values, id]);

    const stmt = `UPDATE ${table} SET ${setClause} WHERE id = ?`;

    await db.run(
        stmt,
        [...values, id]
    );

    await db.close();
    return { status: "success", msg: `[TABLE: ${table}]Registro ${id} atualizado com sucesso!` };
}

async function insert(table, data) {
    const db = await connect();

    const fields = Object.keys(data);
    const values = Object.values(data);

    if (fields.length === 0) {
        await db.close();
        return { status: "fail", msg: "Nada para inserir." };
    }

    const stmt = `INSERT INTO ${table} (${fields.join(", ")}) VALUES (${fields.map(field => "?").join(", ")})`;

    await db.run(
        stmt,
        [...values]
    );

    await db.close();
    return { status: "success", msg: `[TABLE: ${table}] Insert realizado com sucesso!` };
}

export { connect, update, insert};
