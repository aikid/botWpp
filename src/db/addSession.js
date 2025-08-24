import { insert } from '../db';

async function add(token, name, about, icon) {
    
    return insert('sessions',{
        token, name, about, icon
    })
}

export default add;
