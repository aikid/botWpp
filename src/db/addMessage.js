import { insert } from '../db';

async function addMessage(message, path_image, image_original_name, pattern) {

    return insert('messages',{
        message, path_image, image_original_name, pattern
    })    
    
}

export default addMessage;
