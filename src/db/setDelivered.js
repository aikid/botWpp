import { connect, update, insert } from '../db';

async function set(sentId) {
    const db = await connect();

    const messages = await db.all('SELECT * FROM messages WHERE sentId = ? ', [sentId]);
    const messageId = messages.length ? messages[0].id : null;

    if (!messageId) return {status: "fail", msg: `Mensagem não encontrada.`};

    const delivereds = await db.all('SELECT * FROM delivereds WHERE messageId = ? ', [messageId]);
    const {id, count} = delivereds;

    await db.close();
    
    if (!id) {
        return insert('delivereds', {
            messageId: messageId
        });
    }

    return update('delivereds', id, {
        count: count + 1
    })
}

export default set;