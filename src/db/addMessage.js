import { insert } from '../db';

async function addMessage(message, pathImage, imageOriginalName, groupId) {

    return insert('messages',{
        message, pathImage, imageOriginalName, groupId
    })    
    
}

export default addMessage;
