import { connect } from '../db';

async function pathImageInUse(path) {
    const db = await connect();
    const rows = await db.all(
        'SELECT * FROM filas WHERE pathImage = ? AND (wasSent = 1 OR (wasSent = 0 AND attempt < 10))',
        [path]
    );
    await db.close();
    return rows;
}

export default pathImageInUse;