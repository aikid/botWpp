import { insert } from '../db';

async function addMessage(message, pathImage, imageOriginalName, pattern) {

    return insert('messages',{
        message, pathImage, imageOriginalName, pattern
    })    
    
}

export default addMessage;
