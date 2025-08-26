import { insert } from '../db';

async function addMessage(sessionId, groupId, message, pathImage, imageOriginalName) {

    return insert('messages',{
        sessionId, groupId, message, pathImage, imageOriginalName
    })    
    
}
export default addMessage;
