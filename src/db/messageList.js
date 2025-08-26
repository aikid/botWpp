import { connect } from '.';

async function messageList() {
    const db = await connect();
    const rows = await db.all('SELECT m.*, s.token FROM messages as m inner join sessions as s on m.sessionId = s.id WHERE wasSent = 0 and attempt < 10');
    await db.close();
    return rows;
}

export default messageList;