import { connect, update } from '../db';

async function set(id, sent, sentId) {
    const db = await connect();

    const messages = await db.all('SELECT * FROM messages WHERE id = ? ', [id]);
    const message = (messages.length) ? messages[0] : null;

    await db.close();

    return update('messages', message.id, {
        attempt: message.attempt + 1,
        wasSent: sent ? 1 : 0 ,
        sentId
    })

}

export default set;
