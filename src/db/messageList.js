import { connect } from '.';

async function messageList() {
    const db = await connect();
    const rows = await db.all('SELECT * FROM messages WHERE wasSent = 0 and attempt < 10)');
    await db.close();
    return rows;
}

export default messageList;