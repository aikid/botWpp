import { connect } from './index.js';

export async function addMessage(message, path_image, image_original_name, pattern) {
    const db = await connect();
    await db.run(
        'INSERT INTO filas (message, path_image, image_original_name, pattern) VALUES (?, ?, ?, ?)',
        [message, path_image, image_original_name, pattern]
    );
    await db.close();
}
