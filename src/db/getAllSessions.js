import { connect } from '../db';

async function query() {
    const db = await connect();
    const rows = await db.all('SELECT * FROM sessions');
    await db.close();
    return rows;
}

export default query;