import { connect } from '../db';

async function messageList() {
    const db = await connect();
    const rows = await db.all('SELECT * FROM filas WHERE wasSent = 0 and attempt < 10)');
    await db.close();
    return rows;
}

export { messageList };

