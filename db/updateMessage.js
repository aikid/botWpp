import { connect } from '../db';

async function updateFila(id, data) {
    const db = await connect();

    const fields = Object.keys(data);
    const values = Object.values(data);

    if (fields.length === 0) {
        await db.close();
        return { status: "fail", msg: "Nada para atualizar." };
    }

    const setClause = fields.map(field => `${field} = ?`).join(', ');

    await db.run(`UPDATE filas SET ${setClause} WHERE id = ?`, [...values, id]);

    await db.close();
    return { status: "success", msg: `Registro ${id} atualizado com sucesso!` };
}

export { updateFila };
