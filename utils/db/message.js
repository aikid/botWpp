import { connect } from './index.js';

export async function messageList() {
    const db = await connect();
    const rows = await db.all('SELECT * FROM filas');
    await db.close();
    return rows;
}

export async function path_image_in_use(path) {
    const db = await connect();
    const rows = await db.all(
        'SELECT * FROM filas WHERE path_image = ? AND (wasSent = 1 OR (wasSent = 0 AND attempt < 10))',
        [path]
    );
    await db.close();
    return rows;
}
