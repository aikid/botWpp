import { connect } from '../db';

async function del(id) {
    const db = await connect();
    const stmt = 'DELETE FROM sessions WHERE id = ?';

    await db.run(
        stmt,
        [id]
    );

    await db.close();
    
    return true; 
}

export default del;
