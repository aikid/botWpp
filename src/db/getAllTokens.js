import { connect } from '.';

async function query() {
    const db = await connect();
    const rows = await db.all('SELECT id, token FROM sessions');
    await db.close();
    return rows;
}

export default query;